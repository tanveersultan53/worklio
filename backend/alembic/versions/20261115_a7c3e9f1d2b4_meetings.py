"""meetings: scheduled huddles and their attendees (calendar)

Revision ID: a7c3e9f1d2b4
Revises: c4d8e2f6a1b3
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a7c3e9f1d2b4"
down_revision: str | Sequence[str] | None = "c4d8e2f6a1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "meetings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel_id", sa.Uuid(), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "organizer_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(16), server_default="audio", nullable=False),
        sa.Column("status", sa.String(16), server_default="scheduled", nullable=False),
        sa.Column("sequence", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "message_id", sa.Uuid(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("reminded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_notified_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_meetings_workspace_starts", "meetings", ["workspace_id", "starts_at"])
    op.create_index("ix_meetings_channel_starts", "meetings", ["channel_id", "starts_at"])
    op.create_index("ix_meetings_status_starts", "meetings", ["status", "starts_at"])

    op.create_table(
        "meeting_attendees",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "meeting_id", sa.Uuid(), sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("response", sa.String(16), server_default="pending", nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("meeting_id", "user_id"),
    )
    op.create_index("ix_meeting_attendees_user", "meeting_attendees", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_meeting_attendees_user", table_name="meeting_attendees")
    op.drop_table("meeting_attendees")
    op.drop_index("ix_meetings_status_starts", table_name="meetings")
    op.drop_index("ix_meetings_channel_starts", table_name="meetings")
    op.drop_index("ix_meetings_workspace_starts", table_name="meetings")
    op.drop_table("meetings")
