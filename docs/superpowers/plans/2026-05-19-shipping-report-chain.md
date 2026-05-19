# Shipping Report Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make report confirmation, ZTO shipping detail maintenance, and exports use one auditable source of truth for the current issue's shipping quantity.

**Architecture:** Keep `shipping_details` as the current execution surface for ZTO shipping. Stop using `shipping_records` for confirmation and shipping Excel export, add explicit confirmation/export snapshot records tied to each issue, and surface those values in the existing report editor and shipping detail UI so users can see the exact compared totals and drift after confirmation.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, openpyxl, React, TypeScript, Ant Design, TanStack Query, unittest/pytest

---

## File structure

### Backend files

- Create: `backend\tests\test_report_shipping_chain.py` — regression tests for confirmation totals, export snapshots, and shipping export source switching.
- Create: `backend\app\models\issue_audit_snapshot.py` — stores confirmation and export snapshot rows per issue.
- Create: `backend\app\schemas\audit_snapshot.py` — API response models for audit snapshot summaries shown in the UI.
- Modify: `backend\app\models\__init__.py` — export the new snapshot model.
- Modify: `backend\app\models\issue.py` — add relationship from issue to snapshot rows.
- Modify: `backend\app\api\reports.py` — persist confirmation snapshot rows, expose current-vs-confirmed totals, and keep mismatch warning explicit.
- Modify: `backend\app\api\exports.py` — persist export snapshots for report/shipping/all exports.
- Modify: `backend\app\services\excel_service.py` — make shipping Excel read `shipping_details`, not `shipping_records`.
- Modify: `backend\app\schemas\report.py` — add audit summary fields returned to the report editor.
- Modify: `backend\app\api\issues.py` — remove old `/shipping/:issueId` flow by returning redirect metadata or current shipping-detail route info if kept.

### Frontend files

- Modify: `frontend\src\pages\ReportEditor.tsx` — show compared totals, mismatch delta, and post-confirm drift notice using report API data.
- Modify: `frontend\src\pages\Recipients.tsx` — show current issue total, confirmed total, delta, and export actions in the `中通发货明细` tab.
- Modify: `frontend\src\pages\Dashboard.tsx` — change old `发货` action to route into the ZTO shipping-details tab for the chosen issue.
- Modify: `frontend\src\App.tsx` and `frontend\src\components\AppLayout.tsx` only if a route or selected-menu mapping must change after the old shipping page is demoted.
- Optional modify: `frontend\src\pages\ShippingPreview.tsx` — replace with redirect/notice page if the route must remain for compatibility.

### Docs

- Modify: `docs\technical.md` — document the new source of truth and snapshot/audit flow.
- Modify: `docs\user-guide.md` — update the operator workflow: maintain shipping details, confirm report, read mismatch prompt, export.
- Modify: `docs\requirements.md` — narrow current phase scope to “report ↔ shipping detail” and note recipient/subscription integration is deferred.

## Task 1: Lock down backend behavior with failing tests

**Files:**
- Create: `backend\tests\test_report_shipping_chain.py`
- Modify: `backend\app\api\reports.py`
- Modify: `backend\app\services\excel_service.py`
- Modify: `backend\app\api\exports.py`

- [ ] **Step 1: Write the failing test for confirmation snapshot and shipping-detail source of truth**

```python
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Issue, IssueStatus, ReportEntry, ShippingDetail, User, UserRole
from app.api.reports import confirm_report, get_report
from app.api.exports import export_shipping


class ReportShippingChainTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def test_confirm_uses_shipping_details_total_and_persists_snapshot(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3001, publish_date=date(2026, 5, 25), status=IssueStatus.draft)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ReportEntry(issue_id=issue.id, category="postal", sub_category="本市", value=10),
                ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=40),
                ShippingDetail(issue_number=3001, sheet_name="测试", channel="渠道订阅", name="甲", quantity=15),
                ShippingDetail(issue_number=3001, sheet_name="测试", channel="渠道订阅", name="乙", quantity=25),
            ]
        )
        db.commit()

        result = confirm_report(
            issue.id,
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertEqual(result["zt_report_total"], 40)
        self.assertEqual(result["zt_shipping_total"], 40)
        report = get_report(issue.id, db=db)
        self.assertEqual(report.confirmation_summary.shipping_total, 40)
        self.assertEqual(report.confirmation_summary.is_match, True)

    def test_shipping_export_reads_shipping_details_instead_of_shipping_records(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3002, publish_date=date(2026, 6, 1), status=IssueStatus.confirmed)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ShippingDetail(issue_number=3002, sheet_name="测试", channel="渠道订阅", name="甲", quantity=7),
                ShippingDetail(issue_number=3002, sheet_name="测试", channel="对公订阅", name="乙", quantity=9),
            ]
        )
        db.commit()

        response = export_shipping(issue.id, db=db)

        self.assertIn(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            response.media_type,
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -m pytest tests\test_report_shipping_chain.py -v
```

