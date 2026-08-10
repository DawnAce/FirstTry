import io
from datetime import date

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Issue,
    IssueAuditSnapshot,
    IssueStatus,
    OperationLog,
    ReportEntry,
    ShippingDetail,
    ShippingDetailSourceType,
    User,
    UserRole,
)
from app.services.shipping_plan_import_service import (
    commit_shipping_plan_import,
    preview_shipping_plan_import,
)


HEADERS = [
    "工作表名称", "渠道", "子渠道", "运输方式", "频次", "状态",
    "姓名", "地址", "电话", "数量", "截止日期", "备注", "附加信息",
    "网点名称", "网点大厅", "联系人", "序号", "期数", "公司",
]


def shipping_file(issue_number: int, quantities: tuple[int, ...] = (6, 4)) -> bytes:
    workbook = Workbook()
    basic = workbook.active
    basic.title = "基本信息"
    basic.append(["字段", "值"])
    basic.append(["期号", issue_number])
    basic.append(["出版日期", "2026-01-26"])
    sheet = workbook.create_sheet("发货明细")
    sheet.append(HEADERS)
    for index, quantity in enumerate(quantities, start=1):
        sheet.append([
            "每周（读者）", "个人订阅", "", "中通物流", "周", "正常",
            f"测试{index}", f"北京市测试路{index}号", f"1380000000{index}", quantity,
            "长期", "", "", "", "", "", index, issue_number, "",
        ])
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    yield session
    session.close()


def add_issue(db, issue_number: int = 2638) -> Issue:
    issue = Issue(
        issue_number=issue_number,
        publish_date=date(2026, 1, 26),
        status=IssueStatus.confirmed,
    )
    db.add(issue)
    db.flush()
    db.add(ReportEntry(
        issue_id=issue.id,
        category="zto",
        sub_category="中通物流公司",
        destination="中通物流公司",
        value=11,
        is_variable=False,
    ))
    db.add(IssueAuditSnapshot(
        issue_id=issue.id,
        snapshot_type="confirm",
        report_total=11,
        shipping_total=11,
        delta=0,
        is_match=True,
    ))
    db.commit()
    return issue


def admin() -> User:
    return User(id=1, username="admin", role=UserRole.admin, password_hash="x")


def test_preview_allows_refill_after_issue_was_cleared(db):
    issue = add_issue(db)

    preview = preview_shipping_plan_import(
        db,
        issue_id=issue.id,
        filename="2638中通明细.xlsx",
        content=shipping_file(2638),
    )

    assert preview.can_commit is True
    assert preview.imported_row_count == 2
    assert preview.imported_quantity == 10
    assert preview.replaced_row_count == 0
    assert preview.resulting_quantity == 10
    assert preview.confirmed_shipping_total == 11
    assert any("不会修改已确认印数" in warning for warning in preview.warnings)


def test_commit_replaces_manual_rows_and_preserves_generated_rows(db):
    issue = add_issue(db)
    old = ShippingDetail(
        issue_number=2638,
        sheet_name="旧文件",
        channel="个人订阅",
        name="旧记录",
        quantity=3,
        source_type=ShippingDetailSourceType.manual,
    )
    generated = ShippingDetail(
        issue_number=2638,
        sheet_name="订单生成",
        channel="个人订阅",
        name="订单记录",
        quantity=1,
        source_type=ShippingDetailSourceType.order_generated,
    )
    db.add_all([old, generated])
    db.commit()
    old_id = old.id
    generated_id = generated.id

    preview = preview_shipping_plan_import(
        db,
        issue_id=issue.id,
        filename="2638中通明细.xlsx",
        content=shipping_file(2638),
    )
    result = commit_shipping_plan_import(
        db,
        issue_id=issue.id,
        import_session_id=preview.import_session_id,
        reason="修正测试文件",
        user=admin(),
    )

    assert result.deleted_count == 1
    assert result.created_count == 2
    assert result.preserved_count == 1
    assert result.resulting_quantity == 11
    assert db.get(ShippingDetail, old_id) is None
    assert db.get(ShippingDetail, generated_id) is not None
    imported = db.query(ShippingDetail).filter(
        ShippingDetail.source_type == ShippingDetailSourceType.historical_import
    ).all()
    assert len(imported) == 2
    log = db.query(OperationLog).filter(OperationLog.action == "replace_shipping").one()
    assert log.changes["reason"] == "修正测试文件"
    assert log.changes["old_quantity"] == 3
    assert log.changes["new_quantity"] == 10


def test_preview_rejects_another_issue_file(db):
    issue = add_issue(db)

    preview = preview_shipping_plan_import(
        db,
        issue_id=issue.id,
        filename="错误期号.xlsx",
        content=shipping_file(2639),
    )

    assert preview.can_commit is False
    assert any("文件期号为 2639" in error for error in preview.errors)


def test_preview_blocks_replacement_of_shipped_history(db):
    issue = add_issue(db)
    db.add(ShippingDetail(
        issue_number=2638,
        sheet_name="旧文件",
        channel="个人订阅",
        name="已经发货",
        quantity=3,
        shipped_quantity=3,
        source_type=ShippingDetailSourceType.manual,
    ))
    db.commit()

    preview = preview_shipping_plan_import(
        db,
        issue_id=issue.id,
        filename="2638中通明细.xlsx",
        content=shipping_file(2638),
    )

    assert preview.can_commit is False
    assert any("已经关联运单、实发或核销记录" in error for error in preview.errors)


def test_commit_rejects_stale_preview(db):
    issue = add_issue(db)
    detail = ShippingDetail(
        issue_number=2638,
        sheet_name="旧文件",
        channel="个人订阅",
        name="旧记录",
        quantity=3,
        source_type=ShippingDetailSourceType.manual,
    )
    db.add(detail)
    db.commit()
    preview = preview_shipping_plan_import(
        db,
        issue_id=issue.id,
        filename="2638中通明细.xlsx",
        content=shipping_file(2638),
    )
    detail.quantity = 4
    db.commit()

    with pytest.raises(HTTPException) as exc:
        commit_shipping_plan_import(
            db,
            issue_id=issue.id,
            import_session_id=preview.import_session_id,
            reason="修正测试文件",
            user=admin(),
        )

    assert exc.value.status_code == 409
    assert "重新预览" in exc.value.detail
