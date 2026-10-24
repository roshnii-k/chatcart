import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from .models import Order, OrderStatus, refresh_order


ORDER_PATTERN = re.compile(
    r"\b(?:i\s+need|i\s+want|i'd\s+like|please\s+order|order)\s+"
    r"([+-]?\d+)\s+(.+?)\s+at\s+([+-]?)\s*(?:₹|rs\.?\s*)?"
    r"([\d,]+(?:\.\d{1,2})?)\s+each\b",
    re.IGNORECASE,
)
TOTAL_PATTERN = re.compile(r"\btotal\s*(?:is|of|:)?\s*(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)", re.I)
CORRECTION_PATTERN = re.compile(
    r"\bcorrection\s+for\s+order\s+([0-9a-f-]{36})\s*:\s*"
    r"(?:change\s+)?quantity\s+to\s+(?<![-+\d])([1-9]\d*)\b",
    re.IGNORECASE,
)


def _money(value: str) -> Decimal:
    return Decimal(value.replace(",", ""))


def extract_order(message: str, *, today: date | None = None) -> tuple[Order, list[str]]:
    """Parse only the documented demo pattern; unrecognized details remain empty."""
    today = today or date.today()
    fields: dict = {"original_message": message}
    issues: list[str] = []
    match = ORDER_PATTERN.search(message)

    if match:
        raw_quantity, product, sign, raw_price = match.groups()
        quantity = int(raw_quantity)
        if quantity < 1:
            issues.append("quantity: Quantity must be a positive whole number.")
        else:
            fields["quantity"] = quantity
        fields["product_name"] = product.strip().rstrip(".,")
        try:
            price = _money(raw_price)
            if sign == "-":
                price = -price
            if price <= 0:
                issues.append("unit_price: Unit price must be greater than zero.")
            else:
                fields["unit_price"] = float(price)
        except InvalidOperation:
            issues.append("unit_price: Unit price could not be read.")
    else:
        issues.append("message: No supported quantity, product, and unit-price pattern was found.")

    delivery = re.search(r"\b(today|tomorrow|\d{4}-\d{2}-\d{2})\b", message, re.I)
    if delivery:
        phrase = delivery.group(1).lower()
        try:
            fields["delivery_date"] = (
                today if phrase == "today"
                else today + timedelta(days=1) if phrase == "tomorrow"
                else date.fromisoformat(phrase)
            )
        except ValueError:
            issues.append("delivery_date: Delivery date is invalid.")

    address = re.search(r"\bdeliver\s+to\s+([^.;\n]+)", message, re.I)
    if address:
        fields["delivery_address"] = address.group(1).strip().rstrip(",")

    instructions = re.search(
        r"\b(?:special\s+instructions?|note)\s*:\s*([^\n]+)", message, re.I
    )
    if instructions:
        fields["special_instructions"] = instructions.group(1).strip().rstrip(".")

    expected_total = re.search(TOTAL_PATTERN, message)
    if expected_total and "quantity" in fields and "unit_price" in fields:
        try:
            stated = _money(expected_total.group(1))
            calculated = Decimal(fields["quantity"]) * Decimal(str(fields["unit_price"]))
            if stated != calculated:
                issues.append(
                    f"total_price: Stated total {stated} conflicts with calculated total {calculated}."
                )
        except InvalidOperation:
            issues.append("total_price: Stated total could not be read.")

    order = Order(
        **fields,
        validation_issues=issues,
        status=OrderStatus.NEEDS_REVIEW,
    )
    order = refresh_order(order)
    return order, issues


def find_correction(message: str) -> tuple[str, int] | None:
    match = CORRECTION_PATTERN.search(message)
    if not match:
        return None
    return match.group(1), int(match.group(2))
