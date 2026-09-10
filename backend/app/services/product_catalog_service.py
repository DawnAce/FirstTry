"""商品别名维护：把新的电商名称关联到已有履约商品。"""
from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Product
from app.services.product_resolver_service import _norm


def append_product_alias(db: Session, product_id: int, alias: str) -> Product:
    """锁定当前商品库后追加别名；冲突或停用时整笔拒绝，不覆盖已有别名。"""
    target_found = False
    target_active = False
    conflict: tuple[str, str] | None = None
    normalized = _norm(alias)
    try:
        # 别名是 JSON 数组，空白归一化与识别器保持一致；按 ID 顺序锁定，
        # 流式读取匹配所需列，避免并发关联把同一名称写给两个商品。
        catalog = (db.query(Product.id, Product.code, Product.display_name, Product.aliases, Product.active)
                   .filter(or_(Product.active.is_(True), Product.id == product_id))
                   .order_by(Product.id).with_for_update().yield_per(100))
        for row in catalog:
            if row.id == product_id:
                target_found = True
                target_active = row.active
                continue
            if normalized in {_norm(name) for name in [row.display_name, *(row.aliases or [])]}:
                conflict = (row.display_name, row.code)
        if not target_found:
            raise HTTPException(404, f"商品 {product_id} 不存在")
        if not target_active:
            raise HTTPException(409, "该商品已停用，请选择启用中的商品")
        if conflict:
            raise HTTPException(409, f"该名称已关联商品「{conflict[0]}」（{conflict[1]}），请核对原关联")
        product = (db.query(Product).filter(Product.id == product_id)
                   .with_for_update().populate_existing().one())
        if normalized not in {_norm(name) for name in (product.aliases or [])}:
            product.aliases = [*(product.aliases or []), alias.strip()]
        db.commit()
        db.refresh(product)
        return product
    except Exception:
        db.rollback()
        raise
