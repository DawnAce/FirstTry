"""Product catalog (商品库) admin CRUD.

A data-driven mapping table the importer resolves against. New promo SKU = a row
insert here, not a code change. Orders snapshot their own attributes, so editing
a product never mutates historical orders.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Product, User
from app.schemas.product import ProductCreate, ProductOut, ProductUpdate

router = APIRouter(prefix="/api/products", tags=["products"])


def _components_to_json(components):
    if components is None:
        return None
    return [c.model_dump(mode="json") for c in components]


@router.get("", response_model=List[ProductOut])
def list_products(
    active: Optional[bool] = None,
    q: Optional[str] = Query(default=None, description="模糊匹配 code / display_name"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    query = db.query(Product)
    if active is not None:
        query = query.filter(Product.active.is_(active))
    if q:
        like = f"%{q}%"
        query = query.filter(Product.code.ilike(like) | Product.display_name.ilike(like))
    return query.order_by(Product.active.desc(), Product.code).all()


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if product is None:
        raise HTTPException(status_code=404, detail=f"商品 {product_id} 不存在")
    return product


@router.post("", response_model=ProductOut, status_code=201)
def create_product(
    data: ProductCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    if db.query(Product).filter(Product.code == data.code).first() is not None:
        raise HTTPException(status_code=409, detail=f"商品编码 {data.code} 已存在")

    product = Product(
        code=data.code,
        display_name=data.display_name,
        aliases=data.aliases,
        publication=data.publication,
        publication_format=data.publication_format,
        fulfillment_type=data.fulfillment_type,
        subscription_term=data.subscription_term,
        delivery_method=data.delivery_method,
        billing_type=data.billing_type,
        coverage_rule=data.coverage_rule,
        coverage_start_date=data.coverage_start_date,
        coverage_end_date=data.coverage_end_date,
        list_price=data.list_price,
        is_bundle=data.is_bundle,
        components=_components_to_json(data.components),
        active=data.active,
        notes=data.notes,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    data: ProductUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if product is None:
        raise HTTPException(status_code=404, detail=f"商品 {product_id} 不存在")

    patch = data.model_dump(exclude_unset=True)
    if "components" in patch:
        patch["components"] = _components_to_json(data.components)
    for field, value in patch.items():
        setattr(product, field, value)

    db.commit()
    db.refresh(product)
    return product


@router.post("/{product_id}/deactivate", response_model=ProductOut)
def deactivate_product(
    product_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Soft-disable a product (kept for audit; reactivate via PUT active=true)."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if product is None:
        raise HTTPException(status_code=404, detail=f"商品 {product_id} 不存在")
    product.active = False
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Hard-delete a product row.

    Safe by construction: order items snapshot their own attributes and do NOT
    reference ``products`` (no FK), so deleting a catalog row never touches
    historical order data. Prefer ``POST /{id}/deactivate`` to retire a product
    while keeping it on record; use delete to remove a mistake / test row.
    """
    product = db.query(Product).filter(Product.id == product_id).first()
    if product is None:
        raise HTTPException(status_code=404, detail=f"商品 {product_id} 不存在")
    db.delete(product)
    db.commit()
