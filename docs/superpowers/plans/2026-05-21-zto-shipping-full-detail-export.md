# ZTO Shipping Full Detail Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change ZTO-MF Excel export to a single “ZTO-MF” sheet containing all current business fields.

**Architecture:** Keep the existing FastAPI export endpoint and export snapshot behavior. Replace only the Excel workbook layout inside `export_shipping_excel()` with a generated single-sheet workbook driven by a stable field mapping. Tests assert sheet names, headers, and representative field values.

**Tech Stack:** FastAPI, SQLAlchemy, openpyxl, Python unittest.

---

## File Structure

- Modify `backend/app/services/excel_service.py`: add a shipping export field mapping and write a single full-detail sheet.
- Modify `backend/tests/test_report_shipping_chain.py`: update existing export format assertions and add a full-header/value regression test.
- Modify `docs/user-guide.md`: describe the new one-sheet full-field export.

---

### Task 1: Add failing backend export format test

**Files:**
- Modify: `backend/tests/test_report_shipping_chain.py`

- [ ] **Step 1: Replace the old sheet-specific export test**

In `backend/tests/test_report_shipping_chain.py`, replace `test_shipping_export_reads_shipping_details_instead_of_shipping_records` with:

```python
    def test_shipping_export_writes_single_full_detail_sheet(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3002, publish_date=date(2026, 6, 1), status=IssueStatus.confirmed)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ShippingDetail(
                    issue_number=3002,
                    sheet_name="原始表",
                    channel="渠道订阅",
                    sub_channel="监管",
                    transport="中通物流",
                    frequency="周",
                    status="正常",
                    name="甲",
                    address="北京市朝阳区测试路1号",
                    phone="13800000000",
                    quantity=7,
                    deadline="长期",
                    notes="备注",
                    extra_info="附加信息",
                    city="北京",
                    station_name="北京站",
                    station_hall="A厅",
                    contact_person="联系人甲",
                    seq_number=12,
                    period_count=3,
                    confirmation="已确认",
                    company="测试公司",
                ),
                ShippingDetail(issue_number=3002, sheet_name="测试", channel="对公订阅", name="乙", quantity=9),
            ]
        )
        db.commit()

        response = export_shipping(issue.id, db=db)

        self.assertIn(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            response.media_type,
        )
        workbook = load_workbook(io.BytesIO(self._read_streaming_response_bytes(response)))
        self.assertEqual(workbook.sheetnames, ["ZTO-MF"])

        sheet = workbook["ZTO-MF"]
        headers = [sheet.cell(row=1, column=col).value for col in range(1, 25)]
        self.assertEqual(
            headers,
            [
                "序号",
                "期号",
                "原工作表",
                "渠道",
                "子渠道",
                "签约公司",
                "姓名",
                "电话",
                "地址",
                "份数",
                "频率",
                "运输方式",
                "发货时间",
                "截止日期",
                "状态",
                "备注",
                "附加信息",
                "城市",
                "站点",
                "站厅",
                "联系人",
                "高铁序号",
                "期数",
                "信息确认",
            ],
        )
        first_row = [sheet.cell(row=2, column=col).value for col in range(1, 25)]
        self.assertEqual(
            first_row,
            [
                1,
                3002,
                "原始表",
                "渠道订阅",
                "监管",
                "测试公司",
                "甲",
                "13800000000",
                "北京市朝阳区测试路1号",
                7,
                "周",
                "中通物流",
                "",
                "长期",
                "正常",
                "备注",
                "附加信息",
                "北京",
                "北京站",
                "A厅",
                "联系人甲",
                12,
                3,
                "已确认",
            ],
        )
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
cd backend
venv\Scripts\python.exe -m unittest tests.test_report_shipping_chain.ReportShippingChainTests.test_shipping_export_writes_single_full_detail_sheet
```

Expected: FAIL because the workbook still contains old sheets such as `每周合计` and old 5-column headers.

---

### Task 2: Implement single-sheet full-detail export

**Files:**
- Modify: `backend/app/services/excel_service.py`

- [ ] **Step 1: Add the field mapping**

