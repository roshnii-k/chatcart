from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import database
from backend.app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", Path(tmp_path) / "test-orders.sqlite3")
    with TestClient(app) as test_client:
        yield test_client


def complete_payload(**overrides):
    payload = {
        "customer_name": "Asha",
        "product_name": "chocolate cakes",
        "quantity": 3,
        "unit_price": 500,
        "delivery_date": "2026-10-25",
        "delivery_address": "Rose Villa, Thrissur",
        "original_message": "I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur.",
    }
    payload.update(overrides)
    return payload


def test_extracts_complete_supported_message(client):
    response = client.post(
        "/api/orders/extract",
        json={"message": "I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur."},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["demo_mode"] is True
    assert data["order"]["product_name"] == "chocolate cakes"
    assert data["order"]["quantity"] == 3
    assert data["order"]["unit_price"] == 500
    assert data["order"]["total_price"] == 1500
    assert data["order"]["delivery_address"] == "Rose Villa, Thrissur"
    assert data["order"]["status"] == "Needs Review"
    assert data["order"]["customer_name"] is None
    assert data["order"]["order_id"]


def test_missing_information_requires_clarification(client):
    data = client.post("/api/orders/extract", json={"message": "I need 2 pies"}).json()
    assert "quantity" in data["order"]["missing_fields"]
    assert "delivery_address" in data["order"]["missing_fields"]
    assert data["order"]["status"] == "Needs Clarification"
    assert data["order"]["total_price"] is None


@pytest.mark.parametrize(
    ("message", "issue_prefix"),
    [
        ("I need 0 pies at ₹500 each tomorrow. Deliver to Home.", "quantity:"),
        ("I need 2 pies at -₹500 each tomorrow. Deliver to Home.", "unit_price:"),
    ],
)
def test_invalid_extracted_quantity_and_price_are_reported(client, message, issue_prefix):
    data = client.post("/api/orders/extract", json={"message": message}).json()
    assert any(issue.startswith(issue_prefix) for issue in data["validation_issues"])
    assert data["order"]["status"] == "Needs Clarification"


def test_total_calculation_and_conflicts(client):
    data = client.post(
        "/api/orders/extract",
        json={"message": "I need 2 pies at ₹500 each for tomorrow. Deliver to Home. Total ₹900."},
    ).json()
    assert data["order"]["total_price"] == 1000
    assert any(issue.startswith("total_price:") for issue in data["validation_issues"])


def test_create_and_retrieve_order(client):
    created = client.post("/api/orders", json=complete_payload())
    assert created.status_code == 201
    order_id = created.json()["order_id"]
    assert created.json()["total_price"] == 1500
    fetched = client.get(f"/api/orders/{order_id}")
    assert fetched.status_code == 200
    assert fetched.json()["order_id"] == order_id


def test_edit_recalculates_total(client):
    order_id = client.post("/api/orders", json=complete_payload()).json()["order_id"]
    updated = client.patch(f"/api/orders/{order_id}", json={"quantity": 2})
    assert updated.status_code == 200
    assert updated.json()["quantity"] == 2
    assert updated.json()["total_price"] == 1000


def test_confirmation_requires_all_required_fields(client):
    order_id = client.post("/api/orders", json={"product_name": "cake"}).json()["order_id"]
    response = client.post(f"/api/orders/{order_id}/confirm")
    assert response.status_code == 409
    assert "missing_fields" in response.json()["detail"]


def test_explicit_confirmation_and_status_changes(client):
    order_id = client.post("/api/orders", json=complete_payload()).json()["order_id"]
    assert client.post(f"/api/orders/{order_id}/confirm").json()["status"] == "Confirmed"
    changed = client.post(f"/api/orders/{order_id}/status", json={"status": "In Progress"})
    assert changed.status_code == 200
    assert changed.json()["status"] == "In Progress"


def test_status_endpoint_cannot_bypass_confirmation(client):
    order_id = client.post("/api/orders", json=complete_payload()).json()["order_id"]
    response = client.post(f"/api/orders/{order_id}/status", json={"status": "Confirmed"})
    assert response.status_code == 409


def test_sqlite_persists_across_app_restarts(client):
    created = client.post("/api/orders", json=complete_payload()).json()
    client.close()
    with TestClient(app) as second_client:
        fetched = second_client.get(f"/api/orders/{created['order_id']}")
        assert fetched.status_code == 200
        assert fetched.json()["product_name"] == "chocolate cakes"


def test_csv_exports_only_confirmed_and_escapes_fields(client):
    unconfirmed = client.post(
        "/api/orders", json=complete_payload(original_message="unconfirmed")
    ).json()
    confirmed = client.post(
        "/api/orders",
        json=complete_payload(original_message='Customer said, "please bake".\nThanks'),
    ).json()
    client.post(f"/api/orders/{confirmed['order_id']}/confirm")
    response = client.get("/api/orders/export.csv")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "unconfirmed" not in response.text
    assert 'Customer said, ""please bake""' in response.text
    assert unconfirmed["order_id"] not in response.text


def test_csv_without_confirmed_orders_is_helpful(client):
    assert client.get("/api/orders/export.csv").status_code == 404


def test_duplicate_messages_are_flagged_without_auto_save(client):
    message = "I need 3 pies at ₹500 each for tomorrow. Deliver to Home."
    client.post("/api/orders", json=complete_payload(original_message=message))
    response = client.post("/api/orders/extract", json={"message": message})
    assert response.status_code == 200
    assert len(response.json()["possible_duplicates"]) == 1
    assert len(client.get("/api/orders").json()) == 1


def test_explicit_quantity_correction_is_proposed_not_applied(client):
    original = client.post("/api/orders", json=complete_payload()).json()
    message = f"Correction for order {original['order_id']}: change quantity to 2"
    proposed = client.post("/api/orders/extract", json={"message": message}).json()
    assert proposed["possible_correction"]["applied"] is False
    assert proposed["possible_correction"]["original_details"]["quantity"] == 3
    assert proposed["possible_correction"]["proposed_details"]["quantity"] == 2
    assert client.get(f"/api/orders/{original['order_id']}").json()["quantity"] == 3


def test_invalid_api_requests_have_expected_status_codes(client):
    assert client.post("/api/orders", json=complete_payload(quantity=0)).status_code == 422
    assert client.get("/api/orders/not-a-uuid").status_code == 400
    assert client.get("/api/orders/11111111-1111-4111-8111-111111111111").status_code == 404
    assert client.post("/api/orders/extract", json={"message": ""}).status_code == 422
def test_edit_preserves_active_order_status(client):
    order_id = client.post("/api/orders", json=complete_payload()).json()["order_id"]
    client.post(f"/api/orders/{order_id}/confirm")
    client.post(f"/api/orders/{order_id}/status", json={"status": "In Progress"})
    updated = client.patch(f"/api/orders/{order_id}", json={"special_instructions": "Less sugar"})
    assert updated.json()["status"] == "In Progress"


def test_health_endpoint(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "app": "ChatCart"}
def test_nonpositive_correction_is_not_treated_as_a_valid_proposal(client):
    original = client.post("/api/orders", json=complete_payload()).json()
    message = f"Correction for order {original['order_id']}: change quantity to 0"
    proposed = client.post("/api/orders/extract", json={"message": message}).json()
    assert proposed["possible_correction"] is None
    assert client.get(f"/api/orders/{original['order_id']}").json()["quantity"] == 3
