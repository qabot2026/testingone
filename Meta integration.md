# Meta integration

Simple step-by-step guide to connect **WhatsApp**, **Instagram**, and **Facebook Messenger** with your chatbot.

Your chatbot backend is already ready. **GenieChatbot** portfolio mein naya Meta app banao aur connect karo.

---

## Before you start — Existing portfolio

| Point | Detail |
|-------|--------|
| **Portfolio** | **GenieChatbot** use karo (Unverified = test ke liye OK) |
| **Naya app** | Purana Developer app delete ho chuka ho to **same portfolio** mein naya app banao |
| **Tokens** | Sirf **naye app** se tokens — purane Railway tokens mat use karo |

### Railway — purane tokens badlo (naya app se pehle)

Railway → chatbot-api → **Variables** — purane values **replace** karo (naya app banne ke baad naye daaloge):

```
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
META_PAGE_ACCESS_TOKEN
META_PAGE_ID
WHATSAPP_APP_SECRET
```

**Pehle se rakh sakte ho (same re-use):**

```
WHATSAPP_VERIFY_TOKEN
```

Save → **Redeploy**.

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

### Health link ka jawab kaise padhein (simple)

Browser mein health link kholo — JSON dikhega. **`ok: false` matlab server band nahi hai** — sirf kuch Meta tokens purane / galat hain.

| Health mein dikhe | Matlab | Kya karo |
|-------------------|--------|----------|
| `"ok": false` | WhatsApp token check fail | Naya app se naya token Railway mein daalo |
| `"access_token_error": "Application has been deleted"` | Purana app delete — Railway par purane tokens hain | Naya app banao → naye tokens → Railway update → redeploy |
| `"access_token_valid": false` | WhatsApp token expire ya invalid | Part 2 — naya `WHATSAPP_ACCESS_TOKEN` |
| `"verify_token_set": true` | Webhook secret Railway mein hai | Theek hai |
| `"page_id_set": true` | Page ID Railway mein hai | Theek hai (lekin token naya app se hona chahiye) |
| `"page_access_token_set": true` | Page token Railway mein hai | Purana ho sakta hai — **naya app se dubara generate karo** |
| `"missing_env": []` | Koi variable missing nahi | Theek hai |

Purane tokens kaam nahi karenge jab tak naya app se naye tokens Railway mein na daalo.

Jab sab theek ho jaye:

| Field | Expected |
|-------|----------|
| `"ok": true` | WhatsApp token valid |
| `"access_token_valid": true` | WhatsApp theek |
| `"page_access_token_set": true` | Instagram / Facebook ke liye |

> Instagram / Facebook test ke liye `ok: false` ho to bhi chalega — agar `page_*` true ho aur naya Page token ho. Lekin **Application has been deleted** aaye to **sab tokens naye app se lo**.

---

## Part 1 — Common steps (sab channels ke liye)

Ye steps **ek baar** karo. WhatsApp, Instagram, Facebook — teeno ke liye same.

---

### Step 1 — Meta account

