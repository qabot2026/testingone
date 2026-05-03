# Contact form → Firestore + Google Sheet (**Google Cloud dashboards only**)

This guide uses **only web pages** (Google Cloud Console + GitHub in a browser). It does **not** use Terminal, Command Prompt, `gcloud`, `npm`, Cloud Shell commands, or copy-pasted shell blocks.

The API code and this file live on GitHub under **`server/contact-form-api/`** in [qabot2026/testingone](https://github.com/qabot2026/testingone) (**branch `main`**). After edits, keep GitHub updated (see **Pushing updates from your computer**) so Cloud Run can rebuild from the latest commit.

---

## Contents

1. [What you need first](#what-you-need-first) · [This project on GitHub](#this-project-on-github-official-repo)  
2. [Steps 1–18](#steps-all-from-dashboards) (Cloud + GitHub + embed)  
3. [Pushing updates (Git)](#pushing-updates-from-your-computer-git) · [Optional env vars](#optional-dashboards-only-later-tuning)

---

## What you need first

| Item | Purpose |
|------|--------|
| A Google account | Sign in to Google Cloud |
| A **GitHub** account | Cloud Run pulls your code from GitHub via the dashboard (browser only) |

If you do not use GitHub yet, create a **free** repo and upload files using GitHub’s website (**Add file → Upload files**). Upload everything inside your **`contact-form-api`** folder (including `Dockerfile`, `package.json`, `index.mjs`, and the **`lib`** folder).

**Important:** Either:

- Upload **only** the contents of **`contact-form-api`** as the **root** of the repo (so `Dockerfile` sits at the root of the repo), **or**

- Keep a parent repo and remember the **path** to `Dockerfile` (for example `server/contact-form-api`) when Cloud Run asks for “Build context” or “Dockerfile path” — use the paths that match **your** GitHub repo.

---

## This project on GitHub (official repo)

| | |
|--|--|
| **Repository** | [https://github.com/qabot2026/testingone](https://github.com/qabot2026/testingone) |
| **Branch** | `main` |
| **API folder (contains `Dockerfile`)** | `server/contact-form-api/` |

In **Cloud Run → deploy from this GitHub repo**, set the build to use folder **`server/contact-form-api`** as the **source / build context** (UI labels vary). The **`Dockerfile`** lives in that folder; if the wizard asks for a path from repo root, use **`server/contact-form-api/Dockerfile`** or the equivalent “directory” field.

---

## Steps (all from dashboards)

### Step 1 — Open Google Cloud

1. In the browser go to **[https://console.cloud.google.com](https://console.cloud.google.com)**  
2. Sign in with Google.

**Done when:** You see the Cloud Console home and a project picker at the top.

---

### Step 2 — Create or select a project

1. Top bar → click the **project name** (next to “Google Cloud”).  
2. Click **New project** → enter a name → **Create**.  
3. When it finishes, open the **project picker** again and **select** that project.

**Done when:** The top bar shows **your new project** as active.

**Find your Project ID** (you will need it later):

1. Top-left **☰** (hamburger) → **IAM & Admin** → **Settings**.  
2. Copy **Project ID** (lowercase, may differ from the display name). Example shape: `my-leads-123`.

---

### Step 3 — Turn on billing (required for Cloud Run)

1. **☰** → **Billing** → **Link a billing account** (or manage billing).  
2. Follow the wizard to attach a billing account to **this project**.

**Done when:** The project shows as linked to billing (no “billing disabled” banner for paid services).

---

### Step 4 — Create Firestore

1. **☰** → **Firestore** (search if needed).  
2. **Create database**.  
3. Choose a **location/region** → pick **Datastore mode** or **Native mode** (either is fine for this API) → finish the wizard.

**Done when:** Firestore opens with no error and you can see the database home.

---

### Step 5 — Enable APIs (checklist in one place)

1. **☰** → **APIs & Services** → **Enabled APIs & services**.  
2. Click **+ Enable APIs and services** at the top.  
3. Search and open each of these, then click **Enable** if not already enabled:

   - **Cloud Run Admin API**
   - **Artifact Registry API** (often used when building from GitHub)
   - **Cloud Build API** (builds your container when you deploy from source)
   - **Secret Manager API** (optional — only if you later use secrets; safe to enable)
   - **Google Sheets API**

Return to **Enabled APIs & services** and confirm all of the above list as **Enabled**.

**Done when:** No “Enable API” blocker when you reach Cloud Run in later steps.

---

### Step 6 — Create service account (**no JSON key**)

1. **☰** → **IAM & Admin** → **Service accounts**.  
2. **Create service account**.  
3. **Service account name:** for example `contact-form-api`.  
   **Continue**.  
4. **Grant this service account access to this project:**

   - **Role** → search **Datastore** → select **Cloud Datastore User**.

5. **Continue** → **Done**.

**Done when:** The service account appears in the list.

6. Click the new account row → copy the **email** (looks like `contact-form-api@YOUR_PROJECT_ID.iam.gserviceaccount.com`).  
   Keep it in Notepad — you need it for Sheets and Cloud Run.

---

### Step 7 — Organization blocks keys (optional reminder)

If a screen ever says keys are blocked: **ignore “Create key”.** Cloud Run attaches this account **without** downloading JSON.

---

### Step 8 — Share Google Sheet with the service account

1. Open **[https://sheets.google.com](https://sheets.google.com)** → open or create your leads sheet.  
2. Click **Share**.  
3. Paste the **service account email** from Step 6.  
4. Set access to **Editor** → **Send** / **Share**.

**Done when:** That robot email appears under people with access.

(Optional row 1 header):  
`submitted_at` | `form_id` | `name` | `mobile` | `email` | `session_id`

---

### Step 9 — Copy Spreadsheet ID

With the spreadsheet open, look at the address bar:

`https://docs.google.com/spreadsheets/d/` **`THIS_LONG_ID`** `/edit`

Copy **only** **`THIS_LONG_ID`**. You will paste it as **`SHEETS_SPREADSHEET_ID`** in Cloud Run (Step 12).

---

### Step 10 — Code on GitHub

**If you use this repo already:** [https://github.com/qabot2026/testingone](https://github.com/qabot2026/testingone) — the API lives under **`server/contact-form-api/`**. Connect Cloud Run to **that** repo and folder in Step 12; no separate upload needed.

**If you use your own empty repo** (browser only): on **[https://github.com](https://github.com)** → **New repository** → **Add file** → **Upload files** → upload everything under `server\contact-form-api` from your PC (including **`Dockerfile`**, **`package.json`**, **`index.mjs`**, **`lib`**). **Commit changes**.

**Done when:** GitHub shows `Dockerfile` at **repo root** *or* under `server/contact-form-api/` — match that path in the Cloud Run source settings (Step 12).

---

### Step 11 — Connect GitHub to Google Cloud (OAuth, in browser only)

Google needs permission to read the repo Cloud Run will build from.

Typical paths (names can shift slightly):

1. **☰** → **Cloud Run**  
2. You may see **Set up Continuous Deployment** or **Connect repository** — if not, go to Step 12 and start **Create service**; the wizard often includes **GitHub** connection.

Otherwise:

1. **☰** → **Infrastructure Manager** / **Developer Connect** OR from Cloud Run wizard “Connect Repository” leads to OAuth.

Follow the prompts to **authorize Google Cloud** to **read** your GitHub account / selected repo.  
Choose **only** the repo you created in Step 10.

**Done when:** Your repo appears as a selectable **source** in the Cloud Run “Deploy from repo” wizard with no authorization error.

---

### Step 12 — Create Cloud Run service from source (dashboard)

1. **☰** → **Cloud Run**.  
2. **Create service** (or **Create service** → **Deploy from GitHub/GitLab/source repository** depending on UI).  
3. **Region:** pick one (example: **`us-central1`**). Same region is easiest for Artifact Registry consistency.

Configure **source**:

- Choose **deploy from GitHub / source repository / continuous deployment** (wording varies).  
- **Repository:** the repo from Step 10.  
- **Branch:** usually `main` or `master` (whatever you use).  

When the wizard asks **Configuration → Type**:

| Option | Use for this repo? |
|--------|---------------------|
| **Autodetected** | Risky — may look only at repo **root**. Your Dockerfile is **not** at root. Prefer **Dockerfile** below. |
| **Cloud Build configuration file** | Only if you add `cloudbuild.yaml`. Skip unless you maintain that file. |
| **Dockerfile** | **Choose this.** Then set Dockerfile path / context per the table below. |
| **Buildpacks** | Skip — unnecessary; you already ship a Dockerfile. |

**Source / Build configuration** (when type = **Dockerfile**):

  - **`Dockerfile` at repo root** → Dockerfile path **`/Dockerfile`** (or `/` as context).  

  - **This project** → context / source directory **`server/contact-form-api`**, Dockerfile **`Dockerfile`** **or** single path from repo root: **`server/contact-form-api/Dockerfile`** (labels differ by console version).

**Concrete example — this repo ([qabot2026/testingone](https://github.com/qabot2026/testingone))**

| Field | Value |
|--------|--------|
| Repository | `qabot2026/testingone` (or browse and select it after GitHub auth) |
| Branch | `main` |
| **Source folder / build context** | **`server/contact-form-api`** (folder that contains `Dockerfile`) |
| **Dockerfile path** (if separate from context) | Often **`Dockerfile`** relative to that folder, **or** from repo root: **`server/contact-form-api/Dockerfile`** |

If the build fails with “Dockerfile not found”, open **[Dockerfile on GitHub](https://github.com/qabot2026/testingone/blob/main/server/contact-form-api/Dockerfile)** and match the folder you set in the wizard.

**GCP project vs Dialogflow:** `company.config.js` may list a Dialogflow **project id** (e.g. `qabot01`). Your **Cloud Run + Firestore** project can be the same GCP project or a different one — they are only related by what *you* configure. Create Firestore and this service in whichever project you use for **storing** form rows.

4. **Service name:** `contact-form-api` (any allowed name).

5. **Authentication** (required dropdown / radio — pick one)

For the **contact form API**, visitors’ browsers must call your Cloud Run **URL** without signing in to Google. Choose **public** access:

| If the console shows… | Choose |
|------------------------|--------|
| **Allow unauthenticated invocations** | ✅ **Yes** / **Allow** (this is what you want). |
| **Allow public access** | ✅ **Yes**. |
| **Ingress: all** (with public URL) + auth “none” / open | ✅ Match your wizard’s “public HTTP” option. |

❌ **Do not** choose **Require authentication**, **IAM only**, **Authenticated users only**, or similar — that blocks anonymous `POST` from your website unless you add Cloud IAM tokens in JavaScript (you are not doing that).

**Note:** “Unauthenticated” means **anyone who has the URL can send requests** to this service. Keep the URL unlisted if you want obscurity; rate limiting is a separate topic. Firestore/Sheets writes still use the **runtime service account** configured in **item 7 (Service account)** in **this same Step 12** — that is **server-side** identity, not your website visitors.

6. **Container / Runtime / Resources:** defaults are usually enough for this small API; you can increase memory later if builds fail.

7. **Service account** (important):

   - Open the **Security** or **Container** / **Advanced** section.  
   - Set **Service account** to **`contact-form-api@YOUR_PROJECT_ID.iam.gserviceaccount.com`** (the one from Step 6).

8. **Environment variables:**

   - Add variable **`SHEETS_SPREADSHEET_ID`**  
   - Value = the **Spreadsheet ID** from Step 9.

9. **Create** / **Deploy** (primary button).

The console will queue a **Cloud Build** job and then deploy. Wait until the status is **Healthy** / **Serving** without a red error.

**Done when:** Cloud Run shows a **URL** like `https://contact-form-api-xxxxx-xx.a.run.app`

---

### Step 13 — Open the `/health` check in browser

Paste into the address bar (replace with **your** service URL):

`https://YOUR-SERVICE-URL/health`

**Done when:** The page shows the text **`ok`**.

---

### Step 14 — Fix common dashboard errors

| Symptom | What to change in dashboards |
|---------|-------------------------------|
| **Build failed** | Cloud Run → click service → **Revisions / Logs / Builds** links → open **Cloud Build** → read error. Often wrong **Dockerfile path** vs GitHub folder layout. Fix GitHub paths or rerun deploy with corrected path. |
| **403 / permission** on GitHub | Repeat Step 11 and re-authorize; ensure the selected repo matches Step 10. |
| **Firestore permission denied** in logs | IAM → grant **Cloud Datastore User** on **this project** for the Cloud Run **service account** (Step 6 account). Save → **Deploy new revision** with same container if needed so identity is applied. |
| **Sheets append failed** | Sheet **Share** (Step 8) missing or wrong email; **`SHEETS_SPREADSHEET_ID`** wrong in Cloud Run env vars.**Edit service** → Variables → correct → Deploy. |

---

### Step 15 — Point your chat widget at Cloud Run (**your site / HTML**, not GCP)

The chat iframe loads **`company-loader.js`**, which passes **`apiBase`** into **`chat-frame.html`** so **`company.js`** can `POST` to **`/contact-form-submissions`** on your API host.

Where you embed the widget (for example **`myweb.html`** in this repo), add **`apiBase`** (**HTTPS only**, **no trailing slash**):

```html
<script src="company-loader.js?botid=0001&v=70&apiBase=https://YOUR-SERVICE-URL"></script>
```

Replace **`YOUR-SERVICE-URL`** with the host from Step 12 (example: **`contact-form-api-xxxxx-uc.a.run.app`** — include `https://` inside `apiBase` as shown).

- Keep **`v=70`** in sync when you bump cache versions in **`company-loader.js`** (`IFRAME_VERSION`) and **`chat-frame.html`** asset query strings after big updates.  
- If the site is **GitHub Pages** for this same repo (**`…/testingone/`**), commit and push **`myweb.html`** after editing **`apiBase`**, then wait for Pages to rebuild.

Save and publish your site and **hard-refresh** the page (**Ctrl+F5**).

**Done when:** Chat opens; **F12** → **Network** shows a **`POST`** to `https://YOUR-SERVICE-URL/contact-form-submissions` returning **200** after submit (not blocked or mixed-content errors).

---

### Step 16 — Submit the contact form in chat

Use the bot’s contact form (**name**, **mobile**, **email**).

**Done when:** It succeeds in the UI (no red error).

---

### Step 17 — Verify Firestore and Sheet

**Firestore:**

1. **☰** → **Firestore** → open collection **`contact_submissions`** (created on first successful write).

**Spreadsheet:**

1. Open your Google Sheet → new row appended.

**Done when:** Both places show the same submission.

---

### Step 18 — Update code later (still no Terminal)

After you change code on GitHub:

1. **☰** → **Cloud Run** → click **`contact-form-api`**.  
2. **Edit & deploy new revision** (or trigger rebuild from linked repo — wording varies).

If your setup **redeploys on every Git push**, then after **Commit** on GitHub, wait for the revision to flip to **Serving**.

---

## Pushing updates from your computer (Git)

This repo’s remote is **`https://github.com/qabot2026/testingone.git`**, branch **`main`**.

After you edit files locally (Cursor, VS Code, **GitHub Desktop**, etc.):

1. **Stage** changed files (`chat-frame.html`, `company-loader.js`, `myweb.html`, `server/contact-form-api/STEP-BY-STEP.md`, …).  
2. **Commit** with a short message describing the change.  
3. **Push** to **`main`** (`origin`).

That updates GitHub for:

- Cloud Run triggers or manual “deploy from repo” (**Step 12 / Step 18**), and  
- This guide remaining accurate beside the repo it documents.

You may occasionally see Git mention **`credential-manager-core`** on Windows; if **`git push`** still reports **`main -> main`**, the push succeeded.

---

### Optional dashboards only (later tuning)

**More env vars:** Cloud Run → your service → **Edit & deploy new revision** → **Variables**.

| Variable | Meaning |
|---------|---------|
| `DISABLE_SHEETS=1` | Firestore only |
| `DISABLE_FIRESTORE=1` | Sheets only (rare) |
| `FIRESTORE_COLLECTION` | Override collection name (`contact_submissions` default) |

---

## Reminder — what stays public vs secret

Safe in **`myweb.html`:** only **`https://`…`** Cloud Run URL in **`apiBase`**.

Never put **service account JSON**, **sheet private links as secrets**, or **API keys meant for servers** inside `company.js`, `company.config.js`, or public GitHub repos.
