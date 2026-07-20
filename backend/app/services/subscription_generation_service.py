"""邮局订报数据生成模块 · 文件生成（严格对齐 7月/8月 黄金样本）。

基于批次**当前有效版本**的有效明细，生成三类产物并落盘、登记 artifacts：
1. 北京-{Y}年{M}月中国经营报订阅汇总+明细+申请.xlsx（北京-汇总 / 北京-明细 / 未到款申请）
2. 北京局订报汇总表.xlsx（代码|报刊名称|订期|省份|条数|份数|单价|款额）
3. 1-76《中国经营报》集订分送表~{Y}年{M}月起报~{地区}.xlsx（仅有订户地区；用邮局模板保留说明页/产品页）
并打包 北京{yy}年{M}月订报明细.zip（邮局汇总 + 全部地区明细）。

金额/汇总**复刻活公式**（明细 =M*N*20、汇总 SUMIF）；单价=N×20，N=13−起始月。
版式：宋体11、标题/表头/合计加粗、A4+打印区域；无签名图片（签名为文字）。
"""

import io
import os
import zipfile
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

import openpyxl
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
from app.services import subscription_import_service as import_svc

BASE_FONT = "宋体"
FN = Font(name=BASE_FONT, size=11)
FB = Font(name=BASE_FONT, size=11, bold=True)
CUR = "0.00"
CENTER = Alignment(horizontal="center", vertical="center")
RULE_VERSION = "v1"
TEMPLATE_VERSION = "v1"
REGION_TEMPLATE = os.path.join(os.path.dirname(__file__), "..", "templates", "postal_region_template.xlsx")


def _cn(d: date) -> str:
    return f"{d.year}年{d.month}月{d.day}日"


def _a4(ws, *, landscape: bool, print_area: str) -> None:
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_area = print_area


def _widths(ws, widths: dict) -> None:
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


def _region_order(records: List[SubscriptionRecord]) -> List[str]:
    """按明细首次出现顺序列出地区（与黄金样本一致）。"""
    order: List[str] = []
    for r in records:
        reg = r.region_name or "(未识别地区)"
        if reg not in order:
            order.append(reg)
    return order


# --- (a) 汇总 + 明细 + 申请 --------------------------------------------------

