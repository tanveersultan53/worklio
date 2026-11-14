"""Calendar: scheduled meetings (a huddle booked for a time in a channel or DM).

Rules:
- The organizer must be a member of the channel; every attendee must be able to see it.
- The organizer is always an attendee (accepted). Only the organizer (or a workspace
  owner/admin) edits or cancels; attendees RSVP.
- The channel gets a system card (`meta.type == "meeting"`) that mirrors the meeting, so it
  updates live on every change (RSVPs included).
- A beat sweep sends a "starts soon" reminder REMIND_BEFORE ahead and a "starting now" ring at
  the start time, each once per start time (a reschedule re-arms both).

Realtime events:
    channel topic: message.created / message.updated (the card)
    user topic:    meeting.updated {meeting}, meeting.starting {meeting},
                   activity.new (meeting_invite / meeting_reminder)
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_workspace_membership, is_channel_member
from app.calls import can_access_channel
from app.core.config import settings
from app.messaging_extras import message_event
from app.models import (
    RSVP,
    ActivityEvent,
    Channel,
    ChannelKind,
    ChannelMember,
    Meeting,
    MeetingAttendee,
    MeetingStatus,
    Message,
    User,
    WorkspaceRole,
)
from app.realtime.hub import notify_user, publish_to_channel
from app.schemas_meetings import MeetingAttendeeOut, MeetingIn, MeetingOut, MeetingPatch
from app.services import serialize_messages

log = logging.getLogger(__name__)

REMIND_BEFORE = timedelta(minutes=10)
# A meeting can still be joined from its card (and is "live" on the calendar) until it ends;
# the "starting now" ring is skipped if the sweep only notices it this long after the start.
RING_GRACE = timedelta(minutes=5)
MIN_DURATION = timedelta(minutes=5)
MAX_DURATION = timedelta(hours=24)
MAX_AHEAD = timedelta(days=366)
# How far in the past a new meeting may start (clock skew, "starting now" bookings).
PAST_SLACK = timedelta(minutes=5)
MAX_ATTENDEES = 200
MAX_RANGE = timedelta(days=62)
SWEEP_BATCH = 200

MEETING_INVITE = "meeting_invite"
MEETING_REMINDER = "meeting_reminder"


def _now() -> datetime:
    return datetime.now(UTC)


# --- Serialization ----------------------------------------------------------------------------


async def _attendees(db: AsyncSession, meeting_id: uuid.UUID) -> list[MeetingAttendee]:
    return list(
        await db.scalars(
            select(MeetingAttendee)
            .where(MeetingAttendee.meeting_id == meeting_id)
            .order_by(MeetingAttendee.created_at, MeetingAttendee.user_id)
        )
    )


def meeting_out(m: Meeting, attendees: list[MeetingAttendee]) -> MeetingOut:
    return MeetingOut(
        id=m.id,
        workspace_id=m.workspace_id,
        channel_id=m.channel_id,
        organizer_id=m.organizer_id,
        title=m.title,
        description=m.description,
        starts_at=m.starts_at,
        ends_at=m.ends_at,
        kind=m.kind,
        status=m.status,
        message_id=m.message_id,
        attendees=[MeetingAttendeeOut(user_id=a.user_id, response=a.response) for a in attendees],
    )


async def serialize(db: AsyncSession, m: Meeting) -> MeetingOut:
    return meeting_out(m, await _attendees(db, m.id))


def card_meta(out: MeetingOut) -> dict:
    return {"type": "meeting", "meeting": out.model_dump(mode="json")}


def card_body(m: Meeting) -> str:
    prefix = "Cancelled: " if m.status == MeetingStatus.cancelled else ""
    return f"📅 {prefix}{m.title}"


# --- Access ---------------------------------------------------------------------------------


async def _channel(db: AsyncSession, channel_id: uuid.UUID) -> Channel:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return channel


async def get_for(db: AsyncSession, meeting_id: uuid.UUID, user: User) -> tuple[Meeting, Channel]:
    """The meeting and its channel, if the user can see the channel (404 otherwise)."""
    m = await db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    channel = await _channel(db, m.channel_id)
    if not await can_access_channel(db, channel, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return m, channel


async def _can_manage(db: AsyncSession, m: Meeting, user: User) -> bool:
    if m.organizer_id == user.id:
        return True
    member = await get_workspace_membership(db, m.workspace_id, user.id)
    return bool(member) and member.role in (WorkspaceRole.owner, WorkspaceRole.admin)


async def _validate_attendees(
    db: AsyncSession, channel: Channel, user_ids: set[uuid.UUID]
) -> None:
    if len(user_ids) > MAX_ATTENDEES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"A meeting can have at most {MAX_ATTENDEES} people"
        )
    for uid in user_ids:
        u = await db.get(User, uid)
        if not u or not u.is_active or u.is_bot or not await can_access_channel(db, channel, uid):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Everyone you invite must be able to see this channel"
            )


def _validate_times(starts_at: datetime, ends_at: datetime, *, now: datetime) -> None:
    if starts_at.tzinfo is None or ends_at.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Times need a timezone")
    if ends_at - starts_at < MIN_DURATION:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A meeting lasts at least 5 minutes")
    if ends_at - starts_at > MAX_DURATION:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A meeting lasts at most 24 hours")
    if starts_at < now - PAST_SLACK:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a time in the future")
    if starts_at > now + MAX_AHEAD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a time within the next year")


async def _dm_members(db: AsyncSession, channel: Channel) -> set[uuid.UUID]:
    return set(
        await db.scalars(select(ChannelMember.user_id).where(ChannelMember.channel_id == channel.id))
    )


# --- Publishing -------------------------------------------------------------------------------


async def _sync_card(db: AsyncSession, m: Meeting, out: MeetingOut) -> Message | None:
    if not m.message_id:
        return None
    msg = await db.get(Message, m.message_id)
    if not msg:
        return None
    msg.meta = card_meta(out)
    msg.body = card_body(m)
    return msg


async def _publish(
    db: AsyncSession, m: Meeting, out: MeetingOut, *, created: bool, extra_users: set[uuid.UUID]
) -> None:
    """Broadcast the card and a personal meeting.updated to every attendee (+ extra_users)."""
    try:
        if m.message_id:
            msg = await db.get(Message, m.message_id)
            if msg:
                await db.refresh(msg)
                card = (await serialize_messages(db, [msg]))[0]
                await publish_to_channel(
                    m.channel_id,
                    message_event("message.created" if created else "message.updated", card),
                )
        payload = {"type": "meeting.updated", "meeting": out.model_dump(mode="json")}
        for uid in {a.user_id for a in out.attendees} | extra_users:
            await notify_user(uid, payload)
    except Exception:
        log.exception("Could not publish meeting %s", m.id)


async def _record_invites(
    db: AsyncSession, m: Meeting, actor_id: uuid.UUID, user_ids: set[uuid.UUID]
) -> list[ActivityEvent]:
    events = [
        ActivityEvent(
            workspace_id=m.workspace_id,
            user_id=uid,
            type=MEETING_INVITE,
            actor_id=actor_id,
            channel_id=m.channel_id,
            message_id=m.message_id,
            meta={"meeting_id": str(m.id), "title": m.title, "starts_at": m.starts_at.isoformat()},
        )
        for uid in sorted(user_ids)
        if uid != actor_id
    ]
    db.add_all(events)
    return events


async def _publish_activity(db: AsyncSession, events: list[ActivityEvent]) -> None:
    from app.productivity import publish_activity

    for ev in events:
        try:
            await publish_activity(db, ev.workspace_id, ev.user_id, ev.id)
        except Exception:
            log.exception("Could not publish meeting activity %s", ev.id)


# --- Commands ---------------------------------------------------------------------------------


async def create(db: AsyncSession, channel: Channel, user: User, data: MeetingIn) -> MeetingOut:
    if channel.is_archived:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This channel is archived")
    if not await is_channel_member(db, channel.id, user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the channel first")
    now = _now()
    _validate_times(data.starts_at, data.ends_at, now=now)
    invitees = set(data.attendee_ids or [])
    if channel.kind == ChannelKind.dm and not invitees:
        invitees = await _dm_members(db, channel)
    invitees.discard(user.id)
    await _validate_attendees(db, channel, invitees)

    m = Meeting(
        id=uuid.uuid4(),
        workspace_id=channel.workspace_id,
        channel_id=channel.id,
        organizer_id=user.id,
        title=data.title.strip(),
        description=(data.description or "").strip(),
        starts_at=data.starts_at.astimezone(UTC),
        ends_at=data.ends_at.astimezone(UTC),
        kind=data.kind,
        status=MeetingStatus.scheduled,
    )
    # Booked to start (almost) now: there's nothing to remind about.
    if m.starts_at - now <= REMIND_BEFORE:
        m.reminded_at = now
    db.add(m)
    await db.flush()
    attendees = [MeetingAttendee(meeting_id=m.id, user_id=user.id, response=RSVP.accepted)] + [
        MeetingAttendee(meeting_id=m.id, user_id=uid, response=RSVP.pending)
        for uid in sorted(invitees)
    ]
    db.add_all(attendees)
    await db.flush()
    out = await serialize(db, m)
    card = Message(
        workspace_id=channel.workspace_id,
        channel_id=channel.id,
        author_id=user.id,
        body=card_body(m),
        kind="system",
        meta=card_meta(out),
    )
    db.add(card)
    await db.flush()
    m.message_id = card.id
    out = await serialize(db, m)
    card.meta = card_meta(out)
    events = await _record_invites(db, m, user.id, invitees)
    await db.commit()
    await _publish(db, m, out, created=True, extra_users=set())
    await _publish_activity(db, events)
    return out


async def update(
    db: AsyncSession, meeting_id: uuid.UUID, user: User, data: MeetingPatch
) -> MeetingOut:
    m, channel = await get_for(db, meeting_id, user)
    if not await _can_manage(db, m, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the organizer can change this meeting")
    if m.status == MeetingStatus.cancelled:
        raise HTTPException(status.HTTP_409_CONFLICT, "This meeting was cancelled")
    fields = data.model_fields_set
    if "title" in fields and data.title is not None:
        m.title = data.title.strip()
    if "description" in fields:
        m.description = (data.description or "").strip()
    if "kind" in fields and data.kind is not None:
        m.kind = data.kind
    starts = data.starts_at if "starts_at" in fields and data.starts_at else m.starts_at
    ends = data.ends_at if "ends_at" in fields and data.ends_at else m.ends_at
    rescheduled = starts != m.starts_at or ends != m.ends_at
    now = _now()
    if rescheduled:
        _validate_times(starts, ends, now=now)
        m.starts_at, m.ends_at = starts.astimezone(UTC), ends.astimezone(UTC)
        m.reminded_at = now if m.starts_at - now <= REMIND_BEFORE else None
        m.started_notified_at = None

    current = await _attendees(db, m.id)
    removed: set[uuid.UUID] = set()
    added: set[uuid.UUID] = set()
    if "attendee_ids" in fields and data.attendee_ids is not None:
        wanted = set(data.attendee_ids) | {m.organizer_id}
        have = {a.user_id for a in current}
        added = wanted - have
        removed = have - wanted
        await _validate_attendees(db, channel, added)
        for a in current:
            if a.user_id in removed:
                await db.delete(a)
        db.add_all(MeetingAttendee(meeting_id=m.id, user_id=uid) for uid in sorted(added))
    m.sequence += 1
    await db.flush()
    out = await serialize(db, m)
    await _sync_card(db, m, out)
    events = await _record_invites(db, m, user.id, added)
    await db.commit()
    await _publish(db, m, out, created=False, extra_users=removed)
    await _publish_activity(db, events)
    return out


async def cancel(db: AsyncSession, meeting_id: uuid.UUID, user: User) -> MeetingOut:
    m, _ = await get_for(db, meeting_id, user)
    if not await _can_manage(db, m, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the organizer can cancel this meeting")
    if m.status != MeetingStatus.cancelled:
        m.status = MeetingStatus.cancelled
        m.sequence += 1
        await db.flush()
    out = await serialize(db, m)
    await _sync_card(db, m, out)
    await db.commit()
    await _publish(db, m, out, created=False, extra_users=set())
    return out


async def rsvp(db: AsyncSession, meeting_id: uuid.UUID, user: User, response: RSVP) -> MeetingOut:
    """Answer for yourself. Someone who can see the channel but wasn't invited joins the list."""
    m, _ = await get_for(db, meeting_id, user)
    if m.status == MeetingStatus.cancelled:
        raise HTTPException(status.HTTP_409_CONFLICT, "This meeting was cancelled")
    if response == RSVP.pending:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose yes, maybe or no")
    a = await db.scalar(
        select(MeetingAttendee).where(
            MeetingAttendee.meeting_id == m.id, MeetingAttendee.user_id == user.id
        )
    )
    if a is None:
        if len(await _attendees(db, m.id)) >= MAX_ATTENDEES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This meeting is full")
        a = MeetingAttendee(meeting_id=m.id, user_id=user.id)
        db.add(a)
    a.response = response
    await db.flush()
    out = await serialize(db, m)
    await _sync_card(db, m, out)
    await db.commit()
    await _publish(db, m, out, created=False, extra_users=set())
    return out


