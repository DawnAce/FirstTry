# History Template Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable “导入往期” workflow that lets users download two system templates, upload both files on a dedicated page, preview validation results, and create a full draft issue in one transaction.

**Architecture:** Add a dedicated backend history-import router plus focused services for template generation, preview parsing, and commit-time persistence. On the frontend, add a dedicated `HistoryImport` page, route it from the dashboard, and keep editing on existing report and shipping pages after import succeeds.

**Tech Stack:** FastAPI, SQLAlchemy, openpyxl, React 19, TypeScript, Ant Design, TanStack Query

---

## File Structure

- **Create:** `backend\app\schemas\history_import.py` — Preview/commit/template response models and normalized row payloads.
- **Create:** `backend\app\history_import_cache.py` — Short-lived in-memory preview session store for parsed results.
- **Create:** `backend\app\services\history_import_template_service.py` — Generate report/shipping Excel templates.
- **Create:** `backend\app\services\history_import_service.py` — Parse uploaded workbooks, validate them, create preview sessions, and commit data transactionally.
- **Create:** `backend\app\api\history_import.py` — Template download, preview, and commit endpoints.
- **Create:** `backend\tests\test_history_import.py` — Backend unit tests for template generation, preview validation, and commit behavior.
- **Create:** `frontend\src\api\historyImport.ts` — Frontend API client and TypeScript types for the new workflow.
- **Create:** `frontend\src\pages\HistoryImport.tsx` — Dedicated import page with upload, preview, confirm, and progress UI.
- **Modify:** `backend\app\main.py` — Register the new router.
- **Modify:** `frontend\src\App.tsx` — Add the new protected route.
- **Modify:** `frontend\src\components\AppLayout.tsx` — Keep `/history-import` highlighted under "印数管理".
- **Modify:** `frontend\src\pages\Dashboard.tsx` — Add the “导入往期” entry button.
- **Modify:** `README.md` — Document the template-based history import capability.
- **Modify:** `docs\requirements.md` — Add the new workflow and its limits.
- **Modify:** `docs\technical.md` — Document the new router/services/template format.
- **Modify:** `docs\user-guide.md` — Document user-facing import steps.

### Task 1: Add backend template contracts and download services

**Files:**
- Create: `backend\app\schemas\history_import.py`
- Create: `backend\app\services\history_import_template_service.py`
- Create: `backend\tests\test_history_import.py`

- [ ] **Step 1: Write the failing template-generation tests**

```python
# backend/tests/test_history_import.py
import unittest
from io import BytesIO

from openpyxl import load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import ReportItemTemplate
from app.services.history_import_template_service import (
    build_report_import_template,
    build_shipping_import_template,
)


class HistoryImportTemplateTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)

    def test_report_template_contains_meta_entries_and_temp_detail_sheets(self):
        db = self.SessionLocal()
        db.add_all(
            [
                ReportItemTemplate(
                    category="postal",
                    sub_category="北京邮发（外埠）",
                    display_name="北京邮发（外埠）",
                    destination="北京市报刊发行局",
                    default_value=0,
                    is_variable=True,
                    sort_order=1,
                ),
                ReportItemTemplate(
                    category="social_use",
                    sub_category="临时加印_自留",
                    display_name="临时加印（自留分发）",
                    destination="中通物流公司",
                    default_value=0,
                    is_variable=True,
                    sort_order=2,
                ),
            ]
        )
        db.commit()

        file_bytes = build_report_import_template(db)
        workbook = load_workbook(BytesIO(file_bytes))

        self.assertEqual(workbook.sheetnames, ["基本信息", "报数项", "临时加印明细"])
        self.assertEqual(workbook["基本信息"]["A1"].value, "字段")
        self.assertEqual(workbook["报数项"]["A1"].value, "分类编码")
        self.assertEqual(workbook["临时加印明细"]["A1"].value, "部门")
        self.assertEqual(workbook["报数项"]["A2"].value, "postal")
        self.assertEqual(workbook["报数项"]["B2"].value, "北京邮发")
        self.assertEqual(workbook["报数项"]["C2"].value, "北京邮发（外埠）")

    def test_shipping_template_contains_meta_and_detail_sheets(self):
        file_bytes = build_shipping_import_template()
        workbook = load_workbook(BytesIO(file_bytes))

        self.assertEqual(workbook.sheetnames, ["基本信息", "发货明细"])
        self.assertEqual(workbook["基本信息"]["A1"].value, "字段")
        self.assertEqual(workbook["发货明细"]["A1"].value, "工作表名称")
        self.assertEqual(workbook["发货明细"]["J1"].value, "数量")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m unittest tests.test_history_import.HistoryImportTemplateTests -v
```

