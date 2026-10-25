const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(API_BASE_URL + path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Could not reach the ChatCart API at " + API_BASE_URL + ". Check that the backend is running.");
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload && payload.detail;
    const message =
      typeof detail === "string"
        ? detail
        : (detail && detail.message) || (Array.isArray(detail) ? detail.map((item) => item.msg).join("; ") : null);
    const error = new Error(message || "Request failed with status " + response.status + ".");
    error.status = response.status;
    throw error;
  }
  return response;
}

export async function getOrders() {
  return (await request("/api/orders")).json();
}
export async function getOrder(orderId) {
  return (await request("/api/orders/" + encodeURIComponent(orderId))).json();
}
export async function extractMessage(message) {
  return (await request("/api/orders/extract", {
    method: "POST",
    body: JSON.stringify({ message }),
  })).json();
}
export async function createOrder(payload) {
  return (await request("/api/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  })).json();
}
export async function updateOrder(orderId, payload) {
  return (await request("/api/orders/" + encodeURIComponent(orderId), {
    method: "PATCH",
    body: JSON.stringify(payload),
  })).json();
}
export async function confirmOrder(orderId) {
  return (await request("/api/orders/" + encodeURIComponent(orderId) + "/confirm", {
    method: "POST",
  })).json();
}
export async function updateOrderStatus(orderId, status) {
  return (await request("/api/orders/" + encodeURIComponent(orderId) + "/status", {
    method: "POST",
    body: JSON.stringify({ status }),
  })).json();
}
export async function exportConfirmedOrders() {
  return request("/api/orders/export.csv");
}

export async function getMessageEvents() {
  return (await request("/api/message-events?limit=100")).json();
}
export async function confirmRepeatedOrder(eventId) {
  return (await request("/api/message-events/" + encodeURIComponent(eventId) + "/confirm-repeat", { method: "POST" })).json();
}
export async function dismissRepeatedOrder(eventId) {
  return (await request("/api/message-events/" + encodeURIComponent(eventId) + "/dismiss-repeat", { method: "POST" })).json();
}
