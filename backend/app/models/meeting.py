"""Scheduled meetings: a huddle booked for a time in a channel or DM.

The meeting lives in its channel (that channel's huddle room is where it happens) and is
announced there by a system message card (`meta.type == "meeting"`), kept in sync with the
meeting's state. Attendees RSVP; a beat task reminds them shortly before the start and rings
them when it starts.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamped, UUIDPk


class MeetingStatus(enum.StrEnum):
    scheduled = "scheduled"
    cancelled = "cancelled"


class RSVP(enum.StrEnum):
    pending = "pending"
    accepted = "accepted"
    tentative = "tentative"
    declined = "declined"


class Meeting(UUIDPk, Timestamped, Base):
    __tablename__ = "meetings"
    __table_args__ = (
        Index("ix_meetings_workspace_starts", "workspace_id", "starts_at"),
        Index("ix_meetings_channel_starts", "channel_id", "starts_at"),
        # The reminder / start sweeps only look at upcoming scheduled meetings.
        Index("ix_meetings_status_starts", "status", "starts_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"))
    organizer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # "audio" or "video": how the huddle opens when someone joins from the card.
    kind: Mapped[str] = mapped_column(String(16), default="audio", server_default="audio")
    status: Mapped[str] = mapped_column(
        String(16), default=MeetingStatus.scheduled, server_default="scheduled"
    )
    # ICS SEQUENCE: bumped on every reschedule / cancel so calendar apps update the event.
    sequence: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # The card in the channel.
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL")
    )
    # When the "starts soon" reminder and the "starting now" ring went out (each exactly once
    # per start time; a reschedule clears them).
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MeetingAttendee(UUIDPk, Timestamped, Base):
    __tablename__ = "meeting_attendees"
    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id"),
        # "My calendar": a user's meetings.
        Index("ix_meeting_attendees_user", "user_id"),
    )

    meeting_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    response: Mapped[str] = mapped_column(String(16), default=RSVP.pending, server_default="pending")
