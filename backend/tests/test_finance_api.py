"""Tests for 财务管理（订单发票工作台 + 渠道结算 + 附件）—— invoices / settlements API.

Same strategy as test_contracts_api.py: FastAPI over in-memory SQLite, auth via
dependency override, a single TestClient whose acting user is switchable.
"""

import os
import sys
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


def _order(db, *, invoice_required=False, refunded=0, total=100, code=None):
    o = Order(
        order_date=date(2026, 6, 1),
        entry_method=OrderEntryMethod.excel_import,
        payer_name="测试客户",  # 无拉丁字母，避免与 q 搜索 order_code 串味
        status=OrderStatus.active,
        total_amount=Decimal(str(total)),
        paid_amount=Decimal(str(total)),
        refunded_amount=Decimal(str(refunded)),
        invoice_required=invoice_required,
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
    a = _order(db, invoice_required=True, code="A")              # pending
    b = _order(db, invoice_required=True, code="B")              # 开正票 → issued
    c = _order(db, invoice_required=True, refunded=50, code="C")  # 正票 + 退款 → 需冲红
    d = _order(db, invoice_required=True, refunded=50, code="D")  # 正票 + 红冲 → issued
    e = _order(db, invoice_required=False, code="E")             # 不相关 → 不入工作台
    db.commit()
    a_id, b_id, c_id, d_id, e_id = a.id, b.id, c.id, d.id, e.id
    db.close()

    for oid, no in [(b_id, "B-001"), (c_id, "C-001"), (d_id, "D-001")]:
        r = client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": no})
        assert r.status_code == 201, r.text
    assert client.post("/api/invoices", json={"order_id": d_id, "invoice_type": "red_reversal", "invoice_no": "D-002"}).status_code == 201

    data = client.get("/api/invoices/orders").json()
    by = {r["order_id"]: r for r in data["rows"]}
    assert set(by) == {a_id, b_id, c_id, d_id}          # E 被排除
    assert by[a_id]["invoice_state"] == "pending"
    assert by[b_id]["invoice_state"] == "issued"
    assert by[c_id]["invoice_state"] == "needs_red_reversal"
    assert by[c_id]["needs_red_reversal"] is True
    assert by[d_id]["invoice_state"] == "issued"
    assert len(by[d_id]["invoices"]) == 2
    assert data["pending_count"] == 1
    assert data["needs_red_reversal_count"] == 1

    # 状态筛选
    nr = client.get("/api/invoices/orders", params={"status": "needs_red_reversal"}).json()
    assert {r["order_id"] for r in nr["rows"]} == {c_id}
    # 搜索（order_code 唯一）
    qa = client.get("/api/invoices/orders", params={"q": "A"}).json()
    assert {r["order_id"] for r in qa["rows"]} == {a_id}


def test_create_invoice_requires_existing_order(client):
    assert client.post("/api/invoices", json={"order_id": 999}).status_code == 400


def test_invoice_delete_flips_state_back_to_pending(client):
    db = client.session_factory()
    o = _order(db, invoice_required=True, code="X")
    db.commit()
    oid = o.id
    db.close()

    inv = client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": "X-1"}).json()
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
    assert client.post("/api/invoices", json={"order_id": oid}).status_code == 403


def test_needs_red_reversal_uses_amount_not_boolean(client):
    """红冲按金额口径：覆盖额 ≥ 退款额才算冲完；追加退款后应重新需冲红。"""
    db = client.session_factory()
    o = _order(db, invoice_required=True, refunded=100, code="R")
    db.commit()
    oid = o.id
    db.close()

    client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": "R-N"})
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
    client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": "P-N"})
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
    client.post("/api/invoices", json={"order_id": oid, "invoice_type": "normal", "invoice_no": "V-N"})

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
def _partner(client, name="中通"):
    return client.post("/api/partners", json={"name": name, "partner_type": "logistics"}).json()


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
