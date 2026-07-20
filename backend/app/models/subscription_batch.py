"""邮局订报数据生成模块 · 批次 + 不可变版本流水 + 生成产物。

上传驱动、自成闭环（区别于「月度起投明细」的名册驱动）：用户上传两份来源文件
（来源A 订阅明细、来源B 读者统计），系统解析 / 校验 / 计算 / 生成邮局订报文件。

**不可变版本设计**：原始文件、解析明细、校验问题、生成产物全部绑定到具体
``SubscriptionImportVersion``。重新导入生成 V2/V3，旧版标记 ``superseded``、**不物理覆盖**。

* ``SubscriptionBatch``          —— 一次月份订报工作（如「2026年8月邮局订报」）。
* ``SubscriptionImportVersion``  —— 一次完整上传与解析（V1/V2…）。
* ``SubscriptionSourceFile``     —— 用户上传的原始文件（原样保存 + SHA-256）。
* ``SubscriptionRecord``         —— 某版本解析后的一条有效明细（不可变快照）。
* ``SubscriptionValidationIssue``—— 解析/规则校验发现的问题（阻断/警告/提示）。
* ``SubscriptionGenerationRun``  —— 针对某版本执行的一次生成。
* ``SubscriptionOutputArtifact`` —— 生成的 Excel / ZIP 产物。
"""

import enum

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class SubscriptionBatchStatus(str, enum.Enum):
    """订报批次的生命周期（文档 §4.1）。"""

    draft = "draft"                        # 草稿：刚建、未上传
    pending_validation = "pending_validation"  # 待校验：已上传、有版本未通过
    ready = "ready"                        # 可生成：有校验通过且已设为有效的版本
    generated = "generated"                # 已生成：产物已产出
    archived = "archived"                  # 已归档


class SubscriptionImportStatus(str, enum.Enum):
    """一次导入版本的状态（文档 §4.1）。"""

    uploading = "uploading"
    parsing = "parsing"
    validation_failed = "validation_failed"
    validation_passed = "validation_passed"
    active = "active"          # 当前有效版本
    superseded = "superseded"  # 已被替代（旧版，不删）


class SubscriptionIssueLevel(str, enum.Enum):
    """校验问题级别（文档 §7）。"""

    block = "block"    # 阻断：禁止生成
    warn = "warn"      # 警告：确认后可继续
    info = "info"      # 提示：记录但不阻断


class SubscriptionRunStatus(str, enum.Enum):
    """生成任务状态（文档 §4.1）。"""

    queued = "queued"
    running = "running"
    success = "success"
    failed = "failed"
    void = "void"      # 已作废（被新版产物替代时标历史）


class SubscriptionArtifactType(str, enum.Enum):
    """输出产物类型（文档 §8）。"""

    workbook = "workbook"              # 北京-汇总+明细+申请
    postal_summary = "postal_summary"  # 北京局订报汇总表
    region_detail = "region_detail"    # 各地区集订分送表
    zip = "zip"                        # 打包下载


class SubscriptionBatch(Base):
    """订报批次：一次月份订报工作。"""

    __tablename__ = "subscription_batches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)          # 业务年份
    start_month = Column(Integer, nullable=False)               # 订阅起始月份 1–12
    make_date = Column(Date, nullable=True)                     # 制作日期（生成时定，显示 yyyy年m月d日）
    unit_price = Column(Numeric(10, 2), nullable=True)          # 每份完整订期价格（缺省由规则算）
    status = Column(
        SAEnum(SubscriptionBatchStatus),
        default=SubscriptionBatchStatus.draft,
        server_default="draft",
        nullable=False,
        index=True,
    )
    # 当前有效版本（可空；use_alter 避免与 versions 表的循环外键建表顺序问题）。
    active_version_id = Column(
        Integer,
        ForeignKey("subscription_import_versions.id", use_alter=True,
                   name="fk_sub_batch_active_version", ondelete="SET NULL"),
        nullable=True,
    )
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    versions = relationship(
        "SubscriptionImportVersion",
        back_populates="batch",
        cascade="all, delete-orphan",
        foreign_keys="SubscriptionImportVersion.batch_id",
    )

    __table_args__ = (
        UniqueConstraint("year", "start_month", name="uq_sub_batch_year_month"),
    )


