"""Tests for 财务管理（订单发票工作台 + 渠道结算 + 附件）—— invoices / settlements API.

Same strategy as test_contracts_api.py: FastAPI over in-memory SQLite, auth via
dependency override, a single TestClient whose acting user is switchable.
"""

import os
import sys
import json
from io import BytesIO
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_USER", "test")
os.environ.setdefault("MYSQL_PASSWORD", "test")
os.environ.setdefault("MYSQL_DATABASE", "test")

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models.order import Order, OrderEntryMethod, OrderStatus
from app.models.user import User, UserRole
from app.services import attachment_service

ADMIN = User(id=1, username="admin", password_hash="x", role=UserRole.admin)
OPERATOR = User(id=2, username="op", password_hash="x", role=UserRole.operator)


def _beijing_settlement_xlsx() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["结算单产品明细"])
    sheet.append(["供应商编号：", None, "11014337", None, None, None, "供应商名称：", None, "北京营报传媒文化发展有限责任公司"])
    sheet.append(["结算单号：", None, "JS100025612600000855", None, None, None, "结算年度：", None, "2026"])
    sheet.append([])
    sheet.append([])
    sheet.append(["序号", "产品名称", "邮发代号", "期数", "结算数量", "价格", "总款额", "结算单价", "结算款额（含税）"])
    normal_dates = ["060100", "060800", "061500", "062200", "062900"]
    for index, issue in enumerate(normal_dates, 1):
        sheet.append([index, "中国经营报", "1-76", issue, 1050, 5, 5250, 2.75, 2887.5])
    returns = [
        ("050400", -2, -5.5), ("051100", -2, -5.5),
        ("051800", -4, -11), ("052500", -4, -11),
        ("060100", -1009, -2774.75), ("060100", -4, -11),
        ("060800", -1038, -2854.5), ("061500", -1038, -2854.5),
        ("062200", -999, -2747.25), ("062900", -916, -2519),
    ]
    for offset, (issue, quantity, amount) in enumerate(returns, 6):
        sheet.append([offset, "中国经营报", "1-76", issue, quantity, -5, None, -2.75, amount])
    sheet.append(["合计", None, "--", "--", 234, "--", 1170, "--", 643.5])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    state = {"user": ADMIN}
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    c = TestClient(app)
    c.set_user = lambda u: state.__setitem__("user", u)
    c.session_factory = Session
    try:
        yield c
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)


def _order(db, *, invoice_required=False, refunded=0, total=100, code=None, invoice_email=None):
    o = Order(
        order_date=date(2026, 6, 1),
        entry_method=OrderEntryMethod.excel_import,
        payer_name="测试客户",  # 无拉丁字母，避免与 q 搜索 order_code 串味
        status=OrderStatus.active,
        total_amount=Decimal(str(total)),
        paid_amount=Decimal(str(total)),
        refunded_amount=Decimal(str(refunded)),
        invoice_required=invoice_required,
        invoice_recipient_email=invoice_email,
        order_code=code,
    )
    db.add(o)
    db.flush()
    return o


