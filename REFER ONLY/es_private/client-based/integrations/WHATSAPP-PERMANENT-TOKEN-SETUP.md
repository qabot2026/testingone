# WhatsApp Permanent Token — Poora Setup Guide

Yeh file **Green Valley / bot 10002** ke liye hai.  
Developer page par sirf **24-hour temporary token** milta hai. Photo/PDF save ke liye **permanent System User token** chahiye.

Railway variables (same names):

```
WHATSAPP_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
```

Webhook URL (Meta App mein):

```
https://YOUR-RAILWAY-URL/webhooks/meta
```

---

## Part 0 — Pehle sahi App kaun sa hai? (bahut apps hon to)

### Tarika A — Railway se (sabse easy)

1. Railway → **Variables** → `WHATSAPP_PHONE_NUMBER_ID` copy karo (15–16 digit, mobile number **nahi**).
2. **developers.facebook.com** → har app kholo → **WhatsApp** → **API Setup**.
3. Jis app mein **same Phone number ID** ho → **wohi tumhara app**.
4. Us app par → **App settings** → **Basic** → **App ID** note karo.

### Tarika B — Webhook se

Developer → app → **WhatsApp** → **Configuration**  
Jahan webhook ho: `https://YOUR-RAILWAY-URL/webhooks/meta` → wahi app.

### Tarika C — Bot number se

Jis WhatsApp number par user chat karta hai, API Setup mein wahi **From** number dikhega.

**Business Manager mein app dhundhte waqt naam se nahi — App ID se match karo.**

---

## Part 1 — Business Manager account

1. Kholo: **https://business.facebook.com/overview**
2. Agar account nahi hai → **Create an account** → business naam → create.
3. Settings ke liye direct links (Meta UI badal chuka hai — dono try karo):
   - **https://business.facebook.com/latest/settings/apps**
   - **https://business.facebook.com/settings**

Agar left menu mein **Accounts → Apps** na dikhe → upar wala **direct Apps link** use karo.

---

## Part 2 — App ko Business se link karo

### Option 1 — Business Manager (Apps page)

1. Kholo: **https://business.facebook.com/latest/settings/apps**
2. **Add** → **Connect an app ID** (naya app mat banao).
3. Developer se copy kiya **App ID** paste karo → **Connect**.

### Option 2 — Developer page se (agar Apps menu nahi mile)

1. **developers.facebook.com** → tumhara app.
2. **App settings** → **Basic**.
3. **Business portfolio** → apna business **Connect / Assign** → **Save**.

Dono mein se koi ek ho jaye to kaafi hai.

---

## Part 3 — System User banao

1. Kholo: **https://business.facebook.com/settings**
2. Left menu → **Users** → **System users**  
   (naya UI: search box mein "System users" type karo)
3. **Add** → naam (jaise `whatsapp-bot`) → **Create**.

---

## Part 4 — System User ko assets assign karo (zaroori)

System user par click → **Add assets**

### 4a) App

- Left: **Apps**
- Tumhara app tick (App ID se confirm)
- Role: **Admin** ya **Full control**
- **Save changes**

### 4b) WhatsApp account

- Phir **Add assets**
- Left: **WhatsApp accounts** (ya WhatsApp Business accounts)
- Apna account tick
- Role: **Full control**
- **Save changes**

**Error: "No permissions available / Assign an app role"**  
→ Token generate **mat** karo pehle. Neeche **Part 4 FIX** dekho — role assign hone ke **baad** hi permissions dikhengi.

---

## Part 4 FIX — "No permissions available" (step-by-step)

Yeh error = System User ke paas **app ki role nahi hai**. Token wizard se pehle **assets assign** karna zaroori hai.

### Check 1 — App Business mein hai ya nahi?

1. Kholo: **https://business.facebook.com/latest/settings/apps**
2. Kya tumhara app **list mein dikhta hai**?
   - **Nahi** → Part 2 karo (Connect app ID) → phir yahan wapas aao
   - **Haan** → Check 2

### Check 2 — App par System User ko role do (Method A — recommended)

1. **https://business.facebook.com/latest/settings/apps**
2. Apne app par **click** karo (list mein naam / ID)
3. **People** ya **Assigned users** tab kholo
4. **Add people** / **Assign people**
5. **System user** select karo (jo banaya tha)
6. Role: **Admin** ya **Full control** (sab toggles ON jahan "Manage app" / "Develop" ho)
7. **Save** / **Assign**

### Check 3 — System User se assets assign (Method B)

1. **https://business.facebook.com/settings** → **Users** → **System users**
2. Apna system user **click** karo
3. Tab: **Assigned assets** — kya koi **App** listed hai?
   - **Nahi** → **Add assets**:
     - Left: **Apps** → app tick → **Admin** / **Full control** → Save
   - **Haan** → role **Admin** hai? Agar "Employee" ya kuch kam hai → edit karke **Admin** karo

### Check 4 — WhatsApp account bhi assign

Same system user → **Add assets** again:

- Left: **WhatsApp accounts**
- Apna WhatsApp Business account tick
- **Full control** → Save

