# Customization dashboard

Drop-in Express module that adds a hosted admin UI for tweaking the chatbot
widget without redeploying. You and your clients sign in with an emailed link,
edit colors / icons / text / toggles, and click **Save live** — saved settings
are fetched by `chat-frame.html` on every page load and applied to every
visitor session.

## What gets mounted

`mountDashboardRoutes(app)` adds:

| Path | Method | Auth | Purpose |
|---|---|---|---|
| `/dashboard` | GET | — | Static SPA (login + settings + live preview) |
| `/api/dashboard/login/request` | POST | — | Send magic-link email |
| `/api/dashboard/login/verify` | GET | — | Verify link, set session cookie, redirect |
| `/api/dashboard/logout` | POST | — | Clear session cookie |
| `/api/dashboard/me` | GET | session | Current signed-in email |
| `/api/dashboard/settings?botid=…` | GET | session | Read saved settings |
| `/api/dashboard/settings?botid=…` | PUT | session | Save settings (publish live) |
| `/api/public/widget-settings?botid=…` | GET | — (CORS `*`) | Read settings (called by widget) |
| `/api/dashboard/health` | GET | — | Env sanity (which keys are missing) |

## Auth model

- **Passwordless magic link** sent via the same SMTP transport the contact
  notifier uses. Email allowlist via `DASHBOARD_ALLOWED_EMAILS`.
- **One-time tokens.** Each magic link is HMAC-signed with `exp` + random
  `jti`, and the `jti` is written into Firestore on first use. Reuse fails.
- **Sessions** are an HMAC-signed HttpOnly + SameSite=Lax cookie carrying
  `{ email, exp }`. No external session store.

### SMTP-less fallback (handy for first-run)

When `SMTP_*` env vars are not configured, or when `sendMail` fails (Gmail
auth, TLS hang, etc.), the magic link is printed to the server log instead
of being emailed. Look in Railway → **Logs** for:

```
[dashboard] ==================== MAGIC LINK ====================
[dashboard] Email:  you@yourcompany.com
[dashboard] Reason: SMTP not configured
[dashboard] Expires in 15 minutes. One-time use. Open this URL:
[dashboard] https://YOUR-API.up.railway.app/api/dashboard/login/verify?token=...
[dashboard] ====================================================
```

Copy that URL into your browser and you're signed in — no email needed.

Set `DASHBOARD_PRINT_LOGIN_LINK=1` to print the link **regardless** of SMTP
status (useful while onboarding a client who hasn't wired their SMTP yet).

## Required env

```
DASHBOARD_ALLOWED_EMAILS=alice@yourcompany.com,bob@yourclient.com
DASHBOARD_SESSION_SECRET=...32+ random chars...
DASHBOARD_PUBLIC_BASE_URL=https://YOUR-API.up.railway.app
```

Plus the SMTP env you already use for contact-lead mail
(`SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` or `SMTP_USER`).

## Optional env

```
DASHBOARD_SESSION_TTL_HOURS=168           # 7 days; max 720 (30 days)
DASHBOARD_LINK_TTL_MINUTES=15             # magic-link lifetime; max 120
DASHBOARD_FROM_EMAIL=                     # falls back to MAIL_FROM, then SMTP_USER
DASHBOARD_SETTINGS_COLLECTION=dashboard_settings
DASHBOARD_TOKENS_COLLECTION=dashboard_login_tokens
DASHBOARD_COOKIE_SECURE=1                 # set 0 only for local plain http
DASHBOARD_PREVIEW_URL=                    # informational default in /api/dashboard/health
```

## How a setting goes live

1. **Dashboard user** edits a field. The dashboard `postMessage`s the latest
   flat settings to the preview iframe (`chat-frame.html`), which calls
   `window.__dfchatApplyCompanyAdminFlatSettings(...)` in `company.js` to
   re-skin in place — no reload.
2. User clicks **Save live**. Dashboard `PUT /api/dashboard/settings?botid=...`
   with `{ flat, advancedPatchJson }`. Server writes to Firestore.
3. **Real visitors** load `chat-frame.html`. On boot, the page calls
   `GET /api/public/widget-settings?botid=...` and applies the saved patch via
   the same `__dfchatApplyCompanyAdminFlatSettings` hook. Cached only as long
   as `Cache-Control: no-store` allows (effectively per-page-load).

## Live-preview iframe cross-origin

The dashboard is served from the API host (e.g. `api.yourcompany.com`).
The preview iframe loads `chat-frame.html` from wherever the customer hosts
it (e.g. `qabot2026.github.io`). The dashboard appends
`?adminOrigin=<dashboard-origin>` to that iframe URL so the in-frame message
handler accepts cross-origin `postMessage` from the dashboard.

That receiver lives in `chat-frame.html`:

```js
function isAllowedAdminOrigin(origin) {
  if (origin === window.location.origin) return true;
  var admin = window.COMPANY_ADMIN_PREVIEW_ORIGIN;
  return typeof admin === "string" && admin && origin === admin;
}
```

The customer's real production embed does **not** include `adminOrigin`, so
this back-channel is closed for visitor sessions.

## Settings storage shape

Firestore doc at `dashboard_settings/{botid}`:

```json
{
  "flat": {
    "chatbotPrimaryColor": "#0369a1",
    "userMessageBg": "#0369a1",
    "userMessageText": "#ffffff",
    "botMessageBg": "#f1f5f9",
    "botMessageText": "#0f172a",
    "chatIconUrl": "https://…",
    "chatTitleIconUrl": "https://…",
    "headerTitle": "Your bot",
    "headerSubtitle": "🟢 Online",
    "enableMic": true,
    "enableRestart": true,
    "enableMultiLanguage": true,
    "enablePoweredBy": true,
    "autoOpenDeskEnabled": false,
    "autoOpenMobEnabled": false,
    "autoOpenDeskDelayMs": 5000,
    "autoOpenMobDelayMs": 5000,
    "launcherStripDeskEnabled": true,
    "launcherStripMobEnabled": true,
    "launcherStripDeskText": "Hi! Need help?",
    "launcherStripMobText": "Hi! Need help?"
  },
  "advancedPatchJson": "{\"common\":{\"features\":{\"multiLanguage\":{\"inputPlaceholderByLanguage\":{\"en\":\"Type here…\"}}}}}",
  "updatedAt": "<server ts>",
  "updatedBy": "alice@yourcompany.com"
}
```

The `flat` keys map 1:1 to the schema `buildCompanyAdminFlatSettingsPatch`
in `company.js` already understands. New fields can be added to the
front-end without touching `company.js` by writing them into `advancedPatchJson`
(deep-merged into `window.COMPANY_CHAT_UI_CONFIG`).

## Bots / multi-tenancy

A single dashboard deployment supports many `botid`s — each gets its own
Firestore doc. The dashboard UI exposes a Bot id text input in the top bar;
change it to load/save a different bot's settings.

Allowlist is global today. If you need per-bot ACL, extend `isEmailAllowed_`
to also read e.g. `DASHBOARD_ACL_<botid>`.
