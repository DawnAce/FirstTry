# Shipping Report Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make report confirmation, ZTO shipping detail maintenance, and exports use one auditable source of truth for the current issue's shipping quantity.

**Architecture:** Keep `shipping_details` as the current execution surface for ZTO shipping. Replace legacy confirmation/export reads from `shipping_records` with issue-level totals from `shipping_details`, and persist lightweight confirmation/export snapshots so the UI can show “confirmed then changed” drift. Defer recipient/subscription generation; this phase only tightens the current report-to-shipping-detail chain.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, openpyxl, React, TypeScript, Ant Design, TanStack Query, unittest/pytest

---

## File structure

- Create: `backend\tests\test_report_shipping_chain.py` — regression tests for confirmed totals, drift, and shipping export source.
- Create: `backend\app\models\issue_audit_snapshot.py` — minimal per-issue snapshot rows for confirm/export events.
- Create: `backend\app\schemas\audit_snapshot.py` — Pydantic shapes for confirmation summary and drift summary.
- Modify: `backend\app\models\__init__.py` — export the new snapshot model.
- Modify: `backend\app\models\issue.py` — add `audit_snapshots` relationship.
- Modify: `backend\app\schemas\report.py` — extend `ReportDataOut`.
- Modify: `backend\app\api\reports.py` — write confirmation snapshots and expose current-vs-confirmed totals.
- Modify: `backend\app\api\exports.py` — write export snapshots.
- Modify: `backend\app\services\excel_service.py` — source shipping workbook rows from `shipping_details`.
- Modify: `frontend\src\pages\ReportEditor.tsx` — show confirmed totals, mismatch, and drift.
- Modify: `frontend\src\pages\Recipients.tsx` — show current total, confirmed total, and delta in `中通发货明细`.
- Modify: `frontend\src\pages\Dashboard.tsx` — route old `发货` action into the shipping-details execution surface.
- Optional modify: `frontend\src\pages\ShippingPreview.tsx` — downgrade to redirect/notice page if route must remain.
- Modify: `docs\technical.md`, `docs\requirements.md`, `docs\user-guide.md` — align docs with narrowed scope and new source-of-truth.

## Current branch checkpoint

- Worktree: `C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain`
- Branch: `feature/shipping-report-chain`
- Existing red-test commit: `cf06c3fa0f657cd646c071a97768199f05a59eb3`

Use that commit as the starting point. Do **not** redo the red-test work; continue from there in smaller slices.

## Micro-task sequence

### Task 1: Stabilize the red tests already written

**Files:**
- Modify: `backend\tests\test_report_shipping_chain.py`
- Test: `backend\tests\test_report_shipping_chain.py`

- [ ] **Step 1: Review the current red test file and confirm the exact expected response shape**

```python
# Expected future shape inside get_report(...)
report.confirmation_summary.confirmed_report_total
report.confirmation_summary.confirmed_shipping_total
report.confirmation_summary.confirmed_delta
report.confirmation_summary.confirmed_is_match
report.confirmation_summary.current_shipping_total
report.confirmation_summary.current_delta
report.confirmation_summary.current_is_match
report.confirmation_summary.has_shipping_drift
```

- [ ] **Step 2: Run just the red tests to verify the current failure surface**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py -v
```

Expected: FAIL only on missing confirmation summary fields and shipping export source switch.

- [ ] **Step 3: If the export assertion is still cell-position-coupled, tighten it before moving on**

```python
rows = [
    (ws[f"B{row}"].value, ws[f"E{row}"].value)
    for row in range(2, 10)
    if ws[f"B{row}"].value
]
self.assertIn(("甲", 7), rows)
self.assertIn(("乙", 9), rows)
```

- [ ] **Step 4: Re-run the red tests and the existing delete regression**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py tests\test_issues_delete.py -v
```

Expected: `test_issues_delete.py` PASS; shipping-chain tests remain red for intended missing features only.

- [ ] **Step 5: Commit only if the test file changed**

```powershell
git add -- backend\tests\test_report_shipping_chain.py
git commit -m "test: tighten shipping chain red tests" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add the snapshot model only

**Files:**
- Create: `backend\app\models\issue_audit_snapshot.py`
- Modify: `backend\app\models\issue.py`
- Modify: `backend\app\models\__init__.py`
- Test: `backend\tests\test_report_shipping_chain.py`

- [ ] **Step 1: Write the failing model import/integration expectation**

```python
from app.models import IssueAuditSnapshot

