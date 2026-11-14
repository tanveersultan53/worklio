"""Personal productivity services: Threads inbox, Activity feed, reminders and notifications.

Threads and Activity are derived from existing data so they work for history too:

* A user follows a thread when they wrote the root, replied, or were @mentioned in it, unless
  they unfollowed it; or when they followed it explicitly (`thread_subscriptions`).
* Activity is the union of mentions, reactions to the user's messages, replies in followed
  threads, missed calls and stored events (channel invites, delivered reminders, huddle starts).

Realtime hooks for other modules (call them *after* committing):
    on_message_created(db, message)              mentions + thread replies -> activity/threads
    on_reaction_added(db, message, user_id, emoji)
    notify_channel_invite(db, channel, actor_id, user_ids)
    notify_call_missed(db, call_id, user_id)
    notify_huddle_started(call, channel, invited)        huddle audience + activity items
    huddle_end_audience(db, channel)
"""

import base64
import binascii
import hashlib
import logging
import uuid
import zoneinfo
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import (
    Select,
    String,
    and_,
    case,
    cast,
    exists,
    false,
    func,
    literal,
    not_,
    null,
    or_,
    select,
    union_all,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.deps import (
    get_workspace_membership,
    is_guest,
    readable_channel_ids,
    require_channel_access,
)
from app.core.db import SessionLocal
from app.models import (
    ActivityEvent,
    ActivityRead,
    ActivityState,
    Call,
    CallInvite,
    Channel,
    ChannelKind,
    ChannelMember,
    ChannelPref,
    Message,
    MessageMention,
    MessageReaction,
    Reminder,
    ThreadSubscription,
    User,
    WorkspaceMember,
)
from app.realtime.hub import notify_user, publish_to_channel
from app.schemas import DM_NAME_PREFIX
from app.schemas_productivity import ActivityFilter, ActivityItemOut, ReminderOut
from app.services import serialize_message, serialize_messages

log = logging.getLogger(__name__)

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
# Cap on how many followers a single thread reply fans out to in realtime.
MAX_THREAD_FANOUT = 500
REMINDER_BATCH_SIZE = 100


# --- Cursors ------------------------------------------------------------------------------


def encode_cursor(ts: datetime, item_id: uuid.UUID) -> str:
    raw = f"{ts.isoformat()}|{item_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        ts, item_id = raw.split("|", 1)
        parsed = datetime.fromisoformat(ts)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed, uuid.UUID(item_id)
    except (ValueError, UnicodeDecodeError, binascii.Error):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid cursor") from None


def keyset_before(q: Select, ts_col, id_col, cursor: str | None) -> Select:
    """Newest-first keyset pagination: rows strictly after the cursor position."""
    pos = decode_cursor(cursor)
    if pos is None:
        return q
    ts, item_id = pos
    return q.where(or_(ts_col < ts, and_(ts_col == ts, id_col < item_id)))


def page_of(rows: list, limit: int, key) -> tuple[list, str | None]:
    """Split a limit+1 fetch into the page and the cursor for the next one."""
    if len(rows) <= limit:
        return rows, None
    rows = rows[:limit]
    ts, item_id = key(rows[-1])
    return rows, encode_cursor(ts, item_id)


# --- Visibility helpers -------------------------------------------------------------------


async def readable_for(db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID):
    """Readable-channel subquery for a user, or None when they're not in the workspace."""
    member = await get_workspace_membership(db, workspace_id, user_id)
    if not member:
        return None
    return readable_channel_ids(workspace_id, user_id, is_guest(member))


async def can_read_channel(db: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """deps.require_channel_access for someone other than the current user."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        return False
    member = await get_workspace_membership(db, channel.workspace_id, user_id)
    if not member:
        return False
    if channel.kind == ChannelKind.public and not is_guest(member):
        return True
    return bool(
        await db.scalar(
            select(ChannelMember.id).where(
                ChannelMember.channel_id == channel_id, ChannelMember.user_id == user_id
            )
        )
    )


def visible_message(m) -> list:
    """Conditions hiding deleted messages and replies whose thread root was deleted."""
    parent = aliased(Message)
    return [
        m.deleted_at.is_(None),
        not_(
            exists().where(
                parent.id == m.parent_id, parent.deleted_at.is_not(None)
            )
        ),
    ]


def unread_message_filter(user_id: uuid.UUID) -> list:
    """Same rule as the sidebar badge (channels.list_channels): top-level, not mine, not deleted,
    user messages or missed-call cards, newer than the member's last_read_at."""
    return [
        Message.created_at > ChannelMember.last_read_at,
        Message.parent_id.is_(None),
        Message.deleted_at.is_(None),
        Message.author_id != user_id,
        or_(
            Message.kind == "user",
            and_(
                Message.meta["type"].astext == "call",
                Message.meta["status"].astext == "missed",
            ),
        ),
    ]


# --- Threads ------------------------------------------------------------------------------


def followed_threads(workspace_id: uuid.UUID, user_id: uuid.UUID, readable) -> Select:
    """Threads (roots with at least one reply) the user follows, with read baseline.

    Columns: root_id, channel_id, reply_count, last_reply_at, read_until, following.
    """
    r = aliased(Message, name="reply")
    stats = (
        select(
            r.parent_id.label("root_id"),
            func.count().label("reply_count"),
            func.max(r.created_at).label("last_reply_at"),
            func.max(case((r.author_id == user_id, r.created_at))).label("my_last_reply_at"),
        )
        .where(
            r.workspace_id == workspace_id, r.parent_id.is_not(None), r.deleted_at.is_(None)
        )
        .group_by(r.parent_id)
        .subquery("thread_stats")
    )
    mm = aliased(MessageMention)
    mm_msg = aliased(Message)
    mentioned_roots = (
        select(func.coalesce(mm_msg.parent_id, mm_msg.id))
        .join(mm, mm.message_id == mm_msg.id)
        .where(
            mm.user_id == user_id,
            mm.workspace_id == workspace_id,
            mm_msg.deleted_at.is_(None),
        )
    )
    root = aliased(Message, name="root")
    sub = aliased(ThreadSubscription, name="sub")
    derived = or_(
        root.author_id == user_id,
        stats.c.my_last_reply_at.is_not(None),
        root.id.in_(mentioned_roots),
    )
    following = or_(sub.following.is_(True), and_(sub.following.is_(None), derived))
    read_until = func.coalesce(
        func.greatest(sub.last_read_at, stats.c.my_last_reply_at), literal(EPOCH)
    )
    return (
        select(
            root.id.label("root_id"),
            root.channel_id.label("channel_id"),
            stats.c.reply_count,
            stats.c.last_reply_at,
            read_until.label("read_until"),
            sub.following.label("following"),
        )
        .select_from(root)
        .join(stats, stats.c.root_id == root.id)
        .outerjoin(sub, and_(sub.root_id == root.id, sub.user_id == user_id))
        .where(
            root.workspace_id == workspace_id,
            root.parent_id.is_(None),
            root.deleted_at.is_(None),
            root.channel_id.in_(readable),
            following,
        )
    )


def _thread_unread(ft, user_id: uuid.UUID):
    rep = aliased(Message, name="unread_reply")
    return (
        select(func.count())
        .where(
            rep.parent_id == ft.c.root_id,
            rep.deleted_at.is_(None),
            rep.author_id != user_id,
            rep.created_at > ft.c.read_until,
        )
        .correlate(ft)
        .scalar_subquery()
    )


async def list_threads(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    readable,
    *,
    unread_only: bool,
    cursor: str | None,
    limit: int,
) -> tuple[list[dict], str | None]:
    ft = followed_threads(workspace_id, user_id, readable).subquery("ft")
    unread = _thread_unread(ft, user_id)
    q = select(ft, unread.label("unread_count"))
    if unread_only:
        q = q.where(unread > 0)
    q = keyset_before(q, ft.c.last_reply_at, ft.c.root_id, cursor)
    rows = list(
        (
            await db.execute(
                q.order_by(ft.c.last_reply_at.desc(), ft.c.root_id.desc()).limit(limit + 1)
            )
        ).all()
    )
    rows, next_cursor = page_of(rows, limit, lambda r: (r.last_reply_at, r.root_id))
    if not rows:
        return [], next_cursor
    root_ids = [r.root_id for r in rows]

    roots = {m.id: m for m in await db.scalars(select(Message).where(Message.id.in_(root_ids)))}
    rn = (
        func.row_number()
        .over(
            partition_by=Message.parent_id,
            order_by=(Message.created_at.desc(), Message.id.desc()),
        )
        .label("rn")
    )
    latest_ids = (
        select(Message.id, rn)
        .where(Message.parent_id.in_(root_ids), Message.deleted_at.is_(None))
        .subquery()
    )
    latest = list(
        await db.scalars(
            select(Message)
            .join(latest_ids, latest_ids.c.id == Message.id)
            .where(latest_ids.c.rn <= 3)
            .order_by(Message.created_at, Message.id)
        )
    )
    participants: dict[uuid.UUID, list[uuid.UUID]] = {rid: [roots[rid].author_id] for rid in root_ids}
    for pid, uid in await db.execute(
        select(Message.parent_id, Message.author_id)
        .where(Message.parent_id.in_(root_ids), Message.deleted_at.is_(None))
        .group_by(Message.parent_id, Message.author_id)
        .order_by(Message.parent_id, func.min(Message.created_at))
    ):
        if uid not in participants[pid]:
            participants[pid].append(uid)

    serialized = await serialize_messages(
        db, [roots[rid] for rid in root_ids] + latest, viewer_id=user_id
    )
    by_id = {m.id: m for m in serialized}
    latest_by_root: dict[uuid.UUID, list] = {rid: [] for rid in root_ids}
    for m in latest:
        latest_by_root[m.parent_id].append(by_id[m.id])

    items = [
        {
            "root": by_id[r.root_id],
            "channel_id": r.channel_id,
            "reply_count": r.reply_count,
            "last_reply_at": r.last_reply_at,
            "unread_count": r.unread_count,
            "participant_ids": participants[r.root_id],
            "latest_replies": latest_by_root[r.root_id],
            "following": True,
        }
        for r in rows
    ]
    return items, next_cursor


async def thread_unread_count(db: AsyncSession, user_id: uuid.UUID, root: Message) -> int:
    """Unread replies in one thread for a user (whether or not they follow it)."""
    sub = await db.scalar(
        select(ThreadSubscription.last_read_at).where(
            ThreadSubscription.user_id == user_id, ThreadSubscription.root_id == root.id
        )
    )
    mine = await db.scalar(
        select(func.max(Message.created_at)).where(
            Message.parent_id == root.id,
            Message.author_id == user_id,
            Message.deleted_at.is_(None),
        )
    )
    baseline = max(x for x in (sub, mine, EPOCH) if x is not None)
    return await db.scalar(
        select(func.count()).where(
            Message.parent_id == root.id,
            Message.deleted_at.is_(None),
            Message.author_id != user_id,
            Message.created_at > baseline,
        )
    ) or 0


async def is_following(db: AsyncSession, user_id: uuid.UUID, root: Message) -> bool:
    explicit = await db.scalar(
        select(ThreadSubscription.following).where(
            ThreadSubscription.user_id == user_id, ThreadSubscription.root_id == root.id
        )
    )
    if explicit is not None:
        return explicit
    return user_id in await _derived_followers(db, root)


async def _derived_followers(db: AsyncSession, root: Message) -> set[uuid.UUID]:
    ids = {root.author_id}
    ids |= set(
        await db.scalars(
            select(Message.author_id)
            .where(Message.parent_id == root.id, Message.deleted_at.is_(None))
            .distinct()
        )
    )
    ids |= set(
        await db.scalars(
            select(MessageMention.user_id)
            .join(Message, Message.id == MessageMention.message_id)
            .where(
                or_(Message.id == root.id, Message.parent_id == root.id),
                Message.deleted_at.is_(None),
            )
            .distinct()
        )
    )
    return ids


async def thread_followers(db: AsyncSession, root: Message) -> set[uuid.UUID]:
    explicit = dict(
        (
            await db.execute(
                select(ThreadSubscription.user_id, ThreadSubscription.following).where(
                    ThreadSubscription.root_id == root.id,
                    ThreadSubscription.following.is_not(None),
                )
            )
        ).all()
    )
    derived = await _derived_followers(db, root)
    return {u for u in derived if explicit.get(u) is not False} | {
        u for u, f in explicit.items() if f
    }


async def set_thread_state(
    db: AsyncSession,
    user_id: uuid.UUID,
    root: Message,
    *,
    following: bool | None = None,
    read: bool = False,
) -> None:
    values: dict = {}
    if following is not None:
        values["following"] = following
    if read:
        values["last_read_at"] = func.now()
    await db.execute(
        pg_insert(ThreadSubscription)
        .values(id=uuid.uuid4(), user_id=user_id, workspace_id=root.workspace_id, root_id=root.id, **values)
        .on_conflict_do_update(
            index_elements=["user_id", "root_id"], set_={**values, "updated_at": func.now()}
        )
    )


async def publish_thread_state(db: AsyncSession, user_id: uuid.UUID, root: Message) -> None:
    await notify_user(
        user_id,
        {
            "type": "thread.updated",
            "root_id": str(root.id),
            "channel_id": str(root.channel_id),
            "unread_count": await thread_unread_count(db, user_id, root),
            "following": await is_following(db, user_id, root),
        },
    )


# --- Activity -----------------------------------------------------------------------------


def _lit(value: str):
    return cast(literal(value), String(32))


def _null_text():
    return cast(null(), String(32))


def _null_json():
    return cast(null(), JSONB)


def _row(*cols) -> Select:
    """One activity source as a SELECT with the union's column names."""
    names = (
        "id", "type", "created_at", "actor_id", "channel_id", "message_id", "emoji",
        "implicit_read", "meta",
    )
    return select(*(c.label(n) for c, n in zip(cols, names, strict=True)))


def activity_union(
    workspace_id: uuid.UUID, user_id: uuid.UUID, readable, kind: ActivityFilter = "all"
):
    """Subquery of every activity item for the user: id, type, created_at, actor_id,
    channel_id, message_id, emoji, implicit_read, meta."""
    parts = []

    if kind in ("all", "mentions"):
        m = aliased(Message, name="mention_msg")
        parts.append(
            _row(
                MessageMention.id,
                _lit("mention"),
                MessageMention.created_at,
                m.author_id,
                m.channel_id,
                m.id,
                _null_text(),
                false(),
                _null_json(),
            )
            .join(m, m.id == MessageMention.message_id)
            .where(
                MessageMention.user_id == user_id,
                MessageMention.workspace_id == workspace_id,
                m.channel_id.in_(readable),
                *visible_message(m),
            )
        )

    if kind in ("all", "reactions"):
        m = aliased(Message, name="reaction_msg")
        parts.append(
            _row(
                MessageReaction.id,
                _lit("reaction"),
                MessageReaction.created_at,
                MessageReaction.user_id,
                m.channel_id,
                m.id,
                cast(MessageReaction.emoji, String(32)),
                false(),
                _null_json(),
            )
            .join(m, m.id == MessageReaction.message_id)
            .where(
                m.author_id == user_id,
                m.workspace_id == workspace_id,
                m.kind == "user",
                MessageReaction.user_id != user_id,
                m.channel_id.in_(readable),
                *visible_message(m),
            )
        )

    if kind in ("all", "threads"):
        ft = followed_threads(workspace_id, user_id, readable).subquery("act_ft")
        rep = aliased(Message, name="thread_reply")
        mentioned_me = exists().where(
            MessageMention.message_id == rep.id, MessageMention.user_id == user_id
        )
        parts.append(
            _row(
                rep.id,
                _lit("thread_reply"),
                rep.created_at,
                rep.author_id,
                rep.channel_id,
                rep.id,
                _null_text(),
                rep.created_at <= ft.c.read_until,
                _null_json(),
            )
            .join(ft, ft.c.root_id == rep.parent_id)
            .where(
                rep.author_id != user_id,
                rep.deleted_at.is_(None),
                # Replies that mention the user already appear as "mention".
                not_(mentioned_me),
            )
        )

    if kind == "all":
        parts.append(
            _row(
                CallInvite.id,
                _lit("call_missed"),
                CallInvite.created_at,
                CallInvite.invited_by,
                Call.channel_id,
                Call.message_id,
                _null_text(),
                false(),
                cast(func.jsonb_build_object("call_id", Call.id, "kind", Call.kind), JSONB),
            )
            .join(Call, Call.id == CallInvite.call_id)
            .where(
                CallInvite.user_id == user_id,
                CallInvite.status == "missed",
                Call.workspace_id == workspace_id,
                Call.channel_id.in_(readable),
            )
        )

    stored_types = {
        "all": (
            "channel_invite",
            "reminder",
            HUDDLE_STARTED,
            CARD_MENTION,
            MEETING_INVITE,
            MEETING_REMINDER,
        ),
        "mentions": (CARD_MENTION,),
        "invites": ("channel_invite",),
    }
    if kind in stored_types:
        parts.append(
            _row(
                ActivityEvent.id,
                cast(ActivityEvent.type, String(32)),
                ActivityEvent.created_at,
                ActivityEvent.actor_id,
                ActivityEvent.channel_id,
                ActivityEvent.message_id,
                _null_text(),
                false(),
                ActivityEvent.meta,
            ).where(
                ActivityEvent.user_id == user_id,
                ActivityEvent.workspace_id == workspace_id,
                ActivityEvent.type.in_(stored_types[kind]),
                or_(ActivityEvent.channel_id.is_(None), ActivityEvent.channel_id.in_(readable)),
            )
        )

    return union_all(*parts).subquery("activity")


async def _all_read_at(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> datetime | None:
    return await db.scalar(
        select(ActivityState.all_read_at).where(
            ActivityState.user_id == user_id, ActivityState.workspace_id == workspace_id
        )
    )


def _read_expr(act, user_id: uuid.UUID, all_read_at: datetime | None):
    conds = [
        act.c.implicit_read,
        exists().where(ActivityRead.user_id == user_id, ActivityRead.item_id == act.c.id),
    ]
    if all_read_at is not None:
        conds.append(act.c.created_at <= all_read_at)
    return or_(*conds)


async def activity_unread_count(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID, readable, kind="all"
) -> int:
    act = activity_union(workspace_id, user_id, readable, kind)
    read = _read_expr(act, user_id, await _all_read_at(db, workspace_id, user_id))
    return await db.scalar(select(func.count()).select_from(act).where(not_(read))) or 0


async def _activity_rows(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    readable,
    *,
    kind: ActivityFilter = "all",
    unread_only: bool = False,
    cursor: str | None = None,
    limit: int = 30,
    item_id: uuid.UUID | None = None,
):
    act = activity_union(workspace_id, user_id, readable, kind)
    read = _read_expr(act, user_id, await _all_read_at(db, workspace_id, user_id))
    q = select(act, read.label("read"))
    if unread_only:
        q = q.where(not_(read))
    if item_id is not None:
        q = q.where(act.c.id == item_id)
    q = keyset_before(q, act.c.created_at, act.c.id, cursor)
    return list(
        (
            await db.execute(
                q.order_by(act.c.created_at.desc(), act.c.id.desc()).limit(limit + 1)
            )
        ).all()
    )


async def _activity_out(
    db: AsyncSession, rows: list, viewer_id: uuid.UUID
) -> list[ActivityItemOut]:
    message_ids = {r.message_id for r in rows if r.message_id}
    messages = (
        list(
            await db.scalars(
                select(Message).where(Message.id.in_(message_ids), Message.deleted_at.is_(None))
            )
        )
        if message_ids
        else []
    )
    by_id = {m.id: m for m in await serialize_messages(db, messages, viewer_id=viewer_id)}
    return [
        ActivityItemOut(
            id=r.id,
            type=r.type,
            created_at=r.created_at,
            read=bool(r.read),
            actor_id=r.actor_id,
            channel_id=r.channel_id,
            message=by_id.get(r.message_id) if r.message_id else None,
            emoji=r.emoji,
            meta=r.meta,
        )
        for r in rows
    ]


async def list_activity(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    readable,
    *,
    kind: ActivityFilter,
    unread_only: bool,
    cursor: str | None,
    limit: int,
) -> tuple[list[ActivityItemOut], str | None, int]:
    rows = await _activity_rows(
        db,
        workspace_id,
        user_id,
        readable,
        kind=kind,
        unread_only=unread_only,
        cursor=cursor,
        limit=limit,
    )
    rows, next_cursor = page_of(rows, limit, lambda r: (r.created_at, r.id))
    items = await _activity_out(db, rows, user_id)
    unread = await activity_unread_count(db, workspace_id, user_id, readable, kind)
    return items, next_cursor, unread


async def get_activity_item(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID, item_id: uuid.UUID
) -> ActivityItemOut | None:
    readable = await readable_for(db, workspace_id, user_id)
    if readable is None:
        return None
    rows = await _activity_rows(db, workspace_id, user_id, readable, item_id=item_id, limit=1)
    if not rows:
        return None
    return (await _activity_out(db, rows[:1], user_id))[0]


async def mark_activity_read(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    ids: list[uuid.UUID] | None,
    all_items: bool,
) -> None:
    if all_items:
        await db.execute(
            pg_insert(ActivityState)
            .values(user_id=user_id, workspace_id=workspace_id, all_read_at=func.now())
            .on_conflict_do_update(
                index_elements=["user_id", "workspace_id"], set_={"all_read_at": func.now()}
            )
        )
        # Individual marks are now covered by the watermark.
        await db.execute(
            ActivityRead.__table__.delete().where(
                ActivityRead.user_id == user_id, ActivityRead.workspace_id == workspace_id
            )
        )
    elif ids:
        await db.execute(
            pg_insert(ActivityRead)
            .values(
                [
                    {"user_id": user_id, "item_id": i, "workspace_id": workspace_id}
                    for i in dict.fromkeys(ids)
                ]
            )
            .on_conflict_do_nothing(index_elements=["user_id", "item_id"])
        )


# --- Notifications ------------------------------------------------------------------------

HUDDLE_STARTED = "huddle_started"
CARD_MENTION = "card_mention"
MEETING_INVITE = "meeting_invite"
MEETING_REMINDER = "meeting_reminder"
MENTION_LIKE = {
    "mention",
    "thread_reply",
    "channel_invite",
    "call_missed",
    "reminder",
    CARD_MENTION,
    MEETING_INVITE,
    MEETING_REMINDER,
}


def in_notify_schedule(schedule: dict | None, now: datetime | None = None) -> bool:
    """Whether `now` falls inside the user's notification schedule (always True when off).

    days: 0 = Sunday … 6 = Saturday (like JavaScript's Date.getDay); start > end spans
    midnight, and the overnight tail belongs to the day the window started.
    """
    if not schedule or not schedule.get("enabled"):
        return True
    try:
        tz = zoneinfo.ZoneInfo(schedule.get("tz") or "UTC")
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        tz = zoneinfo.ZoneInfo("UTC")
    local = (now or datetime.now(UTC)).astimezone(tz)
    days = set(schedule.get("days") or [])
    weekday = (local.weekday() + 1) % 7  # Python Monday=0 -> Sunday=0
    start = schedule.get("start", "00:00")
    end = schedule.get("end", "23:59")
    hhmm = local.strftime("%H:%M")
    if start <= end:
        return weekday in days and start <= hhmm < end
    if hhmm >= start:
        return weekday in days
    return hhmm < end and (weekday - 1) % 7 in days


async def should_notify(
    db: AsyncSession,
    user_id: uuid.UUID,
    channel_id: uuid.UUID | None,
    kind: str,
    *,
    now: datetime | None = None,
) -> bool:
    """Whether an event should alert the user (toast/sound/desktop), honouring DND, the
    notification schedule and per-channel mute/notify prefs. Badges are unaffected."""
    now = now or datetime.now(UTC)
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        return False
    if user.dnd_until and user.dnd_until > now:
        return False
    if not in_notify_schedule((user.preferences or {}).get("notify_schedule"), now):
        return False
    if channel_id is not None and kind != "reminder":
        pref = await db.scalar(
            select(ChannelPref).where(
                ChannelPref.user_id == user_id, ChannelPref.channel_id == channel_id
            )
        )
        if pref:
            if pref.muted or pref.notify == "nothing":
                return False
            if pref.notify == "mentions" and kind not in MENTION_LIKE:
                return False
    return True


async def publish_activity(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID, item_id: uuid.UUID
) -> ActivityItemOut | None:
    item = await get_activity_item(db, workspace_id, user_id, item_id)
    if item is None:
        return None
    notify = await should_notify(db, user_id, item.channel_id, item.type)
    await notify_user(
        user_id,
        {"type": "activity.new", "item": item.model_dump(mode="json"), "notify": notify},
    )
    return item


# --- Hooks for other modules --------------------------------------------------------------


async def on_message_created(db: AsyncSession, message: Message) -> None:
    """Fan out Activity/Threads updates for a freshly committed message. Never raises."""
    try:
        await _on_message_created(db, message)
    except Exception:
        log.exception("Activity fan-out failed for message %s", message.id)


async def _on_message_created(db: AsyncSession, message: Message) -> None:
    if message.kind == "system":
        return
    mentions = list(
        (
            await db.execute(
                select(MessageMention.id, MessageMention.user_id).where(
                    MessageMention.message_id == message.id
                )
            )
        ).all()
    )
    mentioned = {uid for _, uid in mentions}
    for mention_id, uid in mentions:
        await publish_activity(db, message.workspace_id, uid, mention_id)
    if not message.parent_id:
        return
    root = await db.get(Message, message.parent_id)
    if not root or root.deleted_at:
        return
    followers = sorted(await thread_followers(db, root))[:MAX_THREAD_FANOUT]
    for uid in followers:
        if uid != message.author_id and uid not in mentioned:
            await publish_activity(db, message.workspace_id, uid, message.id)
        if await can_read_channel(db, root.channel_id, uid):
            await publish_thread_state(db, uid, root)


async def on_reaction_added(
    db: AsyncSession, message: Message, user_id: uuid.UUID, emoji: str
) -> None:
    try:
        if message.author_id == user_id or message.kind != "user":
            return
        reaction_id = await db.scalar(
            select(MessageReaction.id).where(
                MessageReaction.message_id == message.id,
                MessageReaction.user_id == user_id,
                MessageReaction.emoji == emoji,
            )
        )
        if reaction_id:
            await publish_activity(db, message.workspace_id, message.author_id, reaction_id)
    except Exception:
        log.exception("Activity fan-out failed for reaction on %s", message.id)


async def notify_channel_invite(
    db: AsyncSession, channel: Channel, actor_id: uuid.UUID, user_ids: set[uuid.UUID]
) -> None:
    """Record + publish "added you to #channel" (skip DMs and self-joins). Commits. Never raises."""
    try:
        await _notify_channel_invite(db, channel, actor_id, user_ids)
    except Exception:
        await db.rollback()
        log.exception("Activity fan-out failed for invite to %s", channel.id)


async def _notify_channel_invite(
    db: AsyncSession, channel: Channel, actor_id: uuid.UUID, user_ids: set[uuid.UUID]
) -> None:
    targets = {u for u in user_ids if u != actor_id}
    if channel.kind == ChannelKind.dm or not targets:
        return
    events = [
        ActivityEvent(
            workspace_id=channel.workspace_id,
            user_id=uid,
            type="channel_invite",
            actor_id=actor_id,
            channel_id=channel.id,
            meta={"channel_name": channel.name},
        )
        for uid in targets
    ]
    db.add_all(events)
    await db.commit()
    for ev in events:
        await publish_activity(db, channel.workspace_id, ev.user_id, ev.id)


async def notify_call_missed(db: AsyncSession, call_id: uuid.UUID, user_id: uuid.UUID) -> None:
    try:
        row = (
            await db.execute(
                select(CallInvite.id, Call.workspace_id)
                .join(Call, Call.id == CallInvite.call_id)
                .where(CallInvite.call_id == call_id, CallInvite.user_id == user_id)
            )
        ).first()
        if row:
            await publish_activity(db, row.workspace_id, user_id, row.id)
    except Exception:
        log.exception("Activity fan-out failed for missed call %s", call_id)


async def _huddle_audience(
    db: AsyncSession, channel: Channel, starter_id: uuid.UUID, invited: set[uuid.UUID]
) -> list[uuid.UUID]:
    """Channel members who hear that a huddle started: active workspace members other than
    the starter, minus anyone whose channel notify level is "nothing", and minus anyone who
    muted the channel unless they were explicitly invited into the call."""
    rows = (
        await db.execute(
            select(ChannelMember.user_id, ChannelPref.muted, ChannelPref.notify)
            .join(User, User.id == ChannelMember.user_id)
            .join(
                WorkspaceMember,
                and_(
                    WorkspaceMember.user_id == ChannelMember.user_id,
                    WorkspaceMember.workspace_id == channel.workspace_id,
                ),
            )
            .outerjoin(
                ChannelPref,
                and_(
                    ChannelPref.user_id == ChannelMember.user_id,
                    ChannelPref.channel_id == channel.id,
                ),
            )
            .where(
                ChannelMember.channel_id == channel.id,
                ChannelMember.user_id != starter_id,
                User.is_active.is_(True),
            )
            .order_by(ChannelMember.user_id)
        )
    ).all()
    out = []
    for uid, muted, level in rows:
        if level == "nothing":
            continue
        if muted and uid not in invited:
            continue
        out.append(uid)
    return out


async def notify_huddle_started(
    call: Call, channel: Channel, invited: set[uuid.UUID]
) -> list[tuple[uuid.UUID, bool]]:
    """Record a "huddle_started" activity item for everyone who should hear about a new
    huddle in a (non-DM) channel, in its own session so the caller's is never disturbed.
    Returns [(user_id, notify)] where `notify` says whether the user should be alerted
    (DND, schedule and channel level honoured); the caller sends `huddle.started`.
    Never raises (returns [] on failure).

    The matching `activity.new` goes out with notify=False: the alert itself belongs to
    `huddle.started`, so clients don't toast twice.
    """
    if channel.kind == ChannelKind.dm:
        return []
    call_id, starter, kind = call.id, call.started_by, str(call.kind)
    workspace_id, channel_id, card_id = channel.workspace_id, channel.id, call.message_id
    try:
        async with SessionLocal() as db:
            audience = await _huddle_audience(db, channel, starter, invited)
            if not audience:
                return []
            events = [
                ActivityEvent(
                    workspace_id=workspace_id,
                    user_id=uid,
                    type=HUDDLE_STARTED,
                    actor_id=starter,
                    channel_id=channel_id,
                    message_id=card_id,
                    meta={"call_id": str(call_id), "kind": kind},
                )
                for uid in audience
            ]
            db.add_all(events)
            await db.commit()
            out = []
            for ev in events:
                notify = await should_notify(db, ev.user_id, channel_id, HUDDLE_STARTED)
                out.append((ev.user_id, notify))
                item = await get_activity_item(db, workspace_id, ev.user_id, ev.id)
                if item is not None:
                    await notify_user(
                        ev.user_id,
                        {
                            "type": "activity.new",
                            "item": item.model_dump(mode="json"),
                            "notify": False,
                        },
                    )
            return out
    except Exception:
        log.exception("Huddle start fan-out failed for call %s", call_id)
        return []


async def huddle_end_audience(db: AsyncSession, channel: Channel) -> list[uuid.UUID]:
    """Everyone who may be showing a "huddle started" banner for the channel."""
    if channel.kind == ChannelKind.dm:
        return []
    return list(
        await db.scalars(
            select(ChannelMember.user_id)
            .where(ChannelMember.channel_id == channel.id)
            .order_by(ChannelMember.user_id)
        )
    )


# --- Self DM & reminders ------------------------------------------------------------------


def self_dm_name(user_id: uuid.UUID) -> str:
    """Same deterministic name channels.open_dm gives the DM with only yourself."""
    digest = hashlib.sha1(str(user_id).encode()).hexdigest()
    return f"{DM_NAME_PREFIX}{digest[:24]}"


async def ensure_self_dm(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[Channel, bool]:
    """The user's "you" DM in a workspace, created if missing. Returns (channel, newly_joined)."""
    name = self_dm_name(user_id)
    await db.execute(
        pg_insert(Channel)
        .values(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=name,
            kind=ChannelKind.dm,
            created_by=user_id,
            is_archived=False,
        )
        .on_conflict_do_nothing(index_elements=["workspace_id", "name"])
    )
    channel = await db.scalar(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.name == name,
            Channel.kind == ChannelKind.dm,
        )
    )
    if channel is None:
        raise RuntimeError("A non-DM channel squats on the self-DM name")
    added = await db.scalar(
        pg_insert(ChannelMember)
        .values(id=uuid.uuid4(), channel_id=channel.id, user_id=user_id)
        .on_conflict_do_nothing(index_elements=["channel_id", "user_id"])
        .returning(ChannelMember.user_id)
    )
    return channel, added is not None


def reminder_out(r: Reminder) -> ReminderOut:
    return ReminderOut.model_validate(r)


async def deliver_due_reminders(
    db: AsyncSession, *, now: datetime | None = None, limit: int = REMINDER_BATCH_SIZE
) -> int:
    """Deliver pending reminders whose time has come, exactly once (row locks + SKIP LOCKED).

    Each one posts a system message in the owner's self-DM, an Activity item and a
    `reminder.due` event. Returns how many were delivered.
    """
    now = now or datetime.now(UTC)
    due = list(
        await db.scalars(
            select(Reminder)
            .where(Reminder.status == "pending", Reminder.remind_at <= now)
            .order_by(Reminder.remind_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    )
    delivered: list[tuple[Reminder, Message, ActivityEvent, Channel, bool]] = []
    for r in due:
        member = await get_workspace_membership(db, r.workspace_id, r.user_id)
        user = await db.get(User, r.user_id)
        if not member or not user or not user.is_active:
            r.status = "cancelled"
            continue
        channel, joined = await ensure_self_dm(db, r.workspace_id, r.user_id)
        meta = {"type": "reminder", "reminder_id": str(r.id), "text": r.text}
        if r.message_id:
            meta["message_id"] = str(r.message_id)
        msg = Message(
            workspace_id=r.workspace_id,
            channel_id=channel.id,
            author_id=r.user_id,
            body=f"⏰ Reminder: {r.text}",
            kind="system",
            meta=meta,
        )
        db.add(msg)
        await db.flush()
        event = ActivityEvent(
            workspace_id=r.workspace_id,
            user_id=r.user_id,
            type="reminder",
            channel_id=channel.id,
            # Point at the message the reminder is about, else at the reminder card itself.
            message_id=r.message_id or msg.id,
            meta={
                "reminder_id": str(r.id),
                "text": r.text,
                "reminder_message_id": str(msg.id),
            },
        )
        db.add(event)
        r.status = "sent"
        r.sent_at = now
        delivered.append((r, msg, event, channel, joined))
    await db.commit()

    for r, msg, event, channel, joined in delivered:
        try:
            if joined:
                await notify_user(r.user_id, {"type": "channel.joined", "channel_id": str(channel.id)})
            await db.refresh(msg)
            out = await serialize_message(db, msg)
            await publish_to_channel(
                channel.id, {"type": "message.created", "message": out.model_dump(mode="json")}
            )
            await notify_user(
                r.user_id,
                {"type": "reminder.due", "reminder": reminder_out(r).model_dump(mode="json")},
            )
            await publish_activity(db, r.workspace_id, r.user_id, event.id)
        except Exception:
            log.exception("Could not publish reminder %s", r.id)
    return len(delivered)


# --- Unreads ------------------------------------------------------------------------------


async def mark_all_read(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> list[tuple[uuid.UUID, ChannelKind, datetime]]:
    """Mark every channel of the workspace read. Returns (channel_id, kind, last_read_at)."""
    rows = (
        await db.execute(
            update(ChannelMember)
            .where(
                ChannelMember.user_id == user_id,
                ChannelMember.channel_id.in_(
                    select(Channel.id).where(Channel.workspace_id == workspace_id)
                ),
            )
            .values(last_read_at=func.now())
            .returning(ChannelMember.channel_id, ChannelMember.last_read_at)
        )
    ).all()
    kinds = dict(
        (
            await db.execute(
                select(Channel.id, Channel.kind).where(Channel.id.in_([r[0] for r in rows]))
            )
        ).all()
    ) if rows else {}
    return [(cid, kinds[cid], at) for cid, at in rows]



async def get_readable_message(
    db: AsyncSession, user: User, message_id: uuid.UUID, workspace_id: uuid.UUID | None = None
) -> tuple[Message, Channel]:
    """A non-deleted message the user can read (404 otherwise, also across workspaces)."""
    msg = await db.get(Message, message_id)
    if not msg or msg.deleted_at or (workspace_id and msg.workspace_id != workspace_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    channel = await require_channel_access(msg.channel_id, db, user)
    return msg, channel
