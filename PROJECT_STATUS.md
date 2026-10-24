# ChatCart Project Status

## Current phase

The existing React + Vite + Tailwind dashboard and FastAPI + SQLite backend retain the manual intake flow. The hackathon MVP path is the opt-in Chrome extension reading rendered WhatsApp Web message bubbles and posting to the existing local message-event API. There is no Meta Cloud API integration, screen capture, or OS-notification monitoring.

## Dashboard

- Live order counts, clarification queue, and searchable/filterable orders load from the backend.
- Message extraction uses the backend demo parser; results remain unsaved drafts until the seller chooses Save draft.
- Drafts show missing fields, validation issues, duplicate warnings, and correction proposals.
- Order review and editing use the backend detail, PATCH, confirmation, and status endpoints.
- Confirmed-order CSV export downloads the backend response.
- API base URL can be set with VITE_API_BASE_URL. Default: http://127.0.0.1:8000.

## Source status and data flow

- **Supported:** seller pastes complete message text into ChatCart. The `manual` adapter retains original text and available sender/time metadata, runs the deterministic parser, and persists the event. Saving a draft is a separate explicit action.
- **Demo:** `demo_fixture` labels synthetic examples as demo events.
- **Experimental / not verified live:** the opt-in Chrome extension reads rendered message bubbles on WhatsApp Web, posts candidate orders to `/api/message-events`, and saves review drafts into the existing `orders` table. The dashboard refreshes these orders every five seconds. No Meta credentials/tunnel are required. It does not read OS notification previews.
- **Not connected:** Instagram and other apps.

Data flow: dashboard or source adapter → `/api/message-events` → deterministic extraction and validation → persisted event → seller review → draft/order or pending correction proposal → explicit seller approval/confirmation. CSV export continues to include confirmed orders only.

The extension path needs no WhatsApp or Meta credentials. It sends messages to the local ChatCart API at `http://127.0.0.1:8000`. `CHATCART_DB_PATH` defaults to `data/chatcart.sqlite3`, and `VITE_API_BASE_URL` defaults to `http://127.0.0.1:8000`.

## Verification

- Frontend production build: passed with npm run build.
- Live backend health and order-list endpoints responded; the database returned zero orders before sample processing.
- Browser: dashboard loaded at http://127.0.0.1:5173, fetched live counts, and processed the two demo sample messages into unsaved drafts.
- The workspace build was rerun on 2026-10-25: `npm run build` passed.
- Backend pytest was attempted with `python -m pytest backend/tests -q`; pytest could not create its default temporary directory in this sandbox. With `--basetemp` inside the workspace, collection succeeds but a single health test stalls in setup/execution without producing a result. The backend suite is therefore **not verified in this run**.
- No live Chrome/WhatsApp session or real desktop notification integration was tested on this machine.
- `npm run build` passed after the Cloud API panel was removed from the main dashboard.
- Python compilation passed. A direct local message-event smoke check created one WhatsApp Web review draft and remained idempotent on repeat processing.
- There is no frontend test script in `package.json`.

## Known limits

- Extraction follows the backend's deterministic demo patterns.
- SQLite is used for persistent backend storage.
- The orders table scrolls horizontally on narrow screens.
- The parser intentionally supports only the documented narrow message format; unsupported details remain unknown and need seller review.
- Corrections currently support the explicit order-UUID quantity-change format. General natural-language corrections are not automatically inferred.
- To safely process a message from an unconnected or unavailable source, paste the full message into the dashboard.
- The dashboard refreshes the order list every five seconds and when its window regains focus so locally created extension orders can appear without a manual page reload.


## WhatsApp Web monitor MVP (2026-10-24)

- Added an opt-in Chrome Manifest V3 extension under `chrome-extension/`.
- It reads incoming message bubbles from WhatsApp Web's rendered page DOM, sends supported messages to local ChatCart APIs, and creates reviewable orders. It never confirms orders or reads desktop/OS notification contents.
- Chrome API host permissions allow extension-origin calls to the local FastAPI service; no backend API changes were made.
- Verification: JavaScript syntax checks for all extension scripts passed; manifest JSON parsed; frontend production build passed with `npm run build`.
- Not verified in a live Chrome/WhatsApp session; extension loading, DOM selector compatibility, notifications, and end-to-end API draft creation still need manual validation. Treat this source as experimental, not supported.


## WhatsApp Web review fallback (2026-10-25)

- If a new incoming page message looks order-related but cannot be parsed safely, has extraction validation issues, or has duplicate/correction warnings, the extension focuses the source WhatsApp Web tab and shows a ChatCart review notification.
- The popup now injects the WhatsApp page script on demand into open WhatsApp Web tabs, verifies it responds, and includes an explicit scan for incoming messages already rendered in the open conversation. This scans only WhatsApp Web's rendered DOM, not the desktop or other apps. Chrome's `scripting` permission is required.
- A supported message continues through the existing extraction endpoint and becomes a normal review draft; no confirmation call is made.
- Replaced the extension notification icon reference with PNG.
- Verification: extension JavaScript syntax and manifest JSON checks passed. A mocked Chrome/API smoke test passed for both the focus-for-review branch and supported-order draft branch.
- A live Chrome/WhatsApp interaction has not been verified. This does not inspect Windows or Chrome notification previews; it operates on incoming WhatsApp Web page messages.


The fallback also treats a visible trailing ellipsis or a message bubble with a "more"/expand control as possibly truncated. This is a UI heuristic, not a way to read or verify a Windows/browser notification preview.
