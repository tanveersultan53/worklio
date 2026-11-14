from app.models.auth_session import AuthSession
from app.models.base import Base
from app.models.board import Board, BoardCard, BoardColumn
from app.models.call import Call, CallInvite, CallKind, CallStatus, InviteStatus
from app.models.canvas import Canvas
from app.models.channel import Channel, ChannelKind, ChannelMember
from app.models.message import Attachment, Message, MessageMention, MessageReaction
from app.models.productivity import (
    ActivityEvent,
    ActivityRead,
    ActivityState,
    ChannelPref,
    Reminder,
    SavedItem,
    SidebarSection,
    ThreadSubscription,
)
from app.models.user import User
from app.models.whiteboard import Whiteboard
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole

__all__ = [
    "ActivityEvent",
    "ActivityRead",
    "ActivityState",
    "Attachment",
    "AuthSession",
    "Base",
    "Board",
    "BoardCard",
    "BoardColumn",
    "Call",
    "CallInvite",
    "CallKind",
    "CallStatus",
    "Canvas",
    "Channel",
    "ChannelKind",
    "ChannelMember",
    "ChannelPref",
    "InviteStatus",
    "Message",
    "MessageMention",
    "MessageReaction",
    "Reminder",
    "SavedItem",
    "SidebarSection",
    "ThreadSubscription",
    "User",
    "Whiteboard",
    "Workspace",
    "WorkspaceMember",
    "WorkspaceRole",
]

# Wave A2 messaging extras (appended so parallel model additions merge cleanly).
from app.models.messaging_extras import (
    ChannelBookmark,
    LinkPreview,
    MessageForward,
    MessagePin,
    MessageRevision,
    MessageUnfurl,
    Poll,
    PollOption,
    PollVote,
    ScheduledMessage,
    UserGroup,
    UserGroupMember,
)

__all__ += [
    "ChannelBookmark",
    "LinkPreview",
    "MessageForward",
    "MessagePin",
    "MessageRevision",
    "MessageUnfurl",
    "Poll",
    "PollOption",
    "PollVote",
    "ScheduledMessage",
    "UserGroup",
    "UserGroupMember",
]

# Wave B AI agents: final live-caption segments of a call (inputs to the AI call summary).
import uuid as _uuid
from datetime import datetime as _datetime

from sqlalchemy import DateTime as _DateTime
from sqlalchemy import ForeignKey as _ForeignKey
from sqlalchemy import Index as _Index
from sqlalchemy import Text as _Text
from sqlalchemy.orm import Mapped as _Mapped
from sqlalchemy.orm import mapped_column as _mapped_column

from app.models.base import Timestamped as _Timestamped
from app.models.base import UUIDPk as _UUIDPk


class CallTranscriptSegment(_UUIDPk, _Timestamped, Base):
    """One final caption segment ("what someone said") recorded during a call."""

    __tablename__ = "call_transcript_segments"
    __table_args__ = (_Index("ix_call_transcript_segments_call_started", "call_id", "started_at"),)

    call_id: _Mapped[_uuid.UUID] = _mapped_column(_ForeignKey("calls.id", ondelete="CASCADE"))
    user_id: _Mapped[_uuid.UUID] = _mapped_column(_ForeignKey("users.id", ondelete="CASCADE"))
    text: _Mapped[str] = _mapped_column(_Text)
    # When the speaker started saying it (client clock, clamped to the call's lifetime).
    started_at: _Mapped[_datetime] = _mapped_column(_DateTime(timezone=True))


__all__ += ["CallTranscriptSegment"]

# Wave B Worklio AI (appended so parallel model additions merge cleanly).
from app.models.ai import AIConversation, AITurn, AIUsage

__all__ += ["AIConversation", "AITurn", "AIUsage"]

# Wave C canvases v2 (appended so parallel model additions merge cleanly).
from app.models.canvas import CanvasAccess, CanvasComment, CanvasMember

__all__ += ["CanvasAccess", "CanvasComment", "CanvasMember"]

# Wave D1 Worklio AI providers & agent installs (appended so parallel model additions merge cleanly).
from app.models.ai_settings import AIAgentInstall, WorkspaceAISettings

__all__ += ["AIAgentInstall", "WorkspaceAISettings"]

# Wave D1 workspace administration (appended so parallel model additions merge cleanly).
from app.models.admin import AuditEvent, DeactivatedMember, InviteLink

__all__ += ["AuditEvent", "DeactivatedMember", "InviteLink"]

# Calendar: scheduled meetings.
from app.models.meeting import RSVP, Meeting, MeetingAttendee, MeetingStatus

__all__ += ["RSVP", "Meeting", "MeetingAttendee", "MeetingStatus"]
