"""contribution mode scope

Revision ID: 20260613_0010
Revises: 20260613_0009
Create Date: 2026-06-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260613_0010"
down_revision = "20260613_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table_name in ("shared_contribution_packages", "server_uploads"):
        op.add_column(
            table_name,
            sa.Column("mode_scope", sa.String(length=32), nullable=False, server_default="tier_list"),
        )
        op.add_column(
            table_name,
            sa.Column("festival_date_from", sa.String(length=10), nullable=False, server_default=""),
        )
        op.add_column(
            table_name,
            sa.Column("festival_date_to", sa.String(length=10), nullable=False, server_default=""),
        )
        op.create_index(f"ix_{table_name}_mode_scope", table_name, ["mode_scope"], unique=False)


def downgrade() -> None:
    for table_name in ("server_uploads", "shared_contribution_packages"):
        op.drop_index(f"ix_{table_name}_mode_scope", table_name=table_name)
        op.drop_column(table_name, "festival_date_to")
        op.drop_column(table_name, "festival_date_from")
        op.drop_column(table_name, "mode_scope")
