# ChatCart

**From customer conversations to confirmed orders.** ChatCart is a Track 1: Kill the Busywork hackathon project. It uses a React + Vite + Tailwind frontend and a FastAPI backend with SQLite order storage.

## Architecture and intake sources

The optional Chrome extension forwards incoming message events to the FastAPI API. The dashboard shows saved orders and pending repeat-order confirmations. Existing order routes remain responsible for edits, status changes, confirmation, and CSV export.

- **Dashboard:** order management only; message paste and agent activity/review panels are not shown.
- **Experimental, not live-verified:** the optional Chrome extension observes rendered incoming message bubbles on WhatsApp Web while enabled. WhatsApp Web's DOM is undocumented and can change. Do not treat this extension as a supported production source. It does not read Windows notifications, inspect other apps, or send replies. See [chrome-extension/README.md](chrome-extension/README.md).
- **Not connected:** Instagram and other messaging sources.

The extension only reads messages rendered in the supported source page. It does not send WhatsApp messages.

## Phase 2: backend and order storage

The backend supports a small deterministic demo parser, validated order records, SQLite persistence, order edits and status changes, explicit seller confirmation, same-phone repeat-order warnings, explicit quantity-correction proposals, and confirmed-order CSV export. The parser only understands a narrow documented message format; it does not use an AI service.

The dashboard's **Needs review** queue lists saved review drafts. Review an order there, or mark it completed once required details are present. Orders missing required fields must be corrected before they can be marked completed.

### Confirmation rules

An order can be explicitly confirmed only after these fields are present: product name, positive quantity, positive unit price, delivery date, and delivery address. The customer name and special instructions are optional. Confirmation is a deliberate seller action through the confirm endpoint. New complete orders start at Needs Review; orders with missing required details or extraction validation issues start at Needs Clarification.

### Supported demo message format

Example:

    I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur.

The parser recognizes phrases such as “I need”, “I want”, “I'd like”, “please order”, or “order”, followed by a whole-number quantity, product name, unit price, and “each”. It recognizes today, tomorrow, ISO dates, “Deliver to …”, and optional “Note: …” or “Special instructions: …”. Delivery dates “today” and “tomorrow” are relative to the backend machine's local date. For a proposed correction, use the explicit format “Correction for order <UUID>: change quantity to 2”. Corrections are returned as proposals only and never applied automatically. Repeat detection compares the sender phone and the parsed order details. The dashboard provides suggested text for the seller to send manually; only after the seller records the customer's confirmation is a second draft created. Synthetic examples for a complete order, missing details, a repeated order, and a customer correction are in backend/app/examples.py.

### Backend setup (Windows PowerShell)

From the repository root:

    py -m venv .venv
    .\.venv\Scripts\Activate.ps1
    python -m pip install --upgrade pip
    pip install -r requirements.txt

### Start the backend

    .\.venv\Scripts\Activate.ps1
    python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000

Available endpoints:

- GET /api/health
- GET /api/orders
- POST /api/orders/extract
- POST /api/orders
- GET /api/orders/{order_id}
- PATCH /api/orders/{order_id}
- POST /api/orders/{order_id}/confirm
- POST /api/orders/{order_id}/status
- GET /api/orders/export.csv
- GET /api/message-events
- POST /api/message-events/{event_id}/confirm-repeat
- POST /api/message-events/{event_id}/dismiss-repeat

POST /api/orders/extract returns a structured order draft, issues, duplicate IDs, and explicit correction proposals. It does not save or confirm the order. POST /api/orders creates an order. PATCH /api/orders/{order_id} edits fields and recalculates the total. The status endpoint may set any supported status except Confirmed; use the confirm endpoint for explicit confirmation. Invalid request values return 422, invalid UUIDs return 400, unknown orders return 404, and blocked state transitions return 409. A database failure returns a generic 500 response.

The SQLite database is created at data/chatcart.sqlite3. Set CHATCART_DB_PATH to select another file before starting the server.

### Run backend tests

Tests use pytest and a temporary SQLite database. From the repository root:

    .\.venv\Scripts\Activate.ps1
    python -m pytest backend/tests -q

## Start the frontend

In another PowerShell window from the repository root:

    npm install
    npm run dev

Open http://127.0.0.1:5173. The API base defaults to `http://127.0.0.1:8000`; set `VITE_API_BASE_URL` in the frontend environment if needed. `CHATCART_DB_PATH` selects the SQLite path (default `data/chatcart.sqlite3`). `.env.example` contains local settings only.

On first visit, choose a business type or enter a business name. This selection is stored in the current browser. Incoming messages detected by the extension create drafts in **All orders**. Messages with missing details become clarification drafts. A matching order from the same phone appears under **Possible repeat orders**; copy the suggested confirmation text and send it manually in chat. After the customer confirms, record that reply in ChatCart to create a new review draft.

Build the frontend with `npm run build`. There is currently no frontend test script in `package.json`.

## WhatsApp Web MVP (no Meta API)

For the hackathon MVP, use the opt-in Chrome extension in `chrome-extension/`. It watches incoming message bubbles rendered in WhatsApp Web and forwards likely order messages to ChatCart's existing local message-event endpoint. Saved drafts appear in **All orders** and repeat-order prompts appear in **Possible repeat orders**; no Meta credentials or public tunnel are needed. Follow [chrome-extension/README.md](chrome-extension/README.md) to load it in Chrome. Keep WhatsApp Web and the local backend open. The source is experimental because WhatsApp Web does not provide a stable public DOM integration; only loaded/rendered messages are readable.

### Reliable extension demo (simulated inbox)

For a demo without WhatsApp access, run the frontend and backend, load the unpacked extension, and open `http://127.0.0.1:5173/whatsapp-demo.html`. The page is explicitly labelled as simulated and is not connected to WhatsApp or any messaging account. Enter a demo sender name and optional phone number, start monitoring from the extension popup, select **Complete order**, then choose **Simulate incoming message**. The extension forwards the visible demo message and sender details through the existing local API, and the resulting review draft appears in the portal's **All orders** list. No AI model or AI credits are used. See [chrome-extension/README.md](chrome-extension/README.md) for setup.

## Demo script

1. On first launch, choose a business type or enter a business name. Load the extension and open the WhatsApp-style simulated inbox or WhatsApp Web.
2. Send a supported order message. The reviewable draft appears in **All orders**; confirm only after review.
3. Send the same complete order again from the same phone. ChatCart flags the possible repeat instead of silently creating a second draft. Copy and send the suggested confirmation text, then record the customer's confirmation in ChatCart to add a new draft.
