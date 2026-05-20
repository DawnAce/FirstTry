import io
import unittest
from datetime import date, datetime as _dt

from fastapi import HTTPException
from openpyxl import load_workbook, Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.history_import_cache import get_history_import_session
from app.models import ReportItemTemplate, Issue, IssueStatus, ReportEntry, TempPrintDetail, ShippingDetail
from app.services.history_import_template_service import (
    build_report_import_template,
    build_shipping_import_template,
)
from app.services.history_import_service import preview_history_import, commit_history_import


_SHIPPING_HEADERS = [
    "工作表名称", "渠道", "子渠道", "运输方式", "频次", "状态",
    "姓名", "地址", "电话", "数量", "截止日期", "备注", "附加信息",
    "城市", "网点名称", "网点大厅", "联系人", "序号", "期数", "公司",
]


def _wb_to_bytes(wb: Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_report_upload_with_datetime_date(issue_number: int = 2648) -> bytes:
    """Same structure as build_report_upload but with a datetime cell for publish_date."""
    wb = Workbook()
    basic = wb.active
    basic.title = "基本信息"
    basic.append(["字段", "值"])
    basic.append(["期号", issue_number])
    basic.append(["出版日期", _dt(2026, 4, 20)])   # Excel date cell (datetime object)
    basic.append(["版数", 24])
    basic.append(["备注", ""])

    report = wb.create_sheet("报数项")
    report.append(["分类编码", "分类名称", "项目名称", "去向", "是否变动", "数值"])
    report.append(["postal", "北京邮发", "本市", "邮局", "否", 100])

    temp = wb.create_sheet("临时加印明细")
    temp.append(["部门", "自定义名称", "数量", "自留分发数量"])

    return _wb_to_bytes(wb)


def build_report_upload_with_unknown_row(issue_number: int = 2648) -> bytes:
    """Upload containing one valid row and one row not in any ReportItemTemplate."""
    wb = Workbook()
    basic = wb.active
    basic.title = "基本信息"
    basic.append(["字段", "值"])
    basic.append(["期号", issue_number])
    basic.append(["出版日期", "2026-04-20"])
    basic.append(["版数", 24])
    basic.append(["备注", ""])

    report = wb.create_sheet("报数项")
    report.append(["分类编码", "分类名称", "项目名称", "去向", "是否变动", "数值"])
    report.append(["postal", "北京邮发", "本市", "邮局", "否", 100])         # valid
    report.append(["unknown", "未知分类", "未知项目", "", "否", 5])           # not in templates

    temp = wb.create_sheet("临时加印明细")
    temp.append(["部门", "自定义名称", "数量", "自留分发数量"])

    return _wb_to_bytes(wb)


def build_report_upload(issue_number: int = 2648) -> bytes:
    wb = Workbook()
    basic = wb.active
    basic.title = "基本信息"
    basic.append(["字段", "值"])
    basic.append(["期号", issue_number])
    basic.append(["出版日期", "2026-04-20"])
    basic.append(["版数", 24])
    basic.append(["备注", "测试备注"])

    report = wb.create_sheet("报数项")
    report.append(["分类编码", "分类名称", "项目名称", "去向", "是否变动", "数值"])
    report.append(["postal", "北京邮发", "本市", "邮局", "否", 100])
    report.append(["retail", "北京报零", "西部", "零售点", "是", 50])

    temp = wb.create_sheet("临时加印明细")
    temp.append(["部门", "自定义名称", "数量", "自留分发数量"])
    temp.append(["编辑部", "赠送用", 20, 5])

    return _wb_to_bytes(wb)


def build_report_upload_with_blank_publish_date(issue_number: int = 2648) -> bytes:
    wb = Workbook()
    basic = wb.active
    basic.title = "基本信息"
    basic.append(["字段", "值"])
    basic.append(["期号", issue_number])
    basic.append(["出版日期", ""])
    basic.append(["版数", 24])
    basic.append(["备注", "测试备注"])

    report = wb.create_sheet("报数项")
    report.append(["分类编码", "分类名称", "项目名称", "去向", "是否变动", "数值"])
    report.append(["postal", "北京邮发", "本市", "邮局", "否", 100])

    temp = wb.create_sheet("临时加印明细")
    temp.append(["部门", "自定义名称", "数量", "自留分发数量"])

    return _wb_to_bytes(wb)


def build_report_upload_with_invalid_issue_number(issue_number: str = "第2648期") -> bytes:
    wb = Workbook()
    basic = wb.active
    basic.title = "基本信息"
    basic.append(["字段", "值"])
    basic.append(["期号", issue_number])
    basic.append(["出版日期", "2026-04-20"])
    basic.append(["版数", 24])
    basic.append(["备注", "测试备注"])

    report = wb.create_sheet("报数项")
    report.append(["分类编码", "分类名称", "项目名称", "去向", "是否变动", "数值"])
    report.append(["postal", "北京邮发", "本市", "邮局", "否", 100])

    temp = wb.create_sheet("临时加印明细")
    temp.append(["部门", "自定义名称", "数量", "自留分发数量"])

    return _wb_to_bytes(wb)


def build_shipping_upload(issue_number: int = 2648) -> bytes:
    wb = Workbook()
    basic = wb.active
    basic.title = "基本信息"
    basic.append(["字段", "值"])
    basic.append(["期号", issue_number])
    basic.append(["出版日期", "2026-04-20"])

    detail = wb.create_sheet("发货明细")
    detail.append(_SHIPPING_HEADERS)
    detail.append([
        "发货明细", "邮发", "本市", "中通物流", "每周", "正常",
        "张三", "北京市朝阳区xx路1号", "13800138000", 10,
        "2026-04-19", "", "", "北京", "", "", "", 1, issue_number, "",
    ])

    return _wb_to_bytes(wb)


class HistoryImportTemplateTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def test_report_template_has_expected_sheets(self):
        db = self.SessionLocal()

        template_bytes = build_report_import_template(db)
        workbook = load_workbook(io.BytesIO(template_bytes))

        self.assertEqual(workbook.sheetnames, ["基本信息", "报数项", "临时加印明细"])
        db.close()

    def test_shipping_template_has_expected_sheets(self):
        template_bytes = build_shipping_import_template()
        workbook = load_workbook(io.BytesIO(template_bytes))

        self.assertEqual(workbook.sheetnames, ["基本信息", "发货明细"])

    def test_report_template_uses_required_headers(self):
        db = self.SessionLocal()

        template_bytes = build_report_import_template(db)
        workbook = load_workbook(io.BytesIO(template_bytes))

        self.assertEqual(
            [cell.value for cell in workbook["基本信息"][1]],
            ["字段", "值"],
        )
        self.assertEqual(
            [cell.value for cell in workbook["报数项"][1]],
            ["分类编码", "分类名称", "项目名称", "去向", "是否变动", "数值"],
        )
        self.assertEqual(
            [cell.value for cell in workbook["临时加印明细"][1]],
            ["部门", "自定义名称", "数量", "自留分发数量"],
        )
        db.close()

    def test_report_template_includes_basic_info_notes(self):
        db = self.SessionLocal()

        template_bytes = build_report_import_template(db)
        workbook = load_workbook(io.BytesIO(template_bytes))

        basic_rows = [
            [cell.value for cell in row]
            for row in workbook["基本信息"].iter_rows(values_only=False)
        ]

        self.assertIn(["填写说明", "1. 只填“值”列；2. 报数项只改“数值”列；3. 临时加印总数填在报数项 sheet。"], basic_rows)
        self.assertIn(["临时加印说明", "先在报数项 sheet 填“临时加印”总数；再在“临时加印明细” sheet 按行填写部门、数量、自留分发数量；明细数量合计应等于总数。"], basic_rows)
        self.assertIn(["临时加印示例", "例如总数 20：营报传媒 12、自留 2；财经中心 8、自留 0。没有临时加印时，总数填 0，明细可留空。"], basic_rows)
        db.close()

    def test_shipping_template_uses_required_headers(self):
        template_bytes = build_shipping_import_template()
        workbook = load_workbook(io.BytesIO(template_bytes))

        self.assertEqual(
            [cell.value for cell in workbook["基本信息"][1]],
            ["字段", "值"],
        )
        self.assertEqual(
            [cell.value for cell in workbook["发货明细"][1]],
            [
                "工作表名称",
                "渠道",
                "子渠道",
                "运输方式",
                "频次",
                "状态",
                "姓名",
                "地址",
                "电话",
                "数量",
                "截止日期",
                "备注",
                "附加信息",
                "城市",
                "网点名称",
                "网点大厅",
                "联系人",
                "序号",
                "期数",
                "公司",
            ],
        )

    def test_report_template_rows_keep_category_code_and_label_in_order(self):
        db = self.SessionLocal()
        db.add_all(
            [
                ReportItemTemplate(
                    category="retail",
                    sub_category="西部",
                    display_name="北京报零-西部",
                    default_value=8,
                    is_variable=True,
                    destination="零售点",
                    sort_order=20,
                ),
                ReportItemTemplate(
                    category="postal",
                    sub_category="本市",
                    display_name="北京邮发-本市",
                    default_value=12,
                    is_variable=False,
                    destination="邮局",
                    sort_order=10,
                ),
            ]
        )
        db.commit()

        template_bytes = build_report_import_template(db)
        workbook = load_workbook(io.BytesIO(template_bytes))
        rows = [
            row[:6]
            for row in workbook["报数项"].iter_rows(min_row=2, max_row=3, values_only=True)
        ]

        self.assertEqual(
            rows,
            [
                ("postal", "北京邮发", "本市", "邮局", "否", 12),
                ("retail", "北京报零", "西部", "零售点", "是", 8),
            ],
        )
        db.close()


class HistoryImportPreviewTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def _seed_upload_templates(self, db) -> None:
        """Seed templates that match the rows produced by build_report_upload."""
        db.add_all([
            ReportItemTemplate(
                category="postal", sub_category="本市", display_name="北京邮发-本市",
                default_value=0, is_variable=False, destination="邮局", sort_order=1,
            ),
            ReportItemTemplate(
                category="retail", sub_category="西部", display_name="北京报零-西部",
                default_value=0, is_variable=True, destination="零售点", sort_order=2,
            ),
        ])
        db.commit()

    def test_preview_returns_counts_and_session_id(self):
        db = self.SessionLocal()
        self._seed_upload_templates(db)

        result = preview_history_import(db, build_report_upload(), build_shipping_upload())

        self.assertEqual(result.issue_number, 2648)
        self.assertEqual(result.publish_date, "2026-04-20")
        self.assertEqual(result.report_entry_count, 2)
        self.assertEqual(result.temp_detail_count, 1)
        self.assertEqual(result.shipping_detail_count, 1)
        self.assertTrue(result.can_commit)
        self.assertNotEqual(result.import_session_id, "")
        # readiness object must be present and correctly structured
        self.assertIsNotNone(result.readiness)
        self.assertTrue(result.readiness.same_issue)
        self.assertFalse(result.readiness.issue_exists)
        self.assertTrue(result.readiness.can_commit)
        self.assertEqual(result.readiness.errors, [])
        db.close()

    def test_preview_blocks_duplicate_issue_and_cross_issue_upload(self):
        db = self.SessionLocal()

        # Seed an existing issue to trigger duplicate check
        existing = Issue(
            issue_number=2648,
            publish_date=date(2026, 4, 20),
            status=IssueStatus.confirmed,
        )
        db.add(existing)
        db.commit()

        dup_result = preview_history_import(db, build_report_upload(2648), build_shipping_upload(2648))
        self.assertFalse(dup_result.can_commit)
        self.assertTrue(any("该期已存在" in e for e in dup_result.errors))
        # readiness must reflect the correct state
        self.assertTrue(dup_result.readiness.same_issue)
        self.assertTrue(dup_result.readiness.issue_exists)
        self.assertFalse(dup_result.readiness.can_commit)

        # Cross-issue: report=2648, shipping=2649
        cross_result = preview_history_import(db, build_report_upload(2648), build_shipping_upload(2649))
        self.assertFalse(cross_result.can_commit)
        self.assertTrue(any("两份文件不是同一期" in e for e in cross_result.errors))
        # readiness must reflect cross-issue mismatch
        self.assertFalse(cross_result.readiness.same_issue)
        self.assertFalse(cross_result.readiness.can_commit)

        db.close()

    def test_preview_rejects_rows_with_unknown_template_structure(self):
        db = self.SessionLocal()
        # Seed only the known row; the unknown row has no matching template
        db.add(ReportItemTemplate(
            category="postal", sub_category="本市", display_name="北京邮发-本市",
            default_value=0, is_variable=False, destination="邮局", sort_order=1,
        ))
        db.commit()

        result = preview_history_import(
            db, build_report_upload_with_unknown_row(), build_shipping_upload()
        )

        self.assertFalse(result.can_commit)
        self.assertFalse(result.readiness.can_commit)
        self.assertTrue(result.readiness.same_issue)
        self.assertFalse(result.readiness.issue_exists)
        # Error message should identify the unknown category code
        self.assertTrue(any("unknown" in e for e in result.errors))
        db.close()

    def test_preview_normalizes_excel_datetime_publish_date(self):
        db = self.SessionLocal()
        db.add(ReportItemTemplate(
            category="postal", sub_category="本市", display_name="北京邮发-本市",
            default_value=0, is_variable=False, destination="邮局", sort_order=1,
        ))
        db.commit()

        result = preview_history_import(
            db, build_report_upload_with_datetime_date(), build_shipping_upload()
        )

        self.assertEqual(result.publish_date, "2026-04-20")
        db.close()


    def test_preview_payload_uses_display_name_from_template(self):
        """Cached payload must use display_name from ReportItemTemplate, not the raw Excel label."""
        db = self.SessionLocal()
        self._seed_upload_templates(db)

        result = preview_history_import(db, build_report_upload(), build_shipping_upload())
        self.assertTrue(result.can_commit)

        payload = get_history_import_session(result.import_session_id)
        self.assertIsNotNone(payload)

        postal_row = next(r for r in payload["report_rows"] if r["category"] == "postal")
        self.assertEqual(postal_row["display_name"], "北京邮发-本市")

        retail_row = next(r for r in payload["report_rows"] if r["category"] == "retail")
        self.assertEqual(retail_row["display_name"], "北京报零-西部")

        # category_name must NOT be present in the cached payload (replaced by display_name)
        self.assertNotIn("category_name", postal_row)
        db.close()

    def test_preview_rejects_blank_publish_date(self):
        db = self.SessionLocal()
        db.add(ReportItemTemplate(
            category="postal", sub_category="本市", display_name="北京邮发-本市",
            default_value=0, is_variable=False, destination="邮局", sort_order=1,
        ))
        db.commit()

        result = preview_history_import(
            db, build_report_upload_with_blank_publish_date(), build_shipping_upload()
        )

        self.assertFalse(result.can_commit)
        self.assertFalse(result.readiness.can_commit)
        self.assertTrue(any("出版日期" in e for e in result.errors))
        db.close()

    def test_preview_rejects_non_numeric_issue_number(self):
        db = self.SessionLocal()
        db.add(ReportItemTemplate(
            category="postal", sub_category="本市", display_name="北京邮发-本市",
            default_value=0, is_variable=False, destination="邮局", sort_order=1,
        ))
        db.commit()

        result = preview_history_import(
            db, build_report_upload_with_invalid_issue_number(), build_shipping_upload()
        )

        self.assertFalse(result.can_commit)
        self.assertFalse(result.readiness.can_commit)
        self.assertTrue(any("期号" in e for e in result.errors))
        db.close()

    def test_preview_raises_422_for_invalid_workbook_bytes(self):
        db = self.SessionLocal()

        with self.assertRaises(HTTPException) as ctx:
            preview_history_import(db, b"not-an-xlsx", build_shipping_upload())

        self.assertEqual(ctx.exception.status_code, 422)
        db.close()


class HistoryImportCommitTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def _seed_templates(self, db) -> None:
        db.add_all([
            ReportItemTemplate(
                category="postal", sub_category="本市", display_name="北京邮发-本市",
                default_value=0, is_variable=False, destination="邮局", sort_order=1,
            ),
            ReportItemTemplate(
                category="retail", sub_category="西部", display_name="北京报零-西部",
                default_value=0, is_variable=True, destination="零售点", sort_order=2,
            ),
        ])
        db.commit()

    def test_commit_creates_issue_and_all_records(self):
        """Successful commit creates Issue, ReportEntry, TempPrintDetail, ShippingDetail from session."""
        db = self.SessionLocal()
        self._seed_templates(db)

        preview = preview_history_import(db, build_report_upload(), build_shipping_upload())
        self.assertTrue(preview.can_commit)

        result = commit_history_import(db, preview.import_session_id)

        issue = db.query(Issue).filter(Issue.issue_number == 2648).first()
        self.assertIsNotNone(issue)
        self.assertEqual(issue.issue_number, 2648)
        self.assertEqual(str(issue.publish_date), "2026-04-20")
        self.assertEqual(issue.status, IssueStatus.draft)
        self.assertEqual(issue.page_count, 24)
        self.assertEqual(issue.notes, "测试备注")

        entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue.id).all()
        self.assertEqual(len(entries), 2)
        cats = {e.category for e in entries}
        self.assertIn("postal", cats)
        self.assertIn("retail", cats)

        temps = db.query(TempPrintDetail).filter(TempPrintDetail.issue_id == issue.id).all()
        self.assertEqual(len(temps), 1)
        self.assertEqual(temps[0].department, "编辑部")
        self.assertEqual(temps[0].quantity, 20)

        shipping = db.query(ShippingDetail).filter(ShippingDetail.issue_number == 2648).all()
        self.assertEqual(len(shipping), 1)
        self.assertEqual(shipping[0].channel, "邮发")

        self.assertEqual(result.report_entry_count, 2)
        self.assertEqual(result.temp_detail_count, 1)
        self.assertEqual(result.shipping_detail_count, 1)
        self.assertEqual(result.issue_number, 2648)
        self.assertIsNotNone(result.issue_id)
        db.close()

    def test_commit_raises_400_for_missing_session(self):
        """Missing or expired session raises HTTPException with status_code 400."""
        db = self.SessionLocal()
        with self.assertRaises(HTTPException) as ctx:
            commit_history_import(db, "nonexistent-session-id")
        self.assertEqual(ctx.exception.status_code, 400)
        db.close()

    def test_commit_raises_409_if_issue_already_exists(self):
        """If issue already exists at commit time, raises HTTPException with status_code 409."""
        db = self.SessionLocal()
        self._seed_templates(db)

        preview = preview_history_import(db, build_report_upload(), build_shipping_upload())
        self.assertTrue(preview.can_commit)

        # Simulate issue created between preview and commit (race / double-commit)
        db.add(Issue(
            issue_number=2648,
            publish_date=date(2026, 4, 20),
            status=IssueStatus.draft,
        ))
        db.commit()

        with self.assertRaises(HTTPException) as ctx:
            commit_history_import(db, preview.import_session_id)
        self.assertEqual(ctx.exception.status_code, 409)
        db.close()


if __name__ == "__main__":
    unittest.main()