Expected: `ModuleNotFoundError` for `app.services.history_import_template_service`.

- [ ] **Step 3: Add the schema file and template service**

```python
# backend/app/schemas/history_import.py
from datetime import date
from pydantic import BaseModel


class HistoryImportRow(BaseModel):
    category: str
    sub_category: str
    display_name: str
    destination: str | None = None
    is_variable: bool
    value: int


class TempPrintDetailRow(BaseModel):
    department: str
    custom_name: str | None = None
    quantity: int
    self_quantity: int
```

```python
# backend/app/services/history_import_template_service.py
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy.orm import Session

from app.models import ReportItemTemplate


CATEGORY_LABELS = {
    "postal": "北京邮发",
    "retail": "北京报零",
    "subscription": "订阅",
    "social_use": "社用报",
    "temp": "临时加印",
    "binding": "合订本",
}


def build_report_import_template(db: Session) -> bytes:
    wb = Workbook()
    meta = wb.active
    meta.title = "基本信息"
    meta.append(["字段", "值"])
    meta.append(["期号", ""])
    meta.append(["出版日期", "2026-01-05"])
    meta.append(["版数", 24])
    meta.append(["备注", ""])

    rows = wb.create_sheet("报数项")
    rows.append(["分类编码", "分类名称", "项目名称", "去向", "是否变动", "数值"])
    for item in db.query(ReportItemTemplate).order_by(ReportItemTemplate.sort_order).all():
        rows.append(
            [
                item.category,
                CATEGORY_LABELS.get(item.category, item.category),
                item.sub_category,
                item.destination or "",
                "是" if item.is_variable else "否",
                item.default_value,
            ]
        )

    temp = wb.create_sheet("临时加印明细")
    temp.append(["部门", "自定义名称", "加印数量", "自留数量"])

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def build_shipping_import_template() -> bytes:
    wb = Workbook()
    meta = wb.active
    meta.title = "基本信息"
    meta.append(["字段", "值"])
    meta.append(["期号", ""])
    meta.append(["出版日期", ""])

    detail = wb.create_sheet("发货明细")
    detail.append(
        [
            "工作表名称", "渠道", "子渠道", "运输方式", "频次", "状态", "姓名", "地址", "电话", "数量",
            "截止日期", "备注", "附加信息", "城市", "网点名称", "网点大厅", "联系人", "序号", "期数", "公司",
        ]
    )

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m unittest tests.test_history_import.HistoryImportTemplateTests -v
```

Expected: both template tests pass.

- [ ] **Step 5: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add backend\app\schemas\history_import.py backend\app\services\history_import_template_service.py backend\tests\test_history_import.py
git commit -m "feat: add history import templates`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add preview parsing, validation, and preview-session storage

**Files:**
- Create: `backend\app\history_import_cache.py`
- Create: `backend\app\services\history_import_service.py`
- Modify: `backend\app\schemas\history_import.py`
- Modify: `backend\tests\test_history_import.py`

- [ ] **Step 1: Write the failing preview tests**

