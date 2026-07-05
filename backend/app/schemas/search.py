"""全局搜索 · 出参 schema。"""

from typing import List, Literal, Optional

from pydantic import BaseModel


class SearchHit(BaseModel):
    type: Literal["order", "recipient", "product", "issue"]
    id: int
    title: str
    subtitle: Optional[str] = None
    # 精确定位串（外部单号 / 商品编码 / 期号 / 收报人姓名），前端据此跳转/预填。
    ref: Optional[str] = None


class GlobalSearchOut(BaseModel):
    items: List[SearchHit]
