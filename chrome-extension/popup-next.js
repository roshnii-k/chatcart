const button = document.querySelector("#toggle");
const scanButton = document.querySelector("#scan");
const page = document.querySelector("#page");
const apiStatus = document.querySelector("#api");
const WA_URL = "https://web.whatsapp.com/*";
let enabled = false;

function render() {
  button.textContent = enabled ? "Stop monitoring" : "Start monitoring";
  button.setAttribute("aria-pressed", String(enabled));
}

async function sendToTab(tab, message) {
  try { return await chrome.tabs.sendMessage(tab.id, message); }
  catch { return null; }
}

async function ensureContentScript(tab) {
  let response = await sendToTab(tab, { type: "PING" });
  if (response?.ok) return response;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    response = await sendToTab(tab, { type: "PING" });
    return response?.ok ? response : { ok: false, error: "Injected script did not respond." };
  } catch (error) {
    return { ok: false, error: error?.message || "Could not inject ChatCart into WhatsApp Web." };
  }
}

async function initialize() {
  const [tabs, activeTabs] = await Promise.all([
    chrome.tabs.query({ url: WA_URL }),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const activeWhatsApp = activeTabs.find(tab => tab.url?.startsWith("https://web.whatsapp.com/"));
  const responses = await Promise.all(tabs.map(tab => ensureContentScript(tab)));
  const loaded = responses.some(response => response?.ok);
  enabled = responses.some(response => response?.ok && response.enabled);
  render();
  button.disabled = !tabs.length || !loaded;
  scanButton.disabled = !enabled || !activeWhatsApp;

  if (!tabs.length) page.textContent = "Open WhatsApp Web in Chrome. Monitoring can start while you view ChatCart.";
  else if (!loaded) page.textContent = `Could not load ChatCart into WhatsApp Web: ${responses.find(response => response?.error)?.error || "check the extension's site access"}`;
  else if (enabled) page.textContent = "Monitoring is active in a WhatsApp Web tab.";
  else if (activeWhatsApp) page.textContent = "WhatsApp Web is ready. Start monitoring, then scan this open conversation.";
  else page.textContent = "WhatsApp Web is ready in another tab. Start monitoring here; activate WhatsApp Web to scan its open conversation.";

  chrome.runtime.sendMessage({ type: "CHECK_API" }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      apiStatus.textContent = "Backend unavailable. Start FastAPI.";
      apiStatus.classList.add("error");
    } else {
      apiStatus.textContent = `Backend connected - ${response.health.app}`;
      apiStatus.classList.remove("error");
    }
  });
}

button.addEventListener("click", async () => {
  button.disabled = true;
  const next = !enabled;
  try {
    const tabs = await chrome.tabs.query({ url: WA_URL });
    const results = await Promise.all(tabs.map(tab => sendToTab(tab, { type: "SET_MONITOR", enabled: next })));
    if (next && !results.some(result => result?.ok && result.enabled)) {
      page.textContent = "Could not reach the WhatsApp page monitor. Refresh WhatsApp Web and try again.";
      return;
    }
    await chrome.storage.local.set({ monitorEnabled: next });
    enabled = next;
    render();
    const [activeTabs] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true })]);
    const activeWhatsApp = activeTabs.some(tab => tab.url?.startsWith("https://web.whatsapp.com/"));
    scanButton.disabled = !next || !activeWhatsApp;
    page.textContent = next
      ? "Monitoring active in WhatsApp Web. New order messages will be saved for review."
      : "Monitoring stopped.";
  } catch {
    page.textContent = "Could not update monitoring. Refresh WhatsApp Web and try again.";
  } finally { button.disabled = false; }
});

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith("https://web.whatsapp.com/")) {
      page.textContent = "Activate the WhatsApp Web conversation you want to scan, then reopen this popup.";
      return;
    }
    const result = await sendToTab(tab, { type: "SCAN_VISIBLE" });
    if (!result?.ok) page.textContent = result?.error || "Could not scan this tab. Refresh WhatsApp Web and try again.";
    else if (result.queued) page.textContent = `Queued ${result.queued} visible incoming messages. Check ChatCart's order list.`;
    else if (result.readable) page.textContent = `Found ${result.readable} incoming message bubbles, but they were already processed or are still being sent.`;
    else if (result.candidates) page.textContent = `Found ${result.candidates} incoming message containers, but could not read their text or message IDs. WhatsApp Web may have changed its page layout.`;
    else page.textContent = "No incoming message containers were detected. Open the customer chat and try scanning again.";
  } catch { page.textContent = "Could not scan this tab. Refresh WhatsApp Web and try again."; }
  finally { scanButton.disabled = !enabled; }
});

initialize();