# --- Queries ----------------------------------------------------------------------------------


async def list_for_user(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    user: User,
    start: datetime,
    end: datetime,
    *,
    include_cancelled: bool = False,
) -> list[MeetingOut]:
    """The user's meetings (attending or organizing) overlapping [start, end)."""
    if end <= start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "end must be after start")
    if end - start > MAX_RANGE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ask for at most 62 days at a time")
    mine = select(MeetingAttendee.meeting_id).where(MeetingAttendee.user_id == user.id)
    q = (
        select(Meeting)
        .where(
            Meeting.workspace_id == workspace_id,
            Meeting.starts_at < end,
            Meeting.ends_at > start,
            or_(Meeting.organizer_id == user.id, Meeting.id.in_(mine)),
        )
        .order_by(Meeting.starts_at, Meeting.id)
        .limit(500)
    )
    if not include_cancelled:
        q = q.where(Meeting.status == MeetingStatus.scheduled)
    meetings = list(await db.scalars(q))
    out = []
    channels: dict[uuid.UUID, bool] = {}
    for m in meetings:
        # Lost access to the channel (left a private channel): hide it.
        if m.channel_id not in channels:
            ch = await db.get(Channel, m.channel_id)
            channels[m.channel_id] = bool(ch) and await can_access_channel(db, ch, user.id)
        if channels[m.channel_id]:
            out.append(await serialize(db, m))
    return out


