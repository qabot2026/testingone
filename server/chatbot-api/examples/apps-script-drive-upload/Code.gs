/**
 * Web app: POST application/json with _files[].dataBase64.
 * Creates a subfolder: {mobile}_{dd}_{mm}_{yyyy}_1,_2,… or {session}__{dd}_{mm}_{yyyy}_1 (double underscore), …_2, …
 *
 * Parent folder: Script property UPLOAD_FOLDER_ID and/or JSON _drive_folder_id (from Railway GOOGLE_DRIVE_FOLDER_ID).
 * Deploy: Execute as Me, Who has access: Anyone — new version after edits.
 * Railway forwards _submission_mobile_digits (digits-only) when it resolves the phone; folder names use it first so behavior matches the Node server even if mobile fields are oddly shaped.
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
    var dateLabel = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "dd_MM_yyyy"
    );
    var subFolderName = pickSubmissionSubfolderName_(o, childNames, dateLabel);
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

function normalizedKeyGuess_(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Matches Node contact-mobile “loose” aliases so folder naming prefers mobile when the JSON uses custom field names. */
function pickMobileLoose_(obj) {
  if (!obj || typeof obj !== "object") return "";
  var aliases = {
    mobile: true,
    phonenumber: true,
    phone: true,
    tel: true,
    whatsapp: true,
    whatsappnumber: true,
    contactnumber: true,
    contactphone: true,
    contactmobile: true,
    cellphone: true,
    cell: true,
    mobilenumber: true,
    mobilephone: true,
    usermobile: true,
    yourmobile: true,
    customermobile: true,
  };
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var nk = normalizedKeyGuess_(keys[i]);
    if (aliases[nk]) {
      var got = pick_(obj[keys[i]]);
      if (got) return got;
    }
  }
  return "";
}

function pickMobileRaw_(o) {
  var ctx = o.client_context || {};
  var m =
    pick_(o.mobile) ||
    pick_(o.phone) ||
    pick_(o.tel) ||
    pick_(o.contact_mobile) ||
    pick_(o.whatsapp) ||
    pick_(o.whatsapp_number) ||
    pick_(o.contact_phone) ||
    pick_(o.mobile_number) ||
    pick_(o.phone_number) ||
    pick_(o.cell) ||
    pick_(o.cell_phone) ||
    pickFromCtx_(ctx, "mobile") ||
    pickFromCtx_(ctx, "phone") ||
    pickFromCtx_(ctx, "tel") ||
    pickFromCtx_(ctx, "contact_mobile") ||
    pickFromCtx_(ctx, "whatsapp") ||
    pickMobileLoose_(o) ||
    pickMobileLoose_(ctx);
  return m;
}

function pickFromCtx_(ctx, key) {
  if (!ctx || typeof ctx !== "object") return "";
  return pick_(ctx[key]);
}

/** Looks for a 9–15 digit run anywhere under the payload (nested client_context, wa_id, etc.). Skips _* keys and _files. */
function bestDigitRunFromStringScan_(s) {
  var str = String(s || "");
  var runs = str.match(/\d+/g);
  if (!runs) return "";
  var best = "";
  for (var i = 0; i < runs.length; i++) {
    var run = runs[i];
    if (run.length >= 9 && run.length <= 15 && run.length > best.length) best = run;
  }
  return best;
}

function longestDigitRunDeepScan_(val, depth) {
  if (depth > 12 || val == null) return "";
  var t = typeof val;
  if (t === "string") return bestDigitRunFromStringScan_(val);
  if (t === "number" && isFinite(val)) return bestDigitRunFromStringScan_(String(val));
  if (Object.prototype.toString.call(val) === "[object Array]") {
    var arr = /** @type {Array<?>} */ (val);
    var bestA = "";
    for (var ai = 0; ai < arr.length; ai++) {
      var ra = longestDigitRunDeepScan_(arr[ai], depth + 1);
      if (ra.length > bestA.length) bestA = ra;
    }
    return bestA;
  }
  if (t === "object") {
    var bestO = "";
    var keys = Object.keys(val);
    for (var ki = 0; ki < keys.length; ki++) {
      var key = keys[ki];
      if (key === "_files" || key.indexOf("_") === 0) continue;
      var ro = longestDigitRunDeepScan_(val[key], depth + 1);
      if (ro.length > bestO.length) bestO = ro;
    }
    return bestO;
  }
  return "";
}

