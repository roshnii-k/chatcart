const button = document.querySelector("#toggle");
const scanButton = document.querySelector("#scan");
const page = document.querySelector("#page");
const apiStatus = document.querySelector("#api");
const MONITOR_URLS = ["https://web.whatsapp.com/*", "http://127.0.0.1:5173/*", "http://localhost:5173/*"];
let enabled = false;

function render() {
  button.textContent = enabled ? "Stop monitoring" : "Start monitoring";
  button.setAttribute("aria-pressed", String(enabled));
}
function isMonitorTab(tab) {
  return tab?.url?.startsWith("https://web.whatsapp.com/")
    || tab?.url?.startsWith("http://127.0.0.1:5173/whatsapp-demo.html")
    || tab?.url?.startsWith("http://localhost:5173/whatsapp-demo.html");
}
async function getMonitorTabs() {
  const tabGroups = await Promise.all(MONITOR_URLS.map((url) => chrome.tabs.query({ url })));
  const tabs = tabGroups.flat().filter(isMonitorTab);
  if (tabs.length) return tabs;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return isMonitorTab(activeTab) ? [activeTab] : [];
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
    getMonitorTabs(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const activeMonitorTab = activeTabs.find(isMonitorTab);
  const responses = await Promise.all(tabs.map(tab => ensureContentScript(tab)));
  const loaded = responses.some(response => response?.ok);
  enabled = responses.some(response => response?.ok && response.enabled);
  render();
  button.disabled = false;
  scanButton.disabled = !enabled || !activeMonitorTab;

  if (!tabs.length) page.textContent = "Open WhatsApp Web or the ChatCart simulated inbox to start monitoring.";
  else if (!loaded) page.textContent = `Could not load the message monitor: ${responses.find(response => response?.error)?.error || "check the extension's site access"}`;
  else if (enabled) page.textContent = "Monitoring is active. New matching messages will be sent to ChatCart.";
  else if (activeMonitorTab?.url?.includes("whatsapp-demo.html")) page.textContent = "WhatsApp-style demo is ready. Start monitoring, then send a sample message.";
  else if (activeMonitorTab) page.textContent = "WhatsApp Web is ready. Start monitoring or scan this open conversation.";
  else page.textContent = "Message source is ready in another tab. Start monitoring, then activate that tab to scan.";

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
    const tabs = await getMonitorTabs();
    if (next && !tabs.length) {
      await chrome.storage.local.set({ monitorEnabled: true });
      const tab = await chrome.tabs.create({ url: "http://127.0.0.1:5173/whatsapp-demo.html", active: true });
      enabled = true;
      render();
      scanButton.disabled = true;
      page.textContent = "Opened the ChatCart simulated chat. Monitoring will start when the page loads.";
      return;
    }
    const results = await Promise.all(tabs.map(async (tab) => {
      const ready = await ensureContentScript(tab);
      if (!ready.ok) return ready;
      return sendToTab(tab, { type: "SET_MONITOR", enabled: next });
    }));
    if (next && !results.some(result => result?.ok && result.enabled)) {
      const failure = results.find(result => result?.error)?.error;
      page.textContent = failure
        ? `Could not start monitoring: ${failure}. In Chrome, allow ChatCart access to this site, then reload the page and extension.`
        : "Could not reach the message monitor. In Chrome, allow ChatCart access to this site, then reload the page and extension.";
      return;
    }
    await chrome.storage.local.set({ monitorEnabled: next });
    enabled = next;
    render();
    const [activeTabs] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true })]);
    const activeMonitorTab = activeTabs.some(isMonitorTab);
    scanButton.disabled = !next || !activeMonitorTab;
    page.textContent = next
      ? "Monitoring active. New matching messages will be saved as review drafts."
      : "Monitoring stopped.";
  } catch {
    page.textContent = "Could not update monitoring. Refresh the message source tab and try again.";
  } finally { button.disabled = false; }
});

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isMonitorTab(tab)) {
      page.textContent = "Activate WhatsApp Web or the ChatCart simulated inbox, then reopen this popup to scan.";
      return;
    }
    const result = await sendToTab(tab, { type: "SCAN_VISIBLE" });
    if (!result?.ok) page.textContent = result?.error || "Could not scan this tab. Refresh WhatsApp Web and try again.";
    else if (result.queued) page.textContent = `Queued ${result.queued} visible incoming messages. Check ChatCart's order list.`;
    else if (result.readable) page.textContent = `Found ${result.readable} incoming message bubbles, but they were already processed or are still being sent.`;
    else if (result.candidates) page.textContent = `Found ${result.candidates} incoming message containers, but could not read their text or message IDs.`;
    else page.textContent = "No incoming messages were detected. Open a conversation and try scanning again.";
  } catch { page.textContent = "Could not scan this tab. Refresh it and try again."; }
  finally { scanButton.disabled = !enabled; }
});

initialize();
