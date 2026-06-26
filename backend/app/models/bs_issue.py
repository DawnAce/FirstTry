"""商学院月刊「刊期日历」(bs_issues)。

商学院月刊没有数字期号；其「期」身份是 ``issue_label``（"2026-01" / "2026-02~03"），
与订单行 ``order_items.issue_label`` 对齐。本表把每期映射到它覆盖的自然月区间
``[month_start, month_end]``（单刊 start==end；2~3月合刊 start=2,end=3），用于把**订阅**
的覆盖期展开成「覆盖了哪几期」，从而算「某期发行量 = 单期销量 + 覆盖该期的订阅份数」。

与中国经营报的 ``issues`` / ``publication_schedule``（数字期号 + 出版日，周报专用）**解耦**
——商学院走自己这套轻量「月→期」日历。系统不再只能从卖出过的订单被动反推有哪些期。
"""

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.database import Base


class BsIssue(Base):
    __tablename__ = "bs_issues"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 与 order_items.issue_label 完全一致："2026-01" / "2026-02~03"（合刊）。
    issue_label = Column(String(32), unique=True, nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    # 覆盖的自然月：单刊 month_start == month_end；2~3月合刊 month_start=2, month_end=3。
    month_start = Column(Integer, nullable=False)
    month_end = Column(Integer, nullable=False)
    # 期标题（《AI赋能，乡村新生》）——仅展示用，可空（未出刊的期标题先留空）。
    title = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
