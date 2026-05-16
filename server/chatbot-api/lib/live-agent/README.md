# Live human agent

Separate module for handing off widget visitors to a human agent inbox.

## URLs

| Path | Purpose |
|------|---------|
| `/live-agent` | Agent chat dashboard (SPA) |
| `/api/live-agent/*` | REST API (agent + visitor) |
| `/api/live-agent/health` | Config sanity check |

## Auth

Agents sign in with the **same passwordless magic link** as the UI customization dashboard (`/api/dashboard/login/request` → verify → cookie).

Only emails on the allowlist can use the inbox:

- `LIVE_AGENT_ALLOWED_EMAILS` (preferred), or
- `DASHBOARD_ALLOWED_EMAILS` if the live-agent list is empty

Set `LIVE_AGENT_REQUIRE_AUTH=0` only for local development.

## Agent workflow

1. Open `/live-agent` and sign in.
2. **Waiting** queue shows visitors who requested a human.
3. Select a chat → **Claim chat** → reply in the composer.
4. **End chat** closes the session for the visitor.

Messages poll every 4 seconds.

## Widget integration (next step)

From `company.js` / Dialogflow, when the user asks for a human:

```js
const sessionId = /* your client_session_id */;

await fetch("https://YOUR-API/api/live-agent/request", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientSessionId: sessionId,
    botid: "0001",
    visitorName: "Guest",
    initialMessage: "I need help with my appointment"
  })
});

// Poll for agent messages while status is waiting/active:
const poll = async () => {
  const r = await fetch(
    `https://YOUR-API/api/live-agent/messages?clientSessionId=${encodeURIComponent(sessionId)}&since=${encodeURIComponent(lastIso)}`
  );
  const { messages } = await r.json();
  // render messages; update lastIso from last message createdAt
};
```

While `humanActive` is true, route user input to `POST /api/live-agent/visitor-message` instead of Dialogflow.

## Firestore

Collection: `live_agent_conversations` (doc id = `clientSessionId`)

Subcollection: `messages`

Override with `LIVE_AGENT_CONVERSATIONS_COLLECTION`.
