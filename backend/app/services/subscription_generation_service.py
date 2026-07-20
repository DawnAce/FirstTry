"""邮局订报数据生成模块 · 文件生成（文档 §8 输出 / §9 版式）。

基于批次**当前有效版本**的有效明细，生成四类产物并落盘、登记 artifacts：
1. 北京-YYYY年M月中国经营报订阅汇总+明细+申请.xlsx（北京-汇总 / 北京-明细 / 未到款申请）
2. 北京局订报汇总表.xlsx（按地区：条数/份数/单价/款额）
3. 1-76《中国经营报》集订分送表~YYYY年M月起报~地区.xlsx（仅有订户地区各一张）
4. 北京YY年M月订报明细.zip（邮局汇总 + 全部地区明细）

版式按 §9：宋体11、标题加粗、金额货币两位小数、日期真日期值(yyyy年m月d日)、A4/打印区域。
**签名图片锚点与像素级列宽待黄金样本到位后精修**（本期为规范化可用版本）。
"""

import io
import zipfile
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.worksheet.properties import PageSetupProperties
from sqlalchemy.orm import Session

from app.models import (
    SubscriptionArtifactType,
    SubscriptionBatch,
    SubscriptionGenerationRun,
    SubscriptionImportStatus,
    SubscriptionOutputArtifact,
    SubscriptionRecord,
    SubscriptionRunStatus,
)
from app.services import attachment_service
from app.services import subscription_calc_service as calc

BASE_FONT = "宋体"
FONT_NORMAL = Font(name=BASE_FONT, size=11)
FONT_BOLD = Font(name=BASE_FONT, size=11, bold=True)
CURRENCY_FMT = "0.00"
RULE_VERSION = "v1"
TEMPLATE_VERSION = "v1"


def _cn_date(d: date) -> str:
    return f"{d.year}年{d.month}月{d.day}日"


def _set_col_widths(ws, widths: dict) -> None:
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


def _a4(ws, *, landscape: bool, print_area: str) -> None:
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_area = print_area


def _header_row(ws, row_idx: int, headers: List[str]) -> None:
    for c, h in enumerate(headers, start=1):
        cell = ws.cell(row=row_idx, column=c, value=h)
        cell.font = FONT_BOLD
        cell.alignment = Alignment(horizontal="center", vertical="center")


# --- 各工作簿构建 -----------------------------------------------------------

