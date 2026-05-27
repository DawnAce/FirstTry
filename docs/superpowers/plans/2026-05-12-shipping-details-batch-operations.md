# Shipping Details Batch Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add batch update and batch delete operations to the ZTO-MF table, including per-record operation logs.

**Architecture:** Add dedicated FastAPI batch endpoints for shipping detail updates and deletes, with schema-level validation and per-record audit logging. Add frontend API clients and Ant Design table row selection with a compact batch toolbar for status, deadline, and delete actions.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, React, TypeScript, Ant Design, TanStack Query.

---

## File Map

- Modify `backend/app/schemas/shipping_detail.py`: add request/response schemas for batch update/delete.
- Modify `backend/app/api/shipping_details.py`: add `/batch-update` and `/batch-delete` endpoints before `/{detail_id}` routes.
- Modify `frontend/src/api/shippingDetails.ts`: add TypeScript request types and API client functions.
- Modify `frontend/src/pages/Recipients.tsx`: add row selection, selected-record toolbar, batch handlers, and cache invalidation.
- Modify `docs/technical.md`: document batch endpoints.
- Modify `docs/user-guide.md`: document user-facing batch workflow.

---

### Task 1: Backend schemas

**Files:**
- Modify: `backend/app/schemas/shipping_detail.py`

- [ ] **Step 1: Add batch schema imports**

Change the import at the top:

```python
from pydantic import BaseModel, Field, model_validator
from typing import Optional
from datetime import datetime
```

- [ ] **Step 2: Add batch request/response schemas after `ShippingDetailUpdate`**

```python
class ShippingDetailBatchPatch(BaseModel):
    status: Optional[str] = None
    deadline: Optional[str] = None

    @model_validator(mode="after")
    def require_at_least_one_field(self):
        if self.status is None and self.deadline is None:
            raise ValueError("At least one update field is required")
        return self


class ShippingDetailBatchUpdate(BaseModel):
    ids: list[int] = Field(min_length=1)
    updates: ShippingDetailBatchPatch


class ShippingDetailBatchDelete(BaseModel):
    ids: list[int] = Field(min_length=1)


class ShippingDetailBatchResult(BaseModel):
    affected_count: int
```

- [ ] **Step 3: Run backend import check**

Run:

```powershell
cd C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -c "from app.schemas.shipping_detail import ShippingDetailBatchUpdate, ShippingDetailBatchDelete, ShippingDetailBatchResult; print('ok')"
```

Expected: `ok`

---

### Task 2: Backend batch endpoints

**Files:**
- Modify: `backend/app/api/shipping_details.py`

- [ ] **Step 1: Import batch schemas**

Change the schema import to include:

```python
from app.schemas.shipping_detail import (
    ShippingDetailBatchDelete,
    ShippingDetailBatchResult,
    ShippingDetailBatchUpdate,
    ShippingDetailCreate,
    ShippingDetailUpdate,
    ShippingDetailOut,
)
```

- [ ] **Step 2: Add helper for missing IDs after `_diff`**

```python
def _ensure_all_ids_found(requested_ids: list[int], details: list[ShippingDetail]) -> None:
    found_ids = {detail.id for detail in details}
    missing_ids = [detail_id for detail_id in requested_ids if detail_id not in found_ids]
    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Shipping detail IDs not found: {', '.join(map(str, missing_ids))}",
        )
```

- [ ] **Step 3: Add batch update endpoint before `@router.put("/{detail_id}")`**

```python
@router.post("/batch-update", response_model=ShippingDetailBatchResult)
def batch_update_shipping_details(
    data: ShippingDetailBatchUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    details = db.query(ShippingDetail).filter(ShippingDetail.id.in_(data.ids)).all()
    _ensure_all_ids_found(data.ids, details)

    update_data = data.updates.model_dump(exclude_unset=True)
    affected_count = 0
    for detail in details:
        old_snapshot = _snapshot(detail)
        for key, value in update_data.items():
            setattr(detail, key, value)
        new_snapshot = _snapshot(detail)
        changes = _diff(old_snapshot, new_snapshot)
        if changes:
            affected_count += 1
            db.add(OperationLog(
                table_name="shipping_details",
                record_id=detail.id,
                record_name=detail.name,
                action="update",
                changes=changes,
                user_id=user.id,
                username=user.username,
            ))

    db.commit()
    return ShippingDetailBatchResult(affected_count=affected_count)
```

