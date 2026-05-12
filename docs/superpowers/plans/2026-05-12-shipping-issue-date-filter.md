# Shipping Issue Date Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an issue publish-date picker to the “中通发货明细” filters that selects and reflects the current issue number.

**Architecture:** Keep the implementation in `ShippingDetailsTab` because this is a local UI state change. Reuse the existing `/issues` data from `getIssues(0, 100)`, derive the current issue and date from `currentIssueNumber`, and update `selectedIssueNumber` from either DatePicker or Select.

**Tech Stack:** React 19, TypeScript, Ant Design `DatePicker` and `Select`, TanStack Query, dayjs.

---

## File Structure

- Modify `frontend/src/pages/Recipients.tsx`: add the derived current issue/date state, a shared issue selection handler, and the DatePicker control before the issue Select.
- No backend changes are needed because `Issue.publish_date` is already returned by `frontend/src/api/issues.ts`.
- No documentation changes beyond the design and plan are needed because this is a small workflow improvement inside an existing page.

## Task 1: Add derived issue date state and shared selection handlers

**Files:**
- Modify: `frontend/src/pages/Recipients.tsx:107-112`

- [ ] **Step 1: Confirm existing frontend type-check baseline**

Run:

```powershell
cd frontend && npx tsc --noEmit
```

Expected: command exits successfully. If it fails on unrelated existing errors, record the exact errors before editing.

- [ ] **Step 2: Add current issue and date derivation**

In `frontend/src/pages/Recipients.tsx`, replace the current `currentIssueNumber` memo block:

```tsx
  const currentIssueNumber = useMemo(() => {
    if (selectedIssueNumber != null && issues.some((issue) => issue.issue_number === selectedIssueNumber)) {
      return selectedIssueNumber;
    }
    return issues[0]?.issue_number;
  }, [issues, selectedIssueNumber]);
```

with:

```tsx
  const currentIssue = useMemo(() => {
    if (selectedIssueNumber != null) {
      const selectedIssue = issues.find((issue) => issue.issue_number === selectedIssueNumber);
      if (selectedIssue) return selectedIssue;
    }
    return issues[0];
  }, [issues, selectedIssueNumber]);

  const currentIssueNumber = currentIssue?.issue_number;
  const currentIssueDate = currentIssue?.publish_date ? dayjs(currentIssue.publish_date) : null;

  const selectIssue = (issueNumber: number) => {
    setSelectedIssueNumber(issueNumber);
    setShippingFilters((f) => ({ ...f, company: undefined }));
  };
```

This preserves the default behavior of selecting the newest issue when no explicit issue is selected.

- [ ] **Step 3: Add date-to-issue handler**

Immediately after `selectIssue`, add:

```tsx
  const handleIssueDateChange = (date: dayjs.Dayjs | null) => {
    if (!date) return;
    const issue = issues.find((item) => dayjs(item.publish_date).isSame(date, 'day'));
    if (!issue) {
      message.warning('该日期暂无已创建期数');
      return;
    }
    selectIssue(issue.issue_number);
  };
```

The function keeps the existing issue when the selected date has no matching created issue.

- [ ] **Step 4: Run type check for handler types**

Run:

```powershell
cd frontend && npx tsc --noEmit
```

Expected: command exits successfully.

## Task 2: Add DatePicker and wire Select through shared handler

**Files:**
- Modify: `frontend/src/pages/Recipients.tsx:325-341`

- [ ] **Step 1: Insert the publish date picker before the issue Select**

In the filter toolbar, immediately before the existing `<Select placeholder="期号" ...>`, add:

```tsx
        <DatePicker
          placeholder="出刊日期"
          style={{ width: 150 }}
          loading={issuesLoading}
          disabled={issues.length === 0}
          value={currentIssueDate}
          onChange={handleIssueDateChange}
        />
```

- [ ] **Step 2: Replace duplicated issue Select onChange logic**

In the existing issue Select, replace:

```tsx
          onChange={(value) => {
            setSelectedIssueNumber(value);
            setShippingFilters((f) => ({ ...f, company: undefined }));
          }}
```

with:

```tsx
          onChange={selectIssue}
```

- [ ] **Step 3: Include publish date in issue option labels**

Replace each issue option label:

```tsx
              第 {issue.issue_number} 期
```

with:

```tsx
              第 {issue.issue_number} 期（{dayjs(issue.publish_date).format('YYYY-MM-DD')}）
```

This keeps the Select useful when users still prefer issue-based browsing.

- [ ] **Step 4: Run frontend type check**

Run:

```powershell
cd frontend && npx tsc --noEmit
```

Expected: command exits successfully.

## Task 3: Verify behavior and commit implementation

**Files:**
- Verify: `frontend/src/pages/Recipients.tsx`

- [ ] **Step 1: Verify the specific date mapping in code/data path**

Run:

```powershell
cd frontend && npx tsc --noEmit
```

Expected: command exits successfully. The implementation compares `Issue.publish_date` by day, so an `Issue` with `publish_date` `2026-04-27` selects issue number `2649`.

- [ ] **Step 2: Inspect final diff**

Run:

```powershell
git --no-pager diff -- frontend\src\pages\Recipients.tsx docs\superpowers\plans\2026-05-12-shipping-issue-date-filter.md
```

Expected: diff only contains the DatePicker/issue selection implementation and this plan.

- [ ] **Step 3: Commit implementation**

Run:

```powershell
git add frontend\src\pages\Recipients.tsx docs\superpowers\plans\2026-05-12-shipping-issue-date-filter.md
git commit -m "feat: link shipping issue filter to publish date" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds.
