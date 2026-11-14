import re
import uuid
import zoneinfo
from datetime import UTC, date, datetime
from functools import cache
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

from app.models import ChannelKind, WorkspaceRole

# Names/labels: surrounding whitespace is dropped and the result must not be empty.
NonBlankStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

# Channel names starting with this are reserved for DMs (see channels.open_dm).
DM_NAME_PREFIX = "dm-"
MAX_REACTION_KINDS_PER_MESSAGE = 50

_SHORTCODE_RE = re.compile(r"^[a-z0-9_+-]{1,32}$")
# Characters that may appear inside an emoji sequence without being pictographs themselves:
# ZWJ, variation selectors, keycap combiner, tag characters (flags), digits/#/* (keycaps).
_EMOJI_JOINERS = {0x200D, 0xFE0E, 0xFE0F, 0x20E3}
_EMOJI_RANGES = (
    (0x1F000, 0x1FAFF),  # pictographs, emoticons, transport, symbols, flags, skin tones
    (0x2190, 0x21FF),
    (0x2300, 0x23FF),
    (0x2460, 0x24FF),
    (0x25A0, 0x27BF),  # geometric shapes, misc symbols, dingbats
    (0x2900, 0x297F),
    (0x2B00, 0x2BFF),
    (0x3030, 0x3030),
    (0x303D, 0x303D),
    (0x3297, 0x3299),
    (0x00A9, 0x00A9),
    (0x00AE, 0x00AE),
    (0x203C, 0x203C),
    (0x2049, 0x2049),
    (0x2122, 0x2122),
    (0x2139, 0x2139),
)


def _is_pictograph(cp: int) -> bool:
    return any(lo <= cp <= hi for lo, hi in _EMOJI_RANGES)


def _validate_emoji(value: str) -> str:
    """Accept a single Unicode emoji sequence or a `:shortcode:`-style name."""
    if _SHORTCODE_RE.match(value):
        return value
    has_pictograph = False
    for ch in value:
        cp = ord(ch)
        if _is_pictograph(cp) or cp == 0x20E3:
            has_pictograph = True
        elif not (cp in _EMOJI_JOINERS or 0xE0020 <= cp <= 0xE007F or ch in "0123456789#*"):
            raise ValueError("Not an emoji")
    if not has_pictograph:
        raise ValueError("Not an emoji")
    return value


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth ---
class RegisterIn(BaseModel):
    email: EmailStr
    full_name: NonBlankStr = Field(max_length=200)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # Long-lived, single-use: exchange at POST /auth/refresh for a new pair.
    refresh_token: str | None = None
    expires_in: int | None = None


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=200)