- [ ] **Step 4: Add batch delete endpoint before `@router.delete("/{detail_id}")`**

```python
@router.post("/batch-delete", response_model=ShippingDetailBatchResult)
def batch_delete_shipping_details(
    data: ShippingDetailBatchDelete,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    details = db.query(ShippingDetail).filter(ShippingDetail.id.in_(data.ids)).all()
    _ensure_all_ids_found(data.ids, details)

    for detail in details:
        db.add(OperationLog(
            table_name="shipping_details",
            record_id=detail.id,
            record_name=detail.name,
            action="delete",
            changes=_snapshot(detail),
            user_id=user.id,
            username=user.username,
        ))
        db.delete(detail)

    db.commit()
    return ShippingDetailBatchResult(affected_count=len(details))
```

- [ ] **Step 5: Run backend route import check**

Run:

```powershell
cd C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -c "from app.api.shipping_details import router; print('ok')"
```

Expected: `ok`

---

### Task 3: Frontend API client

**Files:**
- Modify: `frontend/src/api/shippingDetails.ts`

- [ ] **Step 1: Add batch types after `ShippingDetailUpdate`**

```ts
export interface ShippingDetailBatchPatch {
  status?: string;
  deadline?: string;
}

export interface ShippingDetailBatchUpdate {
  ids: number[];
  updates: ShippingDetailBatchPatch;
}

export interface ShippingDetailBatchDelete {
  ids: number[];
}

export interface ShippingDetailBatchResult {
  affected_count: number;
}
```

- [ ] **Step 2: Add batch API functions after `deleteShippingDetail`**

```ts
export const batchUpdateShippingDetails = (
  data: ShippingDetailBatchUpdate,
): Promise<AxiosResponse<ShippingDetailBatchResult>> =>
  api.post<ShippingDetailBatchResult>('/shipping-details/batch-update', data);

export const batchDeleteShippingDetails = (
  data: ShippingDetailBatchDelete,
): Promise<AxiosResponse<ShippingDetailBatchResult>> =>
  api.post<ShippingDetailBatchResult>('/shipping-details/batch-delete', data);
```

- [ ] **Step 3: Run TypeScript check**

Run:

```powershell
cd C:\Users\luyal\Repos\FirstTry\frontend
npx tsc --noEmit
```

Expected: no errors.

---

### Task 4: Frontend batch UI

**Files:**
- Modify: `frontend/src/pages/Recipients.tsx`

- [ ] **Step 1: Import new API functions and table key type**

Update imports:

```ts
import type { TableColumnsType, TableProps } from 'antd';
```

Add API imports:

```ts
  batchUpdateShippingDetails,
  batchDeleteShippingDetails,
```

- [ ] **Step 2: Add selected rows state in `ShippingDetailsTab`**

```ts
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeadline, setBatchDeadline] = useState<dayjs.Dayjs | null>(null);
```

- [ ] **Step 3: Add cache refresh helper after `handleDelete`**

```ts
  const refreshShippingDetails = () => {
    queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
    queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
    queryClient.invalidateQueries({ queryKey: ['operationLogs'] });
  };
```

Then replace existing repeated invalidations in create/update/delete handlers with `refreshShippingDetails();`.

- [ ] **Step 4: Add batch handlers after `handleSubmit`**

```ts
  const getSelectedIds = () => selectedRowKeys.map((key) => Number(key));

  const handleBatchStatus = async (status: string) => {
    try {
      const res = await batchUpdateShippingDetails({
        ids: getSelectedIds(),
        updates: { status },
      });
      message.success(`已更新 ${res.data.affected_count} 条记录`);
      setSelectedRowKeys([]);
      refreshShippingDetails();
    } catch {
      message.error('批量修改状态失败');
    }
  };

  const handleBatchDeadline = async () => {
    if (!batchDeadline) {
      message.warning('请选择截止日期');
      return;
    }
    try {
      const res = await batchUpdateShippingDetails({
        ids: getSelectedIds(),
        updates: { deadline: batchDeadline.format('YYYY-MM-DD') },
      });
      message.success(`已更新 ${res.data.affected_count} 条记录`);
      setBatchDeadline(null);
      setSelectedRowKeys([]);
      refreshShippingDetails();
    } catch {
      message.error('批量修改截止日期失败');
    }
  };

  const handleBatchDelete = async () => {
    try {
      const res = await batchDeleteShippingDetails({ ids: getSelectedIds() });
      message.success(`已删除 ${res.data.affected_count} 条记录`);
      setSelectedRowKeys([]);
      refreshShippingDetails();
    } catch {
      message.error('批量删除失败');
    }
  };
```