Expected: FAIL because `ReportDataOut` has no `confirmation_summary`, no snapshot model/table exists, and shipping export still reads `shipping_records`.

- [ ] **Step 3: Add one more failing mismatch test before implementation**

```python
    def test_confirm_mismatch_is_saved_for_future_drift_display(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3003, publish_date=date(2026, 6, 8), status=IssueStatus.draft)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=30),
                ShippingDetail(issue_number=3003, sheet_name="测试", channel="渠道订阅", name="甲", quantity=18),
            ]
        )
        db.commit()

        result = confirm_report(
            issue.id,
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertIn("warning", result)
        report = get_report(issue.id, db=db)
        self.assertEqual(report.confirmation_summary.delta, 12)
        self.assertEqual(report.confirmation_summary.is_match, False)
```

- [ ] **Step 4: Re-run tests to keep the failure signal tight**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -m pytest tests\test_report_shipping_chain.py -v
```

Expected: FAIL with missing snapshot persistence / response fields, but no unrelated import errors.

- [ ] **Step 5: Commit the red tests**

```powershell
git add -- backend\tests\test_report_shipping_chain.py
git commit -m "test: lock report shipping chain behavior" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Add backend snapshot model and confirmation audit flow

**Files:**
- Create: `backend\app\models\issue_audit_snapshot.py`
- Create: `backend\app\schemas\audit_snapshot.py`
- Modify: `backend\app\models\__init__.py`
- Modify: `backend\app\models\issue.py`
- Modify: `backend\app\schemas\report.py`
- Modify: `backend\app\api\reports.py`

- [ ] **Step 1: Write the new snapshot model**

```python
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class IssueAuditSnapshot(Base):
    __tablename__ = "issue_audit_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_type = Column(String(20), nullable=False, index=True)  # confirm / export_report / export_shipping / export_all
    report_total = Column(Integer, nullable=False, default=0)
    shipping_total = Column(Integer, nullable=False, default=0)
    delta = Column(Integer, nullable=False, default=0)
    is_match = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    issue = relationship("Issue", back_populates="audit_snapshots")
```

- [ ] **Step 2: Wire the model into Issue and report response schemas**

```python
# backend\app\models\issue.py
audit_snapshots = relationship(
    "IssueAuditSnapshot",
    back_populates="issue",
    cascade="all, delete-orphan",
)
```

```python
# backend\app\schemas\audit_snapshot.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AuditSnapshotSummary(BaseModel):
    report_total: int
    shipping_total: int
    delta: int
    is_match: bool
    snapshot_type: str
    created_at: Optional[datetime] = None


class DriftSummary(BaseModel):
    confirmed_shipping_total: Optional[int] = None
    current_shipping_total: int
    delta_from_confirmation: Optional[int] = None
```

```python
# backend\app\schemas\report.py
class ReportDataOut(BaseModel):
    issue_id: int
    issue_number: int
    entries: List[ReportEntryOut]
    total: int
    destination_summary: List[DestinationSummary] = []
    confirmation_summary: Optional[AuditSnapshotSummary] = None
    drift_summary: Optional[DriftSummary] = None
```

- [ ] **Step 3: Persist confirmation snapshot rows in `confirm_report()`**

```python
snapshot = IssueAuditSnapshot(
    issue_id=issue.id,
    snapshot_type="confirm",
    report_total=zt_report_total,
    shipping_total=zt_shipping_total,
    delta=zt_report_total - zt_shipping_total,
    is_match=zt_report_total == zt_shipping_total,
    created_by=user.username,
)
db.add(snapshot)
```

Also extend `get_report()` to load the latest confirm snapshot and current shipping total:

```python
latest_confirmation = (
    db.query(IssueAuditSnapshot)
    .filter(
        IssueAuditSnapshot.issue_id == issue.id,
        IssueAuditSnapshot.snapshot_type == "confirm",
    )
    .order_by(IssueAuditSnapshot.created_at.desc(), IssueAuditSnapshot.id.desc())
    .first()
)

current_shipping_total = (
    db.query(func.coalesce(func.sum(ShippingDetail.quantity), 0))
    .filter(ShippingDetail.issue_number == issue.issue_number)
    .scalar()
)
```

