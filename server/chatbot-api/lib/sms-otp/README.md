# SMS OTP — drop-in Express module

A self-contained SMS OTP send/verify integration. Provider-agnostic core with a thin
adapter per SMS gateway (currently MSG91). Copy the whole `sms-otp/` folder into any
Node + Express project, wire two lines, set env vars, done.

## What it gives you

Three HTTP endpoints on your Express app:

| Method + path | Body | Purpose |
|---|---|---|
| `POST /api/sms-otp/send` | `{ "mobile": "9999999999" }` | Generate a 6-digit OTP and send it via the active provider. |
| `POST /api/sms-otp/verify` | `{ "mobile": "9999999999", "code": "123456" }` | Verify the code (one-shot, then consumed). |
| `GET /api/sms-otp/health` | — | Reports active provider + missing env vars + storage backend. |

Plus, baked-in safety so you don't have to think about it:

- Cryptographically-strong random OTP (`crypto.randomBytes`).
- sha256-hashed storage (raw OTP never lives in memory or in Firestore).
- TTL (default 5 min) — codes expire automatically.
- Attempt cap (default 5 wrong tries) — code is invalidated after that.
- Per-mobile resend cooldown (default 30s).
- Per-IP rate limit (default 10 sends per IP per 10 min).
- Indian mobile normalisation (`+91`, `91`, leading `0` all stripped).
- Structured JSON logs with masked mobile numbers for easy grep.
- Optional Firestore audit trail.

## Drop-in install (any Node 18+ Express server)

### 1. Copy this folder

```
your-project/
└── server/
    └── lib/
        └── sms-otp/          <- copy this entire folder
            ├── README.md
            ├── index.mjs
            └── providers/
                └── msg91.mjs
```

### 2. Add 2 lines in your Express entry file

```js
import express from "express";
import { mountSmsOtpRoutes } from "./lib/sms-otp/index.mjs";  // <- add

const app = express();
// ... your existing middleware ...
mountSmsOtpRoutes(app);                                       // <- add
app.listen(8080);
```

That's the entire code wire-up. No `app.post(...)`, no body parsers, no CORS plumbing —
`mountSmsOtpRoutes` registers all three routes, attaches its own JSON body parser
(`16kb` cap), and turns on `trust proxy` so `req.ip` reflects the real visitor IP behind
edge proxies (Railway / Cloudflare / etc.).

### 3. Set env vars

See [Env vars](#env-vars) below. Minimum required is two MSG91 keys.

### 4. Verify

Hit `GET /api/sms-otp/health` after deploy:

```json
{
  "ok": true,
  "provider": "msg91",
  "provider_ready": true,
  "provider_missing_env": [],
  "storage_backend": "firestore"
}
```

If `provider_ready: false`, `provider_missing_env` tells you exactly what's missing.

## What to ask the CLIENT for

You don't need an MSG91 account yourself. The client signs up, registers their DLT,
and hands you two strings:

| Item | What it looks like | Where the client gets it |
|---|---|---|
| **MSG91 Auth Key** | ~32 alphanumeric chars, e.g. `437289ABCDEFghij1234567890abcdef` | https://control.msg91.com/app/#/api → Create AuthKey |
| **MSG91 Template ID** | Hex-ish id, e.g. `6498abc1234567890abcdef0` | MSG91 dashboard → SMS → Templates → open the DLT-approved OTP template |

You set those two values as `MSG91_AUTHKEY` and `MSG91_TEMPLATE_ID` env vars on your
server. Nothing else from MSG91 is needed in code.

### Optional follow-ups to coordinate with the client

- **DLT template wording** — the client must register an OTP template on the DLT portal
  (Jio TrueConnect / Vi / Airtel) before MSG91 will deliver branded SMS. The template
  text MUST contain the literal placeholder `##OTP##` where the code should appear.
  Example: `Your verification code is ##OTP##. Valid for 5 minutes. - XYZCLN`.
- **Sender ID** — a 6-character alphabetic ID the client registers on DLT
  (e.g. `XYZCLN`). Usually baked into the template; set `MSG91_SENDER_ID` only if MSG91
  asks for it explicitly.

DLT approval typically takes 3–10 business days. While waiting, the client can use
MSG91's built-in test template (valid for ~30 days from signup, only sends to the
verified mobile on the account).