# --------------------------------------------------------------------------- #
# 发票工作台
# --------------------------------------------------------------------------- #
def test_invoice_workbench_states(client):
    db = client.session_factory()
    a = _order(db, invoice_required=True, code="A", invoice_email="billing@example.com")  # pending
    b = _order(db, invoice_required=True, code="B")              # 开正票 → issued
    c = _order(db, invoice_required=True, refunded=50, code="C")  # 正票 + 退款 → 需冲红
    d = _order(db, invoice_required=True, refunded=50, code="D")  # 正票 + 红冲 → issued
    e = _order(db, invoice_required=False, code="E")             # 不相关 → 不入工作台
    db.commit()
    a_id, b_id, c_id, d_id, e_id = a.id, b.id, c.id, d.id, e.id
    db.close()

    for oid, no in [(b_id, "B-001"), (c_id, "C-001"), (d_id, "D-001")]:
        r = client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": no, "amount": 100})
        assert r.status_code == 201, r.text
    assert client.post("/api/invoices", json={"order_id": d_id, "invoice_type": "red_reversal", "invoice_no": "D-002"}).status_code == 201

    data = client.get("/api/invoices/orders").json()
    by = {r["order_id"]: r for r in data["rows"]}
    assert set(by) == {a_id, b_id, c_id, d_id}          # E 被排除
    assert by[a_id]["invoice_state"] == "pending"
    assert by[a_id]["invoice_recipient_email"] == "billing@example.com"
    assert by[a_id]["normal_invoiced_amount"] == "0.00"
    assert by[a_id]["remaining_invoice_amount"] == "100.00"
    assert by[b_id]["invoice_state"] == "issued"
    assert by[b_id]["normal_invoiced_amount"] == "100.00"
    assert by[b_id]["remaining_invoice_amount"] == "0.00"
    assert by[c_id]["invoice_state"] == "needs_red_reversal"
    assert by[c_id]["needs_red_reversal"] is True
    assert by[d_id]["invoice_state"] == "issued"
    assert len(by[d_id]["invoices"]) == 2
    assert data["pending_count"] == 1
    assert data["needs_red_reversal_count"] == 1
    assert data["issued_count"] == 2

    # 状态筛选
    nr = client.get("/api/invoices/orders", params={"status": "needs_red_reversal"}).json()
    assert {r["order_id"] for r in nr["rows"]} == {c_id}
    # 搜索（order_code 唯一）
    qa = client.get("/api/invoices/orders", params={"q": "A"}).json()
    assert {r["order_id"] for r in qa["rows"]} == {a_id}


def test_create_invoice_requires_existing_order(client):
    assert client.post("/api/invoices", json={"order_id": 999, "amount": 100}).status_code == 400


def test_normal_invoice_can_be_split_but_cannot_exceed_order_total(client):
    db = client.session_factory()
    o = _order(db, invoice_required=True, total=240, code="SPLIT")
    db.commit()
    oid = o.id
    db.close()

    first = client.post(
        "/api/invoices",
        json={"order_id": oid, "invoice_type": "normal", "amount": 100},
    )
    assert first.status_code == 201, first.text
    assert first.json()["has_attachment"] is False  # 电子发票附件为选填
    assert first.json()["attachment_filename"] is None
    row = client.get("/api/invoices/orders").json()["rows"][0]
    assert row["invoice_state"] == "pending"
    assert row["normal_invoiced_amount"] == "100.00"
    assert row["remaining_invoice_amount"] == "140.00"

    over = client.post(
        "/api/invoices",
        json={"order_id": oid, "invoice_type": "normal", "amount": 141},
    )
    assert over.status_code == 400
    assert over.json()["detail"] == "开票金额超过待开金额 ¥140.00"

    second = client.post(
        "/api/invoices",
        json={"order_id": oid, "invoice_type": "normal", "amount": 140},
    )
    assert second.status_code == 201, second.text
    row = client.get("/api/invoices/orders").json()["rows"][0]
    assert row["invoice_state"] == "issued"
    assert row["normal_invoiced_amount"] == "240.00"
    assert row["remaining_invoice_amount"] == "0.00"

    duplicate = client.post(
        "/api/invoices",
        json={"order_id": oid, "invoice_type": "normal", "amount": 1},
    )
    assert duplicate.status_code == 400
    assert duplicate.json()["detail"] == "该订单已足额开票，不能继续登记正票"


