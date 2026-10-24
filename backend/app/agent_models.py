from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID, uuid4
from pydantic import BaseModel, ConfigDict, Field
from .models import ExtractResponse, Order

SourceId = Literal["manual", "demo_fixture", "whatsapp_web"]

class MessageEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: UUID
    source: SourceId
    message: str = Field(min_length=1, max_length=4000)
    sender_name: str | None = Field(default=None, max_length=200)
    sender_id: str | None = Field(default=None, max_length=200)
    occurred_at: datetime | None = None

class MessageEvent(BaseModel):
    event_id: str
    source: SourceId
    sender_name: str | None = None
    sender_id: str | None = None
    occurred_at: datetime | None = None
    received_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    original_message: str
    processing_state: str
    extraction: ExtractResponse
    order_id: str | None = None
    proposal_id: str | None = None
    duplicate_event_id: str | None = None
    demo_mode: bool = False

class ChangeProposal(BaseModel):
    proposal_id: str = Field(default_factory=lambda: str(uuid4()))
    event_id: str
    order_id: str
    state: Literal["Pending", "Approved", "Rejected"] = "Pending"
    reason: str
    original_values: dict[str, Any]
    proposed_values: dict[str, Any]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    decided_at: datetime | None = None

class SourceInfo(BaseModel):
    source_id: str
    label: str
    status: str
    description: str
    demo_mode: bool = False

class SavedDraftResult(BaseModel):
    event: MessageEvent
    order: Order

class ProposalDecisionResult(BaseModel):
    proposal: ChangeProposal
    order: Order