- [ ] **Step 5: Add `rowSelection` before `shippingColumns`**

```ts
  const rowSelection: TableProps<ShippingDetail>['rowSelection'] = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };
```

- [ ] **Step 6: Add batch toolbar above the `Card`**

Insert after the filter bar closing `</div>` and before `<Card>`:

```tsx
      {selectedRowKeys.length > 0 && (
        <div style={{
          marginBottom: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '12px 16px',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
        }}>
          <span style={{ color: '#666' }}>已选 {selectedRowKeys.length} 条</span>
          <Button size="small" onClick={() => handleBatchStatus('正常')}>设为正常</Button>
          <Button size="small" danger onClick={() => handleBatchStatus('停发')}>设为停发</Button>
          <DatePicker
            size="small"
            placeholder="选择截止日期"
            value={batchDeadline}
            onChange={setBatchDeadline}
          />
          <Button size="small" onClick={handleBatchDeadline}>修改截止日期</Button>
          <Popconfirm title={`确认删除选中的 ${selectedRowKeys.length} 条记录？`} onConfirm={handleBatchDelete}>
            <Button size="small" danger>批量删除</Button>
          </Popconfirm>
          <Button size="small" type="link" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
        </div>
      )}
```

- [ ] **Step 7: Attach row selection to table**

Add prop:

```tsx
          rowSelection={rowSelection}
```

- [ ] **Step 8: Run frontend type check**

Run:

```powershell
cd C:\Users\luyal\Repos\FirstTry\frontend
npx tsc --noEmit
```

Expected: no errors.

---

### Task 5: Documentation

**Files:**
- Modify: `docs/technical.md`
- Modify: `docs/user-guide.md`

- [ ] **Step 1: Update technical API docs**

In `docs/technical.md` under “4.11 ZTO-MF”, add:

```markdown
#### POST /api/shipping-details/batch-update
批量更新发货明细字段。当前支持批量更新 `status` 和 `deadline`。每条实际发生变化的记录都会写入操作日志。

**请求体**：
```json
{
  "ids": [1, 2, 3],
  "updates": {
    "status": "停发",
    "deadline": "2026-06-30"
  }
}
```

**响应**：`{"affected_count": 3}`

#### POST /api/shipping-details/batch-delete
批量删除发货明细记录。每条被删除的记录都会写入操作日志。

**请求体**：
```json
{
  "ids": [1, 2, 3]
}
```

**响应**：`{"affected_count": 3}`
```

- [ ] **Step 2: Update user guide**

In `docs/user-guide.md`, add a short subsection to the recipient/shipping detail area:

```markdown
### 批量操作ZTO-MF

在“物流管理 - ZTO-MF”中，可以勾选多条记录后进行批量操作：

- 设为正常
- 设为停发
- 修改截止日期
- 批量删除

批量删除会弹出确认框。批量修改和删除都会自动写入每条记录的操作日志。
```

- [ ] **Step 3: Commit docs and code**

Run:

```powershell
cd C:\Users\luyal\Repos\FirstTry
git add backend/app/schemas/shipping_detail.py backend/app/api/shipping_details.py frontend/src/api/shippingDetails.ts frontend/src/pages/Recipients.tsx docs/technical.md docs/user-guide.md
git commit -m "feat: add shipping detail batch operations`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Final verification

**Files:**
- No edits expected.

- [ ] **Step 1: Run frontend type check**

Run:

```powershell
cd C:\Users\luyal\Repos\FirstTry\frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run backend import checks**

Run:

```powershell
cd C:\Users\luyal\Repos\FirstTry\backend
.\venv\Scripts\python.exe -c "from app.main import app; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Check git status**

Run:

```powershell
cd C:\Users\luyal\Repos\FirstTry
git --no-pager status --short
```

Expected: no output.