```python
from datetime import date
from io import BytesIO

from openpyxl import Workbook

from app.models import Issue, ReportItemTemplate
from app.services.history_import_service import preview_history_import


def build_report_upload(issue_number: int = 2648) -> bytes:
    wb = Workbook()
    meta = wb.active
    meta.title = "基本信息"
    meta.append(["字段", "值"])
    meta.append(["期号", issue_number])
    meta.append(["出版日期", date(2026, 4, 20)])
    meta.append(["版数", 28])
    meta.append(["备注", "历史补录"])

    rows = wb.create_sheet("报数项")
    rows.append(["分类编码", "分类名称", "项目名称", "去向", "是否变动", "数值"])
    rows.append(["postal", "北京邮发", "北京邮发（外埠）", "北京市报刊发行局", "是", 5575])
    rows.append(["social_use", "社用报", "临时加印_自留", "中通物流公司", "是", 200])

    temp = wb.create_sheet("临时加印明细")
    temp.append(["部门", "自定义名称", "加印数量", "自留数量"])
    temp.append(["财经中心", "", 200, 200])

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_shipping_upload(issue_number: int = 2648) -> bytes:
    wb = Workbook()
    meta = wb.active
    meta.title = "基本信息"
    meta.append(["字段", "值"])
    meta.append(["期号", issue_number])
    meta.append(["出版日期", date(2026, 4, 20)])

    rows = wb.create_sheet("发货明细")
    rows.append(
        ["工作表名称", "渠道", "子渠道", "运输方式", "频次", "状态", "姓名", "地址", "电话", "数量",
         "截止日期", "备注", "附加信息", "城市", "网点名称", "网点大厅", "联系人", "序号", "期数", "公司"]
    )
    rows.append(["渠道订阅", "渠道订阅", "", "中通物流", "每周", "正常", "张三", "北京", "13800138000", 2, "", "", "", "北京", "", "", "", 1, 12, ""])

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


class HistoryImportPreviewTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)

    def test_preview_returns_counts_and_session_id(self):
        db = self.SessionLocal()
        db.add(
            ReportItemTemplate(
                category="postal",
                sub_category="北京邮发（外埠）",
                display_name="北京邮发（外埠）",
                destination="北京市报刊发行局",
                default_value=0,
                is_variable=True,
                sort_order=1,
            )
        )
        db.add(
            ReportItemTemplate(
                category="social_use",
                sub_category="临时加印_自留",
                display_name="临时加印（自留分发）",
                destination="中通物流公司",
                default_value=0,
                is_variable=True,
                sort_order=2,
            )
        )
        db.commit()

        preview = preview_history_import(db, build_report_upload(), build_shipping_upload())

        self.assertEqual(preview.issue_number, 2648)
        self.assertEqual(preview.publish_date.isoformat(), "2026-04-20")
        self.assertEqual(preview.report_entry_count, 2)
        self.assertEqual(preview.temp_detail_count, 1)
        self.assertEqual(preview.shipping_detail_count, 1)
        self.assertTrue(preview.can_commit)
        self.assertTrue(preview.import_session_id)

    def test_preview_blocks_duplicate_issue_and_cross_issue_upload(self):
        db = self.SessionLocal()
        db.add(Issue(issue_number=2648, publish_date=date(2026, 4, 20)))
        db.commit()

        duplicate = preview_history_import(db, build_report_upload(), build_shipping_upload())
        mismatch = preview_history_import(db, build_report_upload(2648), build_shipping_upload(2649))

        self.assertFalse(duplicate.can_commit)
        self.assertIn("该期已存在", duplicate.errors)
        self.assertFalse(mismatch.can_commit)
        self.assertIn("两份文件不是同一期", mismatch.errors)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m unittest tests.test_history_import.HistoryImportPreviewTests -v
```

Expected: `ModuleNotFoundError` for `app.services.history_import_service`.

- [ ] **Step 3: Implement preview-session cache and parser/validator service**

```python
# backend/app/history_import_cache.py
import time
import uuid


_history_import_sessions: dict[str, dict] = {}
SESSION_TTL_SECONDS = 15 * 60


def save_history_import_session(payload: dict) -> str:
    session_id = str(uuid.uuid4())
    _history_import_sessions[session_id] = {
        "payload": payload,
        "expires_at": time.time() + SESSION_TTL_SECONDS,
    }
    return session_id


def get_history_import_session(session_id: str) -> dict | None:
    record = _history_import_sessions.get(session_id)
    if not record:
        return None
    if time.time() >= record["expires_at"]:
        _history_import_sessions.pop(session_id, None)
        return None
    return record["payload"]


def pop_history_import_session(session_id: str) -> dict | None:
    payload = get_history_import_session(session_id)
    if payload is None:
        return None
    _history_import_sessions.pop(session_id, None)
    return payload
```

