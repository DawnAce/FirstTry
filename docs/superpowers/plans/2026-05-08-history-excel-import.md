# History Excel Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create an expired issue draft, upload an Excel file on the report editor, prefill report values/temp print attribution/page count/notes, then manually confirm the draft through the existing workflow.

**Architecture:** Keep the existing create-issue flow and add import at the report-editor layer. Backend work is split into a focused Excel parsing service plus a draft-only import endpoint that writes into `issues`, `report_entries`, and `temp_print_details`. Frontend work stays inside `ReportEditor`, with a small API client addition and query invalidation so imported data replaces the blank draft immediately.

**Tech Stack:** FastAPI, SQLAlchemy, openpyxl, React 19, TypeScript, TanStack Query, Arco Design

---

## File Structure

- **Create:** `backend\app\services\history_excel_import_service.py` — Parse uploaded Excel into a normalized import result and apply it to a draft issue.
- **Create:** `backend\tests\services\test_history_excel_import_service.py` — Unit tests for Excel parsing, missing fields, unmapped items, and temp print detail extraction.
- **Modify:** `backend\requirements.txt` — Add `pytest` so backend service tests can run.
- **Modify:** `backend\app\schemas\report.py` — Add response models for import summary and unmapped fields.
- **Modify:** `backend\app\api\reports.py` — Add the draft-only Excel import endpoint under the existing report router.
- **Modify:** `frontend\src\api\reports.ts` — Add request/response types and the upload API call.
- **Modify:** `frontend\src\pages\ReportEditor.tsx` — Add the Excel upload control, import summary UI, and query refresh after import.
- **Modify:** `docs\technical.md` — Document the new import service and API endpoint.
- **Modify:** `docs\requirements.md` — Document the Excel historical-import workflow scope.
- **Modify:** `docs\user-guide.md` — Document how users create a historical draft and import Excel before confirming.

### Task 1: Add backend test harness and parser contract

**Files:**
- Modify: `backend\requirements.txt`
- Create: `backend\tests\services\test_history_excel_import_service.py`
- Create: `backend\app\services\history_excel_import_service.py`

- [ ] **Step 1: Add pytest to backend dependencies**

```txt
# backend/requirements.txt
fastapi==0.115.0
uvicorn[standard]==0.30.0
sqlalchemy==2.0.35
pymysql==1.1.1
cryptography==43.0.0
alembic==1.13.2
python-dotenv==1.0.1
openpyxl==3.1.5
pandas==2.2.2
pydantic==2.9.0
pydantic-settings==2.5.0
python-multipart==0.0.9
pytest==8.4.1
```

- [ ] **Step 2: Write the failing parser test**

```python
# backend/tests/services/test_history_excel_import_service.py
from io import BytesIO
from openpyxl import Workbook

from app.services.history_excel_import_service import parse_history_excel


def build_history_workbook() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "历史补录"
    ws["A1"] = "项目"
    ws["B1"] = "数值"
    ws["D1"] = "版数"
    ws["E1"] = "备注"
    ws["D2"] = 28
    ws["E2"] = "2651期传真补录"

    ws.append(["北京邮发（外埠）", 5575])
    ws.append(["北京邮发（本市）", 1212])
    ws.append(["临时加印", 200])
    ws.append(["未识别字段", 999])

    detail = wb.create_sheet("临时加印归属明细")
    detail.append(["部门", "份数", "自留", "快递"])
    detail.append(["财经中心", 200, 200, 0])

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_history_excel_extracts_entries_details_and_unmapped_items():
    result = parse_history_excel(build_history_workbook())

    assert result.page_count == 28
    assert result.notes == "2651期传真补录"
    assert result.entries[("postal", "北京邮发（外埠）")] == 5575
    assert result.entries[("postal", "北京邮发（本市）")] == 1212
    assert result.entries[("social_use", "临时加印")] == 200
    assert len(result.temp_details) == 1
    assert result.temp_details[0].department == "财经中心"
    assert result.temp_details[0].quantity == 200
    assert result.temp_details[0].self_quantity == 200
    assert "未识别字段" in result.unmapped_items
```

- [ ] **Step 3: Install dependencies and run the test to verify it fails**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m pytest tests\services\test_history_excel_import_service.py -q
```

Expected: `ImportError` / `ModuleNotFoundError` for `parse_history_excel`.

- [ ] **Step 4: Implement the minimal parser and result model**

```python
# backend/app/services/history_excel_import_service.py
from dataclasses import dataclass, field
from io import BytesIO

