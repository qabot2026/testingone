# Instagram & Facebook — Poora Setup Guide

Yeh file **Green Valley / bot 10002** ke liye hai.  
Instagram DMs aur Facebook Messenger **ek hi Page access token** use karte hain (`FB_PAGE_ACCESS_TOKEN`).

Railway variables:

```
FB_PAGE_ACCESS_TOKEN=
META_APP_SECRET=
META_VERIFY_TOKEN=
INSTAGRAM_PAGE_ID=          (optional — Supersetting ke liye)
PUBLIC_BASE_URL=https://YOUR-RAILWAY-URL
```

Webhook URL (Meta App mein — **WhatsApp jaisa same URL**):

```
https://YOUR-RAILWAY-URL/webhooks/meta
```

---

## Kya support hai? (WhatsApp jaisa)

| Feature | Instagram | Facebook |
|---------|-----------|----------|
| Text chat + Dialogflow | ✅ | ✅ |
| Welcome event (Hi/Hello → menu) | ✅ | ✅ |
| Idle ENDCHAT (10s) | ✅ | ✅ |
| Rich replies (chips, dropdowns, cards) | ✅ | ✅ |
| Image / PDF upload → GCS | ✅ | ✅ |
| Live agent handoff | ✅ | ✅ |
| Session prefix | `ig-` | `fb-` |

---

## Part 0 — Pehle sahi App kaun sa hai?

### Tarika A — Webhook se

Developer → app → **Webhooks**  
Jahan callback ho: `https://YOUR-RAILWAY-URL/webhooks/meta` → wahi app.

### Tarika B — WhatsApp app reuse

Agar WhatsApp pehle se chal raha hai → **wahi Meta App** use karo.  
Naye products add karo: **Messenger**, **Instagram**.

---

## Part 1 — Facebook Page

1. Kholo: **https://www.facebook.com/pages/create** (ya existing Page use karo)
2. Page **Admin** access chahiye
3. Page ID note karo: Page → **About** → Page ID  
   (ya Graph API: `/{page-id}?fields=id,name`)

Instagram ke liye: Page **Settings → Linked accounts → Instagram** se Professional account connect karo.

---

## Part 2 — Meta App mein products add karo

1. **developers.facebook.com** → tumhara app
2. **Add product**:
   - **Messenger** → Set up
   - **Instagram** → Set up (Instagram Graph API / messaging)
3. **App settings → Basic** → App secret copy → `META_APP_SECRET`

---

## Part 3 — Webhook subscribe karo

1. App → **Webhooks** → **Add subscription** (ya existing `/webhooks/meta` edit)
2. **Callback URL:** `https://YOUR-RAILWAY-URL/webhooks/meta`
3. **Verify token:** jo Railway mein `META_VERIFY_TOKEN` hai — same string
4. Subscribe fields:

| Object | Fields |
|--------|--------|
| **Page** | `messages`, `messaging_postbacks`, `messaging_optins` |
| **Instagram** | `messages`, `messaging_postbacks` |

5. **Verify and save**

---

## Part 4 — Page access token (permanent)

Developer page par **Generate token** sirf **1 hour** ka hota hai. Production ke liye **long-lived Page token** chahiye.

### Option A — Business Manager System User (recommended, WhatsApp jaisa)

1. **https://business.facebook.com/settings** → **Users** → **System users**
2. System user banao (jaise `messenger-bot`)
3. **Add assets:**
   - **Apps** → tumhara app → **Admin**
   - **Pages** → tumhara Page → **Full control**
4. **Generate token** → app select → permissions:
   - `pages_messaging`
   - `pages_manage_metadata`
   - `pages_read_engagement`
   - `instagram_manage_messages` (Instagram DMs ke liye)
   - `instagram_basic`
5. Token copy → `FB_PAGE_ACCESS_TOKEN`

### Option B — Graph API Explorer (testing)

1. App → **Tools** → Graph API Explorer
2. User/Page token → **Get Page Access Token**
3. Permissions: `pages_messaging`, `instagram_manage_messages`
4. Short-lived token → exchange for long-lived (60 days) via:

```
GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-token}
```

Phir Page token:

```
GET /{page-id}?fields=access_token&access_token={user-long-lived-token}
```

Production mein **Option A** prefer karo.

---

## Part 5 — Instagram account link karo

1. Instagram account **Professional** (Business/Creator) hona chahiye
2. Facebook Page se link:
   - Page → **Settings** → **Linked accounts** → **Instagram**
   - Ya Meta App → **Instagram** → **Basic Display / API setup**
3. App → **Instagram** → **API setup with Instagram login** ya **Instagram messaging**
4. Webhook mein **instagram** object subscribed ho (Part 3)

Test: Instagram app se linked Page ko DM bhejo.

---

## Part 6 — Railway par lagao

| Variable | Kya daalna hai |
|----------|----------------|
| `FB_PAGE_ACCESS_TOKEN` | Part 4 ka permanent Page token |
| `META_APP_SECRET` | App → Settings → Basic → App secret |
| `META_VERIFY_TOKEN` | Webhook verify string (WhatsApp jaisa same ho sakta hai) |
| `INSTAGRAM_PAGE_ID` | Optional — Page ID ya IG business account ID |
| `PUBLIC_BASE_URL` | `https://your-railway-app.up.railway.app` |

**Save** → **Redeploy**

WhatsApp variables alag rehte hain (`WHATSAPP_TOKEN`, etc.) — teeno channels ek saath chal sakte hain.

---

## Part 7 — Test

### Text + menu

1. Instagram DM ya Facebook Messenger se **Hi** bhejo
2. Bot welcome menu dikhana chahiye (Dialogflow `START_GREEN_VALLEY`)

### File upload

1. **Image ya PDF** attachment bhejo
2. 20–30 second wait
3. Success:
   ```
   📎 Received: filename. Your file has been saved.
   ```
4. Dashboard / GCS par file dikhni chahiye

### Idle ENDCHAT

1. Bot reply ke baad **10 second** wait (bina message)
2. Goodbye / ENDCHAT message aana chahiye

---

## Part 8 — Supersetting dashboard

Dashboard → **Social integrations** → Instagram / Facebook tabs:

- Page access token, app secret, verify token save kar sakte ho
- Runtime pehle **env vars** use karta hai; JSON optional override hai

Webhook URL wahan bhi dikhega: `/webhooks/meta`

---

## Common problems

| Problem | Fix |
|---------|-----|
| Webhook verify fail | `META_VERIFY_TOKEN` Meta dashboard aur Railway mein **exact same** |
| Instagram DM nahi aata | IG Professional + Page linked + `instagram` webhook subscribed |
| Facebook reply nahi | `page` webhook + `messages` field + Page token |
| File save fail | Permanent Page token (`FB_PAGE_ACCESS_TOKEN`) — temporary token mat use karo |
| `(#200) Requires extended permission` | Token mein `pages_messaging` + `instagram_manage_messages` add karo |
| Rich buttons nahi dikhte | Messenger limits: max 13 quick replies, 3 button template buttons |
| Video/audio reject | By design — sirf image/PDF/Word accept |

---

## Meta permissions summary

| Permission | Use |
|------------|-----|
| `pages_messaging` | Facebook Messenger send/receive |
| `instagram_manage_messages` | Instagram DM send/receive |
| `pages_manage_metadata` | Webhook setup |
| `instagram_basic` | IG account info |

---

## Short flow (ek line)

```
Sahi Meta App → Page + IG link → Webhook /webhooks/meta → Page token Railway
→ Redeploy → Hi test → Photo test
```

---

## Related files (code)

| File | Kaam |
|------|------|
| `instagram.integration.js` | Instagram webhook + Dialogflow |
| `facebook.integration.js` | Facebook Messenger webhook |
| `messenger-integration-core.js` | Shared logic (welcome, ENDCHAT, media) |
| `messenger-rich-outbound.js` | Chips, cards, quick replies |
| `messenger-media-upload.js` | GCS upload |
| `meta-shared.js` | Meta Graph API |
| `WHATSAPP-PERMANENT-TOKEN-SETUP.md` | WhatsApp alag token setup |

---

*Last updated: June 2026 — same webhook URL as WhatsApp: `/webhooks/meta`*
