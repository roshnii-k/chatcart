import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { confirmOrder, createMessageEvent, exportConfirmedOrders, getOrder, getOrders, saveMessageEventDraft, updateOrder, updateOrderStatus } from "./api";
import AgentWorkspace from "./AgentWorkspace";
import "./style.css";

const SAMPLE = "I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur.\n\nI need 2 pies.";
const STATUSES = ["Needs Review", "Needs Clarification", "Confirmed", "In Progress", "Completed", "Cancelled"];
const BUSINESS_TYPES = ["Bakery or home kitchen", "Cafe or restaurant", "Retail or boutique", "Other business"];

function Icon({ name, size = 18 }) {
  const paths = {
    bag: <><path d="M5 8h14l1 12H4L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    download: <><path d="M12 4v12m-4-4 4 4 4-4" /><path d="M4 19h16" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2" /></>,
    message: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8 8 0 0 1-3.7-.9L4 20l1.3-3.7A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" /><path d="M8 12h8m-8-3h5" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.bag}</svg>;
}
const shortId = (id) => id ? id.slice(-6).toUpperCase() : "—";
const money = (value) => value == null || Number.isNaN(Number(value)) ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const humanize = (field) => (field || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value.slice(0, 10) + "T00:00:00");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
function toForm(order = {}) {
  return {
    customer_name: order.customer_name ?? "", product_name: order.product_name ?? "",
    quantity: order.quantity == null ? "" : String(order.quantity),
    unit_price: order.unit_price == null ? "" : String(order.unit_price),
    delivery_date: order.delivery_date ? order.delivery_date.slice(0, 10) : "",
    delivery_address: order.delivery_address ?? "", special_instructions: order.special_instructions ?? "",
  };
}
function toPayload(values) {
  const text = (value) => value.trim() || null;
  return {
    customer_name: text(values.customer_name), product_name: text(values.product_name),
    quantity: values.quantity === "" ? null : Number(values.quantity),
    unit_price: values.unit_price === "" ? null : Number(values.unit_price),
    delivery_date: values.delivery_date || null, delivery_address: text(values.delivery_address),
    special_instructions: text(values.special_instructions),
  };
}
function StatusBadge({ status }) {
  return <span className={"status-badge status-" + (status || "").toLowerCase().replaceAll(" ", "-")}>{status}</span>;
}
function SummaryCard({ label, value, icon, tint }) {
  return <article className="summary-card"><div className={"summary-icon summary-icon-" + tint}><Icon name={icon} size={19} /></div><div><span className="summary-label">{label}</span><strong className="summary-value">{value}</strong></div></article>;
}
function Field({ label, name, value, onChange, type = "text", placeholder, min, step, prefix }) {
  const id = prefix + "-" + name;
  return <label className="field" htmlFor={id}><span>{label}</span><input id={id} type={type} value={value} placeholder={placeholder} min={min} step={step} onChange={(event) => onChange(name, event.target.value)} /></label>;
}
function OrderForm({ values, onChange, prefix }) {
  return <div className="fields-grid">
    <Field prefix={prefix} label="Customer" name="customer_name" value={values.customer_name} onChange={onChange} placeholder="Customer name" />
    <Field prefix={prefix} label="Product" name="product_name" value={values.product_name} onChange={onChange} placeholder="What was ordered?" />
    <Field prefix={prefix} label="Quantity" name="quantity" value={values.quantity} onChange={onChange} type="number" min="1" step="1" placeholder="e.g. 3" />
    <Field prefix={prefix} label="Unit price (₹)" name="unit_price" value={values.unit_price} onChange={onChange} type="number" min="0.01" step="0.01" placeholder="e.g. 500" />
    <Field prefix={prefix} label="Delivery date" name="delivery_date" value={values.delivery_date} onChange={onChange} type="date" />
    <Field prefix={prefix} label="Delivery address" name="delivery_address" value={values.delivery_address} onChange={onChange} placeholder="Street, area, city" />
    <label className="field field-wide" htmlFor={prefix + "-instructions"}><span>Special instructions <small>Optional</small></span><textarea id={prefix + "-instructions"} value={values.special_instructions} onChange={(event) => onChange("special_instructions", event.target.value)} rows="2" placeholder="Allergies, delivery notes, or other details" /></label>
  </div>;
}

function App() {
  const [business, setBusiness] = useState(() => window.localStorage.getItem("chatcartBusiness") || "");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [messageText, setMessageText] = useState("");
  const [processing, setProcessing] = useState(false);
  const [extractions, setExtractions] = useState([]);
  const [agentRevision, setAgentRevision] = useState(0);
  const [sourceMode, setSourceMode] = useState("manual");
  const [toast, setToast] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [reviewId, setReviewId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editValues, setEditValues] = useState(toForm());
  const [reviewLoading, setReviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  async function loadOrders() {
    setLoading(true); setLoadError("");
    try { setOrders(await getOrders()); }
    catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    loadOrders();
    const refreshFromAgent = async () => {
      try {
        setOrders(await getOrders());
        setLoadError("");
      } catch (error) {
        setLoadError((current) => current || error.message);
      }
    };
    const interval = window.setInterval(refreshFromAgent, 5000);
    window.addEventListener("focus", refreshFromAgent);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshFromAgent);
    };
  }, []);
  useEffect(() => {
    if (!reviewId) return undefined;
    const keydown = (event) => { if (event.key === "Escape") closeReview(); };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [reviewId]);

  const counts = useMemo(() => ({
    total: orders.length,
    review: orders.filter((item) => item.status === "Needs Review").length,
    clarification: orders.filter((item) => item.status === "Needs Clarification").length,
    completed: orders.filter((item) => item.status === "Completed").length,
  }), [orders]);
  const clarificationOrders = useMemo(() => orders.filter((item) => item.status === "Needs Clarification"), [orders]);
  const shownOrders = useMemo(() => orders.filter((item) => {
    const query = search.trim().toLowerCase();
    return (!query || (item.customer_name || "").toLowerCase().includes(query) || (item.product_name || "").toLowerCase().includes(query)) &&
      (statusFilter === "All statuses" || item.status === statusFilter);
  }), [orders, search, statusFilter]);

  function notify(kind, message) { setToast({ kind, message }); }
  function errorMessage(error) {
    if (error.status === 404 && error.message.toLowerCase().includes("confirmed")) return "There are no confirmed orders to export yet.";
    return error.message || "Something went wrong. Please try again.";
  }
  async function processMessages() {
    const messages = messageText.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
    if (!messages.length) { notify("error", "Paste at least one customer message to process."); return; }
    if (messages.some((item) => item.length > 4000)) { notify("error", "Each message must be 4,000 characters or fewer."); return; }
    setProcessing(true); setExtractions([]);
    const results = await Promise.all(messages.map(async (message) => {
      try {
        const event = await createMessageEvent({
          event_id: globalThis.crypto?.randomUUID?.() || ("chatcart-" + Date.now() + "-" + Math.random().toString(16).slice(2)),
          source: sourceMode,
          message,
        });
        if (["duplicate_warning", "duplicate_event", "correction_proposed"].includes(event.processing_state)) {
          return { message, event_id: event.event_id, event, response: event.extraction, order: null, error: "" };
        }
        const saved = await saveMessageEventDraft(event.event_id);
        return { message, event_id: event.event_id, event: saved.event, response: event.extraction, order: saved.order, error: "" };
      } catch (error) { return { message, event: null, event_id: null, response: null, values: null, error: errorMessage(error) }; }
    }));
    setExtractions(results); setProcessing(false); setAgentRevision((value) => value + 1);
    const savedOrders = results.map((item) => item.order).filter(Boolean);
    if (savedOrders.length) {
      setOrders((current) => [...savedOrders, ...current.filter((order) => !savedOrders.some((saved) => saved.order_id === order.order_id))]);
      notify("success", `${savedOrders.length} message${savedOrders.length === 1 ? "" : "s"} added to the portal as reviewable order${savedOrders.length === 1 ? "" : "s"}.`);
      setMessageText("");
    } else if (results.some((item) => item.response)) {
      notify("error", "No orders were added. Review the duplicate or correction notice below.");
    } else {
      notify("error", "None of the messages could be processed. Check the backend connection and try again.");
    }
  }
  async function openReview(id) {
    setReviewId(id); setSelectedOrder(null); setReviewError(""); setDirty(false); setReviewLoading(true);
    try { const order = await getOrder(id); setSelectedOrder(order); setEditValues(toForm(order)); }
    catch (error) { setReviewError(error.message); }
    finally { setReviewLoading(false); }
  }
  function closeReview() { setReviewId(null); setSelectedOrder(null); setReviewError(""); setDirty(false); }
  function changeField(name, value) {
    setEditValues((current) => ({ ...current, [name]: value }));
    setDirty(true); setReviewError("");
  }
  function replaceOrder(updated) {
    setOrders((current) => current.map((item) => item.order_id === updated.order_id ? updated : item));
    setSelectedOrder(updated); setEditValues(toForm(updated));
  }
  async function saveChanges() {
    if (!selectedOrder || !dirty) return;
    setSaving(true); setReviewError("");
    try { replaceOrder(await updateOrder(selectedOrder.order_id, toPayload(editValues))); setDirty(false); notify("success", "Order changes saved."); }
    catch (error) { setReviewError(error.message); }
    finally { setSaving(false); }
  }
  async function confirmSelected() {
    if (!selectedOrder) return;
    setActionLoading(true); setReviewError("");
    try { replaceOrder(await confirmOrder(selectedOrder.order_id)); notify("success", "Order confirmed."); }
    catch (error) { setReviewError(error.message); }
    finally { setActionLoading(false); }
  }
  async function changeStatus(status) {
    if (!selectedOrder || status === "Confirmed" || status === selectedOrder.status) return;
    setActionLoading(true); setReviewError("");
    try { replaceOrder(await updateOrderStatus(selectedOrder.order_id, status)); notify("success", "Status updated to " + status + "."); }
    catch (error) { setReviewError(error.message); }
    finally { setActionLoading(false); }
  }
  async function exportOrders() {
    setExporting(true);
    try {
      const response = await exportConfirmedOrders();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "chatcart-orders.csv"; document.body.appendChild(link);
      link.click(); link.remove(); URL.revokeObjectURL(url); notify("success", "Confirmed orders exported.");
    } catch (error) { notify("error", errorMessage(error)); }
    finally { setExporting(false); }
  }

  function chooseBusiness(value) {
    const selected = value.trim();
    if (!selected) return;
    window.localStorage.setItem("chatcartBusiness", selected);
    setBusiness(selected);
  }

  if (!business) return <main className="onboarding-shell">
    <section className="onboarding-card">
      <a className="brand onboarding-brand" href="#welcome"><span className="brand-mark"><Icon name="message" size={20} /></span><span className="brand-copy"><strong>ChatCart</strong><span>Customer messages to organized orders</span></span></a>
      <p className="eyebrow">A simpler order workspace</p>
      <h1>Which business are you working on?</h1>
      <p className="onboarding-intro">Choose a business type to set up your workspace. You can paste customer messages and turn them into reviewable orders.</p>
      <div className="business-options">{BUSINESS_TYPES.map((type) => <button key={type} className="business-option" onClick={() => chooseBusiness(type)}><span>{type}</span><Icon name="arrow" size={17} /></button>)}</div>
      <form className="custom-business" onSubmit={(event) => { event.preventDefault(); chooseBusiness(event.currentTarget.elements.business.value); }}>
        <label htmlFor="business-name">Or enter your business name or type</label>
        <div><input id="business-name" name="business" maxLength="80" placeholder="e.g. Rose Villa Bakery" /><button className="button button-primary" type="submit">Continue</button></div>
      </form>
      <p className="onboarding-note">Your choice is saved in this browser. ChatCart does not connect to WhatsApp automatically; paste copied message text in the dashboard.</p>
    </section>
  </main>;

  return <div className="app-shell">
    <header className="topbar"><div className="topbar-inner">
      <a className="brand" href="#dashboard" aria-label="ChatCart dashboard"><span className="brand-mark"><Icon name="message" size={20} /></span><span className="brand-copy"><strong>ChatCart</strong><span>From customer conversations to confirmed orders.</span></span></a>
      <button className="demo-pill business-switch" onClick={() => { window.localStorage.removeItem("chatcartBusiness"); setBusiness(""); }}><span className="demo-dot" />{business}<span className="switch-label">Change</span></button>
    </div></header>
    <main id="dashboard" className="page">
      <div className="page-heading"><div><p className="eyebrow">Order workspace</p><h1>Your orders, in one place.</h1><p className="page-subtitle">Turn customer messages into clear, reviewable orders.</p></div>
        <button className="button button-secondary export-button" onClick={exportOrders} disabled={exporting}><Icon name="download" size={17} />{exporting ? "Preparing export…" : "Export confirmed orders"}</button>
      </div>
      {loadError && <div className="connection-banner" role="alert"><div><strong>Can’t load orders</strong><span>{loadError}</span></div><button className="button button-secondary button-small" onClick={loadOrders}><Icon name="refresh" size={15} />Retry</button></div>}
      <section className="summary-grid" aria-label="Order summary">
        <SummaryCard label="Total orders" value={loading ? "—" : counts.total} icon="bag" tint="sage" />
        <SummaryCard label="Needs review" value={loading ? "—" : counts.review} icon="clock" tint="amber" />
        <SummaryCard label="Needs clarification" value={loading ? "—" : counts.clarification} icon="alert" tint="rose" />
        <SummaryCard label="Completed" value={loading ? "—" : counts.completed} icon="check" tint="blue" />
      </section>
      <AgentWorkspace revision={agentRevision} onOpenOrder={openReview} onOrdersChanged={loadOrders} />
      <section className="work-grid">
        <article className="panel message-panel">
          <div className="panel-heading"><div className="panel-title-wrap"><span className="section-icon"><Icon name="message" size={18} /></span><div><h2>Paste a customer message</h2><p>Copy a message from your chat and paste it here. Separate multiple messages with a blank line.</p></div></div><span className="fixture-label">{sourceMode === "demo_fixture" ? "Demo fixture" : "Manual input"}</span></div>
          <label className="sr-only" htmlFor="customer-messages">Customer order messages</label>
          <textarea id="customer-messages" className="message-input" value={messageText} onChange={(event) => { setMessageText(event.target.value); setSourceMode("manual"); }} placeholder={"Example: I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur.\n\nPaste another message after a blank line."} rows="6" />
          <div className="message-footer"><span className="input-hint">Messages are added to All orders as drafts for review—not automatically confirmed.</span><div className="button-row"><button className="button button-quiet" onClick={() => { setMessageText(SAMPLE); setExtractions([]); setSourceMode("demo_fixture"); }}>Load sample</button><button className="button button-primary" onClick={processMessages} disabled={processing || !messageText.trim()}>{processing ? <><span className="spinner" />Adding…</> : <><Icon name="arrow" size={17} />Add to portal</>}</button></div></div>
        </article>
        <article className="panel clarification-panel">
          <div className="panel-heading"><div className="panel-title-wrap"><span className="section-icon section-icon-amber"><Icon name="alert" size={18} /></span><div><h2>Needs clarification</h2><p>Orders waiting on missing details.</p></div></div><span className="count-chip">{loading ? "…" : clarificationOrders.length}</span></div>
          {loading ? <div className="inline-loading"><span className="spinner spinner-dark" />Loading orders</div> : clarificationOrders.length ? <div className="clarification-list">
            {clarificationOrders.slice(0, 4).map((order) => <button className="clarification-item" key={order.order_id} onClick={() => openReview(order.order_id)}><span className="clarification-copy"><strong>{order.product_name || "Order details needed"}</strong><span>{order.missing_fields?.length ? order.missing_fields.map(humanize).join(", ") : "Review validation issues"}</span></span><span className="clarification-arrow"><Icon name="arrow" size={16} /></span></button>)}
            {clarificationOrders.length > 4 && <p className="more-note">+{clarificationOrders.length - 4} more in the orders list</p>}
          </div> : <div className="mini-empty"><span className="mini-empty-icon"><Icon name="check" size={18} /></span><span>Nothing waiting for clarification.</span></div>}
        </article>
      </section>

      {extractions.length > 0 && <section className="panel extracted-panel" aria-labelledby="extracted-heading">
        <div className="panel-heading extracted-heading"><div><p className="eyebrow">Message results</p><h2 id="extracted-heading">Portal update results</h2><p className="panel-description">Saved orders appear in All orders. Review and complete details before confirming.</p></div><button className="icon-button" aria-label="Clear message results" onClick={() => setExtractions([])}><Icon name="close" /></button></div>
        <div className="draft-list">{extractions.map((item, index) => {
          if (item.error) return <div className="draft-error" key={"error-" + index}><Icon name="alert" /><div><strong>Message couldn’t be processed</strong><p>{item.error}</p></div></div>;
          const order = item.response.order;
          const duplicateId = item.response.possible_duplicates?.[0], correction = item.response.possible_correction;
          return <article className="draft-card" key={"draft-" + index}>
            <div className="draft-card-head"><div><span className="draft-number">Message {index + 1}</span><h3>{order.product_name || "Unresolved order"}</h3></div><StatusBadge status={order.status} /></div>
            <blockquote className="message-quote">{item.message}</blockquote>
            {item.event?.duplicate_event_id && <div className="notice notice-warning"><Icon name="alert" /><span>This repeats an earlier source event. A second draft is blocked.</span></div>}
            {duplicateId && <div className="notice notice-warning"><Icon name="alert" /><span>Possible duplicate of order #{shortId(duplicateId)}.</span><button className="text-link" onClick={() => openReview(duplicateId)}>Review existing order</button></div>}
            {correction && <div className="notice notice-warning"><Icon name="refresh" /><span>Possible correction for #{shortId(correction.order_id)}: quantity {correction.original_details.quantity} → {correction.proposed_details.quantity}; total {money(correction.original_details.total_price)} → {money(correction.proposed_details.total_price)}. Nothing has been changed.</span><button className="text-link" onClick={() => openReview(correction.order_id)}>Review order</button></div>}
            {item.order ? <div className="draft-actions"><span className="draft-total">Added to portal <strong>#{shortId(item.order.order_id)} · {item.order.status}</strong></span><button className="button button-primary button-small" onClick={() => openReview(item.order.order_id)}>Review order</button></div> : null}
          </article>;
        })}</div>
      </section>}

      <section className="panel orders-panel" aria-labelledby="orders-heading">
        <div className="orders-heading"><div><p className="eyebrow">Order management</p><h2 id="orders-heading">All orders</h2></div><div className="table-controls">
          <label className="search-box" htmlFor="order-search"><Icon name="search" size={17} /><input id="order-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer or product" /></label>
          <label className="select-label" htmlFor="status-filter"><span className="sr-only">Filter by order status</span><select id="status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        </div></div>
        <div className="table-wrap"><table className="orders-table"><thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Qty</th><th>Total</th><th>Delivery</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {loading ? <tr><td colSpan="8"><div className="table-empty"><span className="spinner spinner-dark" />Loading orders…</div></td></tr> : shownOrders.length ? shownOrders.map((order) => <tr key={order.order_id}><td><span className="order-code">#{shortId(order.order_id)}</span></td><td>{order.customer_name || <span className="muted-value">Not provided</span>}</td><td><strong className="product-cell">{order.product_name || "—"}</strong></td><td>{order.quantity ?? "—"}</td><td className="total-cell">{money(order.total_price)}</td><td>{formatDate(order.delivery_date)}</td><td><StatusBadge status={order.status} /></td><td><button className="row-action" onClick={() => openReview(order.order_id)} aria-label={"Review order " + shortId(order.order_id)}>Review <Icon name="arrow" size={14} /></button></td></tr>) : <tr><td colSpan="8"><div className="table-empty table-empty-state"><span className="empty-icon"><Icon name="bag" size={22} /></span><strong>{orders.length ? "No orders match those filters" : "No orders yet"}</strong><span>{orders.length ? "Try a different search or status filter." : "Paste a customer message above to start your order list."}</span></div></td></tr>}
        </tbody></table></div>
        {!loading && <div className="table-foot">{shownOrders.length} of {orders.length} orders</div>}
      </section>
      <footer className="page-footer"><span>ChatCart</span><span>Keep the conversation. Lose the busywork.</span></footer>
    </main>
    {toast && <div className={"toast toast-" + toast.kind} role={toast.kind === "error" ? "alert" : "status"}><span className="toast-dot" />{toast.message}<button aria-label="Dismiss message" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div>}
    {reviewId && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReview(); }}>
      <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <div className="modal-heading"><div><p className="eyebrow">Order review</p><h2 id="review-title">{selectedOrder ? "Order #" + shortId(selectedOrder.order_id) : "Loading order…"}</h2></div><button className="icon-button" aria-label="Close order review" onClick={closeReview}><Icon name="close" /></button></div>
        {reviewLoading ? <div className="modal-loading"><span className="spinner spinner-dark" />Loading order details…</div> : reviewError && !selectedOrder ? <div className="notice notice-error">{reviewError}</div> : selectedOrder && <>
          <div className="modal-status-row"><StatusBadge status={selectedOrder.status} /><span>Created {new Date(selectedOrder.created_at).toLocaleString()}</span></div>
          {selectedOrder.original_message && <div className="original-message"><span className="detail-label">Original customer message</span><p>{selectedOrder.original_message}</p></div>}
          {selectedOrder.validation_issues?.length > 0 && <div className="notice notice-error"><Icon name="alert" /><div><strong>Validation issues</strong><ul>{selectedOrder.validation_issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div></div>}
          {selectedOrder.missing_fields?.length > 0 && <div className="notice notice-warning"><Icon name="alert" /><span>Missing: {selectedOrder.missing_fields.map(humanize).join(", ")}</span></div>}
          <div className="detail-total"><span>Calculated total</span><strong>{money(Number(editValues.quantity) > 0 && Number(editValues.unit_price) > 0 ? Number(editValues.quantity) * Number(editValues.unit_price) : null)}</strong></div>
          <h3 className="form-section-title">Order details</h3><OrderForm values={editValues} onChange={changeField} prefix="review" />
          <div className="status-edit"><label htmlFor="order-status">Update status</label><select id="order-status" value={selectedOrder.status} onChange={(event) => changeStatus(event.target.value)} disabled={actionLoading}>{STATUSES.map((status) => <option key={status} value={status} disabled={status === "Confirmed"}>{status}</option>)}</select></div>
          {reviewError && <p className="form-error" role="alert">{reviewError}</p>}
          <div className="modal-actions"><button className="button button-quiet" onClick={closeReview}>Close</button><div className="modal-action-group">
            <button className="button button-secondary" onClick={confirmSelected} disabled={actionLoading || selectedOrder.status === "Confirmed" || selectedOrder.status === "Cancelled" || selectedOrder.missing_fields?.length > 0 || selectedOrder.validation_issues?.length > 0}>Confirm order</button>
            <button className="button button-primary" onClick={saveChanges} disabled={saving || !dirty}>{saving ? "Saving…" : "Save changes"}</button>
          </div></div>
        </>}
      </section>
    </div>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
