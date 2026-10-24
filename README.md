# ChatCart

**From customer conversations to confirmed orders.** ChatCart is a Track 1: Kill the Busywork hackathon project. It uses a React + Vite + Tailwind frontend and a FastAPI backend with SQLite order storage.

## Architecture and intake sources

The React dashboard sends manual messages to the FastAPI message-event API. A source adapter labels the event, then the existing deterministic parser extracts fields. Events and seller-approved drafts are persisted in SQLite. Duplicate matches and correction proposals stay in the activity/review queue until the seller acts. Existing order routes remain responsible for edits, status changes, confirmation, and CSV export.

- **Supported and tested in this project:** manual paste into the ChatCart dashboard. This is seller-submitted text, not background desktop monitoring.
- **Demo:** built-in sample messages are synthetic and marked `Demo`; they are not customer messages.
- **Experimental, not live-verified:** the optional Chrome extension observes rendered incoming message bubbles on WhatsApp Web while enabled. WhatsApp Web's DOM is undocumented and can change. Do not treat this extension as a supported production source. It does not read Windows notifications, inspect other apps, or send replies. See [chrome-extension/README.md](chrome-extension/README.md).
- **Not connected:** Instagram and other messaging sources.

No desktop monitor is running in the dashboard. If a message is truncated or cannot be read through a source, paste the complete text manually.

## Phase 2: backend and order storage

The backend supports a small deterministic demo parser, validated order records, SQLite persistence, order edits and status changes, explicit seller confirmation, duplicate warnings, explicit quantity-correction proposals, and confirmed-order CSV export. The parser only understands a narrow documented message format; it does not use an AI service and does not save extraction results automatically.

### Confirmation rules

An order can be explicitly confirmed only after these fields are present: product name, positive quantity, positive unit price, delivery date, and delivery address. The customer name and special instructions are optional. Confirmation is a deliberate seller action through the confirm endpoint. New complete orders start at Needs Review; orders with missing required details or extraction validation issues start at Needs Clarification.

### Supported demo message format

Example:

    I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur.

The parser recognizes phrases such as “I need”, “I want”, “I'd like”, “please order”, or “order”, followed by a whole-number quantity, product name, unit price, and “each”. It recognizes today, tomorrow, ISO dates, “Deliver to …”, and optional “Note: …” or “Special instructions: …”. Delivery dates “today” and “tomorrow” are relative to the backend machine's local date. For a proposed correction, use the explicit format “Correction for order <UUID>: change quantity to 2”. Corrections are returned as proposals only and never applied automatically. Duplicate detection flags exact normalized message matches. Synthetic examples for a complete order, missing details, a repeated order, and a customer correction are in backend/app/examples.py.

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

On first visit, choose a business type or enter a business name. This selection is stored in the current browser. In the dashboard, paste a copied customer message and choose **Add to portal**. ChatCart creates a draft order immediately; it appears in **All orders** and remains unconfirmed for seller review. Messages with missing details become clarification drafts. Duplicate messages and correction proposals are flagged for review rather than silently creating or changing an order.

Build the frontend with `npm run build`. There is currently no frontend test script in `package.json`.

## WhatsApp Web MVP (no Meta API)

For the hackathon MVP, use the opt-in Chrome extension in `chrome-extension/`. It watches incoming message bubbles rendered in WhatsApp Web and forwards likely order messages to ChatCart's existing local message-event endpoint. Saved drafts appear in the main **Orders** list and **Agent activity**; no Meta credentials or public tunnel are needed. Follow [chrome-extension/README.md](chrome-extension/README.md) to load it in Chrome. Keep WhatsApp Web and the local backend open. The source is experimental because WhatsApp Web does not provide a stable public DOM integration; only loaded/rendered messages are readable.

## Demo script

1. On first launch, choose a business type or enter a business name. In **Paste a customer message**, paste `I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur.` and choose **Add to portal**. The reviewable draft appears in **All orders**; confirm only after review.
2. Paste `I need 2 pies.` and choose **Add to portal**. It appears as a clarification draft; open it from **Needs clarification** to fill the missing details.
3. Submit the first message again. ChatCart flags the matching order; the repeat is not silently saved as another draft.
4. Copy the first order's UUID from its order detail/API response, then submit `Correction for order <UUID>: change quantity to 2`. Review the before/after proposal and explicitly approve or reject it.

Use the **Load sample** button to demonstrate synthetic, clearly labelled fixture events. Sample data is not real customer data.
