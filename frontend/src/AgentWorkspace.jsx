import { useEffect, useMemo, useState } from "react";
import { decideChangeProposal, getAgentSources, getChangeProposals, getMessageEvents } from "./api";

const sourceLabel = (sources, id) => sources.find((item) => item.source_id === id)?.label || id;
const timeLabel = (value) => value ? new Date(value).toLocaleString() : "Time unavailable";
const stateLabel = (value) => ({
  needs_seller_review: "Needs review",
  duplicate_warning: "Possible duplicate",
  duplicate_event: "Repeated event",
  correction_proposed: "Correction proposed",
  draft_created: "Draft created",
  proposal_approved: "Proposal approved",
  proposal_rejected: "Proposal rejected",
}[value] || value.replaceAll("_", " "));
const displayValue = (value) => value == null || value === "" ? "Not set" : String(value);

export default function AgentWorkspace({ revision, onOpenOrder, onOrdersChanged }) {
  const [sources, setSources] = useState([]);
  const [events, setEvents] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [decisionId, setDecisionId] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [sourceData, eventData, proposalData] = await Promise.all([
        getAgentSources(), getMessageEvents(), getChangeProposals("Pending"),
      ]);
      setSources(sourceData);
      setEvents(eventData);
      setProposals(proposalData);
      setSelectedId((current) => current || eventData[0]?.event_id || "");
    } catch (loadFailure) {
      setError(loadFailure.message || "Could not load agent activity.");
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => refresh({ silent: true }), 5000);
    return () => window.clearInterval(interval);
  }, [revision]);

  const selected = useMemo(() => events.find((item) => item.event_id === selectedId) || null, [events, selectedId]);

  async function decide(proposalId, action) {
    setDecisionId(proposalId);
    setError("");
    setNotice("");
    try {
      await decideChangeProposal(proposalId, action);
      setNotice(action === "approve" ? "Correction approved and applied." : "Correction proposal rejected.");
      await Promise.all([refresh(), onOrdersChanged()]);
    } catch (failure) {
      setError(failure.message || "Could not update the correction proposal.");
    } finally {
      setDecisionId("");
    }
  }

  return <section className="panel agent-panel" aria-labelledby="agent-heading">
    <div className="agent-heading">
      <div><p className="eyebrow">Message intake</p><h2 id="agent-heading">Agent activity & review</h2>
        <p>Use manual paste or the opt-in ChatCart extension with WhatsApp Web open. Incoming drafts appear in Orders.</p></div>
      <div className="agent-status"><span className="agent-status-dot" />Local MVP</div>
    </div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {notice && <p className="agent-notice" role="status">{notice}</p>}
    <div className="source-list" aria-label="Message sources">
      {sources.map((source) => <div className="source-item" key={source.source_id}>
        <div><strong>{source.label}</strong><span>{source.description}</span></div>
        <span className={"source-badge source-" + source.status.toLowerCase().replaceAll(" ", "-")}>{source.status}</span>
      </div>)}
      {!sources.length && !loading && <p className="agent-empty">Source status unavailable.</p>}
    </div>
    <div className="agent-columns">
      <section className="agent-subpanel" aria-labelledby="activity-heading">
        <div className="agent-subheading"><div><h3 id="activity-heading">Incoming activity</h3><p>Stored message events, newest first.</p></div>
          <button className="button button-quiet button-small" onClick={refresh} disabled={loading}>Refresh</button></div>
        {loading ? <p className="agent-empty">Loading activity…</p> : events.length ? <div className="activity-list">
          {events.slice(0, 8).map((event) => <button className={"activity-item" + (event.event_id === selectedId ? " activity-selected" : "")}
            key={event.event_id} onClick={() => setSelectedId(event.event_id)}>
            <span className="activity-copy"><strong>{sourceLabel(sources, event.source)}{event.demo_mode && <em>Demo</em>}</strong>
              <span>{event.sender_name || "Sender not provided"} · {timeLabel(event.occurred_at || event.received_at)}</span></span>
            <span className="activity-state">{stateLabel(event.processing_state)}</span>
          </button>)}
        </div> : <p className="agent-empty">No messages processed yet. Paste a message above to create the first activity event.</p>}
      </section>
      <section className="agent-subpanel" aria-labelledby="proposal-heading">
        <div className="agent-subheading"><div><h3 id="proposal-heading">Correction review queue</h3><p>Changes wait for your approval.</p></div><span className="count-chip">{proposals.length}</span></div>
        {loading ? <p className="agent-empty">Loading proposals…</p> : proposals.length ? <div className="proposal-list">
          {proposals.map((proposal) => <article className="proposal-card" key={proposal.proposal_id}>
            <div className="proposal-card-head"><strong>Order #{proposal.order_id.slice(-6).toUpperCase()}</strong><span>Pending</span></div>
            <p>{proposal.reason}</p>
            <div className="proposal-diff"><span>Field</span><span>Current</span><span>Proposed</span>
              {Object.keys(proposal.proposed_values).filter((key) => key !== "total_price").map((key) => <div className="proposal-diff-row" key={key}>
                <strong>{key.replaceAll("_", " ")}</strong><span>{displayValue(proposal.original_values[key])}</span><b>{displayValue(proposal.proposed_values[key])}</b>
              </div>)}
              {proposal.original_values.total_price != null && <div className="proposal-diff-row"><strong>total price</strong><span>{displayValue(proposal.original_values.total_price)}</span><b>{displayValue(proposal.proposed_values.total_price)}</b></div>}
            </div>
            <div className="proposal-actions">
              <button className="text-link" onClick={() => onOpenOrder(proposal.order_id)}>Review order</button>
              <div><button className="button button-quiet button-small" onClick={() => decide(proposal.proposal_id, "reject")} disabled={decisionId === proposal.proposal_id}>Reject</button>
                <button className="button button-primary button-small" onClick={() => decide(proposal.proposal_id, "approve")} disabled={decisionId === proposal.proposal_id}>{decisionId === proposal.proposal_id ? "Saving…" : "Approve change"}</button></div>
            </div>
          </article>)}
        </div> : <p className="agent-empty">No pending correction proposals.</p>}
      </section>
    </div>
    {selected && <section className="event-detail" aria-label="Selected message details">
      <div className="agent-subheading"><div><h3>Message details</h3><p>{sourceLabel(sources, selected.source)} · {stateLabel(selected.processing_state)}{selected.demo_mode ? " · Demo event" : ""}</p></div>
        {selected.order_id && <button className="text-link" onClick={() => onOpenOrder(selected.order_id)}>Open linked order</button>}</div>
      <blockquote className="message-quote">{selected.original_message}</blockquote>
      {selected.duplicate_event_id && <p className="agent-warning">This repeats event {selected.duplicate_event_id.slice(-6).toUpperCase()}; a second draft is blocked.</p>}
      {selected.extraction?.order?.missing_fields?.length > 0 && <p className="agent-warning">Missing: {selected.extraction.order.missing_fields.join(", ")}</p>}
      {selected.extraction?.validation_issues?.length > 0 && <ul className="event-issues">{selected.extraction.validation_issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    </section>}
  </section>;
}
