import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DATABASE_PATH = Path(os.getenv("CHATCART_DB_PATH", "data/chatcart.sqlite3"))


def get_connection() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def connection_scope() -> Iterator[sqlite3.Connection]:
    connection = get_connection()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    """Create ChatCart's order store and preserve the original starter table."""
    with connection_scope() as connection:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(orders)").fetchall()
        }
        if columns and "order_id" not in columns:
            exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='orders_legacy'"
            ).fetchone()
            if not exists:
                connection.execute("ALTER TABLE orders RENAME TO orders_legacy")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                order_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)"
        )
