1. Open script.google.com → your project → paste Code.gs (replace old doPost if needed).
2. Project Settings → Script properties → add UPLOAD_FOLDER_ID = folder id from drive.google.com URL
   OR set GOOGLE_DRIVE_FOLDER_ID on Railway (sent as _drive_folder_id).
3. Deploy → New deployment → Web app → Anyone → copy /exec URL to Railway GOOGLE_APPS_SCRIPT_WEBAPP_URL.
4. After every script change: Deploy → Manage deployments → Edit → New version → Deploy.

The API sends JSON like { name, email, ..., _files: [{ name, mime, field, dataBase64 }] }.