- [ ] **Step 4: Run backend tests and the existing delete regression**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -m pytest tests\test_report_shipping_chain.py tests\test_issues_delete.py -v
```

Expected: PASS for snapshot-confirmation tests and existing delete behavior.

- [ ] **Step 5: Commit the confirmation audit slice**

```powershell
git add -- backend\app\models\issue_audit_snapshot.py backend\app\schemas\audit_snapshot.py backend\app\models\__init__.py backend\app\models\issue.py backend\app\schemas\report.py backend\app\api\reports.py backend\tests\test_report_shipping_chain.py
git commit -m "feat: audit report confirmation totals" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Switch shipping export and old shipping flow to the single source of truth

**Files:**
- Modify: `backend\app\services\excel_service.py`
- Modify: `backend\app\api\exports.py`
- Modify: `frontend\src\pages\Dashboard.tsx`
- Optional modify: `frontend\src\pages\ShippingPreview.tsx`
- Modify: `frontend\src\App.tsx`

- [ ] **Step 1: Replace shipping Excel data source with `shipping_details`**

```python
# backend\app\services\excel_service.py
details = (
    db.query(ShippingDetail)
    .filter(ShippingDetail.issue_number == issue.issue_number)
    .order_by(ShippingDetail.id)
    .all()
)

corporate = [d for d in details if d.channel == "对公订阅"]
readers = [d for d in details if d.channel in {"个人订阅", "渠道订阅"}]
samples = [d for d in details if d.channel in {"赠阅", "记者站", "报社留存", "库房留存"}]

def _write_sheet(ws, items, start_row=2):
    for i, detail in enumerate(items):
        row = start_row + i
        ws.cell(row=row, column=1, value=i + 1)
        ws.cell(row=row, column=2, value=detail.name)
        ws.cell(row=row, column=3, value=detail.phone or "")
        ws.cell(row=row, column=4, value=detail.address or "")
        ws.cell(row=row, column=5, value=detail.quantity)
```

- [ ] **Step 2: Save export snapshots in the export API**

```python
snapshot = IssueAuditSnapshot(
    issue_id=issue.id,
    snapshot_type="export_shipping",
    report_total=zt_report_total,
    shipping_total=zt_shipping_total,
    delta=zt_report_total - zt_shipping_total,
    is_match=zt_report_total == zt_shipping_total,
)
db.add(snapshot)
db.commit()
```

Repeat with `"export_report"` and `"export_all"` in the other endpoints before returning the stream.

- [ ] **Step 3: Demote the old dashboard “发货” entry to the shipping-details page**

```tsx
// frontend\src\pages\Dashboard.tsx
<Button
  type="text"
  icon={<SendOutlined />}
  onClick={() => navigate(`/recipients?tab=shipping&issue=${item.issue_number}`)}
  style={{ color: '#86868b' }}
>
  中通明细
</Button>
```

If route compatibility must remain, make `ShippingPreview.tsx` a redirect/notice:

```tsx
useEffect(() => {
  if (issue?.issue_number) {
    navigate(`/recipients?tab=shipping&issue=${issue.issue_number}`, { replace: true });
  }
}, [issue, navigate]);
```

- [ ] **Step 4: Run tests plus frontend type-check/build**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -m pytest tests\test_report_shipping_chain.py tests\test_issues_delete.py -v

Set-Location C:\Users\luyal\Repos\FirstTry\frontend
npx tsc --noEmit
npm run build
```

Expected: backend tests PASS; TypeScript check PASS; Vite build PASS.

- [ ] **Step 5: Commit the source-of-truth switch**

```powershell
git add -- backend\app\services\excel_service.py backend\app\api\exports.py frontend\src\pages\Dashboard.tsx frontend\src\pages\ShippingPreview.tsx frontend\src\App.tsx
git commit -m "feat: route shipping exports through shipping details" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Surface compared totals and drift in the existing UI

**Files:**
- Modify: `frontend\src\pages\ReportEditor.tsx`
- Modify: `frontend\src\pages\Recipients.tsx`
- Modify: `backend\app\api\reports.py`
- Modify: `backend\app\schemas\report.py`

- [ ] **Step 1: Add report-editor UI for compare result and drift**

```tsx
{report?.confirmation_summary && (
  <Card style={{ marginBottom: 20 }}>
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>确认对照</span>
      <Tag color={report.confirmation_summary.is_match ? 'green' : 'red'}>
        报数 {report.confirmation_summary.report_total} 份 / 中通 {report.confirmation_summary.shipping_total} 份 / 差值 {report.confirmation_summary.delta}
      </Tag>
      {report.drift_summary?.delta_from_confirmation !== 0 && report.drift_summary?.delta_from_confirmation != null && (
        <Tag color="orange">
          确认后中通明细已变化：当前 {report.drift_summary.current_shipping_total} 份，较确认时变化 {report.drift_summary.delta_from_confirmation} 份
        </Tag>
      )}
    </Space>
  </Card>
)}
```

