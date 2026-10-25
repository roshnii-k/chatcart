from datetime import date, datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class OrderStatus(str, Enum):
    NEEDS_REVIEW = "Needs Review"
    NEEDS_CLARIFICATION = "Needs Clarification"
    CONFIRMED = "Confirmed"
    IN_PROGRESS = "In Progress"
    COMPLETED = "Completed"
    CANCELLED = "Cancelled"


class OrderFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_name: str | None = None
    customer_phone: str | None = Field(default=None, max_length=40)
    product_name: str | None = None
    quantity: int | None = Field(default=None, gt=0)
    unit_price: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    delivery_date: date | None = None
    delivery_address: str | None = None
    special_instructions: str | None = None


class OrderCreate(OrderFields):
    original_message: str = ""


class OrderPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_name: str | None = None
    customer_phone: str | None = Field(default=None, max_length=40)
    product_name: str | None = None
    quantity: int | None = Field(default=None, gt=0)
    unit_price: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    delivery_date: date | None = None
    delivery_address: str | None = None
    special_instructions: str | None = None
    original_message: str | None = None


class Order(OrderFields):
    order_id: str = Field(default_factory=lambda: str(uuid4()))
    total_price: float | None = None
    original_message: str = ""
    missing_fields: list[str] = Field(default_factory=list)
    validation_issues: list[str] = Field(default_factory=list)
    status: OrderStatus = OrderStatus.NEEDS_REVIEW
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=4000)


class ExtractResponse(BaseModel):
    demo_mode: bool = True
    order: Order
    validation_issues: list[str]
    possible_duplicates: list[str] = Field(default_factory=list)
    possible_correction: dict[str, Any] | None = None


class StatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: OrderStatus


REQUIRED_CONFIRMATION_FIELDS = (
    "product_name",
    "quantity",
    "unit_price",
    "delivery_date",
    "delivery_address",
)

def refresh_order(order: Order, *, preserve_timestamps: bool = True) -> Order:
    """Recalculate derived fields and make the review state match current data."""
    total = (
        round(order.quantity * order.unit_price, 2)
        if order.quantity is not None and order.unit_price is not None
        else None
    )
    missing = [
        field for field in REQUIRED_CONFIRMATION_FIELDS
        if getattr(order, field) is None or getattr(order, field) == ""
    ]
    if missing or order.validation_issues:
        status = OrderStatus.NEEDS_CLARIFICATION
    elif order.status in {
        OrderStatus.CONFIRMED,
        OrderStatus.IN_PROGRESS,
        OrderStatus.COMPLETED,
        OrderStatus.CANCELLED,
    }:
        status = order.status
    else:
        status = OrderStatus.NEEDS_REVIEW
    return order.model_copy(
        update={
            "total_price": total,
            "missing_fields": missing,
            "status": status,
            "updated_at": order.updated_at if preserve_timestamps else datetime.now(timezone.utc),
        }
    )
