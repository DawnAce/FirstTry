"""postal manual CRUD: updated_at + complaint three-state enum + handling records

给 5 张邮局台账加手工增改删所需的表结构变更（不含冻结批次）：
- 给 postal_complaints / postal_address_changes / postal_follow_ups / postal_finance 补 ``updated_at``
  （无 FK / 无 index → downgrade 直接 drop_column）。``postal_delivery`` 已有 updated_at，跳过。
- 投诉状态由两态扩三态：``open/resolved`` → ``open/in_progress/resolved``（MySQL 原生 ENUM，须 ALTER；
  其它方言用 VARCHAR/CHECK，不需改，故按方言跳过）。
- 新建 ``postal_complaint_handling_records``（投诉处理时间线子表；删投诉级联删）。

downgrade 遵守 MySQL FK 顺序坑：子表只 drop_table（自带删索引/FK），收窄枚举前先把 in_progress 回写 open。

Revision ID: c7e9a1b3d5f2
Revises: b5d7f9a1c3e6
Create Date: 2026-07-03
"""

from alembic import op
import sqlalchemy as sa


revision = "c7e9a1b3d5f2"
down_revision = "b5d7f9a1c3e6"
branch_labels = None
depends_on = None


_UPDATED_AT_TABLES = (
    "postal_complaints",
    "postal_address_changes",
    "postal_follow_ups",
    "postal_finance",
)

_ENUM_2 = sa.Enum("open", "resolved", name="postalcomplaintstatus")
_ENUM_3 = sa.Enum("open", "in_progress", "resolved", name="postalcomplaintstatus")


def upgrade() -> None:
    # 1) 4 张表补 updated_at（无 FK / 无 index）。
    for tbl in _UPDATED_AT_TABLES:
        op.add_column(
            tbl,
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    # 2) 投诉状态两态 → 三态（仅 MySQL 原生 ENUM 需 ALTER）。
    if op.get_bind().dialect.name == "mysql":
        op.alter_column(
            "postal_complaints", "status",
            existing_type=_ENUM_2, type_=_ENUM_3,
            existing_nullable=False, existing_server_default="open",
        )

    # 3) 投诉处理记录子表。
    op.create_table(
        "postal_complaint_handling_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("complaint_id", sa.Integer(), nullable=False),
        sa.Column("handled_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("handled_by", sa.Integer(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("follow_result", sa.Text(), nullable=True),
        sa.Column("result_status", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["complaint_id"], ["postal_complaints.id"],
            name="fk_pchr_complaint", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["handled_by"], ["users.id"], name="fk_pchr_handled_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_postal_complaint_handling_records_complaint_id",
        "postal_complaint_handling_records", ["complaint_id"],
    )


def downgrade() -> None:
    # 子表只 drop_table（自带删索引/FK，别先 drop_index → MySQL FK 顺序坑）。
    op.drop_table("postal_complaint_handling_records")

    # 收窄枚举前先把 in_progress 归回 open，避免越界值。
    if op.get_bind().dialect.name == "mysql":
        op.execute("UPDATE postal_complaints SET status='open' WHERE status='in_progress'")
        op.alter_column(
            "postal_complaints", "status",
            existing_type=_ENUM_3, type_=_ENUM_2,
            existing_nullable=False, existing_server_default="open",
        )

    for tbl in _UPDATED_AT_TABLES:
        op.drop_column(tbl, "updated_at")