```python
# backend/app/services/history_import_service.py
from datetime import date
from io import BytesIO

from fastapi import HTTPException
from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app.history_import_cache import save_history_import_session
from app.models import Issue, ReportItemTemplate
from app.schemas.history_import import (
    CommitReadiness,
    HistoryImportPreviewOut,
    HistoryImportRow,
    ShippingImportRow,
    TempPrintDetailRow,
)


def _read_meta(sheet) -> dict[str, object]:
    return {str(row[0]).strip(): row[1] for row in sheet.iter_rows(min_row=2, values_only=True) if row[0]}


def preview_history_import(db: Session, report_bytes: bytes, shipping_bytes: bytes) -> HistoryImportPreviewOut:
    report_book = load_workbook(BytesIO(report_bytes), data_only=True)
    shipping_book = load_workbook(BytesIO(shipping_bytes), data_only=True)

    report_meta = _read_meta(report_book["基本信息"])
    shipping_meta = _read_meta(shipping_book["基本信息"])
    issue_number = int(report_meta["期号"])
    publish_date = report_meta["出版日期"]

    errors: list[str] = []
    if int(shipping_meta["期号"]) != issue_number:
        errors.append("两份文件不是同一期")
    if db.query(Issue).filter(Issue.issue_number == issue_number).first():
        errors.append("该期已存在，不能重复导入")

    template_keys = {
        (item.category, item.sub_category): item
        for item in db.query(ReportItemTemplate).all()
    }
    report_rows: list[HistoryImportRow] = []
    for row in report_book["报数项"].iter_rows(min_row=2, values_only=True):
        category, _category_name, sub_category, destination, is_variable, value = row
        key = (str(category).strip(), str(sub_category).strip())
        if key not in template_keys:
            errors.append(f"报数项结构不匹配：{key[0]} / {key[1]}")
            continue
        report_rows.append(
            HistoryImportRow(
                category=key[0],
                sub_category=key[1],
                display_name=template_keys[key].display_name,
                destination=str(destination).strip() if destination else template_keys[key].destination,
                is_variable=str(is_variable).strip() == "是",
                value=int(value or 0),
            )
        )

    temp_rows = [
        TempPrintDetailRow(
            department=str(department).strip(),
            custom_name=str(custom_name).strip() if custom_name else None,
            quantity=int(quantity or 0),
            self_quantity=int(self_quantity or 0),
        )
        for department, custom_name, quantity, self_quantity in report_book["临时加印明细"].iter_rows(min_row=2, values_only=True)
        if department
    ]
    shipping_rows = [
        ShippingImportRow.model_validate(
            {
                "sheet_name": row[0], "channel": row[1], "sub_channel": row[2], "transport": row[3] or "中通物流",
                "frequency": row[4] or "每周", "status": row[5] or "正常", "name": row[6], "address": row[7],
                "phone": row[8], "quantity": int(row[9] or 0), "deadline": row[10], "notes": row[11],
                "extra_info": row[12], "city": row[13], "station_name": row[14], "station_hall": row[15],
                "contact_person": row[16], "seq_number": row[17], "period_count": row[18], "company": row[19],
            }
        )
        for row in shipping_book["发货明细"].iter_rows(min_row=2, values_only=True)
        if row[0]
    ]

    session_id = save_history_import_session(
        {
            "issue_number": issue_number,
            "publish_date": publish_date,
            "page_count": int(report_meta["版数"] or 24),
            "notes": str(report_meta["备注"]).strip() if report_meta.get("备注") else None,
            "report_rows": [row.model_dump() for row in report_rows],
            "temp_rows": [row.model_dump() for row in temp_rows],
            "shipping_rows": [row.model_dump() for row in shipping_rows],
        }
    )

    return HistoryImportPreviewOut(
        issue_number=issue_number,
        publish_date=publish_date,
        report_entry_count=len(report_rows),
        temp_detail_count=len(temp_rows),
        shipping_detail_count=len(shipping_rows),
        readiness=CommitReadiness(
            same_issue=not any("同一期" in error for error in errors),
            issue_exists=any("已存在" in error for error in errors),
            can_commit=len(errors) == 0,
        ),
        errors=errors,
        can_commit=len(errors) == 0,
        import_session_id=session_id,
    )
```

- [ ] **Step 4: Add the missing preview response models**

