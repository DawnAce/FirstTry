"""邮局台账手工 CRUD + 投诉三态处理流程 · HTTP 测试。

In-memory SQLite + TestClient，覆盖 get_db / get_current_user / require_admin，
与 test_postal_api 同风格（模型 create_all，不跑迁移；三态枚举随 model 自动可用）。
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user, require_admin
from app.database import Base, get_db
from app.main import app
from app.models import Partner, PartnerType


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    seed = TestingSessionLocal()
    seed.add(Partner(name="北京集订分送", partner_type=PartnerType.distribution))
    seed.commit()
    seed.close()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    fake = SimpleNamespace(id=1, role="admin", username="admin")
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: fake
    app.dependency_overrides[require_admin] = lambda: fake

    c = TestClient(app)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()


def _unit_id(client) -> int:
    partners = client.get("/api/partners").json()
    return next(p["id"] for p in partners if p["name"] == "北京集订分送")


def test_delivery_summary(client):
    """概览行聚合：合计份数 / 投递单位数 / 未填单位条数（同筛选口径）。"""
    unit = _unit_id(client)
    client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "0801", "recipient_name": "甲",
        "recipient_address": "地址A", "distribution_unit_id": unit, "copies": 2,
    })
    client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "0802", "recipient_name": "乙",
        "recipient_address": "地址B", "copies": 3,  # 未填投递单位
    })
    body = client.get("/api/postal/deliveries?year=2026").json()
    assert body["total"] == 2
    s = body["summary"]
    assert s["total_copies"] == 5
    assert s["unit_count"] == 1
    assert s["missing_unit_count"] == 1


# --- 投递名册 --------------------------------------------------------

def test_delivery_crud(client):
    unit = _unit_id(client)
    r = client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "0700", "recipient_name": "张三",
        "recipient_address": "北京市朝阳区某路1号", "distribution_unit_id": unit,
    })
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["delivery_no"] == "700"                       # 编号去零
    assert d["distribution_unit_name"] == "北京集订分送"    # 计算列回填
    did = d["id"]

    # 重复 (year, no) → 409
    dup = client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "700", "recipient_name": "李四", "recipient_address": "x",
    })
    assert dup.status_code == 409

    # 更新
    u = client.put(f"/api/postal/deliveries/{did}", json={"recipient_name": "张三改"})
    assert u.status_code == 200, u.text
    assert u.json()["recipient_name"] == "张三改"

    assert client.get("/api/postal/deliveries?year=2026").json()["total"] == 1

    # 删除
    assert client.delete(f"/api/postal/deliveries/{did}").status_code == 204
    assert client.get("/api/postal/deliveries?year=2026").json()["total"] == 0


def test_delivery_delete(client):
    r = client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "701", "recipient_name": "王五",
        "recipient_address": "北京市海淀区",
        "coverage_start_date": "2026-03-05", "coverage_end_date": "2026-09-05",
    })
    did = r.json()["id"]
    # 月度批次层已移除，投递记录可直接删除
    assert client.delete(f"/api/postal/deliveries/{did}").status_code == 204
    assert client.delete(f"/api/postal/deliveries/{did}").status_code == 404


# --- 投诉工单 + 三态处理流程 ----------------------------------------

def test_complaint_crud_and_linking(client):
    # 先建投递记录供关联 + 快照回填
    client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "800", "recipient_name": "赵六",
        "recipient_address": "上海市浦东新区", "recipient_phone": "13900000000",
    })
    r = client.post("/api/postal/complaints", json={
        "year": 2026, "delivery_no": "800", "complaint_date": "2026-03-10",
        "missing_issues": "3月刊未收到", "handling": "转北京11185",
    })
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["postal_delivery_id"] is not None      # 关联投递记录
    assert c["snap_name"] == "赵六"                  # 快照回填
    assert c["routed_label"] == "北京11185"          # 处理情况归一
    assert c["status"] == "open"
    cid = c["id"]

    u = client.put(f"/api/postal/complaints/{cid}", json={"missing_issues": "3、4月都未收到"})
    assert u.status_code == 200
    assert u.json()["missing_issues"] == "3、4月都未收到"

    assert client.delete(f"/api/postal/complaints/{cid}").status_code == 204
    assert client.get(f"/api/postal/complaints/{cid}").status_code == 404


def test_complaint_handling_workflow(client):
    r = client.post("/api/postal/complaints", json={
        "complaint_date": "2026-03-01", "missing_issues": "缺刊", "snap_name": "钱七",
    })
    cid = r.json()["id"]
    assert r.json()["status"] == "open"

    # 一次处理（未指定结果状态 → 处理中）
    h1 = client.post(f"/api/postal/complaints/{cid}/handlings", json={"action": "已联系投递站核实"})
    assert h1.status_code == 201, h1.text
    d1 = h1.json()
    assert d1["complaint"]["status"] == "in_progress"
    assert d1["complaint"]["handling_count"] == 1
    assert len(d1["handlings"]) == 1
    assert d1["handlings"][0]["handled_by"] == 1

    # 二次处理并置为已解决
    h2 = client.post(f"/api/postal/complaints/{cid}/handlings", json={
        "action": "补寄完成", "follow_result": "读者确认收到", "result_status": "resolved",
    })
    d2 = h2.json()
    assert d2["complaint"]["status"] == "resolved"
    assert d2["complaint"]["handling_count"] == 2
    assert len(d2["handlings"]) == 2
    assert d2["handlings"][0]["action"] == "补寄完成"   # 时间线倒序，最新在前

    # 删最新一条处理 → 次数回退、状态回退到剩余最新（处理中）
    hid_latest = d2["handlings"][0]["id"]
    d3 = client.delete(f"/api/postal/complaints/{cid}/handlings/{hid_latest}").json()
    assert d3["complaint"]["handling_count"] == 1
    assert d3["complaint"]["status"] == "in_progress"
    assert len(d3["handlings"]) == 1

    # 删投诉级联删处理记录
    assert client.delete(f"/api/postal/complaints/{cid}").status_code == 204
    assert client.get(f"/api/postal/complaints/{cid}").status_code == 404


# --- 改地址 / 回访 / 收款 -------------------------------------------

def test_address_change_crud(client):
    client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "900", "recipient_name": "孙八", "recipient_address": "广州市天河区",
    })
    r = client.post("/api/postal/address-changes", json={
        "year": 2026, "delivery_no": "900", "change_date": "2026-03-15",
        "new_name": "孙八", "new_address": "广州市越秀区新地址", "handling": "转广东局微信",
    })
    assert r.status_code == 201, r.text
    ac = r.json()
    assert ac["postal_delivery_id"] is not None
    assert ac["routed_label"] == "广东局"
    assert ac["applied_to_order"] is False
    aid = ac["id"]

    u = client.put(f"/api/postal/address-changes/{aid}", json={"new_phone": "13700000000"})
    assert u.status_code == 200
    assert u.json()["new_phone"] == "13700000000"
    assert client.delete(f"/api/postal/address-changes/{aid}").status_code == 204


def test_follow_up_crud(client):
    r = client.post("/api/postal/follow-ups", json={
        "year": 2026, "delivery_no": "123", "follow_up_date": "2026-03-20",
        "result": "已回访", "snap_name": "周九",
    })
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    u = client.put(f"/api/postal/follow-ups/{fid}", json={"result": "拒接"})
    assert u.status_code == 200
    assert u.json()["result"] == "拒接"
    assert client.delete(f"/api/postal/follow-ups/{fid}").status_code == 204


def test_unified_tickets_list(client):
    # 三类各建一条
    client.post("/api/postal/complaints", json={
        "year": 2026, "delivery_no": "301", "complaint_date": "2026-05-10",
        "missing_issues": "缺 5 月", "snap_name": "投诉甲",
    })
    client.post("/api/postal/address-changes", json={
        "year": 2026, "delivery_no": "302", "change_date": "2026-05-11",
        "new_name": "改址乙", "new_address": "北京市海淀区新址",
    })
    client.post("/api/postal/follow-ups", json={
        "year": 2026, "delivery_no": "303", "follow_up_date": "2026-05-12",
        "result": "已回访", "snap_name": "回访丙",
    })

    # 全部：三类混排 + 计数
    r = client.get("/api/postal/tickets?year=2026")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 3
    assert body["summary"] == {"complaint": 1, "address": 1, "follow": 1}
    types = {row["type"] for row in body["rows"]}
    assert types == {"complaint", "address", "follow"}
    # 按日期倒序：回访(05-12) 在最前
    assert body["rows"][0]["type"] == "follow"
    assert body["rows"][0]["ticket_date"] == "2026-05-12"

    # 按类型筛选
    assert client.get("/api/postal/tickets?type=complaint&year=2026").json()["total"] == 1
    assert client.get("/api/postal/tickets?type=address&year=2026").json()["rows"][0]["recipient_name"] == "改址乙"
    # 未知类型 400
    assert client.get("/api/postal/tickets?type=xxx").status_code == 400


def test_finance_crud_net(client):
    r = client.post("/api/finance/postal-receipts", json={
        "payer_name": "吴十", "product": "《中国经营报》", "copies": 1,
        "amount": "240.00", "fee_amount": "1.30", "collected_at": "2026-03-01",
        "buyer_title": "某公司", "tax_no": "91ABC", "tax_category": "普票", "platform": "CBJ+小程序",
    })
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["link_by"] == "none"                 # 无订单可挂
    assert float(f["net_amount"]) == 238.70       # net = 金额 - 手续费
    fid = f["id"]

    u = client.put(f"/api/finance/postal-receipts/{fid}", json={"fee_amount": "2.00"})
    assert u.status_code == 200
    assert float(u.json()["net_amount"]) == 238.00  # 手续费改动 → 重算
    assert client.delete(f"/api/finance/postal-receipts/{fid}").status_code == 204


# --- 回归：对抗式审查确认的缺陷修复 --------------------------------

def test_update_delivery_null_on_required_col_is_noop_not_500(client):
    """显式把非空列传 null 应视为「不修改」，不得触发 NOT NULL 500。"""
    r = client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "710", "recipient_name": "钱一", "recipient_address": "北京市X",
    })
    did = r.json()["id"]
    u = client.put(f"/api/postal/deliveries/{did}", json={"recipient_name": None, "copies": None})
    assert u.status_code == 200, u.text
    assert u.json()["recipient_name"] == "钱一"  # 未被清空
    assert u.json()["copies"] == 1


def test_create_delivery_non_numeric_no_rejected(client):
    """非数字编号无法被工单按编号关联 → create 直接 400，避免脏数据。"""
    r = client.post("/api/postal/deliveries", json={
        "year": 2026, "delivery_no": "甲区", "recipient_name": "钱一", "recipient_address": "X",
    })
    assert r.status_code == 400


def test_update_complaint_null_status_is_noop(client):
    """显式 status=null 应视为「不修改」，不得触发 NOT NULL 500。"""
    r = client.post("/api/postal/complaints", json={
        "missing_issues": "缺刊", "snap_name": "赵一", "status": "resolved",
    })
    cid = r.json()["id"]
    u = client.put(f"/api/postal/complaints/{cid}", json={"status": None, "missing_issues": "缺 3、4 月"})
    assert u.status_code == 200, u.text
    assert u.json()["status"] == "resolved"           # 状态未被改成 null
    assert u.json()["missing_issues"] == "缺 3、4 月"  # 其它字段照常更新


def test_delete_handling_preserves_imported_baseline_status():
    """撤销处理不得把「导入基线（已解决/次数>0、无子表行）」的投诉误置为待处理。"""
    from app.models import PostalComplaint, PostalComplaintStatus
    from app.services import postal_complaint_service as svc

    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        # 模拟导入的投诉：已解决 + 处理次数基线 3，但没有任何处理记录子行。
        c = PostalComplaint(snap_name="导入用户", status=PostalComplaintStatus.resolved, handling_count=3)
        db.add(c)
        db.commit()
        db.refresh(c)

        svc.add_handling(db, c.id, action="误操作补登", operator_id=1)
        db.refresh(c)
        assert c.handling_count == 4 and c.status == PostalComplaintStatus.in_progress

        h = svc.get_complaint_detail(db, c.id)[1][0]
        svc.delete_handling(db, c.id, h.id)
        db.refresh(c)
        assert c.status != PostalComplaintStatus.open   # 修复点：不误置 open
        assert c.handling_count == 3                     # 回到导入基线
    finally:
        db.close()
