# Contact form API — **Railway** + **Firebase Firestore** + optional **Google Sheets**

Hosting is **only on [Railway](https://railway.app/)**. **Firestore** and credentials come from the **[Firebase Console](https://console.firebase.google.com/)**. **Google Sheets** gets a **live row append** on each successful save when you set **`SHEETS_SPREADSHEET_ID`** (same service account; share the sheet with its email).

Optional: **Dialogflow** in `company.config.js` is separate from this API.

---

## Architecture

| Piece | Where |
|--------|--------|
| Website + chat (static files) | GitHub Pages, Netlify, your host, etc. |
| **Contact API** (this folder) | **Railway** (Docker / Node) |
| **Firestore** | **Firebase** (same project as your app) |
| **Google Sheets** (optional) | Your spreadsheet; API appends a row when **`SHEETS_SPREADSHEET_ID`** is set in Railway |

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

## 1b. Google Sheets — live row on each submission (optional)

1. Create a Google Sheet or open an existing one. First row can be headers, e.g. `timestamp`, `form_id`, `name`, `mobile`, `email`, `client_session_id` (columns **A–F** match the default range).

2. From your **`FIREBASE_SERVICE_ACCOUNT_JSON`**, copy the **`client_email`** (looks like `something@PROJECT.iam.gserviceaccount.com`). In the Sheet click **Share** → paste that email → role **Editor** → **Send**.

3. Copy **`SHEETS_SPREADSHEET_ID`** from the URL:  
   `https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit`

4. In **[Google Cloud Console](https://console.cloud.google.com/)** → select the **same project** as Firebase (**project id** in your JSON) → **APIs & Services** → **Library** → enable **Google Sheets API** (if the first append fails with API not enabled).

5. In **Railway → Variables** add:
   - **`SHEETS_SPREADSHEET_ID`** = that id  
   - Optional: **`SHEETS_RANGE`** = e.g. `Sheet1!A:F` (default) or `Leads!A:F` if your tab is named `Leads`  
   - To turn Sheets off but keep Firestore: **`DISABLE_SHEETS`** = `1`, or remove **`SHEETS_SPREADSHEET_ID`**.

Each **POST** to `/contact-form-submissions` appends **one row** when Sheets is enabled.

---

## 2. Deploy the API on Railway

1. Push this repo to **GitHub**.
2. **[railway.app](https://railway.app)** → **New project** → **Deploy from GitHub** → select the repo.
3. The repo root should include **`railway.json`**, which points the Docker build at **`server/contact-form-api/Dockerfile`**.
4. Add **`FIREBASE_SERVICE_ACCOUNT_JSON`** (step 1).  
5. For Sheets: add **`SHEETS_SPREADSHEET_ID`** (and optional **`SHEETS_RANGE`**) per **§1b**.
6. **Networking** → public **HTTPS** URL (e.g. `https://handsome-amazement-production-7f65.up.railway.app`).
7. Wait until **`GET /health`** returns `ok`.

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
| **`Firestore: 5 NOT_FOUND` or `NOT_FOUND`** | **Most common:** no Firestore database in that project, wrong **database id**, or the JSON key is for a **different** project than where you opened Firestore. Open **Firebase Console** → select the project whose **`project_id`** is inside your JSON → **Firestore Database** → if you see **Create database**, create it (Native / **production** mode is fine). If you use a **named** database (not `(default)`), set Railway **`FIRESTORE_DATABASE_ID`** to that exact name (see Firestore → database selector). |
| `Firestore: ... permission` or IAM | Same project as Firebase: service account needs write access. **Firebase Console → Project settings → Service accounts** (use the key from here), or in Google Cloud **IAM** grant **Datastore User** (or Editor for testing) to **`client_email`** from the JSON. |
| **`Sheets:` … default credentials** / **Could not load the default credentials** | **Railway** must have **`FIREBASE_SERVICE_ACCOUNT_JSON`** (full service account JSON — same as Firestore). Without it, Sheets cannot sign requests. Redeploy after adding the variable. |
| **`Sheets:` … No Google service account JSON** | Paste the full JSON in **`FIREBASE_SERVICE_ACCOUNT_JSON`** (must include `"type":"service_account"` and **`private_key`**). Client-only Firebase web config is not valid here. |
| **`Sheets:` … permission / 403** | Sheet **Shared** with **`client_email`** from the JSON as **Editor**. **Google Sheets API** enabled in the same GCP project as Firebase. |
| **`Sheets:` … Unable to parse range** | **`SHEETS_RANGE`** must match an existing tab name, e.g. `Sheet1!A:F`. |
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