def test_order_detail_uses_same_invoice_state_as_finance_workbench(client):
    db = client.session_factory()
    no_invoice = _order(db, invoice_required=False, total=240, code="NONE")
    pending = _order(db, invoice_required=True, total=240, code="PENDING")
    partial = _order(db, invoice_required=True, total=240, code="PARTIAL")
    issued = _order(db, invoice_required=True, total=240, code="ISSUED")
    needs_red = _order(db, invoice_required=True, refunded=50, total=240, code="RED")
    db.commit()
    ids = {
        "none": no_invoice.id,
        "pending": pending.id,
        "partial": partial.id,
        "issued": issued.id,
        "red": needs_red.id,
    }
    db.close()

    assert client.post("/api/invoices", json={"order_id": ids["partial"], "amount": 100}).status_code == 201
    assert client.post("/api/invoices", json={"order_id": ids["issued"], "amount": 240}).status_code == 201
    assert client.post("/api/invoices", json={"order_id": ids["red"], "amount": 240}).status_code == 201

    expected = {
        "none": ("not_required", "0.00", "0.00", False),
        "pending": ("pending", "0.00", "240.00", False),
        "partial": ("pending", "100.00", "140.00", False),
        "issued": ("issued", "240.00", "0.00", False),
        "red": ("needs_red_reversal", "240.00", "0.00", True),
    }
    for key, order_id in ids.items():
        detail = client.get(f"/api/orders/{order_id}")
        assert detail.status_code == 200, detail.text
        body = detail.json()
        state, invoiced, remaining, needs_reversal = expected[key]
        assert body["invoice_state"] == state
        assert body["normal_invoiced_amount"] == invoiced
        assert body["remaining_invoice_amount"] == remaining
        assert body["needs_red_reversal"] is needs_reversal

    workbench = {
        row["order_id"]: row
        for row in client.get("/api/invoices/orders").json()["rows"]
    }
    for key in ("pending", "partial", "issued", "red"):
        detail = client.get(f"/api/orders/{ids[key]}").json()
        row = workbench[ids[key]]
        assert detail["invoice_state"] == row["invoice_state"]
        assert detail["normal_invoiced_amount"] == row["normal_invoiced_amount"]
        assert detail["remaining_invoice_amount"] == row["remaining_invoice_amount"]
        assert detail["needs_red_reversal"] == row["needs_red_reversal"]


def test_normal_invoice_requires_positive_amount(client):
    db = client.session_factory()
    o = _order(db, invoice_required=True, total=240)
    db.commit()
    oid = o.id
    db.close()

    missing = client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal"})
    assert missing.status_code == 400
    assert missing.json()["detail"] == "开票金额必须大于 0"


def test_invoice_delete_flips_state_back_to_pending(client):
    db = client.session_factory()
    o = _order(db, invoice_required=True, code="X")
    db.commit()
    oid = o.id
    db.close()

    inv = client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": "X-1", "amount": 100}).json()
    assert client.get("/api/invoices/orders").json()["rows"][0]["invoice_state"] == "issued"
    assert client.delete(f"/api/invoices/{inv['id']}").status_code == 204
    assert client.get("/api/invoices/orders").json()["rows"][0]["invoice_state"] == "pending"


def test_invoice_writes_require_admin(client):
    db = client.session_factory()
    o = _order(db, invoice_required=True)
    db.commit()
    oid = o.id
    db.close()
    client.set_user(OPERATOR)
    assert client.get("/api/invoices/orders").status_code == 200
    assert client.post("/api/invoices", json={"order_id": oid, "amount": 100}).status_code == 403