def _build_workbook(records: List[SubscriptionRecord], batch: SubscriptionBatch, N: int, make_date: date) -> bytes:
    count = len(records)
    total_amount = sum((r.amount or Decimal(0)) for r in records)
    last = count + 1  # 明细数据末行
    mm = f"{batch.start_month:02d}"
    regions = _region_order(records)

    wb = Workbook()

    # --- 北京-明细（先建，供汇总 SUMIF 引用） ---
    det = wb.active
    det.title = "北京-明细"
    headers = ["地区", "姓名", "联系电话", "省", "市", "区", "详细地址", "邮编", "年度",
               "产品名称", "起月日", "止月日", "份数", "金额", "渠道", "汇款名称", "汇款日期"]
    for c, h in enumerate(headers, start=1):
        det.cell(row=1, column=c, value=h).font = FB
    for i, r in enumerate(records, start=2):
        det.cell(row=i, column=1, value=r.region_name or "").font = FN
        det.cell(row=i, column=2, value=r.name).font = FN
        det.cell(row=i, column=3, value=(r.phone or "")).font = FN
        det.cell(row=i, column=4, value=r.province or "").font = FN
        det.cell(row=i, column=5, value=r.city or "").font = FN
        det.cell(row=i, column=6, value=r.district or "").font = FN
        det.cell(row=i, column=7, value=r.address or "").font = FN
        det.cell(row=i, column=8, value=(r.postal_code or "")).font = FN
        det.cell(row=i, column=9, value=f"{batch.year}年").font = FN
        det.cell(row=i, column=10, value="中国经营报").font = FN
        det.cell(row=i, column=11, value=f"{mm}01").font = FN
        det.cell(row=i, column=12, value="1231").font = FN
        det.cell(row=i, column=13, value=int(r.copies or 0)).font = FN
        amt = det.cell(row=i, column=14, value=f"=M{i}*{N}*20")  # 复刻活公式
        amt.font = FN
        det.cell(row=i, column=15, value=r.source_channel or "").font = FN
        det.cell(row=i, column=16, value=r.remittance_name or "").font = FN
        det.cell(row=i, column=17, value=r.remittance_date or "").font = FN
    _widths(det, {"A": 6, "B": 7, "C": 12, "D": 9, "E": 7, "G": 30, "H": 7.4, "I": 7,
                  "J": 9.5, "K": 6.2, "L": 6.2, "M": 4.9, "N": 10.9, "O": 15.8, "P": 17.7, "Q": 21.1})
    _a4(det, landscape=True, print_area=f"北京-明细!$A$1:$Q${max(last, 32)}")

    # --- 北京-汇总 ---
    su = wb.create_sheet("北京-汇总", 0)
    su.merge_cells("A1:D1")
    su["A1"] = f"北京局-{batch.year}年{batch.start_month}月各地区订报汇总"
    su["A1"].font = FB
    su["A1"].alignment = CENTER
    for c, h in enumerate(["序号", "地区", "金额", "数量"], start=1):
        su.cell(row=2, column=c, value=h).font = FB
    r = 3
    for idx, region in enumerate(regions, start=1):
        su.cell(row=r, column=1, value=idx).font = FN
        su.cell(row=r, column=2, value=region).font = FN
        su.cell(row=r, column=3,
                value=f"=SUMIF('北京-明细'!$A$2:$A${last},B{r},'北京-明细'!$N$2:$N${last})").font = FN
        su.cell(row=r, column=4,
                value=f"=SUMIF('北京-明细'!$A$2:$A${last},B{r},'北京-明细'!$M$2:$M${last})").font = FN
        r += 1
    su.merge_cells(f"A{r}:B{r}")
    su.cell(row=r, column=1, value="合计").font = FB
    su.cell(row=r, column=3, value=f"=SUM(C3:C{r-1})").font = FB
    su.cell(row=r, column=4, value=f"=SUM(D3:D{r-1})").font = FB
    su.cell(row=r + 2, column=3, value="制表人：").font = FN
    su.cell(row=r + 3, column=3, value="制表时间：").font = FN
    dcell = su.cell(row=r + 3, column=4, value=make_date)
    dcell.font = FN
    dcell.number_format = 'yyyy"年"m"月"d"日"'
    _widths(su, {"A": 16, "B": 24, "C": 28, "D": 24})
    _a4(su, landscape=False, print_area="北京-汇总!$A$1:$D$20")

    # --- 未到款申请（8月紧凑版） ---
    ap = wb.create_sheet("未到款申请")
    for rng in ("A1:I1", "A2:I2", "A3:I3", "A5:I5", "A6:I6", "A7:I7", "A8:I8", "A9:I9", "F12:I12"):
        ap.merge_cells(rng)
    ap["A1"] = "未到款提前订报的申请"
    ap["A1"].font = FB
    ap["A1"].alignment = CENTER
    ap["A2"] = "尊敬的领导："
    ap["A3"] = (f"         {batch.year}年{batch.start_month}月份《中国经营报》订阅共计{count}份。"
                f"付费读者款项正在流程中，为不影响读者按时收报，现申请先行支付订报款人民币"
                f"{total_amount:,.2f}元整。")
    ap["A5"] = "汇款信息："
    ap["A6"] = "名称：中国邮政集团有限公司北京市报刊发行局"
    ap["A7"] = "账号：0200 0031 0905 4203 874"
    ap["A8"] = "开户行：中国工商银行股份有限公司北京珠市口支行"
    ap["A9"] = "妥否，请领导批示！（名单附后）"
    ap["F11"] = "发行部："
    ap["F12"] = _cn(make_date)
    for row in ap.iter_rows():
        for cell in row:
            if cell.value is not None and cell.font is not FB:
                cell.font = FN
    _widths(ap, {"A": 6, "B": 9, "C": 7, "E": 14, "F": 10, "G": 19, "H": 7})
    _a4(ap, landscape=False, print_area="未到款申请!$A$1:$I$17")

    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


# --- (b) 北京局订报汇总表 ----------------------------------------------------

def _build_postal_summary(records: List[SubscriptionRecord], batch: SubscriptionBatch, N: int) -> bytes:
    mm = f"{batch.start_month:02d}"
    unit = N * 20
    regions = _region_order(records)
    agg = {reg: {"count": 0, "copies": 0} for reg in regions}
    for r in records:
        reg = r.region_name or "(未识别地区)"
        agg[reg]["count"] += 1
        agg[reg]["copies"] += int(r.copies or 0)

    wb = Workbook()
    ws = wb.active
    ws.title = "汇总"
    for c, h in enumerate(["代码", "报刊名称", "订期", "省份", "条数", "份数", "单价", "款额"], start=1):
        ws.cell(row=1, column=c, value=h).font = FB
    r = 2
    for region in regions:
        cnt = agg[region]["count"]
        cop = agg[region]["copies"]
        ws.cell(row=r, column=3, value=f"{mm}01-1231").font = FN
        ws.cell(row=r, column=4, value=region).font = FN
        ws.cell(row=r, column=5, value=cnt).font = FN
        ws.cell(row=r, column=6, value=cop).font = FN
        ws.cell(row=r, column=7, value=unit).font = FN
        ws.cell(row=r, column=8, value=cop * unit).font = FN
        r += 1
    # 代码 / 报刊名称 两列纵向合并。
    if regions:
        ws.merge_cells(f"A2:A{r-1}")
        ws.merge_cells(f"B2:B{r-1}")
        ws.cell(row=2, column=1, value="1-76").font = FN
        ws.cell(row=2, column=1).alignment = CENTER
        ws.cell(row=2, column=2, value="中国经营报").font = FN
        ws.cell(row=2, column=2).alignment = CENTER
    ws.merge_cells(f"A{r}:D{r}")
    ws.cell(row=r, column=1, value="合计").font = FB
    ws.cell(row=r, column=5, value=sum(a["count"] for a in agg.values())).font = FB
    ws.cell(row=r, column=6, value=sum(a["copies"] for a in agg.values())).font = FB
    ws.cell(row=r, column=8, value=sum(a["copies"] for a in agg.values()) * unit).font = FB
    _widths(ws, {"A": 12, "B": 18, "C": 15, "D": 12, "E": 10, "F": 10, "G": 10, "H": 14})
    _a4(ws, landscape=False, print_area=f"汇总!$A$1:$H${r}")
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


