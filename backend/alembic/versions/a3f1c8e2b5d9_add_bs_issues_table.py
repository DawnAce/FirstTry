"""add bs_issues (商学院月刊刊期日历) table

商学院月刊的「月→期」日历（含合刊覆盖区间），用于把订阅覆盖期展开成命中的各期，
算「某期发行量 = 单期销量 + 覆盖该期的订阅份数」。纯新增，不动任何既有表。

Revision ID: a3f1c8e2b5d9
Revises: c4f1a9e2b6d3
Create Date: 2026-06-26
"""

from alembic import op
import sqlalchemy as sa


revision = "a3f1c8e2b5d9"
down_revision = "c4f1a9e2b6d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bs_issues",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("issue_label", sa.String(length=32), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month_start", sa.Integer(), nullable=False),
        sa.Column("month_end", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("issue_label", name="uq_bs_issues_issue_label"),
    )
    op.create_index("ix_bs_issues_issue_label", "bs_issues", ["issue_label"], unique=False)
    op.create_index("ix_bs_issues_year", "bs_issues", ["year"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_bs_issues_year", table_name="bs_issues")
    op.drop_index("ix_bs_issues_issue_label", table_name="bs_issues")
    op.drop_table("bs_issues")