```python
# backend/app/schemas/history_import.py
from datetime import date


class ShippingImportRow(BaseModel):
    sheet_name: str
    channel: str
    sub_channel: str | None = None
    transport: str = "中通物流"
    frequency: str = "每周"
    status: str = "正常"
    name: str
    address: str | None = None
    phone: str | None = None
    quantity: int
    deadline: str | None = None
    notes: str | None = None
    extra_info: str | None = None
    city: str | None = None
    station_name: str | None = None
    station_hall: str | None = None
    contact_person: str | None = None
    seq_number: int | None = None
    period_count: int | None = None
    company: str | None = None


class CommitReadiness(BaseModel):
    same_issue: bool
    issue_exists: bool
    can_commit: bool


class HistoryImportPreviewOut(BaseModel):
    issue_number: int
    publish_date: date
    report_entry_count: int
    temp_detail_count: int
    shipping_detail_count: int
    readiness: CommitReadiness
    errors: list[str]
    can_commit: bool
    import_session_id: str
```

- [ ] **Step 5: Run the preview tests to verify they pass**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m unittest tests.test_history_import.HistoryImportPreviewTests -v
```

Expected: both preview tests pass.

- [ ] **Step 6: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add backend\app\history_import_cache.py backend\app\services\history_import_service.py backend\app\schemas\history_import.py backend\tests\test_history_import.py
git commit -m "feat: add history import preview flow`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Add commit-time persistence and backend API routes

**Files:**
- Create: `backend\app\api\history_import.py`
- Modify: `backend\app\services\history_import_service.py`
- Modify: `backend\app\main.py`
- Modify: `backend\tests\test_history_import.py`

- [ ] **Step 1: Write the failing commit tests**

```python
from app.history_import_cache import save_history_import_session
from app.models import Issue, ReportEntry, ShippingDetail, TempPrintDetail
from app.services.history_import_service import commit_history_import


class HistoryImportCommitTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)

    def test_commit_creates_issue_report_entries_temp_details_and_shipping_details(self):
        db = self.SessionLocal()
        db.add(
            ReportItemTemplate(
                category="postal",
                sub_category="北京邮发（外埠）",
                display_name="北京邮发（外埠）",
                destination="北京市报刊发行局",
                default_value=0,
                is_variable=True,
                sort_order=1,
            )
        )
        db.commit()

        session_id = save_history_import_session(
            {
                "issue_number": 2648,
                "publish_date": date(2026, 4, 20),
                "page_count": 28,
                "notes": "历史补录",
                "report_rows": [
                    {
                        "category": "postal",
                        "sub_category": "北京邮发（外埠）",
                        "display_name": "北京邮发（外埠）",
                        "destination": "北京市报刊发行局",
                        "is_variable": True,
                        "value": 5575,
                    }
                ],
                "temp_rows": [
                    {"department": "财经中心", "custom_name": None, "quantity": 200, "self_quantity": 200}
                ],
                "shipping_rows": [
                    {
                        "sheet_name": "渠道订阅",
                        "channel": "渠道订阅",
                        "sub_channel": None,
                        "transport": "中通物流",
                        "frequency": "每周",
                        "status": "正常",
                        "name": "张三",
                        "address": "北京",
                        "phone": "13800138000",
                        "quantity": 2,
                        "deadline": None,
                        "notes": None,
                        "extra_info": None,
                        "city": "北京",
                        "station_name": None,
                        "station_hall": None,
                        "contact_person": None,
                        "seq_number": 1,
                        "period_count": 12,
                        "company": None,
                    }
                ],
            }
        )

        result = commit_history_import(db, session_id)

        self.assertEqual(result.issue_number, 2648)
        self.assertEqual(db.query(Issue).filter_by(issue_number=2648).count(), 1)
        self.assertEqual(db.query(ReportEntry).count(), 1)
        self.assertEqual(db.query(TempPrintDetail).count(), 1)
        self.assertEqual(db.query(ShippingDetail).filter_by(issue_number=2648).count(), 1)

    def test_commit_rejects_missing_or_expired_session(self):
        db = self.SessionLocal()
        with self.assertRaises(HTTPException) as ctx:
            commit_history_import(db, "missing-session")
        self.assertEqual(ctx.exception.status_code, 400)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m unittest tests.test_history_import.HistoryImportCommitTests -v
```

Expected: `ImportError` because `commit_history_import` is not implemented.

- [ ] **Step 3: Implement commit persistence**

