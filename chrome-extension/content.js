let enabled = false, observer, baselineTimer, baselining = false;
let seen = new WeakSet();
let pending = new WeakSet();
function scan({ includeLoaded = false } = {}) {
  if (!enabled) return { queued: 0, candidates: 0, readable: 0 };
  if (includeLoaded) seen = new WeakSet();
  let queued = 0, readable = 0;
  const bubbles = new Set();
  for (const element of document.querySelectorAll(".message-in, [data-id^='false_'], [data-chatcart-incoming='true']")) {
    bubbles.add(element.closest(".message-in") || element);
  }
  for (const bubble of bubbles) {
    const node = bubble.matches(".copyable-text, .mock-message-text")
      ? bubble
      : bubble.querySelector(".copyable-text, .mock-message-text, [data-testid='selectable-text'], .selectable-text");
    const text = (node?.innerText || node?.textContent || "").trim();
    const id = bubble.getAttribute("data-id")
      || bubble.getAttribute("data-message-id")
      || node?.getAttribute("data-id")
      || bubble.querySelector("[data-id]")?.getAttribute("data-id")
      || node?.getAttribute("data-message-id")
      || node?.getAttribute("data-pre-plain-text")
      || bubble.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text");
    if (!text || !id) continue;
    readable++;
    if (seen.has(bubble) || pending.has(bubble)) continue;
    const simulatedIncoming = bubble.matches("[data-chatcart-incoming='true']");
    if (baselining && !includeLoaded && !simulatedIncoming) {
      seen.add(bubble);
      continue;
    }
    const metadata = node?.getAttribute("data-pre-plain-text")
      || bubble.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text")
      || "";
    const bubbleSender = bubble.getAttribute("data-sender") || metadata.match(/\] ([^:]+):/)?.[1]?.trim() || "";
    const conversation = getConversationDetails();
    const senderPhone = bubble.getAttribute("data-sender-phone")
      || visiblePhone(bubbleSender)
      || conversation.phone
      || null;
    const sender = bubbleSender && !visiblePhone(bubbleSender) ? bubbleSender : conversation.name;
    const maybeTruncated = /(?:\.{3}|…)\s*$/.test(text) || Boolean(bubble.querySelector('[aria-label*="more" i], [data-testid*="expand"]'));
    pending.add(bubble);
    chrome.runtime.sendMessage(
      { type: "INCOMING", payload: { id, text, sender, senderPhone, maybeTruncated } },
      response => {
        const failed = chrome.runtime.lastError || !response?.ok;
        pending.delete(bubble);
        if (simulatedIncoming) {
          window.postMessage({
            source: "chatcart-extension",
            type: "MESSAGE_RESULT",
            messageId: id,
            ok: !failed,
            error: failed ? chrome.runtime.lastError?.message || response?.error || "Extension could not process the message." : null,
          }, location.origin);
        }
        if (failed) {
          console.warn("ChatCart could not hand off the message. Scan the conversation again after checking the backend.", chrome.runtime.lastError?.message || response?.error);
          return;
        }
        seen.add(bubble);
      },
    );
    queued++;
  }
  return { queued, candidates: bubbles.size, readable };
}
function getConversationDetails() {
  const title = document.querySelector(
    '[data-testid="conversation-info-header-chat-title"], [data-testid="conversation-info-header"] span[title], header span[title]',
  );
  const titleText = (title?.getAttribute("title") || title?.textContent || "").trim();
  const visibleCandidates = [...document.querySelectorAll(
    'header [title], header [aria-label], header span, [data-testid*="conversation-info-header"] [title], [data-testid*="conversation-info-header"] span',
  )].filter((element) => element.getClientRects().length);
  const phone = visibleCandidates
    .map((element) => element.getAttribute("title") || element.getAttribute("aria-label") || element.textContent)
    .map((value) => visiblePhone(value))
    .find(Boolean) || visiblePhone(titleText);
  return { name: titleText && !visiblePhone(titleText) ? titleText : null, phone };
}
function visiblePhone(value) {
  if (!value) return null;
  const candidate = value.trim();
  const digits = candidate.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+\d().\-\s]+$/.test(candidate)
    ? candidate
    : null;
}
function enable(value) {
  enabled = Boolean(value);
  if (observer) observer.disconnect();
  clearTimeout(baselineTimer);
  if (enabled) {
    // Let WhatsApp finish rendering loaded history before monitoring new messages.
    baselining = true;
    scan();
    observer = new MutationObserver(() => {
      scan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    baselineTimer = setTimeout(() => { baselining = false; }, 1800);
  } else baselining = false;
}
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m?.type === "SET_MONITOR") {
    enable(m.enabled);
    reply({ ok: true, enabled });
    return;
  }
  if (m?.type === "PING") reply({ ok: true, enabled });
  if (m?.type === "SCAN_VISIBLE") {
    if (!enabled) reply({ ok: false, error: "Start monitoring before scanning the open conversation." });
    else reply({ ok: true, ...scan({ includeLoaded: true }) });
  }
});

// Keep opt-in monitoring active if WhatsApp Web reloads while the seller is away.
chrome.storage.local.get("monitorEnabled").then(({ monitorEnabled }) => {
  if (monitorEnabled) enable(true);
}).catch(() => {});
