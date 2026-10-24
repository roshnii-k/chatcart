# ChatCart WhatsApp Web monitor (local MVP)

## Load in Chrome
1. Start the ChatCart backend from the repo root: `py -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000`. No Meta credentials or public tunnel are needed for this local extension path.
2. Open `chrome://extensions`, enable Developer mode, then choose Load unpacked.
3. Select this repository's `chrome-extension` folder.
4. Open `https://web.whatsapp.com/`, open the ChatCart extension popup, verify backend status, then press Start monitoring. The popup injects ChatCart into open WhatsApp Web tabs on demand; Chrome must allow the extension's WhatsApp Web site access.
5. To process messages that are already visible in the open conversation, choose **Scan open conversation**. The extension queues visible incoming messages for deterministic extraction; it deduplicates messages it has already processed. New incoming messages are checked while monitoring remains on. Press Stop monitoring to stop.

New supported order messages create review drafts and an extension notification. Review them in the dashboard's Orders list and Agent activity at `http://127.0.0.1:5173`. The extension never confirms orders.

## Limits and privacy
- Prototype only; WhatsApp Web's undocumented DOM may change.
- Keep Chrome, WhatsApp Web, and the ChatCart backend running. The extension resumes monitoring after a WhatsApp Web reload if monitoring was enabled.
- Reads rendered incoming bubble text only while enabled. It does not capture the desktop, inspect other tabs, read OS/browser notification bodies, or send WhatsApp replies.
- The explicit conversation scan reads only rendered incoming bubbles in the current WhatsApp Web conversation. It does not inspect off-screen history that WhatsApp has not loaded.
- If the backend is unavailable or a message handoff fails, the extension leaves that bubble eligible for retry. After restoring the backend, use **Scan open conversation**; failed handoffs are also reported in the WhatsApp Web page console.
- The scan reports whether it detected incoming message containers and could read their text. If no containers are detected, WhatsApp Web may have changed its undocumented page layout; refresh the WhatsApp tab and try again.
- Sends matching messages to the local API and stores hashes for deduplication, not message bodies.
- Uses the parser in `backend/app/extraction.py`. Unsupported/incomplete messages are skipped. Use only with chats you are authorized to process.


## Review fallback
When an incoming WhatsApp Web page message looks order-related but ChatCart cannot parse it safely, has validation issues, or flags a duplicate/correction, the extension brings that WhatsApp Web tab to the foreground and shows a ChatCart review notification. It does not read Windows notification previews.

The fallback also treats a visible trailing ellipsis or a message bubble with a "more"/expand control as possibly truncated. This is a UI heuristic, not a way to read or verify a Windows/browser notification preview.