# --- (c) 地区集订分送表（邮局模板 · 数据页填充） -----------------------------

def _build_region_detail(region: str, recs: List[SubscriptionRecord], batch: SubscriptionBatch) -> bytes:
    mm = f"{batch.start_month:02d}"
    wb = openpyxl.load_workbook(REGION_TEMPLATE)
    ws = wb["数据页"]
    for i, r in enumerate(recs, start=1):
        row = i + 1
        vals = [str(i), str(batch.year), None, "1-76", "中国经营报", f"{mm}01", "1231",
                str(int(r.copies or 0)), r.name, (r.phone or ""), r.province or "",
                r.city or "", r.district or "", r.address or "", (r.postal_code or "")]
        for c, v in enumerate(vals, start=1):
            ws.cell(row=row, column=c, value=v)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


# --- 编排 -------------------------------------------------------------------

def generate(db: Session, batch: SubscriptionBatch, *, operator_id: Optional[int] = None) -> SubscriptionGenerationRun:
    from fastapi import HTTPException

    if batch.active_version_id is None:
        raise HTTPException(status_code=409, detail="批次尚无当前有效版本，请先上传并设为有效")
    version = next((v for v in batch.versions if v.id == batch.active_version_id), None)
    if version is None or version.status != SubscriptionImportStatus.active:
        raise HTTPException(status_code=409, detail="当前有效版本无效，请重新设为有效")

    records = [r for r in version.records if not r.excluded]
    if not records:
        raise HTTPException(status_code=409, detail="当前有效版本无有效明细，无法生成")

    make_date = batch.make_date or date.today()
    N = import_svc.months_for(batch.start_month)
    yy = batch.year % 100
    m = batch.start_month

    run = SubscriptionGenerationRun(
        batch_id=batch.id, version_id=version.id,
        rule_version=RULE_VERSION, template_version=TEMPLATE_VERSION,
        status=SubscriptionRunStatus.running, started_at=datetime.now(),
    )
    db.add(run)
    db.flush()

    db.query(SubscriptionOutputArtifact).filter(
        SubscriptionOutputArtifact.batch_id == batch.id,
        SubscriptionOutputArtifact.is_historical == False,  # noqa: E712
    ).update({"is_historical": True}, synchronize_session=False)

    category = f"subscription/{batch.year}-{m:02d}/gen"

    def _store(atype, filename, content, region=None):
        stored = attachment_service.store_file(category, filename, content)
        db.add(SubscriptionOutputArtifact(
            run_id=run.id, batch_id=batch.id, version_id=version.id,
            artifact_type=atype, region_name=region, filename=filename,
            stored_path=stored, sha256=attachment_service.sha256_hex(content),
        ))

    try:
        wb_bytes = _build_workbook(records, batch, N, make_date)
        _store(SubscriptionArtifactType.workbook,
               f"北京-{batch.year}年{m}月中国经营报订阅汇总+明细+申请.xlsx", wb_bytes)

        ps_bytes = _build_postal_summary(records, batch, N)
        _store(SubscriptionArtifactType.postal_summary, "北京局订报汇总表.xlsx", ps_bytes)

        by_region: dict = {}
        for r in records:
            by_region.setdefault(r.region_name or "(未识别地区)", []).append(r)
        region_files = []
        for region in _region_order(records):
            rd = _build_region_detail(region, by_region[region], batch)
            fname = f"1-76《中国经营报》集订分送表~{batch.year}年{m}月起报~{region}.xlsx"
            _store(SubscriptionArtifactType.region_detail, fname, rd, region=region)
            region_files.append((fname, rd))

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
