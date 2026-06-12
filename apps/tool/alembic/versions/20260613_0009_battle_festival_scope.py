"""battle festival collection scope

Revision ID: 20260613_0009
Revises: 20260519_0008
Create Date: 2026-06-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260613_0009"
down_revision = "20260519_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "server_share_config",
        sa.Column("include_battle_festival", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "server_leaderboard_runs",
        sa.Column("include_battle_festival", sa.Integer(), nullable=False, server_default="0"),
    )
    op.drop_index("ix_server_leaderboard_runs_current", table_name="server_leaderboard_runs")
    op.create_index(
        "ix_server_leaderboard_runs_current",
        "server_leaderboard_runs",
        [
            "scope",
            "status",
            "payload_version",
            "target_version",
            "date_from",
            "date_to",
            "include_solo",
            "include_battle_festival",
            "upload_watermark",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_server_leaderboard_runs_current", table_name="server_leaderboard_runs")
    op.create_index(
        "ix_server_leaderboard_runs_current",
        "server_leaderboard_runs",
        ["scope", "status", "payload_version", "target_version", "date_from", "date_to", "include_solo", "upload_watermark"],
        unique=False,
    )
    op.drop_column("server_leaderboard_runs", "include_battle_festival")
    op.drop_column("server_share_config", "include_battle_festival")
