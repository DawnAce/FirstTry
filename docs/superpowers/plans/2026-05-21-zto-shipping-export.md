# ZTO Shipping Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a direct export button on the ZTO-MF page that downloads the selected issue's full ZTO-MF Excel.

**Architecture:** Reuse the existing backend export endpoint `/api/issues/{issue_id}/export/shipping` and existing Excel generation service. Add a small tested frontend export URL helper, then add a UI entry point in `ShippingDetailsTab` using the already-loaded `currentIssue.id` for the selected issue. Documentation updates describe the new user-facing workflow.

**Tech Stack:** React 19, TypeScript, Ant Design 6, TanStack Query, FastAPI, openpyxl.

---

## File Structure

- Modify `frontend/package.json` and `frontend/package-lock.json`: add Vitest and a `test` script.
- Create `frontend/src/api/exports.test.ts`: test the ZTO-MF export URL helper.
- Create `frontend/src/api/exports.ts`: provide the tested `getIssueShippingExportUrl()` helper.
- Modify `frontend/src/pages/Recipients.tsx`: add `DownloadOutlined`, add `handleExportShipping`, and render a “导出” button next to “新增”.
- Modify `docs/user-guide.md`: document exporting from the ZTO-MF tab.
- No backend changes: `backend/app/api/exports.py` and `backend/app/services/excel_service.py` already implement the required export.

---

### Task 1: Add frontend test framework and tested export URL helper

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/api/exports.test.ts`
- Create: `frontend/src/api/exports.ts`

- [ ] **Step 1: Install Vitest**

Run:

```powershell
cd frontend
npm install --save-dev vitest
```

Expected: `package.json` and `package-lock.json` are updated.

- [ ] **Step 2: Add the test script**

In `frontend/package.json`, add:

```json
"test": "vitest run"
```

inside `scripts`, after the existing `preview` script with a comma before it.

- [ ] **Step 3: Write the failing test**

Create `frontend/src/api/exports.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getIssueShippingExportUrl } from './exports';

describe('getIssueShippingExportUrl', () => {
  it('builds the existing shipping export endpoint for an issue', () => {
    expect(getIssueShippingExportUrl(2649)).toBe('/api/issues/2649/export/shipping');
  });
});
```

- [ ] **Step 4: Run the test and verify it fails**

Run:

```powershell
cd frontend
npm test -- exports.test.ts
```

Expected: FAIL because `./exports` does not exist or does not export `getIssueShippingExportUrl`.

- [ ] **Step 5: Add the minimal helper**

Create `frontend/src/api/exports.ts`:

```ts
export const getIssueShippingExportUrl = (issueId: number) =>
  `/api/issues/${issueId}/export/shipping`;
```

- [ ] **Step 6: Run the test and verify it passes**

Run:

```powershell
cd frontend
npm test -- exports.test.ts
```

Expected: PASS for `getIssueShippingExportUrl`.

---

### Task 2: Add the export button to ZTO-MF

**Files:**
- Modify: `frontend/src/pages/Recipients.tsx`

- [ ] **Step 1: Update the icon import**

In `frontend/src/pages/Recipients.tsx`, replace the Ant Design icon import:

```tsx
import { PlusOutlined, PauseCircleOutlined, CaretRightOutlined, SearchOutlined, DeleteOutlined, EditOutlined, HistoryOutlined } from '@ant-design/icons';
```

with:

```tsx
import {
  PlusOutlined,
  PauseCircleOutlined,
  CaretRightOutlined,
  SearchOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
```

- [ ] **Step 2: Add the export handler**

Add this import near existing API imports:

```tsx
import { getIssueShippingExportUrl } from '../api/exports';
```

In `ShippingDetailsTab`, after `handleIssueDateChange`, add:

```tsx
  const handleExportShipping = () => {
    if (currentIssue?.id == null) {
      message.warning('请先选择期号');
      return;
    }
    window.open(getIssueShippingExportUrl(currentIssue.id), '_blank');
  };
```

- [ ] **Step 3: Render the export button next to 新增**

In the `.shipping-detail-filter-tail` block, replace:

```tsx
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
              新增
            </Button>
```

with:

```tsx
            <Space size="small">
              <Button
                icon={<DownloadOutlined />}
                onClick={handleExportShipping}
                disabled={currentIssue?.id == null}
              >
                导出
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
                新增
              </Button>
            </Space>
```

- [ ] **Step 4: Run frontend test and type check**

Run:

```powershell
cd frontend
npm test -- exports.test.ts
npx tsc --noEmit
```

Expected: test passes and TypeScript exits successfully with no errors.

- [ ] **Step 5: Commit the UI change**

Run:

```powershell
git add frontend\src\api\exports.test.ts frontend\src\api\exports.ts frontend\src\pages\Recipients.tsx frontend\package.json frontend\package-lock.json
git commit -m "feat: add zto shipping export button" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds and includes only frontend test framework, export helper, test, and UI files.

---

### Task 3: Update user documentation

**Files:**
- Modify: `docs/user-guide.md`

- [ ] **Step 1: Update the 检查发货明细 workflow**

In `docs/user-guide.md`, under `### 2.5 检查发货明细`, add this workflow item near the existing 中通明细 operation instructions:

```markdown
6. 如需导出当前期的完整ZTO-MF，点击筛选面板右侧的“导出”按钮；导出内容为所选期号的全部ZTO-MF，不受当前筛选条件或勾选记录影响
```

- [ ] **Step 2: Run frontend test and type check again**

Run:

```powershell
cd frontend
npm test -- exports.test.ts
npx tsc --noEmit
```

Expected: exits successfully with no TypeScript errors.

- [ ] **Step 3: Commit the documentation change**

Run:

```powershell
git add docs\user-guide.md
git commit -m "docs: document zto shipping export" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds and includes only `docs/user-guide.md`.

---

### Task 4: Final verification

**Files:**
- Verify: `frontend/src/pages/Recipients.tsx`
- Verify: `docs/user-guide.md`

- [ ] **Step 1: Run final frontend checks**

Run:

```powershell
cd frontend
npm test -- exports.test.ts
npx tsc --noEmit
```

Expected: test passes and TypeScript exits successfully with no errors.

- [ ] **Step 2: Review git status**

Run:

```powershell
git --no-pager status --short
```

Expected: no uncommitted changes related to the export feature.