def test_invoice_optional_attachment_upload_preview_replace_and_delete(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    db = client.session_factory()
    o = _order(db, invoice_required=True, total=240, code="FILE")
    db.commit()
    oid = o.id
    db.close()

    created = client.post(
        "/api/invoices",
        json={"order_id": oid, "invoice_type": "normal", "amount": 240},
    )
    assert created.status_code == 201, created.text
    invoice_id = created.json()["id"]
    assert created.json()["has_attachment"] is False

    uploaded = client.post(
        f"/api/invoices/{invoice_id}/attachment",
        files={"file": ("电子发票.pdf", b"%PDF first", "application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["has_attachment"] is True
    assert uploaded.json()["attachment_filename"] == "电子发票.pdf"
    first_path = next((tmp_path / "uploads" / "invoices").iterdir())

    # 登录用户均可预览 / 下载，写操作仍仅管理员可用。
    client.set_user(OPERATOR)
    downloaded = client.get(f"/api/invoices/{invoice_id}/attachment")
    assert downloaded.status_code == 200
    assert downloaded.content == b"%PDF first"
    assert downloaded.headers["content-type"].startswith("application/pdf")
    assert client.delete(f"/api/invoices/{invoice_id}/attachment").status_code == 403

    client.set_user(ADMIN)
    replaced = client.post(
        f"/api/invoices/{invoice_id}/attachment",
        files={"file": ("新版发票.png", b"PNG second", "image/png")},
    )
    assert replaced.status_code == 200
    assert replaced.json()["attachment_filename"] == "新版发票.png"
    assert not first_path.exists()

    removed = client.delete(f"/api/invoices/{invoice_id}/attachment")
    assert removed.status_code == 200
    assert removed.json()["has_attachment"] is False
    assert client.get(f"/api/invoices/{invoice_id}/attachment").status_code == 404


def test_invoice_attachment_rejects_unsupported_file(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    db = client.session_factory()
    o = _order(db, invoice_required=True, total=100)
    db.commit()
    oid = o.id
    db.close()
    invoice_id = client.post("/api/invoices", json={"order_id": oid, "amount": 100}).json()["id"]

    response = client.post(
        f"/api/invoices/{invoice_id}/attachment",
        files={"file": ("发票.exe", b"bad", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "仅支持 PDF / JPG / PNG"


def test_delete_invoice_removes_attachment_file(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    db = client.session_factory()
    o = _order(db, invoice_required=True, total=100)
    db.commit()
    oid = o.id
    db.close()
    invoice_id = client.post("/api/invoices", json={"order_id": oid, "amount": 100}).json()["id"]
    client.post(
        f"/api/invoices/{invoice_id}/attachment",
        files={"file": ("待删除发票.pdf", b"%PDF cleanup", "application/pdf")},
    )
    stored_file = next((tmp_path / "uploads" / "invoices").iterdir())

    assert client.delete(f"/api/invoices/{invoice_id}").status_code == 204
    assert not stored_file.exists()


def test_needs_red_reversal_uses_amount_not_boolean(client):
    """红冲按金额口径：覆盖额 ≥ 退款额才算冲完；追加退款后应重新需冲红。"""
    db = client.session_factory()
    o = _order(db, invoice_required=True, refunded=100, code="R")
    db.commit()
    oid = o.id
    db.close()

    client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": "R-N", "amount": 100})
    client.post("/api/invoices", json={"order_id": oid, "invoice_type": "red_reversal", "invoice_no": "R-R", "amount": 100})
    by = {r["order_id"]: r for r in client.get("/api/invoices/orders").json()["rows"]}
    assert by[oid]["invoice_state"] == "issued"  # 冲红 100 覆盖退款 100

    db = client.session_factory()
    db.query(Order).filter(Order.id == oid).first().refunded_amount = Decimal("150")
    db.commit()
    db.close()
    by = {r["order_id"]: r for r in client.get("/api/invoices/orders").json()["rows"]}
    assert by[oid]["invoice_state"] == "needs_red_reversal"  # 追加退款 → 150 > 已冲红 100


def test_partial_red_reversal_still_needs_more(client):
    db = client.session_factory()
    o = _order(db, invoice_required=True, refunded=100, code="P")
    db.commit()
    oid = o.id
    db.close()
    client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": "P-N", "amount": 100})
    client.post("/api/invoices", json={"order_id": oid, "invoice_type": "red_reversal", "invoice_no": "P-R", "amount": 50})
    by = {r["order_id"]: r for r in client.get("/api/invoices/orders").json()["rows"]}
    assert by[oid]["invoice_state"] == "needs_red_reversal"  # 只冲了 50 < 退款 100


def test_voided_order_with_unreversed_invoice_stays_visible(client):
    """已作废但「已开正票 + 退款未冲红」的单仍须在工作台可见（合规待办）；作废的纯待开票单排除。"""
    db = client.session_factory()
    o = _order(db, invoice_required=True, refunded=50, code="V")
    vp = _order(db, invoice_required=True, code="VP")
    db.commit()
    oid, vp_id = o.id, vp.id
    db.close()
    client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": "V-N", "amount": 100})

    db = client.session_factory()
    for x in (oid, vp_id):
        db.query(Order).filter(Order.id == x).first().status = OrderStatus.void
    db.commit()
    db.close()

    data = client.get("/api/invoices/orders").json()
    by = {r["order_id"]: r for r in data["rows"]}
    assert oid in by
    assert by[oid]["invoice_state"] == "needs_red_reversal"
    assert by[oid]["order_voided"] is True
    assert vp_id not in by  # 作废的纯待开票单不展示
    assert data["needs_red_reversal_count"] >= 1


# --------------------------------------------------------------------------- #
# 渠道结算
# --------------------------------------------------------------------------- #
def _partner(client, name="中通", sales_mode_policy="not_applicable"):
    return client.post(
        "/api/partners",
        json={
            "name": name,
            "partner_type": "logistics",
            "sales_mode_policy": sales_mode_policy,
        },
    ).json()


def test_settlement_crud_and_partner_name(client):
    p = _partner(client)
    s = client.post(
        "/api/settlements",
        json={"partner_id": p["id"], "period": "2026-Q1", "amount_due": 1000, "status": "pending"},
    )
    assert s.status_code == 201, s.text
    body = s.json()
    assert body["partner_name"] == "中通"
    assert body["has_attachment"] is False

    rows = client.get("/api/settlements").json()
    assert len(rows) == 1

    upd = client.put(f"/api/settlements/{body['id']}", json={"status": "paid", "paid_amount": 1000, "on_time": True})
    assert upd.status_code == 200
    assert upd.json()["status"] == "paid"
    assert upd.json()["on_time"] is True

    # 筛选
    assert len(client.get("/api/settlements", params={"status": "paid"}).json()) == 1
    assert len(client.get("/api/settlements", params={"q": "2026-Q1"}).json()) == 1

    # partner 不存在
    assert client.post("/api/settlements", json={"partner_id": 999}).status_code == 400
    assert client.delete(f"/api/settlements/{body['id']}").status_code == 204


def test_structured_settlement_periods_returns_direction_and_calculations(client):
    p = _partner(client, "北京报刊零售", "required")
    client.put(
        f"/api/partners/{p['id']}",
        json={
            "invoice_title": "北京市报刊零售有限公司",
            "tax_no": "91110102101537026D",
            "taxpayer_type": "general",
            "default_invoice_type": "vat_normal",
            "default_invoice_content": "*印刷品*中国经营报",
            "default_invoice_unit": "份",
            "default_invoice_unit_price": 2.75,
        },
    )
    response = client.post(
        "/api/settlements",
        json={
            "partner_id": p["id"],
            "direction": "receivable",
            "settlement_type": "consignment",
            "settlement_no": "JS100025612600000855",
            "settlement_start_date": "2026-06-01",
            "settlement_end_date": "2026-06-29",
            "return_start_date": "2026-05-04",
            "return_end_date": "2026-06-29",
            "gross_amount": 14437.50,
            "return_deduction_amount": 13794,
            "invoice_quantity": 4,
            "invoice_unit_price": 2.75,
            "invoice_tax_rate": 0.09,
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["direction"] == "receivable"
    assert body["system_no"].startswith("JS-QD-")
    assert body["external_no"] == "JS100025612600000855"
    assert body["amount_due"] == "643.50"
    assert body["invoice_amount"] == "11.00"
    assert body["invoice_title"] == "北京市报刊零售有限公司"
    assert body["invoice_tax_no"] == "91110102101537026D"
    assert body["return_start_date"] == "2026-05-04"

    cleared_invoice_basis = client.put(
        f"/api/settlements/{body['id']}", json={"invoice_quantity": None}
    )
    assert cleared_invoice_basis.status_code == 200
    assert cleared_invoice_basis.json()["invoice_amount"] is None

    assert len(client.get("/api/settlements", params={"direction": "receivable"}).json()) == 1
    assert len(client.get("/api/settlements", params={"settlement_from": "2026-06-15"}).json()) == 1
    assert len(client.get("/api/settlements", params={"q": "JS10002561"}).json()) == 1

    duplicate = client.post(
        "/api/settlements",
        json={
            "partner_id": p["id"],
            "settlement_type": "buyout",
            "settlement_no": "JS100025612600000855",
            "settlement_start_date": "2026-07-06",
            "settlement_end_date": "2026-07-27",
        },
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["system_no"] != body["system_no"]


def test_settlement_excel_preview_extracts_beijing_retail_fields(client):
    preview = client.post(
        "/api/settlements/import/preview",
        files={
            "file": (
                "北京报零.xlsx",
                _beijing_settlement_xlsx(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["recognized"] is True
    assert body["supplier_name"] == "北京营报传媒文化发展有限责任公司"
    assert body["external_no"] == "JS100025612600000855"
    assert body["settlement_start_date"] == "2026-06-01"
    assert body["settlement_end_date"] == "2026-06-29"
    assert body["return_start_date"] == "2026-05-04"
    assert body["return_end_date"] == "2026-06-29"
    assert body["gross_amount"] == "14437.50"
    assert body["return_deduction_amount"] == "13794.00"
    assert body["amount_due"] == "643.50"
    assert body["invoice_quantity"] == "234.00"
    assert body["invoice_unit_price"] == "2.7500"
    assert body["detail_count"] == 15
    assert body["return_detail_count"] == 10
    assert body["warnings"] == []


def test_create_settlement_with_attachments_is_atomic_and_invoice_drives_status(
    client, monkeypatch, tmp_path
):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    partner = _partner(client, "北京报刊零售", "required")
    payload = {
        "partner_id": partner["id"],
        "party_type": "channel",
        "settlement_type": "consignment",
        "external_no": "JS100025612600000855",
        "direction": "receivable",
        "settlement_start_date": "2026-06-01",
        "settlement_end_date": "2026-06-29",
        "return_start_date": "2026-05-04",
        "return_end_date": "2026-06-29",
        "gross_amount": 14437.5,
        "return_deduction_amount": 13794,
    }
    response = client.post(
        "/api/settlements/with-attachments",
        data={
            "payload_json": json.dumps(payload),
            "categories_json": json.dumps(["settlement_sheet", "invoice"]),
        },
        files=[
            (
                "files",
                (
                    "北京报零.xlsx",
                    _beijing_settlement_xlsx(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ),
            ),
            ("files", ("发票.pdf", b"%PDF invoice", "application/pdf")),
        ],
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["system_no"].startswith("JS-QD-")
    assert body["invoice_received"] is True
    assert body["invoice_status"] == "issued"
    assert body["status"] == "invoiced"
    assert len(body["attachments"]) == 2
    assert all(item["sha256"] for item in body["attachments"])
    settlement_sheet = next(item for item in body["attachments"] if item["category"] == "settlement_sheet")
    assert settlement_sheet["is_primary"] is True
    assert settlement_sheet["recognized"] is True

    invoice = next(item for item in body["attachments"] if item["category"] == "invoice")
    deleted = client.delete(
        f"/api/settlements/{body['id']}/attachments/{invoice['id']}"
    )
    assert deleted.status_code == 200
    assert deleted.json()["invoice_received"] is False
    assert deleted.json()["invoice_status"] == "unissued"
    assert deleted.json()["status"] == "pending"


def test_individual_settlement_gets_distinct_system_number_prefix(client):
    partner = _partner(client, "个人结算对象")
    response = client.post(
        "/api/settlements",
        json={
            "partner_id": partner["id"],
            "party_type": "individual",
            "settlement_start_date": "2026-08-01",
            "settlement_end_date": "2026-08-01",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["system_no"].startswith("JS-GR-")
    changed = client.put(
        f"/api/settlements/{response.json()['id']}", json={"party_type": "channel"}
    )
    assert changed.status_code == 400
    assert "不可修改" in changed.json()["detail"]


def test_sales_mode_policy_controls_validation_and_storage(client):
    regular = _partner(client, "普通渠道")
    regular_settlement = client.post(
        "/api/settlements",
        json={
            "partner_id": regular["id"],
            "settlement_type": "buyout",
            "settlement_start_date": "2026-08-01",
            "settlement_end_date": "2026-08-31",
        },
    )
    assert regular_settlement.status_code == 201
    assert regular_settlement.json()["settlement_type"] is None

    required = _partner(client, "要求销售模式渠道", "required")
    missing = client.post(
        "/api/settlements",
        json={
            "partner_id": required["id"],
            "settlement_start_date": "2026-08-01",
            "settlement_end_date": "2026-08-31",
        },
    )
    assert missing.status_code == 400
    assert "必须选择代销或包销" in missing.json()["detail"]

    optional = _partner(client, "销售模式选填渠道", "optional")
    optional_settlement = client.post(
        "/api/settlements",
        json={
            "partner_id": optional["id"],
            "settlement_start_date": "2026-08-01",
            "settlement_end_date": "2026-08-31",
        },
    )
    assert optional_settlement.status_code == 201
    assert optional_settlement.json()["settlement_type"] is None


def test_primary_settlement_sheet_is_explicit_and_recognition_is_per_file(
    client, monkeypatch, tmp_path
):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    partner = _partner(client)
    response = client.post(
        "/api/settlements/with-attachments",
        data={
            "payload_json": json.dumps({
                "partner_id": partner["id"],
                "settlement_start_date": "2026-06-01",
                "settlement_end_date": "2026-06-29",
            }),
            "categories_json": json.dumps(["settlement_sheet", "settlement_sheet"]),
            "primary_attachment_index": "1",
        },
        files=[
            ("files", ("旧平台结算.pdf", b"%PDF old", "application/pdf")),
            ("files", ("北京报零.xlsx", _beijing_settlement_xlsx(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
        ],
    )
    assert response.status_code == 201, response.text
    first, second = response.json()["attachments"]
    assert first["is_primary"] is False
    assert first["recognized"] is None
    assert second["is_primary"] is True
    assert second["recognized"] is True

    reclassified = client.put(
        f"/api/settlements/{response.json()['id']}/attachments/{second['id']}",
        params={"category": "other"},
    )
    assert reclassified.status_code == 200
    updated = next(item for item in reclassified.json()["attachments"] if item["id"] == second["id"])
    assert updated["category"] == "other"
    assert updated["is_primary"] is False
    assert updated["recognized"] is None


def test_invoice_payment_actions_are_independent_and_audited(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    partner = _partner(client)
    settlement = client.post(
        "/api/settlements",
        json={
            "partner_id": partner["id"],
            "direction": "receivable",
            "settlement_start_date": "2026-08-01",
            "settlement_end_date": "2026-08-31",
            "gross_amount": 100,
        },
    ).json()
    missing_file = client.post(
        f"/api/settlements/{settlement['id']}/invoice",
        json={"invoice_no": "FP-001", "invoice_date": "2026-09-01", "invoice_amount": 100},
    )
    assert missing_file.status_code == 400
    assert "必须先上传发票文件" in missing_file.json()["detail"]

    uploaded = client.post(
        f"/api/settlements/{settlement['id']}/attachments",
        params={"category": "invoice"},
        files={"file": ("发票.pdf", b"%PDF invoice", "application/pdf")},
    )
    assert uploaded.status_code == 200
    invoiced = client.post(
        f"/api/settlements/{settlement['id']}/invoice",
        json={"invoice_no": "FP-001", "invoice_date": "2026-09-01", "invoice_amount": 100},
    )
    assert invoiced.status_code == 200, invoiced.text
    assert invoiced.json()["invoice_status"] == "issued"
    assert invoiced.json()["payment_status"] == "unpaid"
    assert invoiced.json()["invoice_date"] == "2026-09-01"

    partial = client.post(
        f"/api/settlements/{settlement['id']}/payment",
        json={"amount": 40, "paid_date": "2026-09-02", "on_time": True},
    )
    assert partial.status_code == 200
    assert partial.json()["payment_status"] == "partial"
    assert partial.json()["invoice_status"] == "issued"

    paid = client.post(
        f"/api/settlements/{settlement['id']}/payment",
        json={"amount": 60, "paid_date": "2026-09-03"},
    )
    assert paid.status_code == 200
    assert paid.json()["payment_status"] == "paid"
    assert paid.json()["status"] == "paid"

    history = client.get(f"/api/settlements/{settlement['id']}/history")
    assert history.status_code == 200
    actions = [item["action"] for item in history.json()]
    assert "create" in actions
    assert "invoice_register" in actions
    assert actions.count("payment_register") == 2


@pytest.mark.parametrize(
    "payload, detail",
    [
        ({"settlement_start_date": "2026-06-01"}, "同时填写开始和结束"),
        (
            {
                "settlement_start_date": "2026-06-29",
                "settlement_end_date": "2026-06-01",
            },
            "开始日期不能晚于结束日期",
        ),
        (
            {
                "settlement_start_date": "2026-06-01",
                "settlement_end_date": "2026-06-29",
                "gross_amount": 100,
                "return_deduction_amount": 10,
            },
            "必须选择退报周期",
        ),
    ],
)
def test_structured_settlement_validation(client, payload, detail):
    p = _partner(client)
    response = client.post("/api/settlements", json={"partner_id": p["id"], **payload})
    assert response.status_code == 400
    assert detail in response.json()["detail"]


def test_settlement_contract_must_belong_to_partner(client):
    owner = _partner(client, "合同渠道")
    other = _partner(client, "其他渠道")
    contract = client.post(
        "/api/contracts",
        json={"partner_id": owner["id"], "title": "合同X"},
    ).json()
    response = client.post(
        "/api/settlements",
        json={
            "partner_id": other["id"],
            "contract_id": contract["id"],
            "settlement_start_date": "2026-06-01",
            "settlement_end_date": "2026-06-29",
        },
    )
    assert response.status_code == 400
    assert "不属于当前合作渠道" in response.json()["detail"]


def test_settlement_writes_require_admin(client):
    p = _partner(client)
    client.set_user(OPERATOR)
    assert client.get("/api/settlements").status_code == 200
    assert client.post("/api/settlements", json={"partner_id": p["id"]}).status_code == 403


def test_settlement_attachment(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    p = _partner(client)
    s = client.post("/api/settlements", json={"partner_id": p["id"], "period": "2026-05"}).json()
    sid = s["id"]

    up = client.post(
        f"/api/settlements/{sid}/attachment",
        files={"file": ("结算单.pdf", b"%PDF demo", "application/pdf")},
    )
    assert up.status_code == 200, up.text
    assert up.json()["has_attachment"] is True

    dl = client.get(f"/api/settlements/{sid}/attachment")
    assert dl.status_code == 200
    assert dl.content == b"%PDF demo"

    rm = client.delete(f"/api/settlements/{sid}/attachment")
    assert rm.status_code == 200
    assert rm.json()["has_attachment"] is False
    assert client.get(f"/api/settlements/{sid}/attachment").status_code == 404


def test_settlement_multiple_typed_attachments_support_excel(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    p = _partner(client)
    settlement = client.post(
        "/api/settlements",
        json={
            "partner_id": p["id"],
            "settlement_start_date": "2026-06-01",
            "settlement_end_date": "2026-06-29",
        },
    ).json()
    sid = settlement["id"]

    first = client.post(
        f"/api/settlements/{sid}/attachments",
        params={"category": "settlement_sheet"},
        files={"file": ("结算单.xlsx", b"xlsx-demo", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert first.status_code == 200, first.text
    second = client.post(
        f"/api/settlements/{sid}/attachments",
        params={"category": "invoice_application"},
        files={"file": ("开票申请.pdf", b"%PDF application", "application/pdf")},
    )
    assert second.status_code == 200, second.text
    attachments = second.json()["attachments"]
    assert [item["category"] for item in attachments] == [
        "settlement_sheet",
        "invoice_application",
    ]

    excel_attachment = attachments[0]
    downloaded = client.get(
        f"/api/settlements/{sid}/attachments/{excel_attachment['id']}"
    )
    assert downloaded.status_code == 200
    assert downloaded.content == b"xlsx-demo"

    deleted = client.delete(
        f"/api/settlements/{sid}/attachments/{excel_attachment['id']}"
    )
    assert deleted.status_code == 200
    assert len(deleted.json()["attachments"]) == 1


def test_delete_partner_blocked_by_settlement(client):
    """渠道被结算记录引用时拒删（新外键纳入删除守卫，避免 MySQL 外键 500 / SQLite 孤儿）。"""
    p = _partner(client)
    client.post("/api/settlements", json={"partner_id": p["id"], "period": "2026-Q1"})
    assert client.delete(f"/api/partners/{p['id']}").status_code == 409


def test_delete_contract_blocked_by_settlement(client):
    """合同被结算记录(contract_id)引用时拒删。"""
    p = _partner(client)
    c = client.post("/api/contracts", json={"partner_id": p["id"], "title": "合同X"}).json()
    client.post("/api/settlements", json={"partner_id": p["id"], "contract_id": c["id"], "period": "2026-Q1"})
    assert client.delete(f"/api/contracts/{c['id']}").status_code == 409
