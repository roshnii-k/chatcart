const button = document.querySelector("#toggle"), scanButton = document.querySelector("#scan"), page = document.querySelector("#page"), apiStatus = document.querySelector("#api");
let enabled = false, tabId;
function render() { button.textContent = enabled ? "Stop monitoring" : "Start monitoring"; button.setAttribute("aria-pressed", String(enabled)); }
async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = tab?.id;
  const wa = tab?.url?.startsWith("https://web.whatsapp.com/"); enabled = !!(await chrome.storage.local.get("monitorEnabled")).monitorEnabled;
  page.textContent = wa ? "WhatsApp Web tab detected." : "Open WhatsApp Web in this tab to start."; button.disabled = !wa || !tabId; render();
  if (wa && tabId) {
    chrome.tabs.sendMessage(tabId, { type: "PING" }, response => {
      if (chrome.runtime.lastError || !response?.ok) {
        page.textContent = "WhatsApp page monitor is not loaded. Refresh this tab, then reopen ChatCart.";
        enabled = false;
        chrome.storage.local.set({ monitorEnabled: false });
        button.disabled = true;
        render();
      } else if (response.enabled) {
        page.textContent = "WhatsApp page monitor is active in this tab.";
        scanButton.disabled = false;
      } else if (enabled) {
        page.textContent = "Monitoring was selected, but is not active in this tab. Click Start monitoring.";
        enabled = false;
        chrome.storage.local.set({ monitorEnabled: false });
        render();
      }
    });
  }
  chrome.runtime.sendMessage({ type: "CHECK_API" }, r => {
    if (chrome.runtime.lastError || !r?.ok) { apiStatus.textContent = "Backend unavailable. Start FastAPI."; apiStatus.classList.add("error"); }
    else { apiStatus.textContent = `Backend connected - ${r.health.app}`; apiStatus.classList.remove("error"); }
  });
}
button.addEventListener("click", async () => {
  button.disabled = true; const next = !enabled;
  try {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    const results = await Promise.all(tabs.map(async tab => {
      try { return await chrome.tabs.sendMessage(tab.id, { type: "SET_MONITOR", enabled: next }); }
      catch { return null; }
    }));
    if (next && !results.some(result => result?.ok && result.enabled)) {
      page.textContent = "Could not reach the WhatsApp page monitor. Refresh WhatsApp Web and try again.";
      return;
    }
    await chrome.storage.local.set({ monitorEnabled: next }); enabled = next; render(); scanButton.disabled = !next;
    page.textContent = next ? "Monitoring active. Leave WhatsApp Web open for new messages." : "Monitoring stopped.";
  } catch { page.textContent = "Refresh WhatsApp Web and reopen this popup."; }
  finally { button.disabled = false; }
});
scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { type: "SCAN_VISIBLE" }, response => {
      if (chrome.runtime.lastError || !response?.ok) {
        page.textContent = response?.error || "Could not scan this WhatsApp Web tab. Refresh it and try again.";
      } else {
        page.textContent = response.queued
          ? `Queued ${response.queued} visible incoming messages. Check the ChatCart orders list.`
          : "No unprocessed incoming messages were found in the open conversation.";
      }
      scanButton.disabled = !enabled;
    });
  } catch {
    page.textContent = "Could not scan this tab. Refresh WhatsApp Web and try again.";
    scanButton.disabled = !enabled;
  }
});
initialize();