Update the confirm mismatch modal text:

```tsx
content: `报数中通合计 ${confirmData.zt_report_total} 份；中通明细合计 ${confirmData.zt_shipping_total} 份；差值 ${confirmData.zt_report_total - confirmData.zt_shipping_total} 份。`,
```

- [ ] **Step 2: Add shipping-details UI for current total, confirmed total, and delta**

```tsx
<div style={{ flex: 1 }} />
<Space size={12} wrap>
  <Tag color="blue">当前中通：{details.reduce((sum, d) => sum + (d.quantity ?? 0), 0)} 份</Tag>
  {reportSummary && (
    <>
      <Tag color={reportSummary.is_match ? 'green' : 'red'}>
        确认时：报数 {reportSummary.report_total} / 中通 {reportSummary.shipping_total}
      </Tag>
      <Tag color={reportSummary.delta === 0 ? 'green' : 'orange'}>
        差值：{reportSummary.delta}
      </Tag>
    </>
  )}
</Space>
```

Fetch the report summary with the existing issue/issue-number selection:

```tsx
const { data: reportSummary } = useQuery({
  queryKey: ['report-summary', currentIssue?.id],
  queryFn: async () => {
    if (!currentIssue?.id) return null;
    const res = await getReport(currentIssue.id);
    return res.data.confirmation_summary;
  },
  enabled: !!currentIssue?.id,
});
```

- [ ] **Step 3: Verify query invalidation keeps the counts fresh**

```tsx
const refreshShippingDetails = () => {
  queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
  queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
  queryClient.invalidateQueries({ queryKey: ['operationLogs'] });
  queryClient.invalidateQueries({ queryKey: ['report-summary'] });
  queryClient.invalidateQueries({ queryKey: ['report'] });
};
```

- [ ] **Step 4: Run backend tests and frontend type-check/build**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -m pytest tests\test_report_shipping_chain.py tests\test_issues_delete.py -v

Set-Location C:\Users\luyal\Repos\FirstTry\frontend
npx tsc --noEmit
npm run build
```

Expected: PASS across backend tests, type-check, and build.

- [ ] **Step 5: Commit the UI feedback slice**

```powershell
git add -- frontend\src\pages\ReportEditor.tsx frontend\src\pages\Recipients.tsx backend\app\api\reports.py backend\app\schemas\report.py
git commit -m "feat: show report and shipping total drift" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Update docs and run final verification

**Files:**
- Modify: `docs\technical.md`
- Modify: `docs\requirements.md`
- Modify: `docs\user-guide.md`
- Modify: `docs\superpowers\specs\2026-05-19-shipping-report-chain-design.md` only if implementation changed the design

- [ ] **Step 1: Update the technical doc with the new source-of-truth statement**

```md
## 报数与中通明细链路

- 当前期中通执行面统一为“收件人管理 → 中通发货明细”
- 报数确认只比较：报数中通合计 vs 当期 shipping_details 合计
- shipping_records 不再作为确认或中通 Excel 导出的来源
- issue_audit_snapshots 记录确认与导出时的报数/中通数量快照
```

- [ ] **Step 2: Update requirements and user guide for the narrowed current phase**

```md
### 当前阶段范围

- 收件人/订阅保留现状
- 本阶段只打通 报数编辑页 ↔ 中通发货明细页
- 后续订单管理系统再接入自动生成链
```

```md
### 操作步骤

1. 在“收件人管理 → 中通发货明细”维护当期中通明细
2. 在“印数报数管理 → 报数编辑页”完成报数录入
3. 点击“确认报数”并查看中通数量对照提示
4. 分别导出报数文件和中通明细文件
```

- [ ] **Step 3: Run the full verification set**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -m pytest tests\test_report_shipping_chain.py tests\test_issues_delete.py -v

Set-Location C:\Users\luyal\Repos\FirstTry\frontend
npx tsc --noEmit
npm run build

Set-Location C:\Users\luyal\Repos\FirstTry
git --no-pager status --short
```

Expected:

- backend tests PASS
- frontend type-check PASS
- frontend build PASS
- `git status --short` shows only the intended plan implementation files

- [ ] **Step 4: Commit docs and any final cleanup**

```powershell
git add -- docs\technical.md docs\requirements.md docs\user-guide.md
git commit -m "docs: document shipping report source of truth" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 5: Request implementation review before merge**

```powershell
# No code here: open a review or invoke the project review workflow after all commits land.
git --no-pager log --oneline -5
```

Expected: shows the test, backend, frontend, and docs commits in order.