Agar **WhatsApp accounts** list **khali** hai:

- Developer → app → **WhatsApp** product add hai verify karo
- App **Business portfolio** se linked hai verify karo (App settings → Basic)

### Check 5 — Ab token generate karo

1. System user page → **Generate token**
2. Dropdown mein **wahi app** select jisko ab Assigned assets mein dikhta ho
3. Ab permissions dikhni chahiye:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`

**Generate token pehle mat dabana** jab tak Assigned assets mein app na dikhe.

---

### Still "No permissions"? — Common root causes

| # | Problem | Fix |
|---|---------|-----|
| 1 | Galat app select | Railway `WHATSAPP_PHONE_NUMBER_ID` se sahi app dhundho (Part 0) |
| 2 | App kisi aur Business mein hai | Developer → App settings → Basic → Business portfolio — wahi business use karo jisme login ho |
| 3 | App Business se connected nahi | `latest/settings/apps` → Add → Connect app ID |
| 4 | WhatsApp product app par nahi | developers.facebook.com → app → Add product → **WhatsApp** |
| 5 | Personal app, Business link nahi | App settings → Basic → Business portfolio → Connect |
| 6 | Role sirf "Employee" | App assignment → **Admin** / Full control |
| 7 | Token wizard se pehle assign skip | Pehle Part 4 FIX Method A ya B, phir Generate token |

### Diagnostic — 30 second test

System user → **Assigned assets** screenshot ya check:

```
✅ Apps: [tumhara app naam] — Admin
✅ WhatsApp accounts: [account] — Full control
```

Dono ✅ hone ke baad hi **Generate token** kholo.

---

## Part 5 — Permanent token generate

1. System user → **Generate token**
2. App select (tumhara wala)
3. Permissions tick:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. **Generate** → token copy (`EAA...` lamba string)
5. Safe jagah save — dubara poora nahi dikhega

**Mat use karo:** API Setup ka 24-hour temporary token (chat chal sakti hai, photo save fail).

---

## Part 6 — Railway par lagao

Railway → Project → **Variables**:

| Variable | Kya daalna hai |
|----------|----------------|
| `WHATSAPP_TOKEN` | **Naya permanent token** (Step 5) |
| `WHATSAPP_PHONE_NUMBER_ID` | Same rakho — mat badlo |
| `WHATSAPP_APP_SECRET` | Meta App → Settings → Basic → App secret |
| `WHATSAPP_VERIFY_TOKEN` | Jo webhook verify mein likha tha |

**Save** → **Redeploy** (bina redeploy ke naya token use nahi hota).

---

## Part 7 — Test

1. WhatsApp par bot ko **image ya PDF** bhejo.
2. **20–30 second** wait karo (background upload + retry).
3. Success message:
   ```
   📎 Received: filename. Your file has been saved.
   ```
4. Dashboard / GCS par file dikhni chahiye.

---

## Part 8 — Token test (browser, optional)

Image bhejne ke baad webhook/logs se `mediaId` lo, phir browser mein (values replace karo):

```
https://graph.facebook.com/v22.0/MEDIA_ID?phone_number_id=PHONE_NUMBER_ID&access_token=YOUR_TOKEN
```

- JSON mein `"url"` aaye → token + metadata OK
- Error aaye → token / permissions / phone_number_id check karo

Desk API (login ke baad):

```
POST /api/channels/whatsapp/test-media
Body: { "mediaId": "...", "phoneNumberId": "..." }
```

---

## Common problems

| Problem | Fix |
|---------|-----|
| Accounts → Apps nahi dikhta | **https://business.facebook.com/latest/settings/apps** direct kholo |
| Bahut apps — kaun sa? | Railway `WHATSAPP_PHONE_NUMBER_ID` se match |
| No permissions on token | App + WhatsApp account dono assign (Part 4) |
| Chat chale, photo fail | Temporary token → permanent token (Part 5) |
| Error: permanent System User token | Part 5–6 complete karo, redeploy |

---

## Agar permanent token setup nahi karna

Sirf **text chat** chahiye, **file save nahi**:

- Developer **temporary token** se chat chal sakti hai.
- Code mein opportunistic upload band karwao — permanent token ki zaroorat nahi.

File save (form ke andar ya bina form ke) chahiye → permanent token **zaroori**.

---

## Short flow (ek line)

```
Sahi app (Phone number ID) → Business link → System User → App + WhatsApp assign
→ Generate permanent token → Railway WHATSAPP_TOKEN → Redeploy → Photo test
```

---

## Related files (code)

| File | Kaam |
|------|------|
| `whatsapp.integration.js` | Webhook, media capture, Dialogflow |
| `es_private/lib/channels/meta-shared.js` | Meta API, media download |
| `es_private/lib/channels/whatsapp-media-upload.js` | GCS upload |
| `social-integrations.json` | Supersetting (optional override) |
| `INSTAGRAM-FACEBOOK-PERMANENT-TOKEN-SETUP.md` | Instagram + Facebook setup |

---

*Last updated: June 2026 — Meta UI links `business.facebook.com/latest/settings/...` use karein agar purana menu na dikhe.*