1. Browser kholo
2. Jao: [developers.facebook.com](https://developers.facebook.com)
3. Facebook se **login** karo (jo account Page ka admin ho)

---

### Step 2 — Naya app banao (Meta ka naya flow — 2025/2026)

Meta ab pehle **app name + email** leta hai, phir **use cases** dikhata hai. Neeche **exact order** follow karo.

---

#### Screen A — App name aur email

1. Click: **My Apps** (upar right)
2. Click: **Create App**
3. **App name** daalo (jaise: `Genie Hospital Bot`)
4. **App contact email** — apna email (dropdown se select ya type)
5. Click: **Next**  
   *(Business portfolio agla screen **B2** par aata hai — Screen A par skip ho sakta hai)*

---

#### Screen B — Use cases choose karo (important)

Bahut saare cards / checkboxes dikhenge. **Sirf messaging wale select karo** — baaki mat chhedo.

**Teeno chahiye (WhatsApp + Instagram + Facebook Messenger):**

| Screen par aisa dikhe (words thode alag ho sakte hain) | Tick karo? |
|--------------------------------------------------------|------------|
| **Connect with customers through WhatsApp** | ✅ Haan |
| **Manage messaging and content on Instagram** (ya *Engage with customers on Instagram*) | ✅ Haan |
| **Engage with customers on Messenger from Meta** (ya *Messenger*) | ✅ Haan |

**Sirf ek channel chahiye to sirf wahi ek tick karo** (baaki doc ke Part 2 / 3 / 4 baad mein).

**Ye mat select karo** (abhi zaroorat nahi):

| Use case | Kyon skip |
|----------|-----------|
| Create & manage ads | Ads ke liye — bot ke liye nahi |
| Measure ad performance | Analytics ads |
| Authenticate users / Facebook Login only | Login app — alag kaam |
| Gaming | Game app |
| Fundraisers | NGO donations |
| Business messaging ke alawa koi random use case | Confusion badhega |

**Agar list mein WhatsApp / Instagram / Messenger ka koi card na mile:**

1. Neeche scroll karo — **Other** ya **See all use cases** dhundho
2. **Other** → Next → phir **Business** type choose karo (agar pooche)
3. App banne ke baad **Step 3** se products manually add karo

**Multiple use cases ek saath allowed hain** — teeno messaging wale ek hi app mein tick kar sakte ho.

7. Click: **Next**

---

#### Screen B2 — Business portfolio (GenieChatbot)

Meta poochega:

> **Which business portfolio do you want to connect to this app?**

1. **GenieChatbot** select karo  
   *(Unverified business dikhe to ignore — test ke liye OK)*
2. Click: **Next** (ya **Continue** / **Create app**)

| Note | Detail |
|------|--------|
| **GenieChatbot** | Apna existing portfolio — Page / WhatsApp / Instagram yahi se link honge |
| **Unverified** | Development mode test chalega — verification baad mein |
| **Dusre portfolio** | Mat choose karo — sirf GenieChatbot |

Page kis portfolio mein hai check karna ho: [business.facebook.com/settings](https://business.facebook.com/settings) → **Accounts**.

---

#### Screen C — Requirements / review (agar aaye)

- Kabhi-kabhi Meta **Business verification** ya extra info maangta hai
- Jo samajh aaye woh bharo; jo optional ho skip kar sakte ho (Development mode mein test chalega)
- Click: **Create app** (ya **Go to dashboard**)

---

#### Screen D — Password / security

- Facebook password ya OTP maange to confirm karo
- Dashboard khul jayega — app ready

---

#### App ID save karo

1. Left menu → **App settings** → **Basic**
2. **App ID** copy karo (sirf number — ye secret nahi hai)

Direct link (App ID badal ke):  
`https://developers.facebook.com/apps/YOUR_APP_ID/settings/basic/`

---

#### App dashboard — left menu check karo

App banne ke baad **left side menu** dekho. Use cases sahi choose kiye to ye **pehle se** dikh sakte hain:

| Left menu mein dikhe | Matlab |
|----------------------|--------|
| **WhatsApp** | WhatsApp ready — Part 2 par jao |
| **Messenger** | Messenger ready — Part 3 par jao |
| **Instagram** | Instagram ready — Part 4 par jao |
| **Use cases** | Webhook yahi se set hota hai — **Step 6** |

**Left menu mein "Webhooks" nahi dikhega** — naye Meta apps mein ye normal hai. Seedha **Step 6** follow karo.

---

### Step 3 — Sirf tab jab channel **missing** ho (optional)

> Use cases select kiye to WhatsApp / Messenger / Instagram **pehle se** add ho chuke hain. **"Add products" / "Webhooks" menu nahi dikhega** — ignore karo.

#### Left menu check

1. App kholo: `https://developers.facebook.com/apps/YOUR_APP_ID/`
2. Left menu scroll karo

| Left menu | Action |
|-----------|--------|
| WhatsApp + Messenger + Instagram sab hain | **Step 3 skip** → Step 6 |
| Koi ek missing | Dashboard → **Add use cases** → missing wala tick → Set up |

| Missing | Use case name |
|---------|---------------|
| WhatsApp | Connect with customers through WhatsApp |
| Messenger | Engage with customers on Messenger |
| Instagram | Manage messaging on Instagram |

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

### Step 6 — Webhook configure (Meta — naya UI, 2025/2026)

> **`/webhooks/` link purane apps ke liye hai.** Tumhara app use-case wala hai — webhook **Use cases → Customize → Configuration** ke andar hai.

**Tumhara app:** `https://developers.facebook.com/apps/1681691082959055/`

#### WhatsApp webhook (pehle ye karo — sab channels ke liye same URL)

1. App dashboard kholo (login ke baad):  
   `https://developers.facebook.com/apps/1681691082959055/`
2. **Option A — Dashboard cards:**  
   *Connect with customers through WhatsApp* card par **Customize** click karo  
   **Option B — Left menu:**  
   **Use cases** → WhatsApp use case → **Customize**
3. Left side (ya upar tabs) mein **Configuration** kholo  
   *(kabhi **Settings** ya **Webhook** tab likha ho)*
4. **Configure webhooks** section dhundho
5. Bhari:

| Field | Value |
|-------|-------|
| **Callback URL** | `https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/webhook` |
| **Verify token** | Railway `WHATSAPP_VERIFY_TOKEN` (jaise `geniebot@26`) |

6. Pehle health link kholo — **`verify_token_set: true`** hona chahiye:  
   `https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/health`  
   Agar `false` / `missing_env` mein `WHATSAPP_VERIFY_TOKEN` ho → **Step 5 pehle complete karo** → redeploy
7. Meta mein **Verify and save** dabao

#### Messenger webhook (Facebook ke liye)

1. Wapas app dashboard → **Use cases**
2. *Engage with customers on Messenger* → **Customize**
3. **Messenger API Setup** section → **Configure webhooks**
4. **Same Callback URL** + **Same Verify token** daalo → Verify and save

#### Instagram

Instagram bhi **Page token** use karta hai (Part 4). WhatsApp/Messenger webhook set ho jaye to Instagram events bhi same server par aa sakte hain — Part 4 mein subscribe karo.

#### `/webhooks/` link kaam kyun nahi karta?

| Purana UI | Naya UI (tumhara app) |
|-----------|------------------------|
| Left menu → **Webhooks** | **Use cases → Customize → Configuration** |
| `.../apps/ID/webhooks/` | Ye page blank / redirect — **ignore karo** |

**Verify fail ho to:**  
PowerShell mein (apna token lagao):

```powershell
curl.exe "https://handsome-amazement-production-7f65.up.railway.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=APNA_TOKEN&hub.challenge=12345"
```

Answer **`12345`** aana chahiye. Phir Meta mein dubara Verify karo.

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

1. App → **Use cases** → WhatsApp → **Customize** → **Configuration**
2. Webhook fields / subscriptions mein **`messages`** tick karo → Save

*(Purane UI: App → Webhooks → WhatsApp → Subscribe → messages)*

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

### Step F2 — Page connect + token (Messenger use case)

**Facebook + Instagram dono yahi se setup hote hain.** Instagram tab mein alag **Configuration** nahi hota — ye normal hai.

1. App → **Use cases** → **Messenger** → **Customize**
2. **Messenger API Setup** section:

| Step | Kya karo |
|------|----------|
| **Configure webhooks** | **Same** Callback URL + **Same** Verify token (WhatsApp jaisa) → Verify and save |
| **Connect Facebook Page** | Apni Page select karo → **Save** |
| **Generate token** | Page token copy karo |

3. Railway update (naya token ho to):

```
META_PAGE_ACCESS_TOKEN=EAAG...page token...
META_PAGE_ID=123456789012345
```

> **Important:** `META_PAGE_ID` wahi Page honi chahiye jo yahan connect ki. Health mein `page_id_suffix` match karo.

4. **Add Subscriptions** dabao → tick karo:
   - `messages`
   - `messaging_postbacks`
5. **Confirm** / Save

Redeploy Railway (agar token badla ho).

**Graph API Explorer (optional check):** [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer)  
→ Page token → `POST /{PAGE_ID}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`

---

### Step F3 — Webhook subscribe (Page / Messenger)

1. App → **Use cases** → Messenger → **Customize** → **Messenger API Setup**
2. Page connect karo (Step F2) ke baad **Add Subscriptions**
3. Tick: `messages`, `messaging_postbacks` → Confirm

*(Purane UI: App → Webhooks → Page → Subscribe)*

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

### Step I2 — Instagram (app mein)

Instagram tab mein **Configuration option nahi dikhega** — Instagram DM **Messenger + Page** se chalta hai.

1. **Step F2 poora karo** (Page connect + webhook + subscriptions)
2. App → **Use cases** → **Instagram** → **Customize** — sirf permissions / account link check karo (agar pooche)
3. [business.facebook.com/settings](https://business.facebook.com/settings) → **Accounts** → **Instagram accounts** → Page se **linked** ho

Bina Page link ke Instagram bot kaam nahi karega.

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

**Alag Instagram webhook page nahi hoti.** Page par `messages` subscribe hone se Instagram DM bhi aata hai (Messenger API Setup → **Add Subscriptions**).

Checklist:
- [ ] Page app se connected (Messenger API Setup)
- [ ] `messages` + `messaging_postbacks` subscribed
- [ ] Instagram Business account Page se linked
- [ ] Railway `META_PAGE_*` usi Page ke hain

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
| **`/webhooks/` page blank** | Naya app — Use cases → Customize → Configuration use karo (Step 6) |
| Meta **Verify failed** / *couldn't be validated* | Pehle health check — `verify_token_set` **false** ho to Railway mein `WHATSAPP_VERIFY_TOKEN` add karo → redeploy → curl test → phir Meta Verify |
| Meta **Verify failed** (token set hai) | Token Railway aur Meta mein **exact same**? Extra space? Redeploy? |
| WhatsApp reply nahi | Naya `WHATSAPP_ACCESS_TOKEN` — purana expire ho sakta hai |
| WhatsApp reply, FB/IG nahi | **Messenger API Setup** — Page connect + webhook verify + **Add Subscriptions** (`messages`) |
| Instagram tab mein Configuration nahi | **Normal** — IG Messenger use case + Page link se chalta hai |
| Sirf Development mein chalta hai | App roles mein user ko **Tester** banao |
| Sheet mein Web dikhe | Channel fix ho chuka backend mein — naya message bhejo |
| Health `ok: false` | WhatsApp token expire — ya **Application has been deleted** (purana app delete) → naya app + naye tokens |
| **Application has been deleted** | Meta app delete kar diya — Railway ke **saare** Meta tokens badlo (WhatsApp + Page) |
| Use case galat select ho gaya | App dashboard se products add karo (Step 3) ya naya app banao |

---

## Part 8 — Order of work (recommended)

```
1. Before you start — Railway tokens ready
2. Part 1 — GenieChatbot mein naya app + Webhook + Verify and save
3. Part 2 — WhatsApp (agar chahiye)
4. Part 3 — Facebook Page + Page token
5. Part 4 — Instagram subscribe + test
6. Health check
7. Test message har channel par
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

**GenieChatbot portfolio mein ek Meta app → ek webhook URL → Railway mein tokens → Meta mein Subscribe → test message bhejo.**

WhatsApp = WhatsApp token.  
Instagram + Facebook = Page token + Page ID.  
Teeno = same webhook + same verify token.

---

*Last updated for project: testingone / chatbot-api on Railway.*
