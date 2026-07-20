"""subscription (邮局订报) data generation module: batches + immutable version flow

新建邮局订报数据生成模块 7 张表：批次、导入版本（不可变流水）、来源文件、解析明细、
校验问题、生成任务、输出产物。纯加表，不动既有结构，向后兼容。

批次 active_version_id 与版本 batch_id 互相引用 → 循环外键：先建表、最后用
create_foreign_key 补上 active_version 外键（downgrade 先摘）。

Revision ID: f1a2b3c4d5e6
Revises: d1e3f5a7c9b2
Create Date: 2026-07-20
"""

from alembic import op
import sqlalchemy as sa


revision = "f1a2b3c4d5e6"
down_revision = "d1e3f5a7c9b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscription_batches",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("start_month", sa.Integer(), nullable=False),
        sa.Column("make_date", sa.Date(), nullable=True),
        sa.Column("unit_price", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column(
            "status",
            sa.Enum("draft", "pending_validation", "ready", "generated", "archived",
                    name="subscriptionbatchstatus"),
            server_default="draft",
            nullable=False,
        ),
        # active_version_id 外键最后补（循环引用）。
        sa.Column("active_version_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "start_month", name="uq_sub_batch_year_month"),
    )
    op.create_index("ix_subscription_batches_year", "subscription_batches", ["year"])
    op.create_index("ix_subscription_batches_status", "subscription_batches", ["status"])

    op.create_table(
        "subscription_import_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("uploading", "parsing", "validation_failed", "validation_passed",
                    "active", "superseded", name="subscriptionimportstatus"),
            server_default="uploading",
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["subscription_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "version_no", name="uq_sub_version_batch_no"),
    )
    op.create_index("ix_subscription_import_versions_batch_id", "subscription_import_versions", ["batch_id"])
    op.create_index("ix_subscription_import_versions_status", "subscription_import_versions", ["status"])

    # 循环外键：批次 active_version_id → 版本。
    op.create_foreign_key(
        "fk_sub_batch_active_version",
        "subscription_batches",
        "subscription_import_versions",
        ["active_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "subscription_source_files",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("file_role", sa.String(length=8), nullable=False),
        sa.Column("file_type", sa.String(length=16), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_path", sa.String(length=500), nullable=False),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["version_id"], ["subscription_import_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscription_source_files_version_id", "subscription_source_files", ["version_id"])
    op.create_index("ix_subscription_source_files_sha256", "subscription_source_files", ["sha256"])

    op.create_table(
        "subscription_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("province", sa.String(length=50), nullable=True),
        sa.Column("city", sa.String(length=50), nullable=True),
        sa.Column("district", sa.String(length=50), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("copies", sa.Integer(), server_default="1", nullable=False),
        sa.Column("months", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("region_name", sa.String(length=64), nullable=True),
        sa.Column("distribution_unit_id", sa.Integer(), nullable=True),
        sa.Column("source_file_role", sa.String(length=8), nullable=True),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("excluded", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("exclude_reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["version_id"], ["subscription_import_versions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["distribution_unit_id"], ["partners.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscription_records_version_id", "subscription_records", ["version_id"])
    op.create_index("ix_subscription_records_region_name", "subscription_records", ["region_name"])
    op.create_index("ix_subscription_records_distribution_unit_id", "subscription_records", ["distribution_unit_id"])

    op.create_table(
        "subscription_validation_issues",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column(
            "level",
            sa.Enum("block", "warn", "info", name="subscriptionissuelevel"),
            nullable=False,
        ),
        sa.Column("source", sa.String(length=8), nullable=True),
        sa.Column("sheet_or_file", sa.String(length=128), nullable=True),
        sa.Column("row_no", sa.Integer(), nullable=True),
        sa.Column("field", sa.String(length=64), nullable=True),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["version_id"], ["subscription_import_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscription_validation_issues_version_id", "subscription_validation_issues", ["version_id"])
    op.create_index("ix_subscription_validation_issues_level", "subscription_validation_issues", ["level"])

    op.create_table(
        "subscription_generation_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("rule_version", sa.String(length=32), nullable=True),
        sa.Column("template_version", sa.String(length=32), nullable=True),
        sa.Column(
            "status",
            sa.Enum("queued", "running", "success", "failed", "void",
                    name="subscriptionrunstatus"),
            server_default="queued",
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["subscription_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["subscription_import_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscription_generation_runs_batch_id", "subscription_generation_runs", ["batch_id"])
    op.create_index("ix_subscription_generation_runs_version_id", "subscription_generation_runs", ["version_id"])
    op.create_index("ix_subscription_generation_runs_status", "subscription_generation_runs", ["status"])

    op.create_table(
        "subscription_output_artifacts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column(
            "artifact_type",
            sa.Enum("workbook", "postal_summary", "region_detail", "zip",
                    name="subscriptionartifacttype"),
            nullable=False,
        ),
        sa.Column("region_name", sa.String(length=64), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("stored_path", sa.String(length=500), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("is_historical", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["subscription_generation_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscription_output_artifacts_run_id", "subscription_output_artifacts", ["run_id"])
    op.create_index("ix_subscription_output_artifacts_batch_id", "subscription_output_artifacts", ["batch_id"])
    op.create_index("ix_subscription_output_artifacts_version_id", "subscription_output_artifacts", ["version_id"])


def downgrade() -> None:
    # 先摘循环外键，再按依赖倒序删表（drop_table 自带删其索引/FK/enum）。
    op.drop_constraint("fk_sub_batch_active_version", "subscription_batches", type_="foreignkey")
    op.drop_table("subscription_output_artifacts")
    op.drop_table("subscription_generation_runs")
    op.drop_table("subscription_validation_issues")
    op.drop_table("subscription_records")
    op.drop_table("subscription_source_files")
    op.drop_table("subscription_import_versions")
    op.drop_table("subscription_batches")
