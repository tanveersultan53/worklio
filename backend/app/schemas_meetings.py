"""Request/response schemas for the calendar (scheduled meetings)."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

MeetingTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
MeetingKind = Literal["audio", "video"]
MeetingDescription = Annotated[str, StringConstraints(max_length=4000)]


class MeetingIn(BaseModel):
    title: MeetingTitle
    description: MeetingDescription | None = None
    starts_at: datetime
    ends_at: datetime
    kind: MeetingKind = "audio"
    # Who to invite besides the organizer. Empty in a DM: everyone in it.
    attendee_ids: list[uuid.UUID] | None = Field(default=None, max_length=200)


class MeetingPatch(BaseModel):
    title: MeetingTitle | None = None
    description: MeetingDescription | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    kind: MeetingKind | None = None
    # The full attendee list (the organizer always stays).
    attendee_ids: list[uuid.UUID] | None = Field(default=None, max_length=200)


class RSVPIn(BaseModel):
    response: Literal["accepted", "tentative", "declined"]


class MeetingAttendeeOut(BaseModel):
    user_id: uuid.UUID
    response: str


class MeetingOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    channel_id: uuid.UUID
    organizer_id: uuid.UUID
    title: str
    description: str
    starts_at: datetime
    ends_at: datetime
    kind: str
    status: str
    message_id: uuid.UUID | None
    attendees: list[MeetingAttendeeOut]