from openpyxl import load_workbook

from app.schemas.report import TempPrintDetailIn


ENTRY_NAME_MAPPING = {
    "北京邮发（外埠）": ("postal", "北京邮发（外埠）"),
    "北京邮发（本市）": ("postal", "北京邮发（本市）"),
    "临时加印": ("social_use", "临时加印"),
}


@dataclass
class HistoryExcelParseResult:
    entries: dict[tuple[str, str], int] = field(default_factory=dict)
    temp_details: list[TempPrintDetailIn] = field(default_factory=list)
    page_count: int | None = None
    notes: str | None = None
    unmapped_items: list[str] = field(default_factory=list)


def parse_history_excel(file_bytes: bytes) -> HistoryExcelParseResult:
    workbook = load_workbook(BytesIO(file_bytes), data_only=True)
    sheet = workbook.active
    result = HistoryExcelParseResult(
        page_count=sheet["D2"].value or None,
        notes=sheet["E2"].value or None,
    )

    for row in sheet.iter_rows(min_row=2, values_only=True):
        name = row[0]
        value = row[1]
        if not name:
            continue
        mapped = ENTRY_NAME_MAPPING.get(str(name).strip())
        if mapped is None:
            result.unmapped_items.append(str(name).strip())
            continue
        result.entries[mapped] = int(value or 0)

    if "临时加印归属明细" in workbook.sheetnames:
        detail_sheet = workbook["临时加印归属明细"]
        for department, quantity, self_quantity, _express in detail_sheet.iter_rows(min_row=2, values_only=True):
            if not department:
                continue
            result.temp_details.append(
                TempPrintDetailIn(
                    department=str(department).strip(),
                    quantity=int(quantity or 0),
                    self_quantity=int(self_quantity or 0),
                )
            )

    return result
```

- [ ] **Step 5: Run the parser test to verify it passes**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m pytest tests\services\test_history_excel_import_service.py -q
```

Expected: `1 passed`.

- [ ] **Step 6: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add backend\requirements.txt backend\tests\services\test_history_excel_import_service.py backend\app\services\history_excel_import_service.py
git commit -m "test: add history excel parser contract`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Apply parsed data into a draft issue and expose the API

**Files:**
- Modify: `backend\app\services\history_excel_import_service.py`
- Modify: `backend\app\schemas\report.py`
- Modify: `backend\app\api\reports.py`
- Modify: `backend\tests\services\test_history_excel_import_service.py`

- [ ] **Step 1: Add the failing draft-apply test**

```python
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import Issue, ReportEntry, TempPrintDetail
from app.services.history_excel_import_service import (
    HistoryExcelParseResult,
    apply_history_excel_import,
)
from app.schemas.report import TempPrintDetailIn


def test_apply_history_excel_import_updates_draft_issue_and_replaces_temp_details():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine)
    db: Session = TestingSession()

    issue = Issue(issue_number=2648, publish_date=date(2026, 4, 20), page_count=24, notes=None)
    db.add(issue)
    db.flush()
    db.add_all([
        ReportEntry(issue_id=issue.id, category="postal", sub_category="北京邮发（外埠）", value=0, is_variable=True),
        ReportEntry(issue_id=issue.id, category="social_use", sub_category="临时加印", value=0, is_variable=True),
        ReportEntry(issue_id=issue.id, category="social_use", sub_category="临时加印_自留", value=0, is_variable=True),
    ])
    db.commit()

    result = HistoryExcelParseResult(
        entries={
            ("postal", "北京邮发（外埠）"): 5575,
            ("social_use", "临时加印"): 200,
        },
        temp_details=[TempPrintDetailIn(department="财经中心", quantity=200, self_quantity=200)],
        page_count=28,
        notes="历史补录备注",
        unmapped_items=["未识别字段"],
    )

    summary = apply_history_excel_import(db, issue.id, result)

    updated_issue = db.query(Issue).filter(Issue.id == issue.id).one()
    assert updated_issue.page_count == 28
    assert updated_issue.notes == "历史补录备注"
    assert db.query(ReportEntry).filter_by(issue_id=issue.id, sub_category="北京邮发（外埠）").one().value == 5575
    assert db.query(ReportEntry).filter_by(issue_id=issue.id, sub_category="临时加印").one().value == 200
    assert db.query(ReportEntry).filter_by(issue_id=issue.id, sub_category="临时加印_自留").one().value == 200
    assert db.query(TempPrintDetail).filter_by(issue_id=issue.id).count() == 1
    assert summary.unmapped_items == ["未识别字段"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m pytest tests\services\test_history_excel_import_service.py -q
```

