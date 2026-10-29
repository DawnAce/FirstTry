"""机构渠道订货、报数需求与印数采用记录。

Revision ID: d0e2f4a6b8c1
Revises: c9e1f3a5b7d0
"""
from alembic import op
import sqlalchemy as sa

revision = "d0e2f4a6b8c1"
down_revision = "c9e1f3a5b7d0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("channel_demand_profiles",
        sa.Column("partner_id", sa.Integer(), sa.ForeignKey("partners.id"), primary_key=True),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("legal_name", sa.String(128)),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("pricing_policy", sa.String(30), nullable=False, server_default="unpriced"))
    # 一次性识别旧档案，后续改名不会改变机构关联；不改名、不合并历史记录。
    profiles = sa.table("channel_demand_profiles", sa.column("partner_id", sa.Integer),
        sa.column("display_name", sa.String), sa.column("legal_name", sa.String), sa.column("category", sa.String), sa.column("pricing_policy", sa.String))
    presets = {
        "成都邮征天下（成都杂志铺）": ("成都杂志铺", "chengdu", "chengdu_annual"),
        "成都邮征天下信息技术有限公司": ("成都杂志铺", "chengdu", "chengdu_annual"),
        "成都杂志铺": ("成都杂志铺", "chengdu", "chengdu_annual"),
        "北京市报刊发行局": ("北京邮发", "postal", "unpriced"),
        "北京报刊发行局": ("北京邮发", "postal", "unpriced"),
        "北京报刊零售局": ("北京报零", "retail", "unpriced"),
        "广州日报": ("广州日报", "guangzhou", "unpriced"),
    }
    for partner_id, name in op.get_bind().execute(sa.text("SELECT id, name FROM partners")):
        if name in presets:
            display, category, policy = presets[name]
            op.bulk_insert(profiles, [dict(partner_id=partner_id, display_name=display, legal_name="成都邮征天下信息技术有限公司" if category == "chengdu" else name, category=category, pricing_policy=policy)])

    op.create_table("channel_demands",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("partner_id", sa.Integer(), sa.ForeignKey("partners.id"), nullable=False),
        sa.Column("contract_id", sa.Integer(), sa.ForeignKey("contracts.id")),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("document_type", sa.String(20), nullable=False),
        sa.Column("cycle", sa.String(20), nullable=False),
        sa.Column("received_date", sa.Date(), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("supersedes_id", sa.Integer(), sa.ForeignKey("channel_demands.id")),
        sa.Column("transport", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("recipient_name", sa.String(128)),
        sa.Column("recipient_phone", sa.String(64)),
        sa.Column("recipient_address", sa.String(500)),
        sa.Column("pricing", sa.JSON()), sa.Column("notes", sa.Text()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("confirmed_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("confirmed_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    for field in ("partner_id", "status"):
        op.create_index(f"ix_channel_demands_{field}", "channel_demands", [field])
    op.create_table("channel_demand_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("demand_id", sa.Integer(), sa.ForeignKey("channel_demands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issue_number", sa.Integer(), nullable=False),
        sa.Column("publish_date", sa.Date(), nullable=False),
        sa.Column("sub_category", sa.String(100), nullable=False),
        sa.Column("quantity", sa.Integer()),
        sa.Column("review_status", sa.String(20), nullable=False),
        sa.Column("unit_price", sa.Numeric(10, 2)),
        sa.UniqueConstraint("demand_id", "issue_number", "sub_category", name="uq_demand_line_period"))
    for field in ("demand_id", "issue_number"):
        op.create_index(f"ix_channel_demand_lines_{field}", "channel_demand_lines", [field])
    op.create_table("channel_demand_attachments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("demand_id", sa.Integer(), sa.ForeignKey("channel_demands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("stored_path", sa.String(500), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("extraction", sa.JSON()), sa.Column("reviewed_version", sa.Integer()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_channel_demand_attachments_demand_id", "channel_demand_attachments", ["demand_id"])
    op.create_table("channel_demand_adoptions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("issue_number", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("sub_category", sa.String(100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("apply_token", sa.String(64), nullable=False),
        sa.Column("source_snapshot", sa.JSON(), nullable=False),
        sa.Column("adopted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("adopted_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("issue_number", "category", "sub_category", name="uq_demand_adoption_period"))
    op.create_index("ix_channel_demand_adoptions_issue_number", "channel_demand_adoptions", ["issue_number"])


def downgrade():
    for table in ("channel_demand_adoptions", "channel_demand_attachments", "channel_demand_lines", "channel_demands", "channel_demand_profiles"):
        op.drop_table(table)