def _build_workbook(records: List[SubscriptionRecord], batch: SubscriptionBatch, make_date: date) -> bytes:
    """北京-汇总 / 北京-明细 / 未到款申请 三 sheet。"""
    summary = calc.summarize(records)
    wb = Workbook()

    # 北京-汇总（A4 竖版）。
    ws1 = wb.active
    ws1.title = "北京-汇总"
    ws1["A1"] = f"北京-{batch.year}年{batch.start_month}月中国经营报订阅汇总"
    ws1["A1"].font = FONT_BOLD
    _header_row(ws1, 3, ["项目", "条数", "份数", "款额"])
    ws1.cell(row=4, column=1, value="合计").font = FONT_NORMAL
    ws1.cell(row=4, column=2, value=summary["total_count"])
    ws1.cell(row=4, column=3, value=summary["total_copies"])
    amt = ws1.cell(row=4, column=4, value=float(summary["total_amount"]))
    amt.number_format = CURRENCY_FMT
    ws1.cell(row=6, column=1, value=f"制作日期：{_cn_date(make_date)}").font = FONT_NORMAL
    _set_col_widths(ws1, {"A": 16, "B": 24, "C": 28, "D": 24})
    _a4(ws1, landscape=False, print_area="A1:D20")

    # 北京-明细（A4 横版）。
    ws2 = wb.create_sheet("北京-明细")
    headers = ["序号", "收报人", "电话", "地区", "省", "市/区", "详细地址", "邮编", "份数", "月数", "款额", "投递单位"]
    _header_row(ws2, 1, headers)
    valid = [r for r in records if not r.excluded]
    for i, r in enumerate(valid, start=1):
        ws2.append([
            i, r.name, r.phone or "", r.region_name or "", r.province or "",
            " ".join(x for x in [r.city or "", r.district or ""] if x), r.address or "",
            r.postal_code or "", int(r.copies or 0), int(r.months or 0),
            float(r.amount or 0), "",
        ])
        ws2.cell(row=i + 1, column=11).number_format = CURRENCY_FMT
    total_row = len(valid) + 2
    ws2.cell(row=total_row, column=1, value="合计").font = FONT_BOLD
    ws2.cell(row=total_row, column=9, value=summary["total_copies"]).font = FONT_BOLD
    tot = ws2.cell(row=total_row, column=11, value=float(summary["total_amount"]))
    tot.font = FONT_BOLD
    tot.number_format = CURRENCY_FMT
    # 合计行后空两行，写制表人/时间（§9.3 页脚）。
    ws2.cell(row=total_row + 3, column=1, value="制表人：").font = FONT_NORMAL
    ws2.cell(row=total_row + 4, column=1, value=f"时间：{_cn_date(make_date)}").font = FONT_NORMAL
    _set_col_widths(ws2, {"A": 6, "B": 7, "C": 12, "D": 9, "E": 7, "F": 7, "G": 30, "H": 8, "I": 6, "J": 6, "K": 12, "L": 14})
    _a4(ws2, landscape=True, print_area=f"A1:L{total_row + 4}")

    # 未到款申请（A4 竖版）—— 用本批次全部有效订报款（§9.4）。
    ws3 = wb.create_sheet("未到款申请")
    ws3["A1"] = f"未到款申请 · {batch.year}年{batch.start_month}月"
    ws3["A1"].font = FONT_BOLD
    ws3["A3"] = f"份数合计：{summary['total_copies']}"
    ws3["A4"] = "款额合计："
    a4amt = ws3.cell(row=4, column=2, value=float(summary["total_amount"]))
    a4amt.number_format = CURRENCY_FMT
    ws3["A6"] = "发行部（签名）："
    ws3["A8"] = f"制作日期：{_cn_date(make_date)}"
    for r in (3, 4, 6, 8):
        ws3.cell(row=r, column=1).font = FONT_NORMAL
    _set_col_widths(ws3, {"A": 20, "B": 20})
    _a4(ws3, landscape=False, print_area="A1:B20")

    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def _build_postal_summary(records: List[SubscriptionRecord], batch: SubscriptionBatch, unit_price: Decimal) -> bytes:
    """北京局订报汇总表：按地区列条数/份数/单价/款额，合计与明细对平。"""
    summary = calc.summarize(records)
    wb = Workbook()
    ws = wb.active
    ws.title = "北京局订报汇总表"
    ws["A1"] = f"北京局订报汇总表 · {batch.year}年{batch.start_month}月"
    ws["A1"].font = FONT_BOLD
    _header_row(ws, 3, ["地区", "条数", "份数", "单价", "款额"])
    row_idx = 4
    regions = sorted((k for k in summary["by_region"] if k != "(未识别地区)"))
    if "(未识别地区)" in summary["by_region"]:
        regions.append("(未识别地区)")
    for region in regions:
        agg = summary["by_region"][region]
        ws.cell(row=row_idx, column=1, value=region).font = FONT_NORMAL
        ws.cell(row=row_idx, column=2, value=agg["count"])
        ws.cell(row=row_idx, column=3, value=agg["copies"])
        up = ws.cell(row=row_idx, column=4, value=float(unit_price))
        up.number_format = CURRENCY_FMT
        km = ws.cell(row=row_idx, column=5, value=float(agg["amount"]))
        km.number_format = CURRENCY_FMT
        row_idx += 1
    ws.cell(row=row_idx, column=1, value="合计").font = FONT_BOLD
    ws.cell(row=row_idx, column=2, value=summary["total_count"]).font = FONT_BOLD
    ws.cell(row=row_idx, column=3, value=summary["total_copies"]).font = FONT_BOLD
    tk = ws.cell(row=row_idx, column=5, value=float(summary["total_amount"]))
    tk.font = FONT_BOLD
    tk.number_format = CURRENCY_FMT
    _set_col_widths(ws, {"A": 20, "B": 10, "C": 10, "D": 10, "E": 16})
    _a4(ws, landscape=False, print_area=f"A1:E{row_idx}")
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def _build_region_detail(region: str, records: List[SubscriptionRecord], batch: SubscriptionBatch) -> bytes:
    """某地区的集订分送表。"""
    wb = Workbook()
    ws = wb.active
    ws.title = region[:31] or "地区"
    ws["A1"] = f"《中国经营报》集订分送表~{batch.year}年{batch.start_month}月起报~{region}"
    ws["A1"].font = FONT_BOLD
    headers = ["序号", "收报人", "电话", "详细地址", "邮编", "份数", "月数"]
    _header_row(ws, 3, headers)
    row_idx = 4
    total_copies = 0
    for i, r in enumerate(records, start=1):
        ws.cell(row=row_idx, column=1, value=i).font = FONT_NORMAL
        ws.cell(row=row_idx, column=2, value=r.name).font = FONT_NORMAL
        ws.cell(row=row_idx, column=3, value=r.phone or "").font = FONT_NORMAL
        ws.cell(row=row_idx, column=4, value=r.address or "").font = FONT_NORMAL
        ws.cell(row=row_idx, column=5, value=r.postal_code or "").font = FONT_NORMAL
        ws.cell(row=row_idx, column=6, value=int(r.copies or 0)).font = FONT_NORMAL
        ws.cell(row=row_idx, column=7, value=int(r.months or 0)).font = FONT_NORMAL
        total_copies += int(r.copies or 0)
        row_idx += 1
    ws.cell(row=row_idx, column=1, value="合计").font = FONT_BOLD
    ws.cell(row=row_idx, column=6, value=total_copies).font = FONT_BOLD
    _set_col_widths(ws, {"A": 6, "B": 10, "C": 14, "D": 34, "E": 8, "F": 6, "G": 6})
    _a4(ws, landscape=True, print_area=f"A1:G{row_idx}")
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