SidebarItem = Literal[
    "threads",
    "activity",
    "later",
    "drafts",
    "huddles",
    "calendar",
    "files",
    "canvases",
    "directory",
    "unreads",
]
SidebarHiddenItems = Annotated[
    list[SidebarItem], Field(max_length=20), AfterValidator(lambda v: list(dict.fromkeys(v)))
]
ClockTime = Annotated[str, StringConstraints(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]


class NotifySchedule(BaseModel):
    """Notifications are delivered only on `days` (0 = Sunday … 6 = Saturday) between `start`
    and `end` local time in `tz`; `start` > `end` spans midnight."""

    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    days: Annotated[
        list[Annotated[int, Field(ge=0, le=6)]],
        Field(max_length=7),
        AfterValidator(lambda v: sorted(set(v))),
    ] = [1, 2, 3, 4, 5]
    start: ClockTime = "09:00"
    end: ClockTime = "18:00"
    tz: Annotated[str, StringConstraints(min_length=1, max_length=64)] = "UTC"

    @model_validator(mode="after")
    def _known_tz(self):
        if self.tz not in _known_timezones():
            raise ValueError("Unknown time zone (use an IANA name such as Europe/Berlin)")
        return self


class Preferences(BaseModel):
    """Appearance settings. Every field optional so clients can PATCH one at a time."""

    model_config = ConfigDict(extra="ignore")

    theme: str | None = Field(default=None, max_length=32, pattern=r"^[a-z0-9-]+$")
    mode: Literal["light", "dark", "system"] | None = None
    accent: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    font: str | None = Field(default=None, max_length=32, pattern=r"^[a-z0-9-]+$")
    font_size: Literal["sm", "md", "lg", "xl"] | None = None
    density: Literal["comfortable", "compact"] | None = None
    reduce_motion: bool | None = None
    underline_links: bool | None = None
    sidebar_width: int | None = Field(default=None, ge=200, le=440)
    # Sidebar & notifications (Wave A1).
    show_workspace_switcher: Literal["auto", "always", "never"] | None = None
    sidebar_compact: bool | None = None
    sidebar_hidden_items: SidebarHiddenItems | None = None
    notify_schedule: NotifySchedule | None = None
    notify_sound: bool | None = None
    desktop_notify: Literal["all", "mentions", "nothing"] | None = None


@cache
def _known_timezones() -> frozenset[str]:
    return frozenset(zoneinfo.available_timezones())


def _validate_timezone(value: str | None) -> str | None:
    if value and value not in _known_timezones():
        raise ValueError("Unknown time zone (use an IANA name such as Europe/Berlin)")
    return value


def _blank_to_none(value: str | None) -> str | None:
    return (value or "").strip() or None


def clearable(max_length: int, pattern: str | None = None):
    """Optional text: surrounding whitespace dropped, "" (or null) clears the field."""
    text = Annotated[str, StringConstraints(max_length=max_length, pattern=pattern)]
    return Annotated[text | None, AfterValidator(_blank_to_none)]


class ProfileUpdate(BaseModel):
    """PATCH /auth/me. Omitted fields are untouched; "" clears an optional field."""

    full_name: NonBlankStr | None = Field(default=None, max_length=200)
    title: clearable(100) = None
    pronouns: clearable(40) = None
    timezone: Annotated[clearable(64), AfterValidator(_validate_timezone)] = None
    phone: clearable(40, pattern=r"^[0-9+().#*/xX\s-]*$") = None


def _validate_status_emoji(value: str | None) -> str | None:
    """A Unicode emoji, or a shortcode with or without colons ("coffee" / ":coffee:")."""
    value = _blank_to_none(value)
    if not value:
        return None
    if len(value) > 2 and value[0] == value[-1] == ":" and _SHORTCODE_RE.match(value[1:-1]):
        return value
    return _validate_emoji(value)


class StatusIn(BaseModel):
    emoji: Annotated[
        Annotated[str, StringConstraints(max_length=32)] | None,
        AfterValidator(_validate_status_emoji),
    ] = None
    text: clearable(100) = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def _future_expiry(self):
        if self.expires_at is not None:
            if self.expires_at.tzinfo is None:  # naive datetimes are taken as UTC
                self.expires_at = self.expires_at.replace(tzinfo=UTC)
            if self.expires_at <= datetime.now(UTC):
                raise ValueError("expires_at must be in the future")
        return self


class ProfileFields(BaseModel):
    """Public profile shared by UserOut and MemberOut. An expired status reads as no status."""

    model_config = ConfigDict(from_attributes=True)

    title: str | None = None
    pronouns: str | None = None
    timezone: str | None = None
    phone: str | None = None
    status_emoji: str | None = None
    status_text: str | None = None
    status_expires_at: datetime | None = None
    avatar_url: str | None = None
    # Do not disturb until this moment; an elapsed value reads as null.
    dnd_until: datetime | None = None
    # The workspace's "Worklio" AI agent (mentionable, but not a person).
    is_bot: bool = False

    @model_validator(mode="after")
    def _hide_expired_status(self):
        if self.status_expires_at is not None and self.status_expires_at <= datetime.now(UTC):
            self.status_emoji = self.status_text = self.status_expires_at = None
        if self.dnd_until is not None and self.dnd_until <= datetime.now(UTC):
            self.dnd_until = None
        return self


class UserOut(ProfileFields):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    preferences: dict = {}


# --- Workspaces ---
class WorkspaceIn(BaseModel):
    name: NonBlankStr = Field(max_length=120)
    # Optional: generated from the name (lowercase letters, numbers and dashes) when omitted.
    slug: str | None = Field(None, min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")


class WorkspaceOut(ORM):
    id: uuid.UUID
    name: str
    slug: str
    owner_id: uuid.UUID
    created_at: datetime
    # Absolute URL of the uploaded workspace icon (cache-busted), or null for initials.
    icon_url: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _icon_from_orm(cls, data):
        if hasattr(data, "icon_key"):
            from app.admin import icon_url  # local import: app.admin imports schemas

            return {
                "id": data.id,
                "name": data.name,
                "slug": data.slug,
                "owner_id": data.owner_id,
                "created_at": data.created_at,
                "icon_url": icon_url(data),
            }
        return data


class MemberInviteIn(BaseModel):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.member


class MemberOut(ProfileFields):
    user_id: uuid.UUID
    role: WorkspaceRole
    full_name: str
    # Hidden (null) when the viewer is a guest, so guests can't harvest the member directory.
    email: EmailStr | None = None

    @model_validator(mode="before")
    @classmethod
    def _bots_have_no_email(cls, data):
        # Bot addresses use a reserved domain (no login possible), which EmailStr rejects.
        if isinstance(data, dict) and data.get("is_bot"):
            data = {**data, "email": None}
        return data


# --- Channels ---
class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_-]+$")
    topic: str | None = Field(default=None, max_length=250)
    kind: ChannelKind = ChannelKind.public
    # extra members to add on creation (private channels)
    member_ids: list[uuid.UUID] = Field(default=[], max_length=100)

    @model_validator(mode="after")
    def _check(self):
        if self.name.startswith(DM_NAME_PREFIX):
            raise ValueError(f"Channel names can't start with '{DM_NAME_PREFIX}'")
        self.topic = (self.topic or "").strip() or None
        return self


class ChannelOut(ORM):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    topic: str | None
    kind: ChannelKind
    is_archived: bool
    created_at: datetime
    is_member: bool = True
    unread_count: int = 0
    member_ids: list[uuid.UUID] = []  # populated for DMs so the UI can show names
    my_role: str | None = None  # the viewer's channel role: "manager" | "member" | None


class DMIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=8)