# --- ICS (RFC 5545) ---------------------------------------------------------------------------


def _ics_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    """Fold content lines at 75 octets (continuation lines start with a space)."""
    raw = line.encode()
    if len(raw) <= 75:
        return line
    parts, cur, limit = [], b"", 75
    for ch in line:
        b = ch.encode()
        if len(cur) + len(b) > limit:
            parts.append(cur.decode())
            cur, limit = b"", 74
        cur += b
    parts.append(cur.decode())
    return "\r\n ".join(parts)


def _ics_time(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def app_url() -> str:
    base = settings.app_public_url or (settings.cors_origin_list[0] if settings.cors_origin_list else "")
    return base.rstrip("/")


async def to_ics(db: AsyncSession, m: Meeting, channel: Channel) -> str:
    organizer = await db.get(User, m.organizer_id)
    link = f"{app_url()}/w/{m.workspace_id}/c/{channel.id}?meeting={m.id}"
    where = f"#{channel.name}" if channel.kind != ChannelKind.dm else "a direct message"
    description = (m.description + "\n\n" if m.description else "") + (
        f"Join the huddle in Worklio ({where}): {link}"
    )
    cancelled = m.status == MeetingStatus.cancelled
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Worklio//Calendar//EN",
        "CALSCALE:GREGORIAN",
        f"METHOD:{'CANCEL' if cancelled else 'PUBLISH'}",
        "BEGIN:VEVENT",
        f"UID:{m.id}@worklio",
        f"SEQUENCE:{m.sequence}",
        f"DTSTAMP:{_ics_time(m.updated_at or _now())}",
        f"DTSTART:{_ics_time(m.starts_at)}",
        f"DTEND:{_ics_time(m.ends_at)}",
        f"SUMMARY:{_ics_escape(m.title)}",
        f"DESCRIPTION:{_ics_escape(description)}",
        f"LOCATION:{_ics_escape('Worklio huddle')}",
        f"URL:{link}",
        f"STATUS:{'CANCELLED' if cancelled else 'CONFIRMED'}",
    ]
    if organizer:
        lines.append(f"ORGANIZER;CN={_ics_escape(organizer.full_name)}:mailto:{organizer.email}")
    if not cancelled:
        lines += [
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_ics_escape(m.title)}",
            "TRIGGER:-PT10M",
            "END:VALARM",
        ]
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


