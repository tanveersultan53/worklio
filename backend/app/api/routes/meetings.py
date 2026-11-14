"""Calendar: schedule a huddle in a channel or DM, RSVP, and export it to other calendars.

See app.meetings for the rules and realtime events.
"""

import re
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app import meetings
from app.api.deps import DB, ChannelAccess, CurrentUser, WorkspaceMembership
from app.models import RSVP
from app.schemas_meetings import FreeBusyOut, MeetingIn, MeetingOut, MeetingPatch, RSVPIn

router = APIRouter(tags=["calendar"])


@router.post("/channels/{channel_id}/meetings", response_model=MeetingOut, status_code=201)
async def schedule_meeting(
    data: MeetingIn, channel: ChannelAccess, db: DB, user: CurrentUser
) -> MeetingOut:
    """Schedule a huddle in this channel and post its card. In a DM, an empty attendee list
    invites everyone in it."""
    return await meetings.create(db, channel, user, data)


@router.get("/workspaces/{workspace_id}/meetings", response_model=list[MeetingOut])
async def my_meetings(
    member: WorkspaceMembership,
    db: DB,
    user: CurrentUser,
    start: datetime,
    end: datetime,
    include_cancelled: bool = False,
) -> list[MeetingOut]:
    """Meetings I organize or am invited to that overlap [start, end) (at most 62 days)."""
    return await meetings.list_for_user(
        db, member.workspace_id, user, start, end, include_cancelled=include_cancelled
    )


@router.get("/workspaces/{workspace_id}/meetings/busy", response_model=list[FreeBusyOut])
async def busy_times(
    member: WorkspaceMembership,
    db: DB,
    start: datetime,
    end: datetime,
    user_ids: Annotated[list[uuid.UUID], Query(max_length=50)],
) -> list[FreeBusyOut]:
    """When these people already have meetings in [start, end) (at most 14 days): times only."""
    return await meetings.free_busy(db, member.workspace_id, user_ids, start, end)


@router.get("/meetings/{meeting_id}", response_model=MeetingOut)
async def get_meeting(meeting_id: uuid.UUID, db: DB, user: CurrentUser) -> MeetingOut:
    m, _ = await meetings.get_for(db, meeting_id, user)
    return await meetings.serialize(db, m)


@router.patch("/meetings/{meeting_id}", response_model=MeetingOut)
async def update_meeting(
    meeting_id: uuid.UUID, data: MeetingPatch, db: DB, user: CurrentUser
) -> MeetingOut:
    """Organizer (or a workspace admin): rename, reschedule or change who's invited."""
    return await meetings.update(db, meeting_id, user, data)


@router.post("/meetings/{meeting_id}/cancel", response_model=MeetingOut)
async def cancel_meeting(meeting_id: uuid.UUID, db: DB, user: CurrentUser) -> MeetingOut:
    return await meetings.cancel(db, meeting_id, user)


@router.put("/meetings/{meeting_id}/rsvp", response_model=MeetingOut)
async def rsvp_meeting(
    meeting_id: uuid.UUID, data: RSVPIn, db: DB, user: CurrentUser
) -> MeetingOut:
    return await meetings.rsvp(db, meeting_id, user, RSVP(data.response))


@router.get("/meetings/{meeting_id}/ics")
async def meeting_ics(meeting_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    """The meeting as an .ics file for Google Calendar, Outlook or Apple Calendar."""
    m, channel = await meetings.get_for(db, meeting_id, user)
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", m.title).strip("-")[:60] or "meeting"
    return Response(
        await meetings.to_ics(db, m, channel),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}.ics"'},
    )
