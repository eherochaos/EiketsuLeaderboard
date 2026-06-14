"""battle festival official period source

Revision ID: 20260614_0011
Revises: 20260613_0010
Create Date: 2026-06-14
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260614_0011"
down_revision = "20260613_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table_name in ("shared_contribution_packages", "server_uploads"):
        op.add_column(
            table_name,
            sa.Column("festival_period_source", sa.String(length=32), nullable=False, server_default=""),
        )


def downgrade() -> None:
    for table_name in ("server_uploads", "shared_contribution_packages"):
        op.drop_column(table_name, "festival_period_source")
