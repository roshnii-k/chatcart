let enabled = false, observer, baselineTimer, baselining = false;
let seen = new WeakSet();
let pending = new WeakSet();
function scan({ includeLoaded = false } = {}) {
  if (!enabled) return { queued: 0, candidates: 0, readable: 0 };
  if (includeLoaded) seen = new WeakSet();
  let queued = 0, readable = 0;
  const bubbles = new Set();
  for (const element of document.querySelectorAll(".message-in, [data-id^='false_']")) {
    bubbles.add(element.closest(".message-in") || element);
  }
  for (const bubble of bubbles) {
    const node = bubble.matches(".copyable-text")
      ? bubble
      : bubble.querySelector(".copyable-text, [data-testid='selectable-text'], .selectable-text");
    const text = (node?.innerText || node?.textContent || "").trim();
    const id = bubble.getAttribute("data-id")
      || node?.getAttribute("data-id")
      || bubble.querySelector("[data-id]")?.getAttribute("data-id")
      || node?.getAttribute("data-pre-plain-text")
      || bubble.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text");
    if (!text || !id) continue;
    readable++;
    if (seen.has(bubble) || pending.has(bubble)) continue;
    if (baselining && !includeLoaded) {
      seen.add(bubble);
      continue;
    }
    const metadata = node?.getAttribute("data-pre-plain-text")
      || bubble.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text")
      || "";
    const sender = metadata.match(/\] ([^:]+):/)?.[1]?.trim() || null;
    const maybeTruncated = /(?:\.{3}|…)\s*$/.test(text) || Boolean(bubble.querySelector('[aria-label*="more" i], [data-testid*="expand"]'));
    pending.add(bubble);
    chrome.runtime.sendMessage(
      { type: "INCOMING", payload: { id, text, sender, maybeTruncated } },
      response => {
        const failed = chrome.runtime.lastError || !response?.ok;
        pending.delete(bubble);
        if (failed) {
          console.warn("ChatCart could not hand off a WhatsApp message. Scan the conversation again after checking the backend.", chrome.runtime.lastError?.message || response?.error);
          return;
        }
        seen.add(bubble);
      },
    );
    queued++;
  }
  return { queued, candidates: bubbles.size, readable };
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
