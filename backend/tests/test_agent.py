from uuid import uuid4

from fastapi.testclient import TestClient

from backend.app import database
from backend.app.main import app
from pathlib import Path
import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", Path(tmp_path) / "agent-test.sqlite3")
    with TestClient(app) as test_client:
        yield test_client


def submit(client, message, *, source="manual", event_id=None):
    return client.post("/api/message-events", json={
        "event_id": event_id or str(uuid4()),
        "source": source,
        "message": message,
        "sender_name": "Asha",
        "sender_id": "chat-42",
    })


def complete_message():
    return "I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur."


def complete_order(client):
    return client.post("/api/orders", json={
        "customer_name": "Asha",
        "product_name": "chocolate cakes",
        "quantity": 3,
        "unit_price": 500,
        "delivery_date": "2026-10-26",
        "delivery_address": "Rose Villa, Thrissur",
        "original_message": complete_message(),
    }).json()


def test_source_event_creates_idempotent_review_draft(client):
    event_id = str(uuid4())
    payload = {"event_id": event_id, "source": "manual", "message": complete_message(), "sender_name": "Asha"}
    first = client.post("/api/message-events", json=payload)
    assert first.status_code == 201
    assert first.json()["processing_state"] == "needs_seller_review"
    assert first.json()["demo_mode"] is False
    assert client.get("/api/orders").json() == []

    saved = client.post(f"/api/message-events/{event_id}/save-draft")
    assert saved.status_code == 200
    order = saved.json()["order"]
    assert order["status"] == "Needs Review"
    assert order["original_message"] == complete_message()

    replay = client.post(f"/api/message-events/{event_id}/save-draft")
    assert replay.json()["order"]["order_id"] == order["order_id"]
    assert len(client.get("/api/orders").json()) == 1
    assert len(client.get("/api/message-events").json()) == 1


def test_missing_fields_persist_as_clarification_draft(client):
    event = submit(client, "I need 2 pies.").json()
    saved = client.post(f"/api/message-events/{event['event_id']}/save-draft")
    assert saved.status_code == 200
    assert saved.json()["order"]["status"] == "Needs Clarification"
    assert "product_name" in saved.json()["order"]["missing_fields"]


def test_duplicate_event_and_duplicate_order_are_flagged(client):
    event_id = str(uuid4())
    first = submit(client, complete_message(), event_id=event_id).json()
    replay = submit(client, complete_message(), event_id=event_id).json()
    assert replay["event_id"] == first["event_id"]
    assert len(client.get("/api/message-events").json()) == 1

    client.post(f"/api/message-events/{event_id}/save-draft")
    repeated = submit(client, complete_message()).json()
    assert repeated["processing_state"] == "duplicate_warning"
    assert repeated["extraction"]["possible_duplicates"]


def test_correction_is_proposed_then_approved_without_silent_mutation(client):
    original = complete_order(client)
    client.post(f"/api/orders/{original['order_id']}/confirm")
    event = submit(client, f"Correction for order {original['order_id']}: change quantity to 2").json()
    proposal = client.get("/api/change-proposals").json()[0]
    assert event["processing_state"] == "correction_proposed"
    assert proposal["state"] == "Pending"
    assert proposal["original_values"]["quantity"] == 3
    assert client.get(f"/api/orders/{original['order_id']}").json()["quantity"] == 3

    approved = client.post(f"/api/change-proposals/{proposal['proposal_id']}/approve")
    assert approved.status_code == 200
    assert approved.json()["proposal"]["state"] == "Approved"
    assert approved.json()["order"]["quantity"] == 2
    assert approved.json()["order"]["status"] == "Confirmed"


def test_rejecting_proposal_keeps_order_unchanged(client):
    original = complete_order(client)
    event = submit(client, f"Correction for order {original['order_id']}: change quantity to 1").json()
    proposal_id = event["proposal_id"]
    rejected = client.post(f"/api/change-proposals/{proposal_id}/reject")
    assert rejected.status_code == 200
    assert rejected.json()["state"] == "Rejected"
    assert client.get(f"/api/orders/{original['order_id']}").json()["quantity"] == 3


def test_demo_and_unavailable_sources_are_clearly_labelled(client):
    source_list = {item["source_id"]: item for item in client.get("/api/agent/sources").json()}
    assert source_list["manual"]["status"] == "Supported"
    assert source_list["demo_fixture"]["status"] == "Demo"
    assert source_list["whatsapp_web"]["status"] == "Experimental"

    demo = submit(client, complete_message(), source="demo_fixture").json()
    assert demo["demo_mode"] is True
    assert demo["source"] == "demo_fixture"
    assert client.post("/api/message-events", json={
        "event_id": str(uuid4()), "source": "whatsapp_web", "message": complete_message(),
    }).status_code == 201


def test_whatsapp_message_with_missing_details_becomes_reviewable_draft(client):
    event_id = str(uuid4())
    response = client.post("/api/message-events", json={
        "event_id": event_id,
        "source": "whatsapp_web",
        "message": "I need 2 pies.",
        "sender_name": "Asha",
    })
    assert response.status_code == 201
    assert response.json()["source"] == "whatsapp_web"

    saved = client.post(f"/api/message-events/{event_id}/save-draft")
    assert saved.status_code == 200
    assert saved.json()["order"]["status"] == "Needs Clarification"
    assert saved.json()["order"]["original_message"] == "I need 2 pies."

    replay = client.post(f"/api/message-events/{event_id}/save-draft")
    assert replay.json()["order"]["order_id"] == saved.json()["order"]["order_id"]
    assert len(client.get("/api/orders").json()) == 1
