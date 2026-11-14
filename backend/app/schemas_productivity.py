"""API shapes for Threads, Activity, Later, Reminders, browse views, sidebar prefs and DND."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.schemas import CallOut, ChannelFileOut, MessageOut, clearable

MAX_FUTURE = timedelta(days=366)


def _aware(value: datetime | None) -> datetime | None:
    """Naive datetimes are taken as UTC."""
    if value is not None and value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value


def _future(value: datetime | None) -> datetime | None:
    value = _aware(value)
    if value is None:
        return None
    now = datetime.now(UTC)
    if value <= now:
        raise ValueError("must be in the future")
    if value > now + MAX_FUTURE:
        raise ValueError("must be within a year")
    return value


AwareDatetime = Annotated[datetime, AfterValidator(_aware)]
FutureDatetime = Annotated[datetime, AfterValidator(_future)]


# --- Pagination ---------------------------------------------------------------------------
T = TypeVar("T")


class Page(BaseModel, Generic[T]):  # noqa: UP046 (pydantic generic)
    items: list[T]
    next_cursor: str | None = None


# --- Threads ------------------------------------------------------------------------------
class ThreadOut(BaseModel):
    root: MessageOut
    channel_id: uuid.UUID
    reply_count: int
    last_reply_at: datetime | None
    unread_count: int
    participant_ids: list[uuid.UUID]
    latest_replies: list[MessageOut]
    # Explicitly followed (True), unfollowed (False) or derived (None); always followed here.
    following: bool = True


class ThreadStateOut(BaseModel):
    root_id: uuid.UUID
    channel_id: uuid.UUID
    following: bool
    unread_count: int


# --- Activity -----------------------------------------------------------------------------
ActivityType = Literal[
    "mention",
    "reaction",
    "thread_reply",
    "channel_invite",
    "call_missed",
    "reminder",
    "huddle_started",
    "card_mention",
    "meeting_invite",
    "meeting_reminder",
]
ActivityFilter = Literal["all", "mentions", "reactions", "threads", "invites"]


class ActivityItemOut(BaseModel):
    id: uuid.UUID
    type: ActivityType
    created_at: datetime
    read: bool
    actor_id: uuid.UUID | None
    channel_id: uuid.UUID | None
    message: MessageOut | None
    emoji: str | None = None
    # Extra context: reminder text for "reminder" items, call id for "call_missed",
    # {call_id, kind} for "huddle_started", {card_id, card_title, comment_id, excerpt} for
    # "card_mention", {meeting_id, title, starts_at} for "meeting_invite" / "meeting_reminder".
    meta: dict | None = None


class ActivityPage(Page[ActivityItemOut]):
    unread_count: int = 0


class ActivityReadIn(BaseModel):
    ids: list[uuid.UUID] | None = Field(default=None, max_length=200)
    all: bool = False


class ActivityReadOut(BaseModel):
    unread_count: int


# --- Later / to-do ------------------------------------------------------------------------
SavedStatus = Literal["in_progress", "completed", "archived"]
TodoTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class SavedItemIn(BaseModel):
    message_id: uuid.UUID | None = None
    title: TodoTitle | None = None
    notes: clearable(5000) = None
    due_at: AwareDatetime | None = None
    remind_at: FutureDatetime | None = None


class SavedItemPatch(BaseModel):
    """Omitted fields are untouched; null clears notes/due_at/remind_at."""

    title: TodoTitle | None = None
    notes: clearable(5000) = None
    status: SavedStatus | None = None
    due_at: AwareDatetime | None = None
    remind_at: FutureDatetime | None = None


class SavedItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    kind: Literal["message", "todo"]
    message: MessageOut | None = None
    # The saved message's channel (kept even when the message itself is no longer readable).
    channel_id: uuid.UUID | None = None
    title: str | None
    notes: str | None
    status: SavedStatus
    due_at: datetime | None
    remind_at: datetime | None
    created_at: datetime
    completed_at: datetime | None


# --- Reminders ----------------------------------------------------------------------------
class ReminderIn(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    remind_at: FutureDatetime
    message_id: uuid.UUID | None = None


class ReminderPatch(BaseModel):
    text: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
    ] | None = None
    remind_at: FutureDatetime | None = None


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    text: str
    remind_at: datetime
    message_id: uuid.UUID | None
    saved_item_id: uuid.UUID | None = None
    status: Literal["pending", "sent", "cancelled"]
    created_at: datetime


# --- Browse views -------------------------------------------------------------------------
class CallHistoryOut(CallOut):
    channel_label_hint: str
    notes_preview: str | None = None
    duration_s: int | None = None


class WorkspaceFileOut(ChannelFileOut):
    channel_id: uuid.UUID


class UnreadChannelOut(BaseModel):
    channel_id: uuid.UUID
    unread_count: int
    mention_count: int = 0
    first_unread_at: datetime
    muted: bool = False
    messages: list[MessageOut]


# --- Channel prefs & sidebar sections -----------------------------------------------------
# "default" follows the user's global desktop_notify preference; the others override it.
NotifyLevel = Literal["default", "all", "mentions", "nothing"]


class ChannelPrefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    channel_id: uuid.UUID
    muted: bool = False
    notify: NotifyLevel = "default"
    starred: bool = False
    section_id: uuid.UUID | None = None


class ChannelPrefPatch(BaseModel):
    muted: bool | None = None
    notify: NotifyLevel | None = None
    starred: bool | None = None
    # null moves the channel back to the default section.
    section_id: uuid.UUID | None = None


SectionName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class SectionIn(BaseModel):
    name: SectionName


class SectionPatch(BaseModel):
    name: SectionName | None = None
    position: Annotated[float, Field(allow_inf_nan=False)] | None = None
    collapsed: bool | None = None


class SectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    position: float
    collapsed: bool


# --- Do not disturb -----------------------------------------------------------------------
class DndIn(BaseModel):
    until: FutureDatetime | None = None
