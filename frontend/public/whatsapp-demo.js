const form = document.querySelector("#message-form");
const input = document.querySelector("#message-text");
const senderInput = document.querySelector("#sender-name");
const phoneInput = document.querySelector("#sender-phone");
const history = document.querySelector("#chat-history");
const empty = document.querySelector("#empty-chat");
const result = document.querySelector("#result");
const messageElements = new Map();
const pendingTimers = new Map();

function addIncomingMessage(text) {
  const sender = senderInput.value.trim() || "Unknown sender";
  const bubble = document.createElement("article");
  bubble.className = "message-in";
  bubble.dataset.chatcartIncoming = "true";
  bubble.dataset.messageId = "mock_" + crypto.randomUUID();
  bubble.dataset.sender = sender;
  if (phoneInput.value.trim()) bubble.dataset.senderPhone = phoneInput.value.trim();

  const body = document.createElement("span");
  body.className = "mock-message-text";
  body.textContent = text;

  const time = document.createElement("span");
  time.className = "message-meta";
  time.textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date());

  bubble.append(body, time);
  bubble.setAttribute("aria-label", "Message from " + sender);
  messageElements.set(bubble.dataset.messageId, bubble);
  pendingTimers.set(bubble.dataset.messageId, window.setTimeout(() => {
    if (!pendingTimers.has(bubble.dataset.messageId)) return;
    pendingTimers.delete(bubble.dataset.messageId);
    result.classList.add("error");
    result.textContent = "No extension response yet. Reload ChatCart in chrome://extensions, refresh this page, then start monitoring.";
  }, 6000));
  empty.hidden = true;
  history.append(bubble);
  history.scrollTop = history.scrollHeight;
}

senderInput.addEventListener("input", () => {
  document.querySelectorAll(".demo-contact-name").forEach((element) => {
    element.textContent = senderInput.value.trim() || "Unknown sender";
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addIncomingMessage(text);
  input.value = "";
  result.classList.remove("error");
  result.textContent = "Simulated message added. If monitoring is on, check the ChatCart portal for its draft.";
  input.focus();
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.source !== "chatcart-extension" || event.data?.type !== "MESSAGE_RESULT") return;

  const bubble = messageElements.get(event.data.messageId);
  if (!bubble) return;
  window.clearTimeout(pendingTimers.get(event.data.messageId));
  pendingTimers.delete(event.data.messageId);
  if (event.data.ok) {
    result.classList.remove("error");
    result.textContent = "Extension sent this message to ChatCart. Check All orders or Agent activity.";
    bubble.dataset.chatcartResult = "sent";
  } else {
    result.classList.add("error");
    result.textContent = "Extension could not send this message to ChatCart: " + event.data.error;
    bubble.dataset.chatcartResult = "failed";
  }
});

document.querySelectorAll("[data-message]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.message;
    input.focus();
  });
});