Near the top of `backend/app/services/excel_service.py`, after `TEMPLATE_DIR`, add:

```python
SHIPPING_DETAIL_EXPORT_COLUMNS: list[tuple[str, str | None]] = [
    ("序号", None),
    ("期号", "issue_number"),
    ("原工作表", "sheet_name"),
    ("渠道", "channel"),
    ("子渠道", "sub_channel"),
    ("签约公司", "company"),
    ("姓名", "name"),
    ("电话", "phone"),
    ("地址", "address"),
    ("份数", "quantity"),
    ("频率", "frequency"),
    ("运输方式", "transport"),
    ("发货时间", "shipped_at"),
    ("截止日期", "deadline"),
    ("状态", "status"),
    ("备注", "notes"),
    ("附加信息", "extra_info"),
    ("城市", "city"),
    ("站点", "station_name"),
    ("站厅", "station_hall"),
    ("联系人", "contact_person"),
    ("高铁序号", "seq_number"),
    ("期数", "period_count"),
    ("信息确认", "confirmation"),
]
```

- [ ] **Step 2: Replace the shipping export body**

In `export_shipping_excel()`, replace the template loading, grouping, `_write_sheet()`, and old sheet writing block with:

```python
    wb = Workbook()
    ws = wb.active
    ws.title = "ZTO-MF"

    details = (
        db.query(ShippingDetail)
        .filter(ShippingDetail.issue_number == issue.issue_number)
        .order_by(ShippingDetail.id)
        .all()
    )

    for col, (header, _) in enumerate(SHIPPING_DETAIL_EXPORT_COLUMNS, start=1):
        ws.cell(row=1, column=col, value=header)

    for row_index, detail in enumerate(details, start=2):
        for col, (_, field_name) in enumerate(SHIPPING_DETAIL_EXPORT_COLUMNS, start=1):
            if field_name is None:
                value = row_index - 1
            else:
                value = getattr(detail, field_name)
                if field_name == "shipped_at" and value:
                    value = value.strftime("%Y-%m-%d")
                if value is None:
                    value = ""
            ws.cell(row=row_index, column=col, value=value)
```

Keep the existing `output = io.BytesIO()` save/seek/return block unchanged.

- [ ] **Step 3: Run the test and verify it passes**

Run:

```powershell
cd backend
venv\Scripts\python.exe -m unittest tests.test_report_shipping_chain.ReportShippingChainTests.test_shipping_export_writes_single_full_detail_sheet
```

Expected: PASS.

- [ ] **Step 4: Run related backend tests**

Run:

```powershell
cd backend
venv\Scripts\python.exe -m unittest tests.test_report_shipping_chain
```

Expected: all tests in `test_report_shipping_chain` pass.

---

### Task 3: Update user documentation

**Files:**
- Modify: `docs/user-guide.md`

- [ ] **Step 1: Update the export description**

In `docs/user-guide.md`, under `#### 导出发货明细`, replace the old sheet-check instructions with:

```markdown
1. 在「物流管理」→「ZTO-MF」选择期号后，点击"导出"按钮下载 `第2635期发货明细.xlsx`
2. 导出的 Excel 只包含一个「ZTO-MF」sheet
3. 表头包含当前系统维护的业务字段：期号、原工作表、渠道、子渠道、签约公司、姓名、电话、地址、份数、频率、运输方式、发货时间、截止日期、状态、备注、附加信息、城市、站点、站厅、联系人、高铁序号、期数、信息确认
4. 系统会同时记录一条 `shipping_export` 导出快照
5. 检查明细字段和总份数是否正确
```

- [ ] **Step 2: Run final verification**

Run:

```powershell
cd backend
venv\Scripts\python.exe -m unittest tests.test_report_shipping_chain
cd ..\frontend
npm test -- exports.test.ts
npx tsc --noEmit
```

Expected: backend tests pass, frontend export tests pass, TypeScript passes.

- [ ] **Step 3: Commit**

Run:

```powershell
git add backend\app\services\excel_service.py backend\tests\test_report_shipping_chain.py docs\user-guide.md
git commit -m "fix: export full zto shipping detail fields" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds with the service, test, and documentation changes.