self.assertEqual(IssueAuditSnapshot.__tablename__, "issue_audit_snapshots")
```

- [ ] **Step 2: Run the single test that now expects the model to exist**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_uses_shipping_details_total_and_persists_snapshot -v
```

Expected: FAIL with import/name error for `IssueAuditSnapshot`.

- [ ] **Step 3: Add the minimal model and relationship wiring**

```python
# backend\app\models\issue_audit_snapshot.py
class IssueAuditSnapshot(Base):
    __tablename__ = "issue_audit_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_type = Column(String(20), nullable=False, index=True)
    report_total = Column(Integer, nullable=False, default=0)
    shipping_total = Column(Integer, nullable=False, default=0)
    delta = Column(Integer, nullable=False, default=0)
    is_match = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    issue = relationship("Issue", back_populates="audit_snapshots")
```

```python
# backend\app\models\issue.py
audit_snapshots = relationship("IssueAuditSnapshot", back_populates="issue", cascade="all, delete-orphan")
```

- [ ] **Step 4: Re-run the targeted test**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_uses_shipping_details_total_and_persists_snapshot -v
```

Expected: still FAIL, but now on missing API/schema behavior rather than missing model/table wiring.

- [ ] **Step 5: Commit the model slice**

```powershell
git add -- backend\app\models\issue_audit_snapshot.py backend\app\models\issue.py backend\app\models\__init__.py
git commit -m "feat: add issue audit snapshot model" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Add Pydantic schema for confirmation summary only

**Files:**
- Create: `backend\app\schemas\audit_snapshot.py`
- Modify: `backend\app\schemas\report.py`
- Test: `backend\tests\test_report_shipping_chain.py`

- [ ] **Step 1: Write the missing-schema expectation in the red test file if needed**

```python
self.assertTrue(hasattr(report, "confirmation_summary"))
```

- [ ] **Step 2: Run the targeted confirmation test**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_uses_shipping_details_total_and_persists_snapshot -v
```

Expected: FAIL on missing `confirmation_summary` shape.

- [ ] **Step 3: Add the minimal response models**

```python
# backend\app\schemas\audit_snapshot.py
class ConfirmationSummary(BaseModel):
    confirmed_report_total: int
    confirmed_shipping_total: int
    confirmed_delta: int
    confirmed_is_match: bool
    current_shipping_total: int
    current_delta: int
    current_is_match: bool
    has_shipping_drift: bool
```

```python
# backend\app\schemas\report.py
class ReportDataOut(BaseModel):
    ...
    confirmation_summary: Optional[ConfirmationSummary] = None
```

- [ ] **Step 4: Re-run the targeted confirmation test**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_uses_shipping_details_total_and_persists_snapshot -v
```

Expected: FAIL now on `get_report()` not populating the field.

- [ ] **Step 5: Commit the schema slice**

```powershell
git add -- backend\app\schemas\audit_snapshot.py backend\app\schemas\report.py
git commit -m "feat: add confirmation summary schema" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Persist confirmation snapshot in `confirm_report()`

**Files:**
- Modify: `backend\app\api\reports.py`
- Test: `backend\tests\test_report_shipping_chain.py`

- [ ] **Step 1: Run the targeted confirmation test to capture the current failure**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_uses_shipping_details_total_and_persists_snapshot -v
```

Expected: FAIL because no snapshot row is written and `get_report()` cannot return confirmed values.

- [ ] **Step 2: Add the minimal snapshot write inside `confirm_report()`**

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

- [ ] **Step 3: Re-run the targeted confirmation test**

Run:

```powershell
Set-Location C:\Users\\luyal\\Repos\\FirstTry\\.worktrees\\shipping-report-chain\\backend
& 'C:\\Users\\luyal\\Repos\\FirstTry\\backend\\venv\\Scripts\\python.exe' -m pytest tests\\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_uses_shipping_details_total_and_persists_snapshot -v
```

Expected: still FAIL, but now because `get_report()` is not loading the snapshot row into `confirmation_summary`.

- [ ] **Step 4: Run the mismatch test too**

Run:

