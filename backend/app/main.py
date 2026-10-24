import csv
import io
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from typing import Callable, TypeVar
from uuid import UUID

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import load_local_env

load_local_env()

from . import store
from .database import initialize_database
from .extraction import extract_order, find_correction
from .models import (
    ExtractRequest,
    ExtractResponse,
    Order,
    OrderCreate,
    OrderPatch,
    OrderStatus,
    REQUIRED_CONFIRMATION_FIELDS,
    StatusUpdate,
    refresh_order,
)

T = TypeVar("T")


def safe_db(operation: Callable[[], T]) -> T:
    try:
        return operation()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="A database error prevented this operation.") from exc


def valid_id(order_id: str) -> str:
    try:
        return str(UUID(order_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="order_id must be a valid UUID.") from exc


def prepare_order(fields: dict, *, original_message: str = "", issues: list[str] | None = None) -> Order:
    order = Order(
        **fields,
        original_message=original_message,
        validation_issues=issues or [],
    )
    return refresh_order(order)


@asynccontextmanager
async def lifespan(_: FastAPI):
    safe_db(initialize_database)
    yield



app = FastAPI(title="ChatCart API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "app": "ChatCart"}


@app.get("/api/orders", response_model=list[Order])
def get_orders() -> list[Order]:
    return safe_db(store.list_orders)


@app.post("/api/orders/extract", response_model=ExtractResponse)
def extract_message(request: ExtractRequest) -> ExtractResponse:
    order, issues = extract_order(request.message)
    duplicates = safe_db(lambda: store.find_exact_message(request.message))
    correction = find_correction(request.message)
    correction_details = None
    if correction:
        order_id, proposed_quantity = correction
        current = safe_db(lambda: store.get_order(order_id))
        if current:
            proposed = current.model_copy(
                update={"quantity": proposed_quantity, "updated_at": datetime.now(timezone.utc)}
            )
            proposed = refresh_order(proposed)
            correction_details = {
                "order_id": current.order_id,
                "original_details": {"quantity": current.quantity, "total_price": current.total_price},
                "proposed_details": {"quantity": proposed.quantity, "total_price": proposed.total_price},
                "applied": False,
            }
            order = proposed
            issues = proposed.validation_issues
    return ExtractResponse(
        demo_mode=True,
        order=order,
        validation_issues=issues,
        possible_duplicates=duplicates,
        possible_correction=correction_details,
    )


@app.post("/api/orders", response_model=Order, status_code=201)
def create_order(request: OrderCreate) -> Order:
    order = prepare_order(
        request.model_dump(exclude={"original_message"}),
        original_message=request.original_message,
    )
    return safe_db(lambda: store.create_order(order))


@app.get("/api/orders/export.csv")
def export_orders() -> Response:
    orders = safe_db(store.confirmed_orders)
    if not orders:
        raise HTTPException(status_code=404, detail="There are no confirmed orders to export.")
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(
        ["order_id", "customer_name", "product_name", "quantity", "unit_price",
         "total_price", "delivery_date", "delivery_address", "special_instructions",
         "original_message", "status", "created_at", "updated_at"]
    )
    for order in orders:
        writer.writerow([
            order.order_id, order.customer_name, order.product_name, order.quantity,
            order.unit_price, order.total_price, order.delivery_date, order.delivery_address,
            order.special_instructions, order.original_message, order.status.value,
            order.created_at.isoformat(), order.updated_at.isoformat(),
        ])
    return Response(
        content=stream.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="chatcart-orders.csv"'},
    )

@app.get("/api/orders/{order_id}", response_model=Order)
def get_order(order_id: str) -> Order:
    order_id = valid_id(order_id)
    order = safe_db(lambda: store.get_order(order_id))
    if order is None:
        raise HTTPException(status_code=404, detail="Order was not found.")
    return order


@app.patch("/api/orders/{order_id}", response_model=Order)
def edit_order(order_id: str, request: OrderPatch) -> Order:
    order_id = valid_id(order_id)
    current = safe_db(lambda: store.get_order(order_id))
    if current is None:
        raise HTTPException(status_code=404, detail="Order was not found.")

    updates = request.model_dump(exclude_unset=True)
    updated = current.model_copy(update=updates)
    if "quantity" in updates:
        updated.validation_issues = [
            issue for issue in updated.validation_issues if not issue.startswith("quantity:")
        ]
    if "unit_price" in updates:
        updated.validation_issues = [
            issue for issue in updated.validation_issues if not issue.startswith("unit_price:")
        ]
    updated.updated_at = datetime.now(timezone.utc)
    updated = refresh_order(updated, preserve_timestamps=False)
    return safe_db(lambda: store.update_order(updated))


@app.post("/api/orders/{order_id}/confirm", response_model=Order)
def confirm_order(order_id: str) -> Order:
    order_id = valid_id(order_id)
    current = safe_db(lambda: store.get_order(order_id))
    if current is None:
        raise HTTPException(status_code=404, detail="Order was not found.")
    unresolved = [
        field for field in REQUIRED_CONFIRMATION_FIELDS
        if getattr(current, field) is None or getattr(current, field) == ""
    ]
    if unresolved or current.validation_issues:
        detail = {
            "message": "Resolve required order details before confirming.",
            "missing_fields": unresolved,
            "validation_issues": current.validation_issues,
        }
        raise HTTPException(status_code=409, detail=detail)
    if current.status == OrderStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="A cancelled order cannot be confirmed.")
    updated = current.model_copy(
        update={"status": OrderStatus.CONFIRMED, "updated_at": datetime.now(timezone.utc)}
    )
    return safe_db(lambda: store.update_order(updated))


@app.post("/api/orders/{order_id}/status", response_model=Order)
def update_status(order_id: str, request: StatusUpdate) -> Order:
    order_id = valid_id(order_id)
    if request.status == OrderStatus.CONFIRMED:
        raise HTTPException(
            status_code=409,
            detail="Use the explicit /confirm endpoint after resolving order details.",
        )
    current = safe_db(lambda: store.get_order(order_id))
    if current is None:
        raise HTTPException(status_code=404, detail="Order was not found.")
    updated = current.model_copy(
        update={"status": request.status, "updated_at": datetime.now(timezone.utc)}
    )
    return safe_db(lambda: store.update_order(updated))



from .agent_routes import router as agent_router
app.include_router(agent_router)
