import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core import storage
from app.core.config import settings
from app.models import Attachment
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)

ORPHAN_BATCH_SIZE = 500


@celery_app.task
def ping() -> str:
    """Smoke-test task. Real ones (notifications, file processing, AI) land here."""
    log.info("pong")
    return "pong"


async def purge_orphaned_uploads(db: AsyncSession, older_than: datetime) -> int:
    """Delete uploads never attached to a message. Returns how many were removed.

    Rows go first (atomically re-checking message_id, so an upload attached a moment ago is
    never touched), then their objects.
    """
    from app.messaging_extras import reserved_attachment_ids

    ids = select(Attachment.id).where(
        Attachment.message_id.is_(None),
        Attachment.created_at < older_than,
        # Uploads waiting on a scheduled message aren't orphans.
        Attachment.id.not_in(reserved_attachment_ids()),
    ).limit(ORPHAN_BATCH_SIZE)
    keys = list(
        await db.scalars(
            delete(Attachment)
            .where(Attachment.id.in_(ids), Attachment.message_id.is_(None))
            .returning(Attachment.storage_key)
        )
    )
    await db.commit()
    for key in keys:
        try:
            await asyncio.to_thread(storage.delete, key)
        except Exception:
            log.exception("Could not delete orphaned object %s", key)
    return len(keys)


async def _purge() -> int:
    # A fresh engine per run: Celery tasks don't share the API's event loop.
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with AsyncSession(engine) as db:
            cutoff = datetime.now(UTC) - timedelta(hours=settings.orphan_upload_ttl_hours)
            return await purge_orphaned_uploads(db, cutoff)
    finally:
        await engine.dispose()


@celery_app.task
def delete_orphaned_uploads() -> int:
    count = asyncio.run(_purge())
    log.info("Deleted %d orphaned uploads", count)
    return count


async def _expire_call(call_id: str) -> None:
    # Imported here so the worker only loads the API stack when this task runs.
    from app import calls
    from app.core.db import engine
    from app.core.redis import redis

    try:
        await calls.expire_call(uuid.UUID(call_id))
    finally:
        # Each task run gets a fresh event loop; drop connections bound to this one.
        await engine.dispose()
        await redis.connection_pool.disconnect()


@celery_app.task
def expire_call_invites(call_id: str) -> None:
    """Ring timeout: invites still ringing after RING_TIMEOUT_SECONDS become "missed"."""
    asyncio.run(_expire_call(call_id))


# --- Wave A2 messaging ----------------------------------------------------------------------


async def _with_api_stack(fn):
    """Run an API-side coroutine in a Celery task's own event loop, then drop its connections."""
    from app.core.db import engine
    from app.core.redis import redis

    try:
        return await fn()
    finally:
        await engine.dispose()
        await redis.connection_pool.disconnect()


@celery_app.task
def send_due_scheduled_messages() -> int:
    """Beat (every 30 s): post every due scheduled message exactly once."""
    from app.messaging_extras import deliver_due_scheduled

    count = asyncio.run(_with_api_stack(deliver_due_scheduled))
    if count:
        log.info("Sent %d scheduled messages", count)
    return count


@celery_app.task(soft_time_limit=60, time_limit=90)
def unfurl_message(message_id: str) -> bool:
    """Fetch link previews for a message (SSRF-safe) and broadcast them."""
    from app.core.db import SessionLocal
    from app.messaging_extras import run_unfurls

    async def go() -> bool:
        async with SessionLocal() as db:
            return await run_unfurls(db, uuid.UUID(message_id))

    return asyncio.run(_with_api_stack(go))


async def _deliver_reminders() -> int:
    # The API stack is imported lazily so the worker only loads it when this task runs.
    from app.core.db import SessionLocal, engine
    from app.core.redis import redis
    from app.productivity import deliver_due_reminders

    try:
        async with SessionLocal() as db:
            return await deliver_due_reminders(db)
    finally:
        # Each run gets a fresh event loop; drop connections bound to this one.
        await engine.dispose()
        await redis.connection_pool.disconnect()


@celery_app.task
def deliver_reminders() -> int:
    """Beat (every 30 s): deliver due reminders (self-DM card, activity item, reminder.due)."""
    count = asyncio.run(_deliver_reminders())
    if count:
        log.info("Delivered %d reminders", count)
    return count


# --- Calendar -------------------------------------------------------------------------------


@celery_app.task
def deliver_meeting_alerts() -> int:
    """Beat (every 30 s): meeting reminders (10 min before) and "starting now" rings."""
    from app.core.db import SessionLocal
    from app.meetings import deliver_due

    async def go() -> int:
        async with SessionLocal() as db:
            return await deliver_due(db)

    count = asyncio.run(_with_api_stack(go))
    if count:
        log.info("Sent %d meeting alerts", count)
    return count
