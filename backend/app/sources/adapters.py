from typing import Protocol
from ..agent_models import MessageEvent, MessageEventRequest
from ..models import ExtractResponse

class MessageSourceAdapter(Protocol):
    source_id: str
    demo_mode: bool
    def make_event(self, request: MessageEventRequest, extraction: ExtractResponse, state: str) -> MessageEvent: ...

class ManualPasteAdapter:
    source_id = "manual"
    demo_mode = False
    def make_event(self, request, extraction, state):
        return MessageEvent(event_id=str(request.event_id), source=self.source_id,
            sender_name=request.sender_name, sender_phone=request.sender_phone,
            sender_id=request.sender_id or request.sender_phone,
            occurred_at=request.occurred_at, original_message=request.message,
            processing_state=state, extraction=extraction, demo_mode=False)

class DemoFixtureAdapter(ManualPasteAdapter):
    source_id = "demo_fixture"
    demo_mode = True
    def make_event(self, request, extraction, state):
        event = super().make_event(request, extraction, state)
        return event.model_copy(update={"source": self.source_id, "demo_mode": True})

class WhatsAppWebAdapter(ManualPasteAdapter):
    source_id = "whatsapp_web"

_ADAPTERS = {
    "manual": ManualPasteAdapter(),
    "demo_fixture": DemoFixtureAdapter(),
    "whatsapp_web": WhatsAppWebAdapter(),
}
def get_source_adapter(source_id):
    return _ADAPTERS[source_id]

def source_catalog():
    return [
        {"source_id":"manual","label":"Manual paste","status":"Supported","description":"Seller-submitted customer message text.","demo_mode":False},
        {"source_id":"demo_fixture","label":"Demo fixture","status":"Demo","description":"Synthetic sample messages; not a desktop notification.","demo_mode":True},
        {"source_id":"whatsapp_web","label":"WhatsApp Web","status":"Experimental","description":"Opt-in extension reads rendered incoming messages; live compatibility is unverified.","demo_mode":False},
    ]