```python
# backend/app/services/history_import_service.py
from fastapi import HTTPException

from app.history_import_cache import pop_history_import_session
from app.models import Issue, IssueStatus, ReportEntry, ShippingDetail, TempPrintDetail
from app.schemas.history_import import HistoryImportCommitOut


def commit_history_import(db: Session, import_session_id: str) -> HistoryImportCommitOut:
    payload = pop_history_import_session(import_session_id)
    if payload is None:
        raise HTTPException(status_code=400, detail="预检结果已失效，请重新上传")

    if db.query(Issue).filter(Issue.issue_number == payload["issue_number"]).first():
        raise HTTPException(status_code=409, detail="该期已存在，不能重复导入")

    issue = Issue(
        issue_number=payload["issue_number"],
        publish_date=payload["publish_date"],
        page_count=payload["page_count"],
        notes=payload["notes"],
        status=IssueStatus.draft,
    )
    db.add(issue)
    db.flush()

    for row in payload["report_rows"]:
        db.add(
            ReportEntry(
                issue_id=issue.id,
                category=row["category"],
                sub_category=row["sub_category"],
                destination=row["destination"],
                is_variable=row["is_variable"],
                value=row["value"],
            )
        )

    for row in payload["temp_rows"]:
        db.add(TempPrintDetail(issue_id=issue.id, **row))

    for row in payload["shipping_rows"]:
        db.add(ShippingDetail(issue_number=payload["issue_number"], **row))

    db.commit()
    db.refresh(issue)
    return HistoryImportCommitOut(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        report_entry_count=len(payload["report_rows"]),
        temp_detail_count=len(payload["temp_rows"]),
        shipping_detail_count=len(payload["shipping_rows"]),
    )
```

- [ ] **Step 4: Add the router and register it**

```python
# backend/app/api/history_import.py
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.history_import import HistoryImportCommitIn, HistoryImportCommitOut, HistoryImportPreviewOut
from app.services.history_import_service import commit_history_import, preview_history_import
from app.services.history_import_template_service import build_report_import_template, build_shipping_import_template

router = APIRouter(prefix="/api/history-import", tags=["history-import"])


@router.get("/templates/report")
def download_report_template(db: Session = Depends(get_db)):
    content = build_report_import_template(db)
    return StreamingResponse(iter([content]), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="report-import-template.xlsx"'})


@router.get("/templates/shipping")
def download_shipping_template():
    content = build_shipping_import_template()
    return StreamingResponse(iter([content]), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="shipping-import-template.xlsx"'})


@router.post("/preview", response_model=HistoryImportPreviewOut)
async def preview(report_file: UploadFile = File(...), shipping_file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not report_file.filename or not report_file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="报数模板仅支持 .xlsx")
    if not shipping_file.filename or not shipping_file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="中通模板仅支持 .xlsx")
    return preview_history_import(db, await report_file.read(), await shipping_file.read())


@router.post("/commit", response_model=HistoryImportCommitOut)
def commit(data: HistoryImportCommitIn, db: Session = Depends(get_db)):
    return commit_history_import(db, data.import_session_id)
```

```python
# backend/app/main.py
from app.api.history_import import router as history_import_router

app.include_router(history_import_router, dependencies=[Depends(get_current_user)])
```

- [ ] **Step 5: Add the missing commit request/response models**

```python
# backend/app/schemas/history_import.py
class HistoryImportCommitIn(BaseModel):
    import_session_id: str


class HistoryImportCommitOut(BaseModel):
    issue_id: int
    issue_number: int
    report_entry_count: int
    temp_detail_count: int
    shipping_detail_count: int
```

- [ ] **Step 6: Run the backend history-import tests to verify they pass**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m unittest tests.test_history_import -v
```

Expected: all history-import tests pass.

- [ ] **Step 7: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add backend\app\api\history_import.py backend\app\main.py backend\app\services\history_import_service.py backend\app\schemas\history_import.py backend\tests\test_history_import.py
git commit -m "feat: add history import backend flow`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add frontend API client and route shell

**Files:**
- Create: `frontend\src\api\historyImport.ts`
- Create: `frontend\src\pages\HistoryImport.tsx`
- Modify: `frontend\src\App.tsx`
- Modify: `frontend\src\components\AppLayout.tsx`
- Modify: `frontend\src\pages\Dashboard.tsx`

- [ ] **Step 1: Make TypeScript fail by wiring the new route before the page exists**

```tsx
// frontend/src/App.tsx
import HistoryImport from './pages/HistoryImport';

<Route path="/history-import" element={<HistoryImport />} />
```

