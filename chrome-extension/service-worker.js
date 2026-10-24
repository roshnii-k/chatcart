const SEEN = "chatcartSeenMessageHashes";
const busy = new Set();
async function api(path, options = {}) {
  const { apiBaseUrl } = await chrome.storage.local.get("apiBaseUrl");
  const r = await fetch((apiBaseUrl || "http://127.0.0.1:8000") + path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const p = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) throw new Error(typeof p?.detail === "string" ? p.detail : p?.detail?.message || "API error " + r.status);
  return p;
}
async function hash(id, text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id + "\n" + text));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function notify(title, message) {
  return chrome.notifications.create({ type: "basic", iconUrl: "icon.png", title, message });
}
async function focusWhatsApp(tab) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    console.warn("ChatCart could not focus the WhatsApp Web tab", error);
  }
}
function looksLikeOrder(text) {
  return /\b(order|need|want|buy|purchase|deliver|delivery|send me|i['’]?d like|i would like|can i get|could i get|book|reserve|i['’]?ll take|i will take|please make|make me|change|correction|instead|actually)\b/i.test(text)
    || /\b\d+\s+(?:[-a-z]+\s+){0,3}(?:cakes?|cookies?|cupcakes?|loaves?|boxes?|bottles?|items?|pieces?|pcs)\b/i.test(text);
}
function eventUuid(hex) {
  const chars = hex.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
async function processMessage(message, sourceTab) {
  if (!message?.id || !message.text?.trim()) return true;
  const text = message.text.trim(), key = await hash(message.id, text);
  if (busy.has(key)) return true;
  busy.add(key);
  try {
    const savedKeys = await chrome.storage.local.get(SEEN), seen = savedKeys[SEEN] || [];
    if (seen.includes(key)) return true;
    if (!looksLikeOrder(text) && !message.maybeTruncated) return true;
    const event = await api("/api/message-events", { method: "POST", body: JSON.stringify({
      event_id: eventUuid(key),
      source: "whatsapp_web",
      message: text,
      sender_name: message.sender || null,
    }) });
    if (event.processing_state === "correction_proposed") {
      await chrome.storage.local.set({ [SEEN]: [...seen.slice(-499), key] });
      await notify("ChatCart correction needs review", "A change proposal was added to ChatCart. Review it before applying.");
      return true;
    }
    if (["duplicate_warning", "duplicate_event"].includes(event.processing_state)) {
      await chrome.storage.local.set({ [SEEN]: [...seen.slice(-499), key] });
      await notify("ChatCart found a possible repeat", "Review the message in ChatCart activity. No second order was created.");
      return true;
    }
    const { order } = await api(`/api/message-events/${encodeURIComponent(event.event_id)}/save-draft`, { method: "POST" });
    await chrome.storage.local.set({ [SEEN]: [...seen.slice(-499), key] });
    const qualifier = message.maybeTruncated ? " The message may be truncated; check the original chat." : "";
    await notify("ChatCart draft created", (order.product_name || "Order details needed") + " - " + order.status + ". Review in dashboard." + qualifier);
    return true;
  } catch (error) {
    if (message.maybeTruncated || looksLikeOrder(text)) {
      await notify("ChatCart could not save this order message", (error.message || "Check the backend.") + " The message remains in WhatsApp Web for manual review.");
    }
    throw error;
  } finally { busy.delete(key); }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type === "INCOMING") {
    processMessage(m.payload, sender.tab).then(
      () => reply({ ok: true }),
      error => reply({ ok: false, error: error.message || "Could not process this WhatsApp message." }),
    );
    return true;
  }
  if (m?.type === "SET_MONITOR") {
    chrome.storage.local.set({ monitorEnabled: Boolean(m.enabled) }).then(() => {
      if (sender.tab?.id) chrome.tabs.sendMessage(sender.tab.id, m).catch(() => {});
      reply({ ok: true });
    });
    return true;
  }
  if (m?.type === "CHECK_API") {
    api("/api/health").then(health => reply({ ok: true, health })).catch(e => reply({ ok: false, error: e.message }));
    return true;
  }
});