class SubscriptionImportVersion(Base):
    """导入版本：一次完整上传与解析（不可变）。"""

    __tablename__ = "subscription_import_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(
        Integer,
        ForeignKey("subscription_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_no = Column(Integer, nullable=False)  # 批次内自增：V1/V2…
    status = Column(
        SAEnum(SubscriptionImportStatus),
        default=SubscriptionImportStatus.uploading,
        server_default="uploading",
        nullable=False,
        index=True,
    )
    reason = Column(Text, nullable=True)  # 重新导入原因（缺省「来源数据修正后重新导入」）
    summary_json = Column(JSON, nullable=True)  # 概览：条数/份数/金额/地区数
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_at = Column(DateTime, server_default=func.now(), nullable=False)

    batch = relationship(
        "SubscriptionBatch", back_populates="versions", foreign_keys=[batch_id]
    )
    source_files = relationship(
        "SubscriptionSourceFile", back_populates="version", cascade="all, delete-orphan"
    )
    records = relationship(
        "SubscriptionRecord", back_populates="version", cascade="all, delete-orphan"
    )
    issues = relationship(
        "SubscriptionValidationIssue", back_populates="version",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("batch_id", "version_no", name="uq_sub_version_batch_no"),
    )


class SubscriptionSourceFile(Base):
    """来源文件：用户上传的原始文件（原样保存 + SHA-256）。"""

    __tablename__ = "subscription_source_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version_id = Column(
        Integer,
        ForeignKey("subscription_import_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_role = Column(String(8), nullable=False)   # 'A'（订阅明细）/ 'B'（读者统计）
    file_type = Column(String(16), nullable=True)   # xlsx / xls / csv
    original_filename = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)  # uploads/... 相对路径
    size = Column(Integer, nullable=True)
    sha256 = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    version = relationship("SubscriptionImportVersion", back_populates="source_files")


class SubscriptionRecord(Base):
    """解析后的一条有效明细（每版一套不可变快照）。"""

    __tablename__ = "subscription_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version_id = Column(
        Integer,
        ForeignKey("subscription_import_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 收报人。
    name = Column(String(128), nullable=False)
    phone = Column(String(64), nullable=True)
    province = Column(String(50), nullable=True)
    city = Column(String(50), nullable=True)
    district = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)              # 规范化后的完整地址
    postal_code = Column(String(20), nullable=True)
    # 订阅信息。
    copies = Column(Integer, nullable=False, server_default="1")  # 份数
    months = Column(Integer, nullable=True)                       # 订阅月数
    amount = Column(Numeric(12, 2), nullable=True)               # 份数×月数×20（数值）
    # 地区 / 投递单位（冻结地区名，与黄金样本一致）。
    region_name = Column(String(64), nullable=True, index=True)
    distribution_unit_id = Column(
        Integer, ForeignKey("partners.id"), nullable=True, index=True
    )
    # 溯源。
    source_file_role = Column(String(8), nullable=True)  # A / B
    source_row = Column(Integer, nullable=True)          # 来源行号
    # 排除项：不删行、生成时跳过并留痕（文档 §6 原始追溯）。
    excluded = Column(Boolean, default=False, server_default="0", nullable=False)
    exclude_reason = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    version = relationship("SubscriptionImportVersion", back_populates="records")


class SubscriptionValidationIssue(Base):
    """校验问题：解析或规则校验发现的问题（可定位到来源行）。"""

    __tablename__ = "subscription_validation_issues"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version_id = Column(
        Integer,
        ForeignKey("subscription_import_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    level = Column(SAEnum(SubscriptionIssueLevel), nullable=False, index=True)
    source = Column(String(8), nullable=True)          # A / B
    sheet_or_file = Column(String(128), nullable=True)  # 工作表名或 CSV 文件名
    row_no = Column(Integer, nullable=True)             # 来源行号
    field = Column(String(64), nullable=True)
    code = Column(String(64), nullable=True)            # 问题代码（可配置枚举）
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    version = relationship("SubscriptionImportVersion", back_populates="issues")


class SubscriptionGenerationRun(Base):
    """生成任务：针对某版本执行的一次生成。"""

    __tablename__ = "subscription_generation_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(
        Integer, ForeignKey("subscription_batches.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    version_id = Column(
        Integer, ForeignKey("subscription_import_versions.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    rule_version = Column(String(32), nullable=True)     # 规则版本（本期占位）
    template_version = Column(String(32), nullable=True)  # 模板版本（本期占位）
    status = Column(
        SAEnum(SubscriptionRunStatus),
        default=SubscriptionRunStatus.queued,
        server_default="queued",
        nullable=False,
        index=True,
    )
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    artifacts = relationship(
        "SubscriptionOutputArtifact", back_populates="run",
        cascade="all, delete-orphan",
    )


class SubscriptionOutputArtifact(Base):
    """输出产物：生成的 Excel 或 ZIP（不覆盖历史）。"""

    __tablename__ = "subscription_output_artifacts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(
        Integer, ForeignKey("subscription_generation_runs.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    batch_id = Column(Integer, nullable=False, index=True)
    version_id = Column(Integer, nullable=False, index=True)
    artifact_type = Column(SAEnum(SubscriptionArtifactType), nullable=False)
    region_name = Column(String(64), nullable=True)  # region_detail 用
    filename = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)
    sha256 = Column(String(64), nullable=True)
    is_historical = Column(Boolean, default=False, server_default="0", nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    run = relationship("SubscriptionGenerationRun", back_populates="artifacts")