## Env vars

### Active provider

| Var | Default | Notes |
|---|---|---|
| `SMS_OTP_PROVIDER` | `msg91` | Switch between providers in the `PROVIDERS` map in `index.mjs`. |

### MSG91 provider

| Var | Required | Default | Notes |
|---|---|---|---|
| `MSG91_AUTHKEY` | yes | — | Client's MSG91 auth key. |
| `MSG91_TEMPLATE_ID` | yes | — | DLT-approved template id from the client's MSG91 dashboard. |
| `MSG91_SENDER_ID` | no | (template default) | 6-char sender ID, only if MSG91 asks for it. |
| `MSG91_COUNTRY_CODE` | no | `91` | Strip leading 0/+91 then prepend this. |
| `MSG91_BASE_URL` | no | `https://control.msg91.com` | Override only for staging. |

### Core OTP behaviour (works for every provider)

| Var | Default | Range | Notes |
|---|---|---|---|
| `SMS_OTP_LENGTH` | `6` | 4..8 | OTP digit count. |
| `SMS_OTP_TTL_SECONDS` | `300` | 30..900 | How long a sent OTP stays valid. |
| `SMS_OTP_MAX_ATTEMPTS` | `5` | 1..20 | Verify failures before lockout. |
| `SMS_OTP_RESEND_COOLDOWN_S` | `30` | 0..600 | Seconds between sends to the same mobile. |
| `SMS_OTP_IP_LIMIT` | `10` | 1..200 | Max sends per IP within the window. |
| `SMS_OTP_IP_WINDOW_S` | `600` | 60..3600 | IP rate-limit window. |

### Storage (Firestore-backed with in-memory fallback)

Firestore is automatically used when `firebase-admin` is installed and Firebase
credentials are set. Without those, the module falls back to per-process in-memory
storage (fine for dev, NOT fine for production — restarts wipe in-flight codes).

| Var | Default | Notes |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | — | JSON service-account credentials. Enables Firestore. |
| `FIREBASE_CONFIG` | — | Alias for `FIREBASE_SERVICE_ACCOUNT_JSON` (host-app friendly). |
| `FIREBASE_DATABASE_URL` | — | Optional RTDB URL (not used by OTP; passed through if your host app needs it). |
| `SMS_OTP_DISABLE_FIRESTORE` | — | Set `1` to force in-memory even when Firestore is configured. |
| `SMS_OTP_FIRESTORE_COLLECTION` | `sms_otp_codes` | Firestore collection for in-flight OTPs. |
| `SMS_OTP_AUDIT_TO_FIRESTORE` | — | Set `1` to log every send/verify outcome to Firestore. |
| `SMS_OTP_AUDIT_COLLECTION` | `sms_otp_audit` | Audit-row collection. |

## API response shapes

### `POST /api/sms-otp/send`

Success (HTTP 200):
```json
{ "ok": true, "message": "OTP sent.", "ttl_seconds": 300, "request_id": "..." }
```

Validation failure (HTTP 400):
```json
{ "ok": false, "error": "Provide a valid 10-digit Indian mobile number." }
```

Per-mobile cooldown (HTTP 429):
```json
{ "ok": false, "error": "Please wait 24s before requesting a new OTP.", "retry_after_seconds": 24, "reason": "cooldown" }
```

Per-IP rate limit (HTTP 429):
```json
{ "ok": false, "error": "Too many OTP requests from this network. Try again in 540s.", "retry_after_seconds": 540, "reason": "ip_rate_limited" }
```