class ChannelMemberIn(BaseModel):
    user_id: uuid.UUID


# --- Messages ---
class MessageIn(BaseModel):
    body: str = Field(default="", max_length=40_000)
    parent_id: uuid.UUID | None = None
    attachment_ids: list[uuid.UUID] = Field(default=[], max_length=10)

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.body.strip() and not self.attachment_ids:
            raise ValueError("Message needs text or an attachment")
        return self


class MessageEdit(BaseModel):
    # May be blank only when the message has attachments (checked in the route).
    body: str = Field(max_length=40_000)


class ReactionIn(BaseModel):
    emoji: Annotated[str, AfterValidator(_validate_emoji)] = Field(min_length=1, max_length=32)


class ReactionOut(BaseModel):
    emoji: str
    user_ids: list[uuid.UUID]


class AttachmentOut(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size: int
    url: str
    # Recorded media metadata (voice / video messages); null for ordinary files.
    kind: Literal["voice", "video_clip", "screen_recording"] | None = None
    duration_ms: int | None = None
    waveform: list[int] | None = None


class MessageOut(ORM):
    id: uuid.UUID
    workspace_id: uuid.UUID
    channel_id: uuid.UUID
    author_id: uuid.UUID
    parent_id: uuid.UUID | None
    body: str
    kind: Literal["user", "system"] = "user"
    meta: dict | None = None
    created_at: datetime
    edited_at: datetime | None
    deleted_at: datetime | None
    reply_count: int = 0
    last_reply_at: datetime | None = None
    reply_user_ids: list[uuid.UUID] = []
    reactions: list[ReactionOut] = []
    attachments: list[AttachmentOut] = []
    # Wave A2 messaging extras (filled by app.messaging_extras.enrich).
    pinned: bool = False
    pinned_by: uuid.UUID | None = None
    forwarded_from: "ForwardedFromOut | None" = None
    poll: "PollOut | None" = None
    unfurls: list["UnfurlOut"] = []
    edit_count: int = 0
    # Scheduled messages never appear in timelines until they are sent.
    scheduled: Literal[False] = False
    # Per viewer (Wave A1 "Later"); always false in realtime broadcasts.
    saved: bool = False


class ForwardedFromOut(BaseModel):
    message_id: uuid.UUID | None
    channel_id: uuid.UUID
    author_id: uuid.UUID
    created_at: datetime
    body_preview: str


class PollOptionOut(BaseModel):
    id: uuid.UUID
    text: str
    votes: int = 0
    # Empty for anonymous polls.
    voter_ids: list[uuid.UUID] = []


class PollOut(BaseModel):
    id: uuid.UUID
    question: str
    options: list[PollOptionOut]
    multiple: bool
    anonymous: bool
    closed: bool
    total_voters: int = 0
    # Per viewer; always empty in realtime broadcasts (clients keep their own).
    my_votes: list[uuid.UUID] = []


class UnfurlOut(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    image_url: str | None = None
    site_name: str | None = None
    favicon_url: str | None = None


MessageOut.model_rebuild()


class ChannelUpdate(BaseModel):
    topic: str | None = Field(default=None, max_length=250)


class ChannelFileOut(AttachmentOut):
    message_id: uuid.UUID
    uploader_id: uuid.UUID
    created_at: datetime


class PresenceOut(BaseModel):
    online_user_ids: list[uuid.UUID]


# --- Board (Kanban) ---
Position = Annotated[float, Field(allow_inf_nan=False)]
ColumnName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
CardTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Color = Annotated[str, StringConstraints(max_length=32, pattern=r"^#?[A-Za-z0-9-]{1,31}$")]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)]


def _dedupe(labels: list[str]) -> list[str]:
    return list(dict.fromkeys(labels))


Labels = Annotated[list[Label], Field(max_length=10), AfterValidator(_dedupe)]
Description = clearable(10_000)