```powershell
Set-Location C:\Users\\luyal\\Repos\\FirstTry\\.worktrees\\shipping-report-chain\\backend
& 'C:\\Users\\luyal\\Repos\\FirstTry\\backend\\venv\\Scripts\\python.exe' -m pytest tests\\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_mismatch_is_saved_for_future_drift_display -v
```

Expected: still FAIL for the same missing read-path reason.

- [ ] **Step 5: Commit the confirmation write slice**

```powershell
git add -- backend\app\api\reports.py
git commit -m "feat: persist report confirmation snapshot" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Load confirmation summary and current drift in `get_report()`

**Files:**
- Modify: `backend\app\api\reports.py`
- Test: `backend\tests\test_report_shipping_chain.py`

- [ ] **Step 1: Read the latest confirm snapshot plus current shipping total**

```python
latest_confirmation = (
    db.query(IssueAuditSnapshot)
    .filter(IssueAuditSnapshot.issue_id == issue.id, IssueAuditSnapshot.snapshot_type == "confirm")
    .order_by(IssueAuditSnapshot.created_at.desc(), IssueAuditSnapshot.id.desc())
    .first()
)

current_shipping_total = (
    db.query(func.coalesce(func.sum(ShippingDetail.quantity), 0))
    .filter(ShippingDetail.issue_number == issue.issue_number)
    .scalar()
)
```

- [ ] **Step 2: Populate `confirmation_summary`**

```python
confirmation_summary = None
if latest_confirmation:
    current_delta = latest_confirmation.report_total - current_shipping_total
    confirmation_summary = ConfirmationSummary(
        confirmed_report_total=latest_confirmation.report_total,
        confirmed_shipping_total=latest_confirmation.shipping_total,
        confirmed_delta=latest_confirmation.delta,
        confirmed_is_match=latest_confirmation.is_match,
        current_shipping_total=current_shipping_total,
        current_delta=current_delta,
        current_is_match=current_delta == 0,
        has_shipping_drift=current_shipping_total != latest_confirmation.shipping_total,
    )
```

- [ ] **Step 3: Re-run the two confirmation tests**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_uses_shipping_details_total_and_persists_snapshot tests\test_report_shipping_chain.py::ReportShippingChainTests::test_confirm_mismatch_is_saved_for_future_drift_display -v
```

Expected: both PASS; export test still FAIL.

- [ ] **Step 4: Run the full shipping-chain test file**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py -v
```

Expected: 2 PASS, 1 FAIL (shipping export still using old source).

- [ ] **Step 5: Commit the read-path slice**

```powershell
git add -- backend\app\api\reports.py
git commit -m "feat: expose confirmed and current shipping totals" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Switch shipping Excel export to `shipping_details`

**Files:**
- Modify: `backend\app\services\excel_service.py`
- Test: `backend\tests\test_report_shipping_chain.py`

- [ ] **Step 1: Run only the export test**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_shipping_export_reads_shipping_details_instead_of_shipping_records -v
```

Expected: FAIL because workbook cells are empty or sourced from `shipping_records`.

- [ ] **Step 2: Replace workbook source rows with `ShippingDetail` rows**

```python
details = (
    db.query(ShippingDetail)
    .filter(ShippingDetail.issue_number == issue.issue_number)
    .order_by(ShippingDetail.id)
    .all()
)
```

```python
def _write_sheet(ws, items, start_row=2):
    for i, detail in enumerate(items):
        row = start_row + i
        ws.cell(row=row, column=1, value=i + 1)
        ws.cell(row=row, column=2, value=detail.name)
        ws.cell(row=row, column=3, value=detail.phone or "")
        ws.cell(row=row, column=4, value=detail.address or "")
        ws.cell(row=row, column=5, value=detail.quantity)
```

- [ ] **Step 3: Re-run the export test**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_shipping_export_reads_shipping_details_instead_of_shipping_records -v
```

Expected: PASS.

- [ ] **Step 4: Re-run the full backend regression set**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py tests\test_issues_delete.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit the export source switch**

```powershell
git add -- backend\app\services\excel_service.py
git commit -m "feat: export shipping workbook from shipping details" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Persist export snapshots

**Files:**
- Modify: `backend\app\api\exports.py`
- Test: `backend\tests\test_report_shipping_chain.py`

- [ ] **Step 1: Add one failing test for export snapshot creation**

```python
response = export_shipping(issue.id, db=db)
snapshot = db.query(IssueAuditSnapshot).filter_by(issue_id=issue.id, snapshot_type="export_shipping").one()
self.assertEqual(snapshot.shipping_total, 16)
```

- [ ] **Step 2: Run the new export snapshot test**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_shipping_export_persists_snapshot -v
```

