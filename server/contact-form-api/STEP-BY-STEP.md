# Contact form API — **Railway** + **Firebase (Firestore)**

Hosting is **only on [Railway](https://railway.app/)**. Data goes to **Firebase Firestore** — you use the **[Firebase Console](https://console.firebase.google.com/)** (not Google Cloud Run, Cloud Build, or `gcloud`).

Optional: **Dialogflow** in `company.config.js` is separate from this API.

---

## Architecture

| Piece | Where |
|--------|--------|
| Website + chat (static files) | GitHub Pages, Netlify, your host, etc. |
| **Contact API** (this folder) | **Railway** (Docker / Node) |
| **Firestore** | **Firebase** (same project as your app) |

---

## 1. Firebase — Firestore + private key (Firebase Console only)

1. Open **[Firebase Console](https://console.firebase.google.com/)** → your project (or create one).
2. **Build → Firestore Database** → create database if needed (**production** mode is fine; your API uses the **Admin** SDK server-side, not client rules for this path).
3. **Project settings** (gear) → **Service accounts** tab.
4. Click **Generate new private key** → download the JSON file.  
   - This is the normal way servers talk to Firestore; you are **not** deploying anything on Google Cloud Run.
5. In **Railway** → your service → **Variables**:
   - Add **`FIREBASE_SERVICE_ACCOUNT_JSON`**
   - Paste the **entire JSON** as the value (one line is OK; Railway supports multiline secrets).
   - Railway may also show **`FIREBASE_CONFIG`** in some setups; either works if it contains the same service account JSON (this server reads both).

**Wrong JSON:** Firebase *web* config (`apiKey`, `authDomain`, …) is not what you need. You need the **service account** JSON with `"type": "service_account"` and `"private_key"`.

**Named Firestore database:** If you use a database other than `(default)`, set **`FIRESTORE_DATABASE_ID`** in Railway to that database id.

---

## 2. Deploy the API on Railway

1. Push this repo to **GitHub**.
2. **[railway.app](https://railway.app)** → **New project** → **Deploy from GitHub** → select the repo.
3. The repo root should include **`railway.json`**, which points the Docker build at **`server/contact-form-api/Dockerfile`**.
4. Add **`FIREBASE_SERVICE_ACCOUNT_JSON`** (step 1).
5. **Networking** → generate a public **HTTPS** URL (this project uses `https://handsome-amazement-production-7f65.up.railway.app`).
6. Wait until **`GET /health`** returns `ok`.

---

## 3. Point the chat widget at Railway

Set your public Railway base URL (**no trailing slash**) in:

- **`myweb.html`** — `apiBase=https://handsome-amazement-production-7f65.up.railway.app`
- **`chat-frame.html`** — `<meta name="dfchat-api-base-url" content="https://handsome-amazement-production-7f65.up.railway.app" />`

If Railway gives you a **new** domain later, update both places (and the line above) to match.

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| `Firestore: ... permission` or IAM | In Google **Cloud** console, same project as Firebase: the service account email from your JSON needs **Firestore** write access. Easiest fix: **Firebase Console → Project settings → Service accounts** and use the **Firebase Admin SDK** default service account, or grant **Cloud Datastore User** / Firestore-compatible role to the account in **IAM**. |
| `NOT_FOUND` / database | Firestore created? **`FIRESTORE_DATABASE_ID`** set if using a non-default database? |
| Build fails on Railway | **Deploy logs** — `railway.json` **`dockerfilePath`** must match **`server/contact-form-api/Dockerfile`**. |

---

## Local development (optional)

From **`server/contact-form-api/`**:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\your-service-account.json"
npm install
npm start
```

Or set **`FIREBASE_SERVICE_ACCOUNT_JSON`** to the raw JSON string instead of a file path.

---

## What we intentionally do **not** use here

- **Google Cloud Run**, **Artifact Registry**, **Cloud Build** for this API — deploy on **Railway** only.

Secrets belong in **Railway variables**, never committed to git.
