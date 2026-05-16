# Live human agent

Separate module for handing off widget visitors to a human agent inbox.

## URLs

| Path | Purpose |
|------|---------|
| `/live-agent` | Agent chat dashboard (SPA) |
| `/api/live-agent/*` | REST API (agent + visitor) |
| `/live-agent/health` | Config sanity check |

## Auth (agents)

Same as `/conversations-sheet` — no email, no magic link.

1. Set `CONVERSATIONS_SHEET_VIEW_SECRET` on Railway.
2. Open `/live-agent`, paste the secret, click **Open inbox**.
3. Optional **Your name** labels claims in “My chats” (sent as `X-Live-Agent-Name`).

API requests must include header:

`X-Conversations-Sheet-Secret: <secret>`

(or `Authorization: Bearer <secret>`).

The browser stores the secret in `sessionStorage` / `localStorage` (same key pattern as the sheet inbox).

## Agent workflow

1. Unlock with the viewer secret.
2. **Waiting** queue → select → **Claim chat** → reply.
3. **End chat** closes the session.

## Widget integration

See visitor API in `env.example.txt` (`POST /api/live-agent/request`, poll messages, etc.).

## Firestore

Collection: `live_agent_conversations` (doc id = `clientSessionId`)

Subcollection: `messages`