Expected: FAIL because no export snapshot row is written.

- [ ] **Step 3: Add a tiny helper in `exports.py` and call it from each endpoint**

```python
def _create_export_snapshot(issue: Issue, snapshot_type: str, db: Session) -> None:
    zt_report_total = ...
    zt_shipping_total = ...
    db.add(
        IssueAuditSnapshot(
            issue_id=issue.id,
            snapshot_type=snapshot_type,
            report_total=zt_report_total,
            shipping_total=zt_shipping_total,
            delta=zt_report_total - zt_shipping_total,
            is_match=zt_report_total == zt_shipping_total,
        )
    )
    db.commit()
```

- [ ] **Step 4: Re-run the export snapshot test plus existing export test**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py::ReportShippingChainTests::test_shipping_export_persists_snapshot tests\test_report_shipping_chain.py::ReportShippingChainTests::test_shipping_export_reads_shipping_details_instead_of_shipping_records -v
```

Expected: both PASS.

- [ ] **Step 5: Commit the export snapshot slice**

```powershell
git add -- backend\app\api\exports.py backend\tests\test_report_shipping_chain.py
git commit -m "feat: snapshot shipping and report exports" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 8: Show confirmation totals in `ReportEditor`

**Files:**
- Modify: `frontend\src\pages\ReportEditor.tsx`
- Test: frontend type-check/build

- [ ] **Step 1: Add a summary card above the main report table**

```tsx
{report?.confirmation_summary && (
  <Card style={{ marginBottom: 20 }}>
    <Space direction="vertical" size={8}>
      <Tag color={report.confirmation_summary.confirmed_is_match ? 'green' : 'red'}>
        确认时：报数 {report.confirmation_summary.confirmed_report_total} / 中通 {report.confirmation_summary.confirmed_shipping_total} / 差值 {report.confirmation_summary.confirmed_delta}
      </Tag>
      <Tag color={report.confirmation_summary.has_shipping_drift ? 'orange' : 'blue'}>
        当前中通 {report.confirmation_summary.current_shipping_total} / 当前差值 {report.confirmation_summary.current_delta}
      </Tag>
    </Space>
  </Card>
)}
```

- [ ] **Step 2: Make the confirm warning modal explicit about all three numbers**

```tsx
content: `报数中通合计 ${confirmData.zt_report_total} 份；中通明细合计 ${confirmData.zt_shipping_total} 份；差值 ${confirmData.zt_report_total - confirmData.zt_shipping_total} 份。`,
```

- [ ] **Step 3: Run frontend type-check**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\frontend
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\frontend
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit the report-editor feedback slice**

```powershell
git add -- frontend\src\pages\ReportEditor.tsx
git commit -m "feat: show confirmed shipping totals in report editor" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 9: Show current-vs-confirmed totals in `中通发货明细`

**Files:**
- Modify: `frontend\src\pages\Recipients.tsx`
- Test: frontend type-check/build

- [ ] **Step 1: Add a query for report confirmation summary keyed by selected issue**

```tsx
const { data: reportData } = useQuery({
  queryKey: ['report-summary', currentIssue?.id],
  queryFn: async () => {
    if (!currentIssue?.id) return null;
    const res = await getReport(currentIssue.id);
    return res.data;
  },
  enabled: !!currentIssue?.id,
});
```

- [ ] **Step 2: Add header tags for current total, confirmed total, and delta**

```tsx
<Tag color="blue">当前中通：{details.reduce((sum, d) => sum + (d.quantity ?? 0), 0)} 份</Tag>
{reportData?.confirmation_summary && (
  <>
    <Tag color={reportData.confirmation_summary.confirmed_is_match ? 'green' : 'red'}>
      确认时中通：{reportData.confirmation_summary.confirmed_shipping_total} 份
    </Tag>
    <Tag color={reportData.confirmation_summary.has_shipping_drift ? 'orange' : 'green'}>
      变化：{reportData.confirmation_summary.current_shipping_total - reportData.confirmation_summary.confirmed_shipping_total} 份
    </Tag>
  </>
)}
```

- [ ] **Step 3: Invalidate the new query after create/update/delete/batch actions**

```tsx
queryClient.invalidateQueries({ queryKey: ['report-summary'] });
queryClient.invalidateQueries({ queryKey: ['report'] });
```

- [ ] **Step 4: Run frontend type-check and build**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\frontend
npx tsc --noEmit
npm run build
```