function pickSubmissionSubfolderName_(o, folderNames, dateLabel) {
  // Server (Railway) sets this when it resolved the phone — avoids relying on o.mobile after JSON merges.
  var fromServer = normalizeDigits_(pick_(o._submission_mobile_digits));
  var digits =
    fromServer ||
    normalizeDigits_(pickMobileRaw_(o)) ||
    longestDigitRunDeepScan_(o, 0);
  if (digits) {
    return nextMobileFolderName_(digits, folderNames, dateLabel);
  }
  var ctx = o.client_context || {};
  var sid = sanitizeSession_(pick_(ctx.client_session_id));
  if (sid) {
    return nextSessionFolderName_(sid, folderNames, dateLabel);
  }
  return nextUnknownFolderName_(folderNames, dateLabel);
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

/** e.g. 9900990099_06_05_2026_1 then …_2 same day */
function nextMobileFolderName_(digits, folderNames, dateLabel) {
  var ranks = {};
  var re = new RegExp(
    "^" + escapeRe_(digits) + "_" + escapeRe_(dateLabel) + "_(\\d+)$"
  );
  for (var i = 0; i < folderNames.length; i++) {
    var m = folderNames[i].match(re);
    if (m) addRanks_(ranks, parseInt(m[1], 10));
  }
  var nextRank = Object.keys(ranks).length ? maxRankFromRanks_(ranks) + 1 : 1;
  return digits + "_" + dateLabel + "_" + nextRank;
}

function sanitizeSession_(raw) {
  var s = String(raw || "").trim();
  if (!s) return "";
  var cleaned = s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return cleaned || "";
}

function nextSessionFolderName_(base, folderNames, dateLabel) {
  if (!base) return nextUnknownFolderName_(folderNames, dateLabel);
  var ranks = {};
  var esc = escapeRe_(base);
  var escD = escapeRe_(dateLabel);
  var reNew = new RegExp("^" + esc + "__" + escD + "_(\\d+)$");
  var reLegacy = new RegExp("^" + esc + "_" + escD + "_(\\d+)$");
  for (var i = 0; i < folderNames.length; i++) {
    var n = folderNames[i];
    var m = n.match(reNew) || n.match(reLegacy);
    if (m) addRanks_(ranks, parseInt(m[1], 10));
  }
  var nextRank = Object.keys(ranks).length ? maxRankFromRanks_(ranks) + 1 : 1;
  return base + "__" + dateLabel + "_" + nextRank;
}

function nextUnknownFolderName_(folderNames, dateLabel) {
  var base = "unknown";
  var ranks = {};
  var reDated = new RegExp(
    "^" + escapeRe_(base) + "_" + escapeRe_(dateLabel) + "_(\\d+)$",
    "i"
  );
  for (var i = 0; i < folderNames.length; i++) {
    var m = folderNames[i].match(reDated);
    if (m) addRanks_(ranks, parseInt(m[1], 10));
  }
  var nextRank = Object.keys(ranks).length ? maxRankFromRanks_(ranks) + 1 : 1;
  return base + "_" + dateLabel + "_" + nextRank;
}

function doGet() {
  return ContentService.createTextOutput("POST JSON uploads (subfolders by mobile or session id + date).").setMimeType(
    ContentService.MimeType.TEXT
  );
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function pick_(x) {
  return x !== undefined && x !== null && String(x).trim() !== "" ? String(x).trim() : "";
}
