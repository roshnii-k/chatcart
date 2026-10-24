from .database import connection_scope, initialize_database
from .models import Order


def _prepare() -> None:
    initialize_database()


def create_order(order: Order) -> Order:
    _prepare()
    with connection_scope() as connection:
        connection.execute(
            "INSERT INTO orders(order_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (order.order_id, order.model_dump_json(), order.created_at.isoformat(), order.updated_at.isoformat()),
        )
    return order


def get_order(order_id: str) -> Order | None:
    _prepare()
    with connection_scope() as connection:
        row = connection.execute(
            "SELECT payload FROM orders WHERE order_id = ?", (order_id,)
        ).fetchone()
    return Order.model_validate_json(row["payload"]) if row else None


def list_orders() -> list[Order]:
    _prepare()
    with connection_scope() as connection:
        rows = connection.execute(
            "SELECT payload FROM orders ORDER BY created_at DESC, order_id"
        ).fetchall()
    return [Order.model_validate_json(row["payload"]) for row in rows]


def update_order(order: Order) -> Order | None:
    _prepare()
    with connection_scope() as connection:
        result = connection.execute(
            "UPDATE orders SET payload=?, updated_at=? WHERE order_id=?",
            (order.model_dump_json(), order.updated_at.isoformat(), order.order_id),
        )
        if result.rowcount == 0:
            return None
    return order


def find_exact_message(message: str) -> list[str]:
    normalized = " ".join(message.casefold().split())
    return [
        order.order_id
        for order in list_orders()
        if normalized and " ".join(order.original_message.casefold().split()) == normalized
    ]


def confirmed_orders() -> list[Order]:
    return [order for order in list_orders() if order.status.value == "Confirmed"]
