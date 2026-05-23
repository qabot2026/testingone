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

### Health link ka jawab kaise padhein (simple)

Browser mein health link kholo — JSON dikhega. **`ok: false` matlab server band nahi hai** — sirf kuch Meta tokens purane / galat hain.

| Health mein dikhe | Matlab | Kya karo |
|-------------------|--------|----------|
| `"ok": false` | WhatsApp token check fail | Naya app se naya token Railway mein daalo |
| `"access_token_error": "Application has been deleted"` | **Purana Meta app delete ho gaya** — Railway par ab bhi purane tokens hain | **Naya app banao** → naye tokens → Railway update → redeploy |
| `"access_token_valid": false` | WhatsApp token expire ya invalid | Part 2 — naya `WHATSAPP_ACCESS_TOKEN` |
| `"verify_token_set": true` | Webhook secret Railway mein hai | Theek hai |
| `"page_id_set": true` | Page ID Railway mein hai | Theek hai (lekin token naya app se hona chahiye) |
| `"page_access_token_set": true` | Page token Railway mein hai | Purana ho sakta hai — **naya app se dubara generate karo** |
| `"missing_env": []` | Koi variable missing nahi | Theek hai |

**Aapne Meta app delete kiya — isliye ab ye error normal hai.**  
Purane `WHATSAPP_ACCESS_TOKEN` aur `META_PAGE_ACCESS_TOKEN` kaam nahi karenge. **Part 1 se naya app banao** aur **saare tokens naye** Railway mein daalo.

Jab sab theek ho jaye:

| Field | Expected |
|-------|----------|
| `"ok": true` | WhatsApp token valid |
| `"access_token_valid": true` | WhatsApp theek |
| `"page_access_token_set": true` | Instagram / Facebook ke liye |

> Instagram / Facebook test ke liye `ok: false` ho to bhi chalega — agar `page_*` true ho aur naya Page token ho. Lekin **Application has been deleted** aaye to **sab tokens naye app se lo**.

---

## Part 0 — Fresh start (pehle sab delete karo)

Poora naya setup chahiye to **pehle ye order** follow karo. **App delete** aur **Portfolio delete** alag hain.

