from .agent_models import ChangeProposal, MessageEvent
from .database import connection_scope, initialize_database
from .models import Order

def ensure_tables():
    initialize_database()
    with connection_scope() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS message_events (
            event_id TEXT PRIMARY KEY, source TEXT NOT NULL, sender_id TEXT,
            message_hash TEXT NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_msg_event_match ON message_events(source,sender_id,message_hash)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_msg_event_received ON message_events(received_at DESC)")
        db.execute("""CREATE TABLE IF NOT EXISTS change_proposals (
            proposal_id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES message_events(event_id),
            order_id TEXT NOT NULL REFERENCES orders(order_id), state TEXT NOT NULL,
            payload TEXT NOT NULL, created_at TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_proposal_state ON change_proposals(state,created_at DESC)")

def message_hash(message):
    import hashlib
    return hashlib.sha256(" ".join(message.casefold().split()).encode("utf-8")).hexdigest()

def get_event(event_id):
    ensure_tables()
    with connection_scope() as db:
        row=db.execute("SELECT payload FROM message_events WHERE event_id=?",(event_id,)).fetchone()
    return MessageEvent.model_validate_json(row["payload"]) if row else None

def update_event(event):
    ensure_tables()
    with connection_scope() as db:
        db.execute("UPDATE message_events SET payload=? WHERE event_id=?",
          (event.model_dump_json(),event.event_id))
        row=db.execute("SELECT payload FROM message_events WHERE event_id=?",(event.event_id,)).fetchone()
    return MessageEvent.model_validate_json(row["payload"]) if row else None

def find_matching_event(source,sender_id,digest,exclude_id):
    ensure_tables()
    with connection_scope() as db:
        row=db.execute("""SELECT payload FROM message_events WHERE source=? AND sender_id IS ?
          AND message_hash=? AND event_id<>? ORDER BY received_at DESC LIMIT 1""",
          (source,sender_id,digest,exclude_id)).fetchone()
    return MessageEvent.model_validate_json(row["payload"]) if row else None

def insert_event(event,digest,proposal=None):
    ensure_tables()
    with connection_scope() as db:
        cur=db.execute("""INSERT OR IGNORE INTO message_events(event_id,source,sender_id,message_hash,payload,received_at)
          VALUES(?,?,?,?,?,?)""",(event.event_id,event.source,event.sender_id,digest,event.model_dump_json(),event.received_at.isoformat()))
        inserted=cur.rowcount==1
        if inserted and proposal:
            db.execute("""INSERT INTO change_proposals(proposal_id,event_id,order_id,state,payload,created_at)
              VALUES(?,?,?,?,?,?)""",(proposal.proposal_id,proposal.event_id,proposal.order_id,proposal.state,proposal.model_dump_json(),proposal.created_at.isoformat()))
        row=db.execute("SELECT payload FROM message_events WHERE event_id=?",(event.event_id,)).fetchone()
    return MessageEvent.model_validate_json(row["payload"]),inserted

def list_events(limit=40):
    ensure_tables()
    with connection_scope() as db:
        rows=db.execute("SELECT payload FROM message_events ORDER BY received_at DESC LIMIT ?",(limit,)).fetchall()
    return [MessageEvent.model_validate_json(r["payload"]) for r in rows]

def list_proposals(state="Pending"):
    ensure_tables()
    with connection_scope() as db:
        if state:
            rows=db.execute("SELECT payload FROM change_proposals WHERE state=? ORDER BY created_at DESC",(state,)).fetchall()
        else:
            rows=db.execute("SELECT payload FROM change_proposals ORDER BY created_at DESC").fetchall()
    return [ChangeProposal.model_validate_json(r["payload"]) for r in rows]

def get_proposal(proposal_id):
    ensure_tables()
    with connection_scope() as db:
        row=db.execute("SELECT payload FROM change_proposals WHERE proposal_id=?",(proposal_id,)).fetchone()
    return ChangeProposal.model_validate_json(row["payload"]) if row else None

def persist_draft(event,order):
    ensure_tables()
    updated=event.model_copy(update={"processing_state":"draft_created","order_id":order.order_id})
    with connection_scope() as db:
        row=db.execute("SELECT payload FROM message_events WHERE event_id=?",(event.event_id,)).fetchone()
        if not row: raise LookupError("Message event was not found.")
        saved=MessageEvent.model_validate_json(row["payload"])
        if saved.order_id:
            order_row=db.execute("SELECT payload FROM orders WHERE order_id=?",(saved.order_id,)).fetchone()
            return saved,Order.model_validate_json(order_row["payload"])
        db.execute("INSERT INTO orders(order_id,payload,created_at,updated_at) VALUES(?,?,?,?)",
          (order.order_id,order.model_dump_json(),order.created_at.isoformat(),order.updated_at.isoformat()))
        db.execute("UPDATE message_events SET payload=? WHERE event_id=?",(updated.model_dump_json(),event.event_id))
    return updated,order

def decide_proposal(proposal,order=None):
    ensure_tables()
    with connection_scope() as db:
        if order:
            db.execute("UPDATE orders SET payload=?,updated_at=? WHERE order_id=?",
              (order.model_dump_json(),order.updated_at.isoformat(),order.order_id))
        db.execute("UPDATE change_proposals SET state=?,payload=? WHERE proposal_id=?",
          (proposal.state,proposal.model_dump_json(),proposal.proposal_id))
        row=db.execute("SELECT payload FROM message_events WHERE event_id=?",(proposal.event_id,)).fetchone()
        if row:
            event=MessageEvent.model_validate_json(row["payload"])
            new_state="proposal_approved" if proposal.state=="Approved" else "proposal_rejected"
            db.execute("UPDATE message_events SET payload=? WHERE event_id=?",
              (event.model_copy(update={"processing_state":new_state}).model_dump_json(),proposal.event_id))
    return proposal
