1. Open script.google.com → your project → paste Code.gs (replace old doPost if needed).
2. Project Settings → Script properties → add UPLOAD_FOLDER_ID = folder id from drive.google.com URL
   OR set GOOGLE_DRIVE_FOLDER_ID on Railway (sent as _drive_folder_id).
3. Deploy → New deployment → Web app → Anyone → copy /exec URL to Railway GOOGLE_APPS_SCRIPT_WEBAPP_URL.
4. After every script change: Deploy → Manage deployments → Edit → New version → Deploy.

The API sends JSON like { mobile, client_context, ..., _files: [{ name, mime, dataBase64 }] }.
Subfolders: {mobile}_1, {mobile}_2, … or {sanitized_session_id}_1,_2 … or unknown_1,… — same rules as submission-folder-name.mjs.

