# ChatCart WhatsApp Web monitor (local MVP)

## Load in Chrome
1. Start the ChatCart backend from the repo root: `py -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000`. No Meta credentials or public tunnel are needed for this local extension path.
2. Open `chrome://extensions`, enable Developer mode, then choose Load unpacked. If ChatCart is already installed, click **Reload** so Chrome applies the updated permissions.
3. Select this repository's `chrome-extension` folder.
4. For a predictable demo, start the Vite frontend and open `http://127.0.0.1:5173/whatsapp-demo.html`. The page is clearly labelled as simulated and is not connected to WhatsApp.
5. From any tab, open the ChatCart extension popup and verify backend status. If no supported source tab is open, **Start monitoring** opens the simulated inbox and enables monitoring when it loads. Enter a demo sender name and optional phone number, click a sample or type your own supported order text, then choose **Simulate incoming message**. The extension detects the demo page's explicit incoming-message marker and sends the sender details with the event. The saved order uses the name as its customer name and preserves the phone number separately. You can also use the existing opt-in monitor with `https://web.whatsapp.com/`; it captures only sender names and phone numbers visibly exposed in the message or chat header.
6. To process messages already visible on either supported page, choose **Scan open conversation**. The extension deduplicates messages it has already processed. Press Stop monitoring to stop.

New order messages create unconfirmed drafts in the dashboard's **All orders** list. If the same phone sends the same parsed order again, ChatCart shows a prompt in **Possible repeat orders**. Choose **Open WhatsApp with message** to open a prefilled chat, or copy the text and paste it yourself. Press Send in WhatsApp, then record the customer's confirmation in ChatCart to create a second review draft. ChatCart never sends the message or confirms the order automatically.

## Limits and privacy
- Prototype only; WhatsApp Web's undocumented DOM may change.
- The local WhatsApp-style simulated inbox at `http://127.0.0.1:5173/whatsapp-demo.html` is provided for demos and tests. Its messages are synthetic, stay in the current tab, and are not sent to WhatsApp.
- Keep Chrome, WhatsApp Web, and the ChatCart backend running. The extension resumes monitoring after a WhatsApp Web reload if monitoring was enabled.
- Reads rendered incoming bubble text only while enabled. It does not capture the desktop, inspect other tabs, read OS/browser notification bodies, or send WhatsApp replies.
- The explicit conversation scan reads only rendered incoming bubbles in the current WhatsApp Web conversation. It does not inspect off-screen history that WhatsApp has not loaded.
- If the backend is unavailable or a message handoff fails, the extension leaves that bubble eligible for retry. After restoring the backend, use **Scan open conversation**; failed handoffs are also reported in the WhatsApp Web page console.
- The scan reports whether it detected incoming message containers and could read their text. If no containers are detected, WhatsApp Web may have changed its undocumented page layout; refresh the WhatsApp tab and try again.
- Sends matching messages to the local API and stores hashes for deduplication, not message bodies.
- Sender name and phone are best-effort page-visible fields. WhatsApp Web may not show the sender's phone for every chat or message; the extension cannot guarantee or look up a number that the page does not expose.
- Uses the parser in `backend/app/extraction.py`. Unsupported/incomplete messages are skipped. Use only with chats you are authorized to process.


## Notifications
The extension reports when a draft is created, when a same-phone repeat needs confirmation in the dashboard, and when it cannot process a message. It does not read Windows notification previews.

The fallback also treats a visible trailing ellipsis or a message bubble with a "more"/expand control as possibly truncated. This is a UI heuristic, not a way to read or verify a Windows/browser notification preview.
