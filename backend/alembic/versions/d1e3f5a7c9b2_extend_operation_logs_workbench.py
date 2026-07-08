"""extend operation_logs for the ZTO-MF workbench feed

给通用操作日志 ``operation_logs`` 加工作台「最近操作记录」所需的三个附加列（不建表）：
- ``issue_number`` INT nullable + index —— 期数（可按期过滤 feed；普通行为 NULL；非 FK，
  与 ``shipping_details.issue_number`` 一致）。
- ``channel`` VARCHAR(100) nullable —— 渠道（单条发货操作时取 ShippingDetail.channel，其余 NULL）。
- ``status`` VARCHAR(20) NOT NULL server_default 'success' —— 成功/失败。

downgrade 是「删带索引的列」：先 drop_index 再 drop_column（**非删表**，故与
「删表只 drop_table」的 MySQL FK 顺序坑不冲突）。历史行不回填 issue_number/channel
（nullable，feed 里留空即可）。

Revision ID: d1e3f5a7c9b2
Revises: c7e9a1b3d5f2
Create Date: 2026-07-07
"""

from alembic import op
import sqlalchemy as sa


revision = "d1e3f5a7c9b2"
down_revision = "c7e9a1b3d5f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("operation_logs", sa.Column("issue_number", sa.Integer(), nullable=True))
    op.add_column("operation_logs", sa.Column("channel", sa.String(length=100), nullable=True))
    op.add_column(
        "operation_logs",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="success"),
    )
    op.create_index(
        op.f("ix_operation_logs_issue_number"),
        "operation_logs",
        ["issue_number"],
        unique=False,
    )


def downgrade() -> None:
    # 删「带索引的列」：先删索引再删列（非删表，别套用「删表只 drop_table」的坑）。
    op.drop_index(op.f("ix_operation_logs_issue_number"), table_name="operation_logs")
    op.drop_column("operation_logs", "status")
    op.drop_column("operation_logs", "channel")
    op.drop_column("operation_logs", "issue_number")