| Cheez | Kahan delete hoti hai |
|-------|------------------------|
| **Developer App** | [developers.facebook.com/apps](https://developers.facebook.com/apps) |
| **Business portfolio** | [business.facebook.com/settings](https://business.facebook.com/settings) |
| **Railway tokens** | [railway.app](https://railway.app) → Variables |

---

### Step 0A — Saari Developer Apps delete karo

Har purani app ke liye:

1. [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. App kholo → left menu → **App settings** → **Advanced**
3. Neeche scroll → **Delete app** → confirm

Sab apps delete ho jayein jab tak **Create App** par koi purani app na bache.

---

### Step 0B — Har Business portfolio delete karo (GenieChatbot, Expo Chatapp, …)

**Important:** Portfolio tab tak delete nahi hoga jab tak andar **WhatsApp Business account** connected ho — pehle hatao.

Official guide: [Meta Help — Delete business portfolio](https://www.facebook.com/business/help/1592865014304024)

#### Pehle assets hatao (har portfolio ke liye repeat)

1. Kholo: [business.facebook.com/settings](https://business.facebook.com/settings)
2. Upar left dropdown se portfolio select karo (**GenieChatbot** ya **Expo Chatapp**)
3. Left menu → **Accounts** (ya **Business assets**)
4. Inhe **remove / disconnect** karo (jo connected hon):
   - **WhatsApp accounts** — **pehle ye** (bina iske portfolio delete block ho sakta hai)
   - Ad accounts (agar test wale hain)
   - Instagram accounts (unlink — Instagram app se account delete nahi hota)
   - **Facebook Page** — Page delete nahi karna agar baad mein use karna hai; sirf portfolio se **remove** karo ya doosre portfolio mein move karo

#### Portfolio permanently delete

1. Same portfolio selected ho ([business.facebook.com/settings](https://business.facebook.com/settings))
2. Left menu → **Business info** (ya **Business portfolio info**)
3. Neeche scroll → **Permanently delete business**
4. Reason select karo → password confirm karo
5. **Submit**

**Dusra portfolio (Expo Chatapp):** dropdown se switch karo → same steps repeat.

| Note | Detail |
|------|--------|
| **24 hours pending** | Delete ke baad 24 ghante wait — tab tak cancel kar sakte ho |
| **Wapas nahi khulega** | 24 ghante ke baad permanent |
| **Facebook Page** | Page khud delete nahi hota — sirf portfolio se link hat-ti hai |
| **Delete option na dikhe** | Full control admin chahiye; ya koi asset ab bhi connected hai |

#### "Scheduled for deletion — account can't be accessed" (normal hai)

Agar ye message aaye:

> *You scheduled Expo Chatapp for deletion. Your account can't be accessed at this time. If you think that this is a mistake, choose Don't delete business before it's permanently deleted.*

| Matlab | Kya karo |
|--------|----------|
| **Delete ho chuka schedule** | Portfolio delete **fail nahi hua** — Meta ne 24 ghante ke liye lock kar diya |
| **Ab access nahi milega** | Pending period mein us portfolio ko kholna / edit karna **normal se band** hai |
| **Dubara delete mat try karo** | Already queue mein hai — wait karo |
| **Don't delete business** | Sirf tab click karo jab cancel karna ho — warna **mat dabao** |

**24 ghante baad** portfolio list se permanently hat jayega. Tab **Part 1** se naya portfolio + naya app banao.

#### "Last admin can't be removed" (galat step par ho)

Agar ye message aaye:

> *This admin can't be removed from the business because they're the last admin on the business. If you want to delete this admin, please add another admin to the business.*

| Matlab | Kya karo |
|--------|----------|
| **People / Users se admin hata rahe ho** | Ye **portfolio delete ka step nahi hai** — Meta last admin ko hataane deta hi nahi |
| **Admin remove mat karo** | Poora portfolio delete karna hai to **Users section chhod do** |
| **Sahi path** | **Business info** → **Permanently delete business** (neeche scroll) |
| **Tum last admin ho** | Theek hai — **tum hi** portfolio delete kar sakte ho, pehle kisi aur ko add karne ki zaroorat nahi |

**Short:** Users / People mein kisi ko remove mat karo. Seedha **Business info → Permanently delete business**.

Agar **Permanently delete** par click karte waqt alag error aaye (jaise *system admin*), to batao — uska alag fix hai.

#### Delete ho gaya verify karo

1. [business.facebook.com/settings](https://business.facebook.com/settings) → **Business portfolios**
2. List **khali** ho ya sirf naya wala ho
3. App banate waqt purane naam na dikhein — agar dikhein to 24h wait karo ya **Create a business portfolio** use karo

---

### Step 0C — Railway se purane Meta tokens hatao

Railway → chatbot-api → **Variables** — ye **delete** karo ya khali karo:

```
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
META_PAGE_ACCESS_TOKEN
META_PAGE_ID
WHATSAPP_APP_SECRET
```

**Rakh sakte ho (naye app mein same use kar sakte ho):**

```
WHATSAPP_VERIFY_TOKEN
```

**Redeploy** karo.

Health check ab `Application has been deleted` dikhaye — **theek hai**, naya app banane ke baad fix hoga.

---

### Step 0D — Ab naya setup shuru karo

Sab clean ho jaye to:

```
Part 0 (delete) → Part 1 (naya app) → Part 2/3/4 (channels) → Test
```

---

### Plan B — Delete skip karo (recommended agar errors aa rahe hon)

**Poora portfolio delete zaroori nahi hai** naya bot chalane ke liye. Meta ke alag-alag pages par errors normal hain — isliye **delete fight mat karo**.

| Question | Answer |
|----------|--------|
| **Koi app / agent sab auto kare?** | **Nahi.** Meta password + 2FA tumhe khud confirm karna padta hai. Koi third-party app tumhare account se portfolio delete / app bana nahi sakta (security). |
| **Cursor / AI agent?** | Sirf **guide** kar sakta hai — Meta UI par click tumhe khud karne padenge. Errors ka screenshot bhejo, step-by-step batate hain. |
| **Expo Chatapp pending delete?** | Theek hai — **24h wait**, usko chhod do. Dubara mat kholo. |
| **GenieChatbot delete nahi ho raha?** | **Chhod do abhi** — baad mein delete kar lena. |

**Ab ye karo (2 sites hi use karo):**

| Site | Sirf ye kaam |
|------|----------------|
| [developers.facebook.com](https://developers.facebook.com) | Naya app, webhook, tokens |
| [business.facebook.com/settings](https://business.facebook.com/settings) | Sirf jab Page / WhatsApp naye portfolio se link karna ho |

**Mat ghumo in par (confusion badhta hai):** facebook.com home, Meta Business Suite dashboard, random Settings tabs, People/Users (admin remove).

**Fresh start bina purana delete:**

1. **Step 0C** — Railway purane tokens hatao → redeploy
2. [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App**
3. Screen B2 par **Create a business portfolio** → naya naam (jaise `Genie Bot 2026`)
4. **GenieChatbot / Expo Chatapp mat select karo**
5. App banne ke baad **Part 1** webhook + **Part 2/3/4** channels

Purane portfolio list mein dikhen to **ignore** — naya portfolio alag hai, naya app usse connect hoga.

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

#### Screen B2 — Business portfolio connect (ye screen aapko dikh rahi hai)

Meta poochega:

> **Which business portfolio do you want to connect to this app?**

**Kya karna hai:**

| Option | Kab choose karo |
|--------|-----------------|
| **GenieChatbot** (ya jo naam is project ka ho) | ✅ **Yahi choose karo** — agar isi portfolio ke andar aapka Facebook Page / WhatsApp / Instagram linked hai ya aap isi ke liye naya app bana rahe ho |
| **Expo Chatapp** (ya purana / alag project) | ❌ Mat choose karo — agar ye purana test app hai aur is bot se link nahi |
| **Create a business portfolio** | ✅ **Plan B (recommended)** — purane delete skip; naya naam se portfolio banao |

**Simple rule:** Jis **Business portfolio** ke saath aapka **Facebook Page** aur **Instagram Business** connected hai — **wahi select karo**.

**Verified vs unverified:**

| Type | Abhi test ke liye |
|------|-------------------|
| **Unverified** portfolio | ✅ Chalega — Development mode mein bot test kar sakte ho |
| **Verified** portfolio | Live / public users ke liye baad mein chahiye — abhi skip kar sakte ho |

Meta likhe: *"unverified portfolio… add later"* — **theek hai**, app bana lo, verification baad mein.

8. Apna portfolio **select** karo (radio / checkbox — jo UI ho)
9. Click: **Next** (ya **Continue** / **Create app**)

**Confusion ho to:** [business.facebook.com/settings](https://business.facebook.com/settings) → **Accounts** → dekho Page kis portfolio ke under hai → wahi portfolio app se connect karo.

**Portfolio delete kiya phir bhi list mein dikhe?**

| Reason | Simple matlab |
|--------|----------------|
| **App delete ≠ Portfolio delete** | Sirf Developer App delete kiya — portfolio alag hai → **Part 0B** follow karo |
| **24 ghante pending** | Delete submit kiya par abhi pending period chal raha hai |
| **Assets ab bhi connected** | WhatsApp / Page hatao, phir delete |
| **Poora delete nahi hua** | [business.facebook.com/settings](https://business.facebook.com/settings) → **Permanently delete business** dubara try karo |

**Fresh start:** Pehle **Part 0** poora karo — phir **Create a business portfolio** se naya portfolio banao.

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

#### Step 2 ke baad left menu mein kya dikhna chahiye

Use cases sahi choose kiye to ye products pehle se dikh sakte hain:

| Left menu | Matlab |
|-----------|--------|
| **WhatsApp** | WhatsApp use case select hua |
| **Messenger** | Messenger use case select hua |
| **Instagram** | Instagram use case select hua |

**Webhooks hamesha check karo** — agar left menu mein **Webhooks** na ho to Step 3 karo.

---

### Step 3 — Products add karo (jo missing ho)

Pehle left menu dekho — Step 2 ke use cases se kuch products **pehle se** aa chuke honge.

| Left menu mein dikhe? | Action |
|-----------------------|--------|
| **Webhooks** nahi hai | **Add products** → **Webhooks** → **Set up** |
| **WhatsApp** chahiye par nahi hai | **Add products** → **WhatsApp** → **Set up** |
| **Messenger** chahiye par nahi hai | **Add products** → **Messenger** → **Set up** |
| **Instagram** chahiye par nahi hai | **Add products** → **Instagram** → **Set up** |

| Product | Kab add karna hai |
|---------|-------------------|
| **Webhooks** | **Hamesha** — teeno channels ke liye zaroori |
| **WhatsApp** | WhatsApp chahiye aur menu mein nahi hai |
| **Messenger** | Facebook Messenger chahiye aur menu mein nahi hai |
| **Instagram** | Instagram DM chahiye aur menu mein nahi hai |

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
| Health `ok: false` | WhatsApp token expire — ya **Application has been deleted** (purana app delete) → naya app + naye tokens |
| **Application has been deleted** | Meta app delete kar diya — Railway ke **saare** Meta tokens badlo (WhatsApp + Page) |
| Use case galat select ho gaya | App delete karke dubara Step 2 — sirf WhatsApp / Instagram / Messenger wale tick karo |

---

## Part 8 — Order of work (recommended)

Poora fresh start:

```
0. Part 0 — Purani apps + portfolios delete + Railway tokens clear
1. Part 1 — Naya app + Webhook + Verify and save
2. Part 2 — WhatsApp (agar chahiye)
3. Part 3 — Facebook Page + Page token
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
