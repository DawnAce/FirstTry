from sqlalchemy.orm import Session
from app.models import ReportItemTemplate

TEMPLATES = [
    # (category, sub_category, display_name, default_value, is_variable, sort_order)
    ("postal", "外埠", "北京邮发-外埠", 5581, True, 10),
    ("postal", "本市", "北京邮发-本市", 1217, True, 20),
    ("retail", "东部", "北京报零-东部", 460, True, 30),
    ("retail", "西部", "北京报零-西部", 592, True, 40),
    ("guangzhou", "零售", "广州日报-零售", 500, True, 50),
    ("guangzhou", "订户", "广州日报-订户", 31, True, 60),
    ("other", "杂志铺", "杂志铺", 375, False, 70),
    ("other", "国图贸", "国图贸", 1, False, 80),
    ("other", "合订本", "合订本", 15, False, 90),
    ("temp", "临时加印", "临时加印", 0, True, 100),
    ("social_use", "临时加印_自留", "临时加印（自留分发）", 0, True, 101),
    ("social_use", "营报传媒", "营报传媒", 183, True, 110),
    ("social_use", "新闻中心", "新闻中心", 45, False, 120),
    ("social_use", "财经中心", "财经中心", 9, True, 130),
    ("social_use", "行政", "行政", 4, False, 140),
    ("social_use", "出版中心", "出版中心", 10, False, 150),
    ("social_use", "上海站", "上海站用报", 10, False, 160),
    ("social_use", "广东站", "广东站用报", 30, False, 170),
    ("social_use", "西安站", "西安站用报", 10, False, 180),
    ("social_use", "备用报", "备用报（留存）", 71, True, 190),
    ("other", "上犹", "上犹", 30, False, 200),
]


def seed_report_templates(db: Session) -> int:
    existing = db.query(ReportItemTemplate).count()
    if existing > 0:
        return 0

    count = 0
    for cat, sub, display, default, is_var, sort in TEMPLATES:
        tmpl = ReportItemTemplate(
            category=cat,
            sub_category=sub,
            display_name=display,
            default_value=default,
            is_variable=is_var,
            sort_order=sort,
        )
        db.add(tmpl)
        count += 1

    db.commit()
    return count
