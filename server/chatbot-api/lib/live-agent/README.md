# Live human agent

Hand off widget visitors to a human agent inbox. Any staff member with the **viewer secret** can open the queue, claim a chat, and reply.

## URLs

| Path | Purpose |
|------|---------|
| `/live-agent` | Agent live chat dashboard |
| `/conversations-sheet` | Conversation leads (same secret) |
| `/api/live-agent/*` | REST API |
| `/live-agent/health` | Config check |

## Auth (agents)

Same as `/conversations-sheet` — no email login.

1. Set `CONVERSATIONS_SHEET_VIEW_SECRET` on Railway.
2. Open **`/live-agent`**, paste the secret, click **Open inbox**.
3. Optional **Your name** (header `X-Live-Agent-Name`) — shown when you claim a chat.

The browser reuses `conversations_sheet_secret_v1` in storage when you switch between leads and live chat.

## Agent workflow

1. **Requests** (left) — visitors who asked for a human; default filter is **Waiting for agent**.
2. Select any request → **Claim chat** → reply in the center panel.
3. **Visitor** (right) — contact fields, documents captured, AI/Human mode toggles, transcript link.
4. **End chat** returns the visitor to AI mode (`aiEnabled: true`).

Browser notifications + sound when new waiting requests arrive (if you allow notifications).

## AI vs human (widget)

When a visitor requests a human, `aiEnabled` is set to `false` and `humanMode` is `waiting` / `human`.

Poll **`GET /api/live-agent/status?clientSessionId=`** — response includes:

- `humanActive` — waiting or active human chat
- `aiEnabled` — whether the bot should auto-reply
- `humanMode` — `ai` | `waiting` | `human`

Agents can change mode from the dashboard (`POST /api/live-agent/conversations/:id/mode`).

## Visitor API (widget)

```
POST /api/live-agent/request       { clientSessionId, botid?, visitorName?, initialMessage? }
GET  /api/live-agent/status?clientSessionId=
GET  /api/live-agent/messages?clientSessionId=&since=
POST /api/live-agent/visitor-message   { clientSessionId, text }
```

## Agent API (secret required)

```
GET  /api/live-agent/me
GET  /api/live-agent/inbox?status=waiting|active|mine|all
POST /api/live-agent/claim              { conversationId }
GET  /api/live-agent/conversations/:id/context
GET  /api/live-agent/conversations/:id/messages?since=
POST /api/live-agent/conversations/:id/messages   { text }
POST /api/live-agent/conversations/:id/mode       { aiEnabled?, humanMode? }
POST /api/live-agent/conversations/:id/close
```

## Firestore

- Collection: `live_agent_conversations` (doc id = `clientSessionId`)
- Subcollection: `messages`

Requires `FIREBASE_SERVICE_ACCOUNT_JSON` (same as leads).
