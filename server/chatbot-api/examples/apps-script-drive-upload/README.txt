1. Open script.google.com → your project → paste Code.gs (replace old doPost if needed).
2. Project Settings → Script properties → add UPLOAD_FOLDER_ID = folder id from drive.google.com URL
   OR set GOOGLE_DRIVE_FOLDER_ID on Railway (sent as _drive_folder_id).
3. Deploy → New deployment → Web app → Anyone → copy /exec URL to Railway GOOGLE_APPS_SCRIPT_WEBAPP_URL.
4. After every script change: Deploy → Manage deployments → Edit → New version → Deploy.

The API sends JSON like { mobile, client_context, ..., _files: [{ name, mime, dataBase64 }] }.
Subfolders: {mobile}_{dd}_{mm}_{yyyy}_1, … same mobile+day increments _2,_3,…; without mobile uses {session}_{date}_n; else unknown_{date}_n. Matches submission-folder-name.mjs (script uses the project’s timezone).

