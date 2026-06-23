"""Pydantic schemas for the product catalog (商品库).

The catalog maps an e-commerce product string to the fulfillment attributes an
order item needs. ``*Create``/``*Update`` are admin CRUD payloads; ``ProductOut``
is built straight from the ORM row.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    Publication,
    PublicationFormat,
    SubscriptionTerm,
)
from app.models.product import CoverageRule


class ProductComponent(BaseModel):
    """One leg of a bundle product (e.g. 中国经营报 / 商学院).

    Price split rule: ``fixed_price`` legs take their fixed amount; exactly one
    ``remainder`` leg absorbs ``paid - sum(fixed_price)``.
    """

    publication: Publication
    subscription_term: Optional[SubscriptionTerm] = None
    # 每组件投递方式（如中国经营报=邮局、商学院=中通）；留空则回落套餐顶层 delivery_method。
    delivery_method: Optional[DeliveryMethod] = None
    coverage_rule: CoverageRule = CoverageRule.term_from_month
    fixed_price: Optional[Decimal] = None
    remainder: bool = False


class ProductBase(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=255)
    aliases: Optional[List[str]] = None
    publication: Optional[Publication] = None
    publication_format: PublicationFormat = PublicationFormat.paper
    fulfillment_type: FulfillmentType
    subscription_term: Optional[SubscriptionTerm] = None
    delivery_method: Optional[DeliveryMethod] = None
    billing_type: BillingType = BillingType.paid
    coverage_rule: CoverageRule = CoverageRule.term_from_month
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    list_price: Decimal = Decimal("0")
    is_bundle: bool = False
    components: Optional[List[ProductComponent]] = None
    active: bool = True
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _check_shape(self):
        if self.is_bundle:
            if not self.components:
                raise ValueError("套餐商品（is_bundle）必须提供 components")
            remainder_legs = [c for c in self.components if c.remainder]
            if len(remainder_legs) != 1:
                raise ValueError("套餐 components 必须恰好有一个 remainder=true 的腿")
        else:
            if self.publication is None:
                raise ValueError("非套餐商品必须指定 publication")
        if self.coverage_rule == CoverageRule.explicit and (
            self.coverage_start_date is None or self.coverage_end_date is None
        ):
            raise ValueError("coverage_rule=explicit 时必须提供 coverage_start_date/end_date")
        return self


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    """PATCH payload — only provided fields are applied. ``code`` is immutable."""

    display_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    aliases: Optional[List[str]] = None
    publication: Optional[Publication] = None
    publication_format: Optional[PublicationFormat] = None
    fulfillment_type: Optional[FulfillmentType] = None
    subscription_term: Optional[SubscriptionTerm] = None
    delivery_method: Optional[DeliveryMethod] = None
    billing_type: Optional[BillingType] = None
    coverage_rule: Optional[CoverageRule] = None
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    list_price: Optional[Decimal] = None
    is_bundle: Optional[bool] = None
    components: Optional[List[ProductComponent]] = None
    active: Optional[bool] = None
    notes: Optional[str] = None


class ProductOut(ProductBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
