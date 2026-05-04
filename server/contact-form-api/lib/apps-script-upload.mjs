/**
 * Forwards multipart form data (fields + files) to a deployed Apps Script Web App URL.
 * The script runs as the owner, so uploads land in their Google Drive without OAuth in Node.
 */

/**
 * @param {string} webAppUrl e.g. https://script.google.com/macros/s/DEPLOYMENT_ID/exec
 * @param {{ files: Array<import('multer').File & { buffer: Buffer }>, fields: Record<string, string>, clientContext: object, formId: string }} payload
 */
export async function forwardSubmissionToAppsScript(webAppUrl, payload) {
    const { files = [], fields = {}, clientContext = {}, formId = "unknown" } = payload;
    const fileParts = (Array.isArray(files) ? files : []).filter(
        (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
    );
    if (fileParts.length === 0) {
        throw new Error(
            "No file bytes for Apps Script (empty buffers). Confirm the browser sent multipart/form-data files."
        );
    }

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

    const res = await fetch(webAppUrl, {
        method: "POST",
        body: fd,
        redirect: "follow"
    });
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

    if (status >= 400) {
        throw new Error(
            `Apps Script web app responded with HTTP ${status}. First 400 chars:\n${text.slice(0, 400)}`
        );
    }
    if (json && typeof json === "object" && json.ok === false) {
        const err = typeof json.error === "string" ? json.error : JSON.stringify(json.error ?? json);
        throw new Error(`Apps Script: ${err}`);
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