- [ ] **Step 2: Run type-check to verify it fails**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\frontend'
npx tsc --noEmit
```

Expected: `Cannot find module './pages/HistoryImport'`.

- [ ] **Step 3: Add the client types, page shell, and route highlighting**

```ts
// frontend/src/api/historyImport.ts
import type { AxiosResponse } from 'axios';
import api from './client';

export interface HistoryImportPreview {
  issue_number: number;
  publish_date: string;
  report_entry_count: number;
  temp_detail_count: number;
  shipping_detail_count: number;
  readiness: { same_issue: boolean; issue_exists: boolean; can_commit: boolean };
  errors: string[];
  can_commit: boolean;
  import_session_id: string;
}

export interface HistoryImportCommitResult {
  issue_id: number;
  issue_number: number;
  report_entry_count: number;
  temp_detail_count: number;
  shipping_detail_count: number;
}

export const downloadReportTemplate = (): Promise<AxiosResponse<Blob>> =>
  api.get('/history-import/templates/report', { responseType: 'blob' });

export const downloadShippingTemplate = (): Promise<AxiosResponse<Blob>> =>
  api.get('/history-import/templates/shipping', { responseType: 'blob' });

export const previewHistoryImport = (reportFile: File, shippingFile: File): Promise<AxiosResponse<HistoryImportPreview>> => {
  const form = new FormData();
  form.append('report_file', reportFile);
  form.append('shipping_file', shippingFile);
  return api.post('/history-import/preview', form);
};

export const commitHistoryImport = (importSessionId: string): Promise<AxiosResponse<HistoryImportCommitResult>> =>
  api.post('/history-import/commit', { import_session_id: importSessionId });
```

```tsx
// frontend/src/pages/HistoryImport.tsx
export default function HistoryImport() {
  return <div>往期导入</div>;
}
```

```tsx
// frontend/src/components/AppLayout.tsx
if (path.startsWith('/history-import')) return '/';
```

```tsx
// frontend/src/pages/Dashboard.tsx
<Button onClick={() => navigate('/history-import')}>导入往期</Button>
```

- [ ] **Step 4: Run type-check to verify it passes**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\frontend'
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add frontend\src\api\historyImport.ts frontend\src\pages\HistoryImport.tsx frontend\src\App.tsx frontend\src\components\AppLayout.tsx frontend\src\pages\Dashboard.tsx
git commit -m "feat: add history import route shell`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Build the full import page behavior

**Files:**
- Modify: `frontend\src\pages\HistoryImport.tsx`
- Modify: `frontend\src\pages\Dashboard.tsx`

- [ ] **Step 1: Expand the page with upload, preview, and commit state**

```tsx
// frontend/src/pages/HistoryImport.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Divider, Space, Typography, Upload, message } from 'antd';
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons';
import { commitHistoryImport, downloadReportTemplate, downloadShippingTemplate, previewHistoryImport } from '../api/historyImport';

export default function HistoryImport() {
  const navigate = useNavigate();
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [shippingFile, setShippingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const runPreview = async () => {
    if (!reportFile || !shippingFile) {
      message.warning('请先上传两份模板文件');
      return;
    }
    setPreviewing(true);
    try {
      const res = await previewHistoryImport(reportFile, shippingFile);
      setPreview(res.data);
    } finally {
      setPreviewing(false);
    }
  };

  const runCommit = async () => {
    if (!preview?.can_commit) return;
    setCommitting(true);
    try {
      const res = await commitHistoryImport(preview.import_session_id);
      message.success(`第 ${res.data.issue_number} 期已生成`);
      navigate(`/report/${res.data.issue_id}`);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <Typography.Title level={2}>往期导入</Typography.Title>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<DownloadOutlined />} onClick={() => void downloadReportTemplate()}>下载报数模板</Button>
        <Button icon={<DownloadOutlined />} onClick={() => void downloadShippingTemplate()}>下载中通模板</Button>
      </Space>
      <Card title="1. 上传文件" style={{ marginBottom: 20 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Upload beforeUpload={(file) => { setReportFile(file); return false; }} maxCount={1}>
            <Button icon={<InboxOutlined />}>选择报数模板</Button>
          </Upload>
          <Upload beforeUpload={(file) => { setShippingFile(file); return false; }} maxCount={1}>
            <Button icon={<InboxOutlined />}>选择中通模板</Button>
          </Upload>
          <Button type="primary" loading={previewing} onClick={() => void runPreview()}>识别并校验</Button>
        </Space>
      </Card>
      <Card title="2. 识别结果" style={{ marginBottom: 20 }}>
        {preview ? (
          <>
            <div>期号：{preview.issue_number}</div>
            <div>出版日期：{preview.publish_date}</div>
            <div>报数项：{preview.report_entry_count}</div>
            <div>临时加印明细：{preview.temp_detail_count}</div>
            <div>中通明细：{preview.shipping_detail_count}</div>
            <Divider />
            {preview.errors.length > 0 && <Alert type="error" message={preview.errors.join('；')} />}
            {preview.errors.length === 0 && <Alert type="success" message="校验通过，可以导入" />}
          </>
        ) : (
          <div>上传两份模板后开始预检。</div>
        )}
      </Card>
      <Card title="3. 正式导入">
        <Button type="primary" disabled={!preview?.can_commit} loading={committing} onClick={() => void runCommit()}>
          导入并生成
        </Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add the missing imports and download helper**

```tsx
import type { UploadFile } from 'antd';
import type { HistoryImportPreview } from '../api/historyImport';

function saveBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Wire the template download buttons to save files locally**

```tsx
const handleDownloadReportTemplate = async () => {
  const res = await downloadReportTemplate();
  saveBlob(res.data, '报数导入模板.xlsx');
};

const handleDownloadShippingTemplate = async () => {
  const res = await downloadShippingTemplate();
  saveBlob(res.data, '中通发货导入模板.xlsx');
};
```

- [ ] **Step 4: Make the dashboard entry explicit**

```tsx
// frontend/src/pages/Dashboard.tsx
<Button
  size="large"
  style={{ width: '100%', marginTop: 12 }}
  onClick={() => navigate('/history-import')}
>
  导入往期
</Button>
```

- [ ] **Step 5: Run type-check to verify the full page compiles**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\frontend'
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add frontend\src\pages\HistoryImport.tsx frontend\src\pages\Dashboard.tsx
git commit -m "feat: build history import page`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Update docs and run end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `docs\requirements.md`
- Modify: `docs\technical.md`
- Modify: `docs\user-guide.md`

- [ ] **Step 1: Update the README feature list and workflow summary**

```md
## 历史导入

- 在首页点击“导入往期”进入独立导入页
- 下载系统提供的报数模板和中通发货模板
- 上传两份模板并先执行识别、校验
- 通过后一次性生成草稿期数，再回到现有报数页继续复核
```

- [ ] **Step 2: Update requirements/technical/user-guide docs**

```md
## 往期导入

- 第一版仅支持系统模板导入
- 两份模板必须同一期且目标期号未存在
- 导入页不提供整表编辑
- 导入成功后继续沿用现有确认、发货、导出流程
```

- [ ] **Step 3: Run backend tests**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m unittest tests.test_history_import tests.test_issues_delete -v
```

Expected: all tests pass.

- [ ] **Step 4: Run frontend type-check and build**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\frontend'
npx tsc --noEmit
npm run build
```

Expected: type-check succeeds and Vite build finishes successfully.

- [ ] **Step 5: Smoke-test the new endpoints and UI flow**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Then in another PowerShell window:

```powershell
curl.exe -L -o report-template.xlsx http://127.0.0.1:8000/api/history-import/templates/report
curl.exe -L -o shipping-template.xlsx http://127.0.0.1:8000/api/history-import/templates/shipping
```

Expected: both downloads succeed, preview accepts a valid pair of templates, and commit redirects to `/report/:issueId`.

- [ ] **Step 6: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add README.md docs\requirements.md docs\technical.md docs\user-guide.md
git commit -m "docs: document history template import`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Self-Review

- **Spec coverage:** The plan covers the dedicated import page, dual-template download/upload, preview token flow, transactional commit, duplicate/mismatch blocking, and documentation updates. No spec section is left without a matching task.
- **Placeholder scan:** No `TODO`, `TBD`, or “implement later” language remains. Each task has exact files, concrete code snippets, and runnable commands.
- **Type consistency:** The plan uses one naming set end-to-end: `HistoryImportPreviewOut`, `HistoryImportCommitIn`, `HistoryImportCommitOut`, `preview_history_import`, and `commit_history_import`.