# --- Reminders and the start ring (beat) -------------------------------------------------------


async def _alert_targets(db: AsyncSession, m: Meeting) -> list[uuid.UUID]:
    """Attendees who haven't declined and can still see the channel."""
    channel = await db.get(Channel, m.channel_id)
    if not channel:
        return []
    out = []
    for a in await _attendees(db, m.id):
        if a.response == RSVP.declined:
            continue
        u = await db.get(User, a.user_id)
        if u and u.is_active and await can_access_channel(db, channel, a.user_id):
            out.append(a.user_id)
    return out


async def deliver_due(db: AsyncSession, *, now: datetime | None = None) -> int:
    """Send due "starts soon" reminders and "starting now" rings, each exactly once
    (row locks + SKIP LOCKED). Returns how many alerts went out."""
    from app.productivity import should_notify

    now = now or _now()
    sent = 0

    soon = list(
        await db.scalars(
            select(Meeting)
            .where(
                Meeting.status == MeetingStatus.scheduled,
                Meeting.reminded_at.is_(None),
                Meeting.starts_at <= now + REMIND_BEFORE,
                Meeting.starts_at > now,
            )
            .order_by(Meeting.starts_at)
            .limit(SWEEP_BATCH)
            .with_for_update(skip_locked=True)
        )
    )
    reminders: list[ActivityEvent] = []
    for m in soon:
        m.reminded_at = now
        for uid in await _alert_targets(db, m):
            reminders.append(
                ActivityEvent(
                    workspace_id=m.workspace_id,
                    user_id=uid,
                    type=MEETING_REMINDER,
                    actor_id=m.organizer_id,
                    channel_id=m.channel_id,
                    message_id=m.message_id,
                    meta={
                        "meeting_id": str(m.id),
                        "title": m.title,
                        "starts_at": m.starts_at.isoformat(),
                    },
                )
            )
    db.add_all(reminders)
    await db.commit()
    await _publish_activity(db, reminders)
    sent += len(reminders)

    starting = list(
        await db.scalars(
            select(Meeting)
            .where(
                Meeting.status == MeetingStatus.scheduled,
                Meeting.started_notified_at.is_(None),
                Meeting.starts_at <= now,
            )
            .order_by(Meeting.starts_at)
            .limit(SWEEP_BATCH)
            .with_for_update(skip_locked=True)
        )
    )
    rings: list[tuple[Meeting, MeetingOut, list[uuid.UUID]]] = []
    for m in starting:
        m.started_notified_at = now
        if now - m.starts_at > RING_GRACE or now >= m.ends_at:
            continue  # the sweep was down at the start time; don't ring late
        rings.append((m, await serialize(db, m), await _alert_targets(db, m)))
    await db.commit()
    for m, out, targets in rings:
        payload = out.model_dump(mode="json")
        for uid in targets:
            try:
                notify = await should_notify(db, uid, m.channel_id, MEETING_REMINDER, now=now)
                await notify_user(
                    uid, {"type": "meeting.starting", "meeting": payload, "notify": notify}
                )
                sent += 1
            except Exception:
                log.exception("Could not ring %s for meeting %s", uid, m.id)
    return sent
