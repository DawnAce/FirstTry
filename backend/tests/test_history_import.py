import io
import unittest

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


if __name__ == "__main__":
    unittest.main()