Provider rejected (HTTP 502):
```json
{ "ok": false, "error": "Invalid template_id" }
```

### `POST /api/sms-otp/verify`

Success (HTTP 200):
```json
{ "ok": true, "message": "OTP verified." }
```

Wrong code (HTTP 400):
```json
{ "ok": false, "error": "Incorrect OTP.", "reason": "invalid_code", "attempts_remaining": 4 }
```

Expired or never sent (HTTP 410):
```json
{ "ok": false, "error": "OTP expired or not requested. Please request a new code.", "reason": "no_otp_or_expired" }
```

Lockout (HTTP 429):
```json
{ "ok": false, "error": "Too many incorrect attempts. Please request a new OTP.", "reason": "too_many_attempts" }
```

## Adding another provider (Twilio / Plivo / Gupshup / Kaleyra / …)

1. Create `providers/<name>.mjs` exporting:

   ```js
   export const provider = {
     name: "<name>",

     missingEnvKeys() {
       const out = [];
       if (!process.env.MYPROVIDER_API_KEY) out.push("MYPROVIDER_API_KEY");
       return out;
     },

     debugInfo() {
       return { api_key_configured: !!process.env.MYPROVIDER_API_KEY };
     },

     async sendOtp({ mobile, otp, otpLength }) {
       // POST to your gateway here. Return:
       //   { ok: true,  request_id, status: <httpStatus> }
       //   { ok: false, error: "human message", status: <httpStatus> }
     }
   };
   ```

2. Register it in `index.mjs`:

   ```js
   import { provider as myProvider } from "./providers/myprovider.mjs";
   const PROVIDERS = {
     msg91: msg91Provider,
     myprovider: myProvider
   };
   ```

3. Switch in production: `SMS_OTP_PROVIDER=myprovider` env var. No other change.

## Troubleshooting

| Symptom | What it usually means |
|---|---|
| `Cannot GET /api/sms-otp/health` | Module not mounted. Check that `mountSmsOtpRoutes(app)` actually runs at boot. |
| `"provider_ready": false` with `provider_missing_env: ["MSG91_AUTHKEY"]` | Env var typo on the host (case-sensitive). |
| `"storage_backend": "memory"` in production | `firebase-admin` not installed, or `FIREBASE_SERVICE_ACCOUNT_JSON` not set. OTPs WILL be wiped on every restart. |
| MSG91 returns `"Invalid template_id"` | Template not yet DLT-approved, or the wrong template type. The template must contain `##OTP##` (exact, case-sensitive) and be approved as Transactional. |
| MSG91 returns `"mobile is invalid"` | Mobile number is foreign or malformed. Check `MSG91_COUNTRY_CODE` (default `91`). |
| HTTP 429 `cooldown` on every send | Same mobile too quickly. Lower `SMS_OTP_RESEND_COOLDOWN_S` if testing. |
| HTTP 429 `ip_rate_limited` while testing | You hammered `/send` from one IP. Raise `SMS_OTP_IP_LIMIT` during dev, or wait `SMS_OTP_IP_WINDOW_S`. |
| Real visitor IP shows up as `127.0.0.1` in logs | Your host doesn't forward `X-Forwarded-For`, or some other middleware blocks `trust proxy`. The module sets `trust proxy=true`; ensure nothing later sets it back. |

## Client-side wiring

This module only exposes the three HTTP endpoints. Wiring them into a frontend form
(autosend on form open, "Resend" button, "Verify" on submit) is a frontend job and
lives outside this folder. See the `submitOtpResendRequest`, `triggerOtpAutoSendIfNeeded_`,
`sendSmsOtpViaApi_` and `verifySmsOtpViaApi_` helpers in `company.js` for a reference
implementation against a Dialogflow Messenger overlay form.

## License / reuse

Internal module — copy freely between projects under your control. Do NOT publish the
client's MSG91 keys or Firebase service account anywhere public.
