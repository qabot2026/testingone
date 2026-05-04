/**
 * Forwards submissions to a deployed Apps Script Web App.
 *
 * Default: **application/json** with Base64 file parts (`_files[]`). Apps Script `doPost` often does **not**
 * reliably handle external `multipart/form-data`, so the server used to return 200 while nothing was saved.
 *
 * Legacy: set `GOOGLE_APPS_SCRIPT_USE_MULTIPART=1` to send multipart (only if your script parses it).
 */

/**
 * @param {string} webAppUrl e.g. https://script.google.com/macros/s/DEPLOYMENT_ID/exec
 * @param {{ files: Array<import('multer').File & { buffer: Buffer }>, fields: Record<string, string>, clientContext: object, formId: string, mobile?: string }} payload
 */
export async function forwardSubmissionToAppsScript(webAppUrl, payload) {
    const { files = [], fields = {}, clientContext = {}, formId = "unknown", mobile = "" } = payload;
    const fileParts = (Array.isArray(files) ? files : []).filter(
        (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
    );
    if (fileParts.length === 0) {
        throw new Error(
            "No file bytes for Apps Script (empty buffers). Confirm the browser sent multipart/form-data files."
        );
    }

    let execUrl = (webAppUrl || "").trim().replace(/\s+/g, "");
    while (execUrl.endsWith("/")) {
        execUrl = execUrl.slice(0, -1);
    }

    const useMultipart = process.env.GOOGLE_APPS_SCRIPT_USE_MULTIPART === "1";

    let res;
    if (useMultipart) {
        const fd = new FormData();
        for (const [k, val] of Object.entries(fields)) {
            fd.append(k, typeof val === "string" ? val : String(val ?? ""));
        }
        fd.append("_contactFormId", String(formId));
        fd.append("client_context", JSON.stringify(clientContext));

        for (const f of fileParts) {
            const mime = typeof f.mimetype === "string" && f.mimetype ? f.mimetype : "application/octet-stream";
            const blob = new Blob([f.buffer], { type: mime });
            const orig =
                typeof f.originalname === "string" && f.originalname.trim() ? f.originalname.trim() : "file";
            const field = typeof f.fieldname === "string" && f.fieldname.trim() ? f.fieldname : "file";
            fd.append(field, blob, orig);
        }
        res = await fetch(execUrl, { method: "POST", body: fd, redirect: "follow" });
    } else {
        const folderId = (
            process.env.APPS_SCRIPT_TARGET_FOLDER_ID ||
            process.env.GOOGLE_DRIVE_FOLDER_ID ||
            ""
        ).trim();
        const resolvedMobile =
            typeof mobile === "string" && mobile.trim() ? mobile.trim() : fields.mobile || "";
        /** @type {Record<string, unknown>} */
        const body = {
            ...fields,
            mobile: resolvedMobile,
            _contactFormId: String(formId),
            client_context: clientContext,
            _files: fileParts.map((f) => ({
                field: typeof f.fieldname === "string" && f.fieldname.trim() ? f.fieldname : "file",
                name:
                    typeof f.originalname === "string" && f.originalname.trim()
                        ? f.originalname.trim()
                        : "upload.bin",
                mime: typeof f.mimetype === "string" && f.mimetype ? f.mimetype : "application/octet-stream",
                dataBase64: f.buffer.toString("base64")
            }))
        };
        if (folderId) {
            body._drive_folder_id = folderId;
        }
        res = await fetch(execUrl, {
            method: "POST",
            redirect: "follow",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(body)
        });
    }

    const status = res.status;
    const text = await res.text();

    /** @type { Record<string, unknown> | null} */
    let json = null;
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
            json = JSON.parse(text);
        } catch {
            /* leave null */
        }
    }

    if (!useMultipart && status < 400 && json === null) {
        throw new Error(
            "Apps Script must return JSON such as {\"ok\":true,\"uploads\":[…]}. " +
                "Paste the sample doPost from server/contact-form-api/examples/apps-script-drive-upload/Code.gs. " +
                `Response preview: ${text.slice(0, 180).replace(/\s+/g, " ")}`
        );
    }

    if (status >= 400) {
        const hint403 =
            "\n\nMost common fix for 401/403 with HTML Google pages: Deploy again as a **Web app** with " +
            '"Who has access" set to **Anyone** (anonymous). Railway has no Google login — "Anyone with Google ' +
            'account" usually fails.\nAlso use the Published **…/macros/s/…/exec** URL from the deployment ' +
            "dialog — not `/dev`. Copy a **New deployment** URL if you redeployed the script.";
        const looksLikeGoogleHtml =
            /<!DOCTYPE html>/i.test(text) || /<title>/i.test(text) || /Page Not Found/i.test(text);
        const tail =
            looksLikeGoogleHtml && (status === 401 || status === 403 || status === 404)
                ? `${hint403}\n\nSnippet:\n${text.slice(0, 400)}`
                : `\n${text.slice(0, 400)}`;
        throw new Error(`Apps Script web app HTTP ${status}.${tail}`);
    }
    if (json && typeof json === "object" && json.ok === false) {
        const err = typeof json.error === "string" ? json.error : JSON.stringify(json.error ?? json);
        throw new Error(`Apps Script: ${err}`);
    }

    if (
        !useMultipart &&
        status < 400 &&
        json &&
        typeof json === "object" &&
        json.ok === true &&
        fileParts.length > 0 &&
        (!Array.isArray(json.uploads) || json.uploads.length === 0)
    ) {
        throw new Error(
            "Apps Script returned ok:true but no file entries in uploads[]. " +
                "Use the sample Code.gs (createFile + push drive_file_id/web_view_link)."
        );
    }

    const uploads =
        json && typeof json === "object" && Array.isArray(json.uploads)
            ? normalizeUploadEntries(json.uploads)
            : [];

    return { uploads, status, rawSnippet: text.slice(0, 2000), json };
}

/**
 * Align with drive_upload shapes used by Firestore / Sheet column J.
 * @param {Array<unknown>} arr
 */
function normalizeUploadEntries(arr) {
    return arr.map((u, i) => {
        const o =
            typeof u === "object" && u !== null
                ? /** @type {Record<string, unknown>} */ (u)
                : {};
        const driveId = pickStr(o.drive_file_id, o.fileId, o.id);
        const link = pickStr(o.web_view_link, o.link, o.url);
        const name = pickStr(o.original_name, o.name, "");
        const view =
            link ||
            (driveId ? `https://drive.google.com/file/d/${driveId}/view` : "");

        return {
            field: pickStr(o.field, ""),
            original_name: name || `file_${i + 1}`,
            content_type: pickStr(o.content_type, ""),
            upload_backend: "google_apps_script",
            drive_file_id: driveId || "",
            web_view_link: view,
            ...(pickStr(o.drive_subfolder_id, "") ? { drive_subfolder_id: pickStr(o.drive_subfolder_id, "") } : {})
        };
    });
}

function pickStr(...cands) {
    for (const c of cands) {
        if (typeof c === "string" && c.trim()) {
            return c.trim();
        }
    }
    return "";
}