Expected: `ImportError` for `apply_history_excel_import` or assertion failure because nothing updates the issue yet.

- [ ] **Step 3: Add the import summary schema and draft-only apply logic**

```python
# backend/app/schemas/report.py
class ImportSummaryOut(BaseModel):
    imported_entries: int
    imported_temp_details: int
    page_count_updated: bool
    notes_updated: bool
    unmapped_items: List[str]
```

```python
# backend/app/services/history_excel_import_service.py
from fastapi import HTTPException

from app.models import Issue, IssueStatus, ReportEntry, TempPrintDetail
from app.schemas.report import ImportSummaryOut


def apply_history_excel_import(db, issue_id: int, result: HistoryExcelParseResult) -> ImportSummaryOut:
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    if issue.status != IssueStatus.draft:
        raise HTTPException(status_code=403, detail="仅草稿状态允许导入 Excel")

    imported_entries = 0
    for (category, sub_category), value in result.entries.items():
        entry = (
            db.query(ReportEntry)
            .filter(
                ReportEntry.issue_id == issue_id,
                ReportEntry.category == category,
                ReportEntry.sub_category == sub_category,
            )
            .first()
        )
        if entry is None:
            result.unmapped_items.append(sub_category)
            continue
        entry.value = value
        imported_entries += 1

    db.query(TempPrintDetail).filter(TempPrintDetail.issue_id == issue_id).delete()
    for detail in result.temp_details:
        db.add(
            TempPrintDetail(
                issue_id=issue_id,
                department=detail.department,
                custom_name=detail.custom_name,
                quantity=detail.quantity,
                self_quantity=detail.self_quantity,
            )
        )

    self_entry = (
        db.query(ReportEntry)
        .filter(
            ReportEntry.issue_id == issue_id,
            ReportEntry.category == "social_use",
            ReportEntry.sub_category == "临时加印_自留",
        )
        .first()
    )
    if self_entry:
        self_entry.value = sum(detail.self_quantity for detail in result.temp_details)

    page_count_updated = result.page_count is not None and result.page_count != issue.page_count
    notes_updated = result.notes is not None and result.notes != issue.notes
    if result.page_count is not None:
        issue.page_count = result.page_count
    if result.notes is not None:
        issue.notes = result.notes

    db.commit()
    return ImportSummaryOut(
        imported_entries=imported_entries,
        imported_temp_details=len(result.temp_details),
        page_count_updated=page_count_updated,
        notes_updated=notes_updated,
        unmapped_items=result.unmapped_items,
    )
```

- [ ] **Step 4: Add the upload endpoint**

```python
# backend/app/api/reports.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from app.schemas.report import ImportSummaryOut
from app.services.history_excel_import_service import parse_history_excel, apply_history_excel_import


@router.post("/import-excel", response_model=ImportSummaryOut)
async def import_report_excel(
    issue_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="仅支持 Excel 文件")

    result = parse_history_excel(await file.read())
    return apply_history_excel_import(db, issue_id, result)
```

- [ ] **Step 5: Run the backend tests and a manual API smoke check**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m pytest tests\services\test_history_excel_import_service.py -q
```

Expected: `2 passed`.

Run:

```powershell
curl -X POST -F "file=@C:\path\to\history.xlsx" http://127.0.0.1:8000/api/issues/2649/report/import-excel
```

Expected: JSON with `imported_entries`, `imported_temp_details`, and `unmapped_items`.

- [ ] **Step 6: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add backend\app\services\history_excel_import_service.py backend\app\schemas\report.py backend\app\api\reports.py backend\tests\services\test_history_excel_import_service.py
git commit -m "feat: add historical excel report import API`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Add Excel import UI to the report editor

**Files:**
- Modify: `frontend\src\api\reports.ts`
- Modify: `frontend\src\pages\ReportEditor.tsx`

- [ ] **Step 1: Add the API contract first**

```ts
// frontend/src/api/reports.ts
export interface ImportSummary {
  imported_entries: number;
  imported_temp_details: number;
  page_count_updated: boolean;
  notes_updated: boolean;
  unmapped_items: string[];
}

export const importReportExcel = (issueId: number, file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post<ImportSummary>(`/issues/${issueId}/report/import-excel`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
```

- [ ] **Step 2: Add the failing editor integration by wiring a button to a missing handler**