class ColumnIn(BaseModel):
    name: ColumnName
    color: Color | None = None


class ColumnPatch(BaseModel):
    name: ColumnName | None = None
    color: Color | None = None
    position: Position | None = None


class CardIn(BaseModel):
    column_id: uuid.UUID
    title: CardTitle
    description: Description = None
    assignee_id: uuid.UUID | None = None
    due_date: date | None = None
    labels: Labels = []


class CardPatch(BaseModel):
    """Omitted fields are untouched; null clears description/assignee/due date."""

    title: CardTitle | None = None
    description: Description = None
    assignee_id: uuid.UUID | None = None
    due_date: date | None = None
    labels: Labels | None = None
    column_id: uuid.UUID | None = None
    position: Position | None = None
    completed: bool | None = None


class ColumnOut(ORM):
    id: uuid.UUID
    name: str
    position: float
    color: str | None


class CardOut(ORM):
    id: uuid.UUID
    column_id: uuid.UUID
    title: str
    description: str | None
    assignee_id: uuid.UUID | None
    due_date: date | None
    labels: list[str]
    position: float
    completed: bool
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class BoardOut(BaseModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    columns: list[ColumnOut]
    cards: list[CardOut]


# --- Canvas ---
class CanvasIn(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    content: dict
    base_version: int = Field(ge=0)

    @model_validator(mode="after")
    def _is_doc(self):
        if self.content.get("type") != "doc":
            raise ValueError('content must be a ProseMirror document ({"type": "doc", ...})')
        return self


class CanvasOut(ORM):
    id: uuid.UUID
    channel_id: uuid.UUID
    title: str
    content: dict
    version: int
    updated_by: uuid.UUID | None
    updated_at: datetime


# --- Whiteboard ---
MAX_WHITEBOARD_ELEMENTS = 10_000


def check_whiteboard_elements(elements: list[dict]) -> list[dict]:
    """Excalidraw elements are opaque, but each needs a string `id` and an integer `version`."""
    for el in elements:
        if not isinstance(el.get("id"), str) or not el["id"]:
            raise ValueError("every element needs a non-empty string id")
        if type(el.get("version")) is not int:
            raise ValueError("every element needs an integer version")
    return elements


WhiteboardElements = Annotated[
    list[dict], Field(max_length=MAX_WHITEBOARD_ELEMENTS), AfterValidator(check_whiteboard_elements)
]


class WhiteboardIn(BaseModel):
    elements: WhiteboardElements
    base_version: int = Field(ge=0)


class WhiteboardOut(ORM):
    channel_id: uuid.UUID
    elements: list[dict]
    version: int
    updated_by: uuid.UUID | None
    updated_at: datetime


# --- Huddles ---
class HuddleJoinOut(BaseModel):
    url: str
    token: str
    room: str


class HuddleOut(BaseModel):
    channel_id: uuid.UUID
    participant_ids: list[uuid.UUID]
    started_at: datetime | None


# --- Calls ---
MAX_CALL_INVITEES = 50


class CallIn(BaseModel):
    kind: Literal["audio", "video"] = "audio"
    # None: DMs ring every other member, channels start a quiet huddle.
    invitee_ids: list[uuid.UUID] | None = Field(default=None, max_length=MAX_CALL_INVITEES)


class CallInviteIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_CALL_INVITEES)


class CallInviteOut(BaseModel):
    user_id: uuid.UUID
    status: Literal["ringing", "accepted", "declined", "missed", "cancelled"]
    invited_by: uuid.UUID


class CallOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    channel_id: uuid.UUID
    kind: Literal["audio", "video"]
    status: Literal["ringing", "active", "ended", "missed", "declined", "cancelled"]
    started_by: uuid.UUID
    started_at: datetime
    ended_at: datetime | None
    # Currently in the LiveKit room (huddle registry) / everyone who ever joined.
    participant_ids: list[uuid.UUID]
    joined_ids: list[uuid.UUID]
    invites: list[CallInviteOut]
    message_id: uuid.UUID | None


class CallJoinOut(BaseModel):
    call: CallOut
    join: HuddleJoinOut


class RingingCallOut(BaseModel):
    call: CallOut
    caller_id: uuid.UUID


class CallNotesIn(BaseModel):
    content: dict
    base_version: int = Field(ge=0)

    @model_validator(mode="after")
    def _is_doc(self):
        if self.content.get("type") != "doc":
            raise ValueError('content must be a ProseMirror document ({"type": "doc", ...})')
        return self


class CallNotesOut(BaseModel):
    call_id: uuid.UUID
    content: dict
    version: int
    updated_by: uuid.UUID | None
    updated_at: datetime | None
