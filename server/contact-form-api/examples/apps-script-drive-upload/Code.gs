/**
 * Web app: POST application/json with _files[].dataBase64.
 * Creates a subfolder under the parent: {mobile}_1,_2,… or {client_session_id}_1,_2,… or unknown_1,…
 *
 * Parent folder: Script property UPLOAD_FOLDER_ID and/or JSON _drive_folder_id (from Railway GOOGLE_DRIVE_FOLDER_ID).
 * Deploy: Execute as Me, Who has access: Anyone — new version after edits.
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
        error: "Expected Content-Type application/json with _files[].dataBase64.",
      });
    }

    /** @type {Object} */
    var o = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var folderId = pick_(o._drive_folder_id) || pick_(props.getProperty("UPLOAD_FOLDER_ID"));
    var parentFolder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();

    var list = o._files;
    if (!list || list.length === 0) {
      return jsonOut({ ok: false, error: "No _files in JSON body" });
    }

    var childNames = listChildFolderNames_(parentFolder);
    var subFolderName = pickSubmissionSubfolderName_(o, childNames);
    var subFolder = getOrCreateChildFolder_(parentFolder, subFolderName);

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
      var file = subFolder.createFile(blob);
      uploads.push({
        original_name: name,
        drive_file_id: file.getId(),
        web_view_link: file.getUrl(),
        content_type: mime,
      });
    }

    return jsonOut({
      ok: true,
      uploads: uploads,
      drive_subfolder_id: subFolder.getId(),
      drive_subfolder_name: subFolder.getName(),
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err.message || err) });
  }
}

function pickSubmissionSubfolderName_(o, folderNames) {
  var digits = normalizeDigits_(o.mobile);
  if (digits) {
    return nextMobileFolderName_(digits, folderNames);
  }
  var ctx = o.client_context || {};
  var sid = sanitizeSession_(pick_(ctx.client_session_id));
  if (sid) {
    return nextSessionFolderName_(sid, folderNames);
  }
  return nextUnknownFolderName_(folderNames);
}

function listChildFolderNames_(parent) {
  var names = [];
  var it = parent.getFolders();
  while (it.hasNext()) {
    names.push(it.next().getName());
  }
  return names;
}

function getOrCreateChildFolder_(parent, name) {
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName() === name) return f;
  }
  return parent.createFolder(name);
}

function normalizeDigits_(s) {
  return String(s || "").replace(/\D/g, "") || "";
}

function escapeRe_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addRanks_(ranks, key) {
  ranks[String(key)] = true;
}

function maxRankFromRanks_(ranks) {
  var ks = Object.keys(ranks);
  var maxR = 0;
  for (var j = 0; j < ks.length; j++) {
    var n = parseInt(ks[j], 10);
    if (!isNaN(n) && n > maxR) maxR = n;
  }
  return maxR;
}

/** First 9900990099_1, then 9900990099_2; legacy folder "9900990099" counts as #1 */
function nextMobileFolderName_(digits, folderNames) {
  var ranks = {};
  if (folderNames.indexOf(digits) !== -1) addRanks_(ranks, 1);
  var re = new RegExp("^" + escapeRe_(digits) + "_(\\d+)$");
  for (var i = 0; i < folderNames.length; i++) {
    var m = folderNames[i].match(re);
    if (m) addRanks_(ranks, parseInt(m[1], 10));
  }
  var nextRank = Object.keys(ranks).length ? maxRankFromRanks_(ranks) + 1 : 1;
  return digits + "_" + nextRank;
}

function sanitizeSession_(raw) {
  var s = String(raw || "").trim();
  if (!s) return "";
  var cleaned = s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return cleaned || "";
}

function nextSessionFolderName_(base, folderNames) {
  if (!base) return nextUnknownFolderName_(folderNames);
  var ranks = {};
  if (folderNames.indexOf(base) !== -1) addRanks_(ranks, 1);
  var re = new RegExp("^" + escapeRe_(base) + "_(\\d+)$");
  for (var i = 0; i < folderNames.length; i++) {
    var m = folderNames[i].match(re);
    if (m) addRanks_(ranks, parseInt(m[1], 10));
  }
  var nextRank = Object.keys(ranks).length ? maxRankFromRanks_(ranks) + 1 : 1;
  return base + "_" + nextRank;
}

function nextUnknownFolderName_(folderNames) {
  var base = "unknown";
  var ranks = {};
  var reUnd = /^unknown_(\d+)$/i;
  var reLeg = /^unknown(\d+)$/i;
  for (var i = 0; i < folderNames.length; i++) {
    var n = folderNames[i];
    var m = n.match(reUnd);
    if (m) {
      addRanks_(ranks, parseInt(m[1], 10));
      continue;
    }
    m = n.match(reLeg);
    if (m) addRanks_(ranks, parseInt(m[1], 10));
  }
  var nextRank = Object.keys(ranks).length ? maxRankFromRanks_(ranks) + 1 : 1;
  return base + "_" + nextRank;
}

function doGet() {
  return ContentService.createTextOutput("POST JSON uploads (subfolders by mobile or session id).").setMimeType(
    ContentService.MimeType.TEXT
  );
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function pick_(x) {
  return x !== undefined && x !== null && String(x).trim() !== "" ? String(x).trim() : "";
}