```tsx
// frontend/src/pages/ReportEditor.tsx
<Button type="outline" onClick={() => fileInputRef.current?.click()}>
  导入 Excel
</Button>
<input
  ref={fileInputRef}
  type="file"
  accept=".xlsx,.xlsm"
  style={{ display: 'none' }}
  onChange={handleImportFile}
/>
```

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\frontend'
npx tsc --noEmit
```

Expected: TypeScript error for missing `fileInputRef` / `handleImportFile`.

- [ ] **Step 3: Implement the upload flow, summary message, and query invalidation**

```tsx
// frontend/src/pages/ReportEditor.tsx
import { useRef, useState } from 'react';
import { importReportExcel } from '../api/reports';

const fileInputRef = useRef<HTMLInputElement | null>(null);
const [importing, setImporting] = useState(false);
const [lastImportSummary, setLastImportSummary] = useState<ImportSummary | null>(null);

const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (!file || !issueId) return;

  setImporting(true);
  try {
    const res = await importReportExcel(Number(issueId), file);
    setLastImportSummary(res.data);
    Message.success(`已导入 ${res.data.imported_entries} 个报数项`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] }),
      queryClient.invalidateQueries({ queryKey: ['report', issueId] }),
      queryClient.invalidateQueries({ queryKey: ['tempDetails', issueId] }),
    ]);
    setEntries([]);
    setTempDetailsLoaded(false);
  } catch (err: any) {
    Message.error(err.response?.data?.detail || 'Excel 导入失败');
  } finally {
    event.target.value = '';
    setImporting(false);
  }
};
```

```tsx
{!isConfirmed && (
  <Space size="medium">
    <Button type="outline" loading={importing} onClick={() => fileInputRef.current?.click()}>
      导入 Excel
    </Button>
    {lastImportSummary && (
      <span style={{ fontSize: 13, color: '#86868b' }}>
        已导入 {lastImportSummary.imported_entries} 项
        {lastImportSummary.unmapped_items.length > 0
          ? `，未导入：${lastImportSummary.unmapped_items.join('、')}`
          : '，无未导入项'}
      </span>
    )}
  </Space>
)}
```

- [ ] **Step 4: Run typecheck and do the browser verification**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\frontend'
npx tsc --noEmit
```

Expected: no output.

Manual verification:

1. 在首页“其他期数补录”创建一个过期期数草稿。
2. 进入该期 `ReportEditor`。
3. 点击“导入 Excel”，选择样例文件。
4. 确认报数项、临时加印归属明细、版数、备注被预填。
5. 确认页面仍为草稿状态，仍需手动点击“确认报数”。

- [ ] **Step 5: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add frontend\src\api\reports.ts frontend\src\pages\ReportEditor.tsx
git commit -m "feat: add excel import to historical report editor`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Update documentation and run end-to-end verification

**Files:**
- Modify: `docs\technical.md`
- Modify: `docs\requirements.md`
- Modify: `docs\user-guide.md`

- [ ] **Step 1: Update technical documentation**

```md
## 历史补录 Excel 导入

- 接口：`POST /api/issues/{issue_id}/report/import-excel`
- 限制：仅草稿状态允许导入，仅支持 `.xlsx` / `.xlsm`
- 导入范围：`report_entries`、`temp_print_details`、`issues.page_count`、`issues.notes`
- 返回：导入数量、临时加印明细数量、版数/备注是否更新、未导入项列表
```

- [ ] **Step 2: Update requirements and user guide**

```md
## 历史补录

1. 在首页“其他期数补录”创建草稿
2. 进入该期报数编辑页
3. 点击“导入 Excel”
4. 系统预填报数项、临时加印归属明细、版数、备注
5. 缺失字段保持为空
6. 未导入项会提示给用户
7. 用户复核后手动确认报数
```

- [ ] **Step 3: Run full verification**

Run:

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry\backend'
.\venv\Scripts\python.exe -m pytest tests\services\test_history_excel_import_service.py -q

Set-Location 'C:\Users\luyal\Repos\FirstTry\frontend'
npx tsc --noEmit
```

Expected:

- `pytest` reports all tests passed
- `tsc` exits with no output
- Manual upload flow works end-to-end on a draft issue

- [ ] **Step 4: Commit**

```powershell
Set-Location 'C:\Users\luyal\Repos\FirstTry'
git add docs\technical.md docs\requirements.md docs\user-guide.md
git commit -m "docs: document historical excel import workflow`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
