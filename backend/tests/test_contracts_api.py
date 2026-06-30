"""Tests for 合同管理（合作渠道 + 渠道合同 + 附件）—— partners / contracts API.

Same strategy as ``test_campaign_analytics.py``: FastAPI over in-memory SQLite,
auth bypassed via dependency override. A single TestClient whose acting user is
switchable (``client.set_user``) so ``require_admin`` (403) can be exercised.
"""

import os
import sys
from datetime import date, timedelta
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


def _make_partner(client, name="中通", partner_type="logistics"):
    resp = client.post(
        "/api/partners", json={"name": name, "partner_type": partner_type}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_contract(client, partner_id, **kw):
    body = {"partner_id": partner_id, "title": "2026 年度合作合同"}
    body.update(kw)
    resp = client.post("/api/contracts", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# --------------------------------------------------------------------------- #
def test_partner_crud(client):
    p = _make_partner(client, "北京市报刊发行局", "distribution")
    assert p["name"] == "北京市报刊发行局"
    assert p["partner_type"] == "distribution"
    assert p["active"] is True

    # duplicate name → 409
    dup = client.post(
        "/api/partners", json={"name": "北京市报刊发行局", "partner_type": "other"}
    )
    assert dup.status_code == 409

    # update
    upd = client.put(f"/api/partners/{p['id']}", json={"contact_person": "张经理"})
    assert upd.status_code == 200
    assert upd.json()["contact_person"] == "张经理"

    rows = client.get("/api/partners").json()
    assert len(rows) == 1


def test_contract_crud_partner_name_and_expiring(client):
    p = _make_partner(client)
    soon = (date.today() + timedelta(days=10)).isoformat()
    c = _make_contract(
        client, p["id"], contract_no="ZT-2026-001", sign_year=2026, end_date=soon
    )
    assert c["partner_name"] == "中通"
    assert c["partner_type"] == "logistics"
    assert c["has_attachment"] is False
    assert c["is_expiring"] is True  # 生效 + 10 天内到期

    rows = client.get("/api/contracts").json()
    assert len(rows) == 1
    assert rows[0]["partner_name"] == "中通"

    # archived → 不再算快到期
    upd = client.put(f"/api/contracts/{c['id']}", json={"status": "archived"})
    assert upd.status_code == 200
    assert upd.json()["is_expiring"] is False

    # 远期到期 → 不算快到期
    far = (date.today() + timedelta(days=200)).isoformat()
    c2 = _make_contract(client, p["id"], end_date=far)
    assert c2["is_expiring"] is False

    # 按渠道 / 年度 / 状态筛选
    assert len(client.get("/api/contracts", params={"sign_year": 2026}).json()) == 1
    assert len(client.get("/api/contracts", params={"status": "archived"}).json()) == 1
    assert len(client.get("/api/contracts", params={"q": "ZT-2026"}).json()) == 1


def test_create_contract_requires_existing_partner(client):
    resp = client.post(
        "/api/contracts", json={"partner_id": 999, "title": "x"}
    )
    assert resp.status_code == 400


def test_writes_require_admin(client):
    p = _make_partner(client)  # as admin
    client.set_user(OPERATOR)
    # 读放行
    assert client.get("/api/partners").status_code == 200
    assert client.get("/api/contracts").status_code == 200
    # 写被拒
    assert client.post("/api/partners", json={"name": "x"}).status_code == 403
    assert client.put(f"/api/partners/{p['id']}", json={"notes": "y"}).status_code == 403
    assert client.delete(f"/api/partners/{p['id']}").status_code == 403
    assert (
        client.post("/api/contracts", json={"partner_id": p["id"], "title": "t"}).status_code
        == 403
    )


def test_delete_partner_blocked_when_has_contract(client):
    p = _make_partner(client)
    c = _make_contract(client, p["id"])
    blocked = client.delete(f"/api/partners/{p['id']}")
    assert blocked.status_code == 409

    assert client.delete(f"/api/contracts/{c['id']}").status_code == 204
    assert client.delete(f"/api/partners/{p['id']}").status_code == 204


def test_attachment_upload_download_delete(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    p = _make_partner(client)
    c = _make_contract(client, p["id"])
    cid = c["id"]

    # 非法扩展名
    bad = client.post(
        f"/api/contracts/{cid}/attachment",
        files={"file": ("x.exe", b"data", "application/octet-stream")},
    )
    assert bad.status_code == 400

    # 上传 PDF
    up = client.post(
        f"/api/contracts/{cid}/attachment",
        files={"file": ("合同扫描件.pdf", b"%PDF-1.4 demo", "application/pdf")},
    )
    assert up.status_code == 200, up.text
    body = up.json()
    assert body["has_attachment"] is True
    assert body["attachment_filename"] == "合同扫描件.pdf"

    # 下载内容一致
    dl = client.get(f"/api/contracts/{cid}/attachment")
    assert dl.status_code == 200
    assert dl.content == b"%PDF-1.4 demo"

    # 删除附件
    rm = client.delete(f"/api/contracts/{cid}/attachment")
    assert rm.status_code == 200
    assert rm.json()["has_attachment"] is False
    assert client.get(f"/api/contracts/{cid}/attachment").status_code == 404


def test_orphan_partner_degrades_gracefully(client):
    """外键悬空（partner 不存在）时列表 / 详情应优雅降级，而非 500。

    SQLite 默认不强制外键，可直接插入孤儿合同复现（生产 MySQL 有 FK，但原始 SQL /
    历史导入仍可能产生悬空 FK）。回归 review 发现的「partner_type=None 触发 ValidationError」。
    """
    from app.models.contract import Contract

    db = client.session_factory()
    db.add(Contract(partner_id=999, title="孤儿合同"))
    db.commit()
    db.close()

    resp = client.get("/api/contracts")
    assert resp.status_code == 200
    row = next(r for r in resp.json() if r["title"] == "孤儿合同")
    assert row["partner_name"] == ""
    assert row["partner_type"] is None


def test_attachment_upload_requires_admin(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_service, "UPLOAD_ROOT", tmp_path / "uploads")
    p = _make_partner(client)
    c = _make_contract(client, p["id"])
    client.set_user(OPERATOR)
    resp = client.post(
        f"/api/contracts/{c['id']}/attachment",
        files={"file": ("a.pdf", b"x", "application/pdf")},
    )
    assert resp.status_code == 403