Expected: both PASS.

- [ ] **Step 5: Commit the shipping-details feedback slice**

```powershell
git add -- frontend\src\pages\Recipients.tsx
git commit -m "feat: show shipping drift in shipping details" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 10: Remove the old shipping page from the main workflow

**Files:**
- Modify: `frontend\src\pages\Dashboard.tsx`
- Optional modify: `frontend\src\pages\ShippingPreview.tsx`
- Test: frontend type-check/build

- [ ] **Step 1: Change the dashboard action text and route**

```tsx
<Button
  type="text"
  icon={<SendOutlined />}
  onClick={() => navigate(`/recipients?tab=shipping&issue=${item.issue_number}`)}
  style={{ color: '#86868b' }}
>
  中通明细
</Button>
```

- [ ] **Step 2: If route compatibility is still needed, make `ShippingPreview` redirect**

```tsx
useEffect(() => {
  if (issue?.issue_number) {
    navigate(`/recipients?tab=shipping&issue=${issue.issue_number}`, { replace: true });
  }
}, [issue, navigate]);
```

- [ ] **Step 3: Run frontend type-check**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\frontend
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\frontend
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit the route cleanup**

```powershell
git add -- frontend\src\pages\Dashboard.tsx frontend\src\pages\ShippingPreview.tsx
git commit -m "feat: route shipping actions to shipping details" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 11: Update docs

**Files:**
- Modify: `docs\technical.md`
- Modify: `docs\requirements.md`
- Modify: `docs\user-guide.md`

- [ ] **Step 1: Add the new source-of-truth note to `docs\technical.md`**

```md
## 报数与中通明细链路

- 当前期中通执行面统一为“收件人管理 → 中通发货明细”
- 报数确认只比较：报数中通合计 vs 当期 shipping_details 合计
- shipping_records 不再作为确认或中通 Excel 导出的来源
- issue_audit_snapshots 记录确认与导出时的数量快照
```

- [ ] **Step 2: Update `docs\requirements.md` to reflect deferred subscription integration**

```md
### 当前阶段范围

- 收件人/订阅保留现状
- 本阶段只打通 报数编辑页 ↔ 中通发货明细页
- 后续订单管理系统再接入自动生成链
```

- [ ] **Step 3: Update `docs\user-guide.md` with the actual operator flow**

```md
1. 在“收件人管理 → 中通发货明细”维护当期中通明细
2. 在"印数管理 → 报数编辑页"完成报数录入
3. 点击“确认报数”并查看数量对照提示
4. 分别导出报数文件和中通明细文件
```

- [ ] **Step 4: Run backend and frontend verification one more time**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py tests\test_issues_delete.py -v

Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\frontend
npx tsc --noEmit
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Commit the docs slice**

```powershell
git add -- docs\technical.md docs\requirements.md docs\user-guide.md
git commit -m "docs: document shipping report source of truth" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 12: Final verification and review handoff

**Files:**
- Modify: none required unless fixes are found

- [ ] **Step 1: Inspect the worktree status**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain
git --no-pager status --short
```

Expected: no unexpected modified files.

- [ ] **Step 2: Inspect recent commits**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain
git --no-pager log --oneline -10
```

Expected: shows small, focused commits for tests, model/schema, confirm path, export path, UI, docs.

- [ ] **Step 3: Re-run the full verification set**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\backend
& 'C:\Users\luyal\Repos\FirstTry\backend\venv\Scripts\python.exe' -m pytest tests\test_report_shipping_chain.py tests\test_issues_delete.py -v

Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain\frontend
npx tsc --noEmit
npm run build
```

Expected: all PASS.

- [ ] **Step 4: Request code review**

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain
git --no-pager diff --stat origin/main...HEAD
```

Expected: clean summary of the feature branch change set, ready for review.

- [ ] **Step 5: Finish the development branch**

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\.worktrees\shipping-report-chain
git --no-pager branch --show-current
```

Expected: `feature/shipping-report-chain`, ready for final integration workflow.
