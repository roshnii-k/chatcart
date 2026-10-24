from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from . import agent_store, store
from .agent_models import ChangeProposal, MessageEvent, MessageEventRequest, ProposalDecisionResult, SavedDraftResult, SourceInfo
from .extraction import extract_order, find_correction
from .models import ExtractResponse, OrderStatus, refresh_order
from .sources.adapters import get_source_adapter, source_catalog

router=APIRouter(prefix="/api",tags=["agent"])

def _uuid(value,label):
    try: return str(UUID(value))
    except ValueError as exc: raise HTTPException(400,detail=f"{label} must be a valid UUID.") from exc

def _extract(message):
    order,issues=extract_order(message)
    duplicates=store.find_exact_message(message)
    correction=find_correction(message)
    proposal_data=None
    if correction:
        order_id,quantity=correction
        current=store.get_order(order_id)
        if current:
            proposed=refresh_order(current.model_copy(update={"quantity":quantity,"updated_at":datetime.now(timezone.utc)}))
            proposal_data={"order_id":current.order_id,
             "original_details":{"quantity":current.quantity,"total_price":current.total_price},
             "proposed_details":{"quantity":proposed.quantity,"total_price":proposed.total_price},"applied":False}
            order=proposed; issues=proposed.validation_issues
    return ExtractResponse(demo_mode=True,order=order,validation_issues=issues,
        possible_duplicates=duplicates,possible_correction=proposal_data)

@router.get("/agent/sources",response_model=list[SourceInfo])
def sources(): return [SourceInfo(**s) for s in source_catalog()]

@router.get("/message-events",response_model=list[MessageEvent])
def events(limit:int=Query(default=40,ge=1,le=100)): return agent_store.list_events(limit)

@router.post("/message-events",response_model=MessageEvent,status_code=201)
def receive_event(request:MessageEventRequest):
    event_id=str(request.event_id)
    existing=agent_store.get_event(event_id)
    if existing: return existing
    extraction=_extract(request.message)
    digest=agent_store.message_hash(request.message)
    prior=agent_store.find_matching_event(request.source,request.sender_id,digest,event_id)
    proposal=None
    if extraction.possible_correction:
        c=extraction.possible_correction
        proposal=ChangeProposal(event_id=event_id,order_id=c["order_id"],
          reason="The message references this order UUID and proposes a quantity change.",
          original_values=c["original_details"],proposed_values=c["proposed_details"])
        state="correction_proposed"
    elif extraction.possible_duplicates: state="duplicate_warning"
    elif prior and prior.processing_state!="failed": state="duplicate_event"
    else: state="needs_seller_review"
    event=get_source_adapter(request.source).make_event(request,extraction,state)
    if proposal: event=event.model_copy(update={"proposal_id":proposal.proposal_id})
    if state=="duplicate_event" and prior: event=event.model_copy(update={"duplicate_event_id":prior.event_id})
    return agent_store.insert_event(event,digest,proposal)[0]

@router.post("/message-events/{event_id}/save-draft",response_model=SavedDraftResult)
def save_draft(event_id:str):
    event=agent_store.get_event(_uuid(event_id,"event_id"))
    if not event: raise HTTPException(404,detail="Message event was not found.")
    if event.order_id:
        order=store.get_order(event.order_id)
        if not order: raise HTTPException(500,detail="Linked order could not be loaded.")
        return SavedDraftResult(event=event,order=order)
    if event.processing_state in {"duplicate_warning","duplicate_event","correction_proposed"}:
        raise HTTPException(409,detail="Review the duplicate or correction warning before saving a draft.")
    order=event.extraction.order.model_copy(update={"original_message":event.original_message,
      "validation_issues":event.extraction.validation_issues,"updated_at":datetime.now(timezone.utc)})
    order=refresh_order(order,preserve_timestamps=False)
    try: saved_event,order=agent_store.persist_draft(event,order)
    except LookupError as exc: raise HTTPException(404,detail=str(exc)) from exc
    return SavedDraftResult(event=saved_event,order=order)

@router.get("/change-proposals",response_model=list[ChangeProposal])
def proposals(state:str|None=Query(default="Pending")):
    if state not in {None,"Pending","Approved","Rejected"}:
        raise HTTPException(422,detail="state must be Pending, Approved, Rejected, or omitted.")
    return agent_store.list_proposals(state)

@router.post("/change-proposals/{proposal_id}/approve",response_model=ProposalDecisionResult)
def approve(proposal_id:str):
    proposal=agent_store.get_proposal(_uuid(proposal_id,"proposal_id"))
    if not proposal: raise HTTPException(404,detail="Change proposal was not found.")
    order=store.get_order(proposal.order_id)
    if not order: raise HTTPException(404,detail="Proposal order was not found.")
    if proposal.state=="Rejected": raise HTTPException(409,detail="Rejected proposal cannot be approved.")
    if proposal.state=="Pending":
        from .models import OrderStatus
        if order.status==OrderStatus.CANCELLED: raise HTTPException(409,detail="Cancelled orders cannot be changed.")
        allowed={"quantity","unit_price","delivery_date","delivery_address","special_instructions"}
        updates={k:v for k,v in proposal.proposed_values.items() if k in allowed}
        if not updates: raise HTTPException(409,detail="Proposal has no supported changes.")
        order=refresh_order(order.model_copy(update={**updates,"updated_at":datetime.now(timezone.utc)}),preserve_timestamps=False)
        proposal=proposal.model_copy(update={"state":"Approved","decided_at":datetime.now(timezone.utc)})
        agent_store.decide_proposal(proposal,order)
    return ProposalDecisionResult(proposal=proposal,order=order)

@router.post("/change-proposals/{proposal_id}/reject",response_model=ChangeProposal)
def reject(proposal_id:str):
    proposal=agent_store.get_proposal(_uuid(proposal_id,"proposal_id"))
    if not proposal: raise HTTPException(404,detail="Change proposal was not found.")
    if proposal.state=="Approved": raise HTTPException(409,detail="Approved proposal cannot be rejected.")
    if proposal.state=="Pending":
        proposal=proposal.model_copy(update={"state":"Rejected","decided_at":datetime.now(timezone.utc)})
        agent_store.decide_proposal(proposal)
    return proposal
