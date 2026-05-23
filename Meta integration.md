# Meta integration

Simple step-by-step guide to connect **WhatsApp**, **Instagram**, and **Facebook Messenger** with your chatbot.

Your chatbot backend is already ready. You only need to create a new Meta app and connect it.

---

## Important points (read once)

| Point | Detail |
|-------|--------|
| **One webhook for all** | WhatsApp + Instagram + Facebook use **same URL** |
| **Same Dialogflow bot** | Web, WhatsApp, Instagram, Facebook — one CX agent |
| **Railway** | Your server runs on Railway — tokens go in Railway Variables |
| **Browser mein Forbidden** | Webhook URL browser mein kholo to **Forbidden** aayega — **normal hai** |
| **Health check** | Server theek hai ya nahi — health link se check karo |

**Your server links (change only if Railway URL changes):**

| Use | Link |
|-----|------|
| Webhook (Meta mein paste karo) | `https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/webhook` |
| Health check | `https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/health` |

---

## Part 1 — Common steps (sab channels ke liye)

Ye steps **ek baar** karo. WhatsApp, Instagram, Facebook — teeno ke liye same.

---

### Step 1 — Meta account

1. Browser kholo
2. Jao: [developers.facebook.com](https://developers.facebook.com)
3. Facebook se **login** karo (jo account Page ka admin ho)

---

### Step 2 — Naya app banao

1. Click: **My Apps** (upar right side)
2. Click: **Create App**
3. **Use case** choose karo: **Other** → Next  
   (ya **Business** agar option aaye)
4. App type: **Business** → Next
5. App name daalo (jaise: `Genie Hospital Bot`)
6. Email select karo → **Create app**
7. Password / OTP maange to confirm karo

**App ID note kar lo:**  
Left menu → **App settings** → **Basic** → **App ID** (number)

Direct link (App ID badal ke):  
`https://developers.facebook.com/apps/YOUR_APP_ID/settings/basic/`

---

### Step 3 — Products add karo (jo chahiye)

Left side **Add products** (ya dashboard par cards):

| Product | Kab add karna hai |
|---------|-------------------|
| **Webhooks** | **Hamesha** — teeno ke liye zaroori |
| **WhatsApp** | Sirf WhatsApp chahiye to |
| **Messenger** | Facebook Messenger chahiye to |
| **Instagram** | Instagram DM chahiye to |

Har product par **Set up** click karo.

> **Note:** Instagram ke liye pehle **Facebook Page** chahiye. Page ke saath Instagram Business account link hona chahiye (Part 4 mein detail).

---

### Step 4 — Verify token socho (secret password jaisa)

Ye aap khud banaoge. Meta aur Railway **dono jagah same** hona chahiye.

**Example:** `geniebot@26`  
(kuch bhi rakho — bas yaad rakho aur kisi ko mat bhejo)

Isko Railway mein save karenge: `WHATSAPP_VERIFY_TOKEN`

---

### Step 5 — Railway mein common variable

1. Kholo: [railway.app](https://railway.app) → login
2. Apna **chatbot project** kholo
3. **chatbot-api** service kholo
4. Tab: **Variables**
5. Add karo:

```
WHATSAPP_VERIFY_TOKEN=apna-secret-yahan
```

6. **Deploy** / redeploy karo (save ke baad)

---

### Step 6 — Webhook configure (Meta)

1. Jao: [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Apna **app** kholo
3. Left menu → **Webhooks**
4. **Configure** (ya **Edit**) click karo
5. Bhari:

| Field | Kya paste karna hai |
|-------|---------------------|
| **Callback URL** | `https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/webhook` |
| **Verify token** | Wahi jo Railway `WHATSAPP_VERIFY_TOKEN` mein hai |

6. Pehle health link browser mein kholo (server warm ho jaye):
   `https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/health`
7. Wapas Meta → click **Verify and save**
8. **Success** aana chahiye

**Verify fail ho to:**  
PowerShell mein (apna token lagao):

```powershell
curl.exe "https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=APNA_TOKEN&hub.challenge=12345"
```

Answer **`12345`** aana chahiye. Phir Meta mein dubara Verify karo.

**Webhook page direct link:**  
`https://developers.facebook.com/apps/YOUR_APP_ID/webhooks/`

---

### Step 7 — App Secret (optional par accha hai)

1. App → **App settings** → **Basic**
2. **App secret** → **Show** → copy
3. Railway Variables:

```
WHATSAPP_APP_SECRET=app-secret-yahan
```

Redeploy.

---

### Step 8 — Development mode / Tester (testing ke liye)

Jab app **Development** mode mein ho, sirf **Tester** log message kar sakte hain.

1. App → left menu → **App roles** → **Roles** (ya Test users)
2. **Add people** → Instagram / Facebook test user add karo
3. Unko invite accept karna hoga

**Live** (public) ke liye baad mein **App Review** chahiye.

---

### Step 9 — Health check

Browser mein kholo:

```
https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/health
```

JSON dikhega. Dekho:

| Field | Matlab |
|-------|--------|
| `verify_token_set: true` | Verify token Railway mein hai |
| `page_id_set: true` | Facebook/Instagram ke liye Page ID set hai |
| `page_access_token_set: true` | Page token set hai |
| `access_token_valid: true` | WhatsApp token theek hai |

---

## Part 2 — WhatsApp integration

Sirf WhatsApp chahiye to Part 1 + ye steps.

---

### Step W1 — WhatsApp product setup

1. App → left menu → **WhatsApp** → **API Setup** (ya Getting started)
2. **Meta Business Account** select karo (ya naya banao)
3. **Phone number** add karo (test number Meta deta hai ya apna business number)

---

### Step W2 — Token aur Phone Number ID

**API Setup** page par:

| Copy karo | Railway variable |
|-----------|------------------|
| **Temporary access token** (ya permanent token banao) | `WHATSAPP_ACCESS_TOKEN` |
| **Phone number ID** (number ke saath dikhega) | `WHATSAPP_PHONE_NUMBER_ID` |

Railway Variables example:

```
WHATSAPP_ACCESS_TOKEN=EAAG...lamba-token...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_GRAPH_API_VERSION=v25.0
```

**Permanent token (production):**  
Meta Business Settings → System users → token generate (recommended).

Redeploy Railway.

---

### Step W3 — Webhook subscribe (WhatsApp)

1. App → **Webhooks**
2. **WhatsApp Business Account** row dhundho
3. **Subscribe**
4. Tick karo: **`messages`**
5. Save

---

### Step W4 — Test WhatsApp

1. Apne phone se us WhatsApp business number par message bhejo: `Hi`
2. Bot reply karega (Dialogflow se)
3. Google Sheet mein Channel = **WhatsApp** dikhega

---

## Part 3 — Facebook Page + Messenger

Facebook Messenger chahiye to Part 1 + ye steps.

---

### Step F1 — Facebook Page banao (agar nahi hai)

1. [facebook.com/pages/create](https://www.facebook.com/pages/create)
2. Page name daalo → create
3. **Page ID** nikalna:
   - Page kholo → **About** → **Page transparency** → **Page ID**  
   ya Graph API Explorer: `me?fields=id,name` (Page token se)

---

### Step F2 — Messenger product

1. App → **Add product** → **Messenger** → **Set up**
2. **Access tokens** section → **Page** select karo → **Generate token**
3. Permissions allow karo jab pooche

| Copy | Railway |
|------|---------|
| Page access token | `META_PAGE_ACCESS_TOKEN` |
| Page ID | `META_PAGE_ID` |

```
META_PAGE_ACCESS_TOKEN=EAAG...page-token...
META_PAGE_ID=123456789012345
```

Redeploy.

**Graph API Explorer:** [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer)  
→ **Get Page Access Token** → permissions: `pages_messaging`, `pages_manage_metadata`

---

### Step F3 — Webhook subscribe (Page)

1. App → **Webhooks**
2. **Page** row → **Subscribe**
3. Tick:
   - `messages`
   - `messaging_postbacks`
4. Save

---

### Step F4 — Test Facebook Messenger

1. Apni Facebook Page kholo
2. **Message** button se Page ko message bhejo (Tester account se agar Development mode ho)
3. Bot reply karega
4. Sheet mein Channel = **Facebook**

---

## Part 4 — Instagram DM

Instagram chahiye to Part 1 + Part 3 (Page token) + ye steps.

---

### Step I1 — Instagram Business account

1. Instagram app → **Settings** → **Account type** → **Professional** (Business ya Creator)
2. [business.facebook.com](https://business.facebook.com) kholo
3. **Settings** → **Accounts** → **Instagram accounts**
4. Apna Instagram **Facebook Page se link** karo

Bina Page link ke Instagram bot kaam nahi karega.

---

### Step I2 — Instagram product app mein

1. App → **Add product** → **Instagram** (Instagram API / messaging wala) → **Set up**
2. Instagram account connect karo jab pooche

---

### Step I3 — Page token (same as Facebook)

Instagram ke liye **alag Instagram token mat banao**.  
Use **Page access token** (Part 3 Step F2):

```
META_PAGE_ACCESS_TOKEN=...
META_PAGE_ID=...
```

Token mein ye permissions honi chahiye:

- `instagram_manage_messages`
- `instagram_basic`
- `pages_messaging`
- `pages_manage_metadata`

---

### Step I4 — Webhook subscribe (Instagram)

1. App → **Webhooks**
2. **Instagram** row → **Subscribe**
3. Tick:
   - `messages`
   - `messaging_postbacks`
4. Save

---

### Step I5 — Test Instagram

1. App **Development** mode mein ho to apna Instagram **App Tester** banao (Part 1 Step 8)
2. Instagram se apne **business account** ko DM karo: `Hi`
3. Bot reply karega
4. Sheet mein Channel = **Instagram**, session `ig_...`

---

## Part 5 — Railway variables (poori list)

Jo channel use karoge, wahi variables bharo.

| Variable | WhatsApp | Instagram | Facebook | Kya hai |
|----------|:--------:|:---------:|:--------:|---------|
| `WHATSAPP_VERIFY_TOKEN` | ✅ | ✅ | ✅ | Webhook secret — Meta + Railway same |
| `WHATSAPP_ACCESS_TOKEN` | ✅ | ❌ | ❌ | WhatsApp token |
| `WHATSAPP_PHONE_NUMBER_ID` | ✅ | ❌ | ❌ | WhatsApp number ID |
| `META_PAGE_ACCESS_TOKEN` | ❌ | ✅ | ✅ | Facebook Page token |
| `META_PAGE_ID` | ❌ | ✅ | ✅ | Facebook Page number ID |
| `WHATSAPP_APP_SECRET` | Optional | Optional | Optional | Security |
| `WHATSAPP_GRAPH_API_VERSION` | Optional | — | — | Default `v25.0` |

Dialogflow / Firebase keys pehle se Railway par hain — unhe dubara mat badlo jab tak zaroorat na ho.

---

## Part 6 — Dialogflow (channel wise reply)

Ek hi bot, alag channel par alag message:

1. CX mein session parameter: **`channel`**
2. Values: `web`, `whatsapp`, `instagram`, `facebook`
3. Same page par alag **Agent response** + **Condition**:

```
$session.params.channel = "web"
$session.params.channel = "whatsapp"
$session.params.channel = "instagram"
$session.params.channel = "facebook"
```

Forms (`open_form`) sirf **web** par chalte hain. WhatsApp / Instagram par chat se details lo.

---

## Part 7 — Problem solving (simple)

| Problem | Solution |
|---------|----------|
| Webhook **Forbidden** browser mein | Normal — Meta Verify se check karo |
| Meta **Verify failed** | Token Railway aur Meta mein **exact same**? Redeploy? |
| WhatsApp reply nahi | Naya `WHATSAPP_ACCESS_TOKEN` — purana expire ho sakta hai |
| Instagram reply nahi | Page token + Instagram **Subscribed**? Tester account? |
| Sirf Development mein chalta hai | App roles mein user ko **Tester** banao |
| Sheet mein Web dikhe | Channel fix ho chuka backend mein — naya message bhejo |
| Health `ok: false` | WhatsApp token expire — Instagram ke liye `page_*` true dekho |

---

## Part 8 — Order of work (recommended)

Naya app ke baad ye order follow karo:

```
1. Part 1 — App + Webhook + Railway verify token + Verify and save
2. Part 2 — WhatsApp (agar chahiye)
3. Part 3 — Facebook Page + Page token (Instagram ke liye bhi zaroori)
4. Part 4 — Instagram subscribe + test
5. Health check
6. Test message har channel par
```

---

## Quick links

| Kaam | Link |
|------|------|
| Meta apps | [developers.facebook.com/apps](https://developers.facebook.com/apps) |
| Graph API Explorer | [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer/) |
| Business settings | [business.facebook.com/settings](https://business.facebook.com/settings) |
| Railway | [railway.app](https://railway.app) |
| Your webhook | `https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/webhook` |
| Your health | `https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/health` |

---

## Summary (ek line mein)

**Ek Meta app → ek webhook URL → Railway mein tokens → Meta mein Subscribe → test message bhejo.**

WhatsApp = WhatsApp token.  
Instagram + Facebook = Page token + Page ID.  
Teeno = same webhook + same verify token.

---

*Last updated for project: testingone / chatbot-api on Railway.*
