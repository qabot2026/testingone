# es_private — Sirf server par (Private)

Yeh folder **kabhi browser se direct open nahi** hota. Railway server isko andar se chalata hai.

## Kya hai isme?

| Folder / file | Kaam |
|---------------|------|
| `server.js` | Main app |
| `lib/` | Dialogflow, Sheets, logic |
| `data/` | Runtime only (sessions, booked slots) — **not** per-client config |
| `scripts/` | Dev tools |

## Secrets kahan?

| Rakho | Mat rakho |
|-------|-----------|
| Railway Variables (`GOOGLE_CREDENTIALS_JSON`) | Git mein |
| `.env` (local) | `credentials.json` in git |

## Supersetting changes

Per-client edit → **`es_public/client-based/`** + **`es_private/client-based/data/`**

## Start server

```bash
npm start
```

(Root se — `node es_private/server.js` chalega)