# --- 编排 -------------------------------------------------------------------

def generate(db: Session, batch: SubscriptionBatch, *, operator_id: Optional[int] = None) -> SubscriptionGenerationRun:
    """基于当前有效版本生成全部产物（同步）。"""
    from fastapi import HTTPException  # 局部导入避免顶层耦合

    if batch.active_version_id is None:
        raise HTTPException(status_code=409, detail="批次尚无当前有效版本，请先上传并设为有效")
    version = next((v for v in batch.versions if v.id == batch.active_version_id), None)
    if version is None or version.status != SubscriptionImportStatus.active:
        raise HTTPException(status_code=409, detail="当前有效版本无效，请重新设为有效")

    records = [r for r in version.records if not r.excluded]
    if not records:
        raise HTTPException(status_code=409, detail="当前有效版本无有效明细，无法生成")

    make_date = batch.make_date or date.today()
    unit_price = batch.unit_price or calc.DEFAULT_PRICE_PER_COPY_MONTH

    run = SubscriptionGenerationRun(
        batch_id=batch.id, version_id=version.id,
        rule_version=RULE_VERSION, template_version=TEMPLATE_VERSION,
        status=SubscriptionRunStatus.running, started_at=datetime.now(),
    )
    db.add(run)
    db.flush()

    # 旧产物标历史（不删）。
    db.query(SubscriptionOutputArtifact).filter(
        SubscriptionOutputArtifact.batch_id == batch.id,
        SubscriptionOutputArtifact.is_historical == False,  # noqa: E712
    ).update({"is_historical": True}, synchronize_session=False)

    yy = batch.year % 100
    m = batch.start_month
    category = f"subscription/{batch.year}-{m:02d}/gen"

    def _store(atype, filename, content, region=None):
        stored = attachment_service.store_file(category, filename, content)
        db.add(SubscriptionOutputArtifact(
            run_id=run.id, batch_id=batch.id, version_id=version.id,
            artifact_type=atype, region_name=region, filename=filename,
            stored_path=stored, sha256=attachment_service.sha256_hex(content),
        ))
        return content

    try:
        wb_bytes = _build_workbook(records, batch, make_date)
        _store(SubscriptionArtifactType.workbook,
               f"北京-{batch.year}年{m}月中国经营报订阅汇总+明细+申请.xlsx", wb_bytes)

        ps_bytes = _build_postal_summary(records, batch, unit_price)
        _store(SubscriptionArtifactType.postal_summary, "北京局订报汇总表.xlsx", ps_bytes)

        # 按地区分表（仅有订户地区）。
        by_region: dict = {}
        for r in records:
            by_region.setdefault(r.region_name or "(未识别地区)", []).append(r)
        region_files = []
        seq = 1
        for region in sorted(by_region):
            rd_bytes = _build_region_detail(region, by_region[region], batch)
            fname = f"{seq}-76《中国经营报》集订分送表~{batch.year}年{m}月起报~{region}.xlsx"
            _store(SubscriptionArtifactType.region_detail, fname, rd_bytes, region=region)
            region_files.append((fname, rd_bytes))
            seq += 1

        # ZIP：邮局汇总 + 全部地区明细。
        zbio = io.BytesIO()
        with zipfile.ZipFile(zbio, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("北京局订报汇总表.xlsx", ps_bytes)
            for fname, content in region_files:
                zf.writestr(fname, content)
        _store(SubscriptionArtifactType.zip, f"北京{yy}年{m}月订报明细.zip", zbio.getvalue())

        run.status = SubscriptionRunStatus.success
        run.ended_at = datetime.now()
        from app.models import SubscriptionBatchStatus
        batch.status = SubscriptionBatchStatus.generated
    except Exception as exc:  # noqa: BLE001
        run.status = SubscriptionRunStatus.failed
        run.ended_at = datetime.now()
        run.error = str(exc)
        db.commit()
        raise HTTPException(status_code=500, detail=f"生成失败：{exc}")

    db.commit()
    db.refresh(run)
    return run
