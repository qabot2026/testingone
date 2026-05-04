/**
 * Paste into your Apps Script project. Deploy → Web app (Execute as: Me, Who has access: Anyone).
 *
 * The Node server POSTs Content-Type: application/json with Base64 files in _files (see apps-script-upload.mjs).
 * Set either:
 *   • Script properties UPLOAD_FOLDER_ID = Drive folder ID, or
 *   • Railway also sets GOOGLE_DRIVE_FOLDER_ID → sent as _drive_folder_id on each request.
 */

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, error: "Empty body" });
    }
    var ctype = String(e.postData.type || "").toLowerCase();
    if (ctype.indexOf("application/json") === -1) {
      return jsonOut({
        ok: false,
        error:
          "Expected Content-Type application/json with _files[].dataBase64. " +
            "Upgrade contact-form-api (it defaults to JSON; do not set GOOGLE_APPS_SCRIPT_USE_MULTIPART unless you implemented multipart)."
      });
    }

    /** @type {Object} */
    var o = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var folderId = pick_(o._drive_folder_id) || pick_(props.getProperty("UPLOAD_FOLDER_ID"));
    var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();

    var list = o._files;
    if (!list || list.length === 0) {
      return jsonOut({ ok: false, error: "No _files in JSON body" });
    }

    var uploads = [];
    for (var i = 0; i < list.length; i++) {
      var u = list[i];
      var b64 = u.dataBase64;
      if (!b64) {
        return jsonOut({ ok: false, error: "Missing dataBase64 on file index " + i });
      }
      var name = pick_(u.name) || "upload_" + (i + 1);
      var mime = pick_(u.mime) || "application/octet-stream";
      var bytes = Utilities.base64Decode(b64);
      var blob = Utilities.newBlob(bytes, mime, name);
      var file = folder.createFile(blob);
      uploads.push({
        original_name: name,
        drive_file_id: file.getId(),
        web_view_link: file.getUrl(),
        content_type: mime
      });
    }

    return jsonOut({ ok: true, uploads: uploads });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err.message || err) });
  }
}

function doGet() {
  return ContentService.createTextOutput("POST JSON uploads to this URL (web app).").setMimeType(
    ContentService.MimeType.TEXT
  );
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function pick_(x) {
  return x !== undefined && x !== null && String(x).trim() !== "" ? String(x).trim() : "";
}
