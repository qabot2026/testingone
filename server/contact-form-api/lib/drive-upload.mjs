/**
 * Upload multipart buffers into a per-submission subfolder under GOOGLE_DRIVE_FOLDER_ID.
 * Naming:
 *   - Mobile present (digits only): first submission `9960343434`, then `9960343434_2`, `_3`, …
 *   - No mobile: `unknown1`, `unknown2`, …
 * Share the parent folder with the service account `client_email` (Editor).
 */

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { getServiceAccountCredentials } from "./google-service-account.mjs";

const FOLDER_ID = (process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim();
const SHARED_DRIVE = process.env.GOOGLE_DRIVE_USE_SHARED_DRIVE === "1";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

async function getDriveClient() {
    const cred = getServiceAccountCredentials();
    if (!cred) {
        throw new Error(
            "No Google service account JSON for Drive. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON (same as Sheets)."
        );
    }
    const auth = new google.auth.GoogleAuth({
        credentials: cred,
        scopes: DRIVE_SCOPES
    });
    return google.drive({ version: "v3", auth: await auth.getClient() });
}

/**
 * @param {Array<import("multer").File & { buffer: Buffer }>} files
 * @param {{ mobile: string }} opts
 * @returns {Promise<{ uploads: Array<Record<string, unknown>>; drive_subfolder_id: string; drive_subfolder_name: string }>}
 */
export async function uploadSubmissionFilesToDrive(files, { mobile }) {
    if (!Array.isArray(files) || files.length === 0) {
        return {
            uploads: [],
            drive_subfolder_id: "",
            drive_subfolder_name: ""
        };
    }
    if (!FOLDER_ID) {
        throw new Error(
            "Set GOOGLE_DRIVE_FOLDER_ID to your target folder id (from the Drive URL). Share that folder with the service account email as Editor."
        );
    }

    const drive = await getDriveClient();
    const childFolders = await listChildFolders(drive, FOLDER_ID);
    const folderNames = childFolders.map((f) => (f.name ? String(f.name) : "")).filter(Boolean);

    const digits = normalizeMobileDigits(mobile);
    const newFolderName = digits
        ? nextMobileSubmissionFolderName(digits, folderNames)
        : nextUnknownFolderName(folderNames);

    const subfolder = await drive.files.create({
        requestBody: {
            name: newFolderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [FOLDER_ID]
        },
        fields: "id, name",
        supportsAllDrives: SHARED_DRIVE
    });

    const parentId = subfolder.data.id || "";
    const parentName = typeof subfolder.data.name === "string" ? subfolder.data.name : newFolderName;

    if (!parentId) {
        throw new Error("Drive: could not create subfolder.");
    }

    /** @type {Array<Record<string, unknown>>} */
    const out = [];
    for (const f of files) {
        if (!f || !f.buffer) {
            continue;
        }
        const orig = typeof f.originalname === "string" ? f.originalname : "file";
        const safeName = sanitizeFilename(orig);
        const uploadName = `${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`;
        const mime = typeof f.mimetype === "string" && f.mimetype
            ? f.mimetype
            : "application/octet-stream";

        const created = await drive.files.create({
            requestBody: {
                name: uploadName,
                parents: [parentId]
            },
            media: {
                mimeType: mime,
                body: Readable.from(f.buffer)
            },
            fields: "id, name, mimeType, size, webViewLink, webContentLink",
            supportsAllDrives: SHARED_DRIVE
        });

        const data = created.data;
        const id = data.id || "";
        const view =
            (typeof data.webViewLink === "string" && data.webViewLink)
                ? data.webViewLink
                : (id ? `https://drive.google.com/file/d/${id}/view` : "");

        out.push({
            field: f.fieldname,
            original_name: orig,
            content_type: data.mimeType || mime,
            size_bytes: typeof f.size === "number" ? f.size : f.buffer.length,
            drive_file_id: id,
            drive_file_name: typeof data.name === "string" ? data.name : uploadName,
            web_view_link: view,
            web_content_link: typeof data.webContentLink === "string" ? data.webContentLink : "",
            drive_subfolder_name: parentName,
            drive_subfolder_id: parentId
        });
    }

    return {
        uploads: out,
        drive_subfolder_id: parentId,
        drive_subfolder_name: parentName
    };
}

async function listChildFolders(drive, parentId) {
    const q = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await drive.files.list({
        q,
        fields: "files(id, name)",
        pageSize: 1000,
        supportsAllDrives: SHARED_DRIVE,
        includeItemsFromAllDrives: SHARED_DRIVE
    });
    return Array.isArray(res.data.files) ? res.data.files : [];
}

function normalizeMobileDigits(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    return d.length ? d : "";
}

/**
 * First submission for this number → folder `9960343434`. Later → `9960343434_2`, `_3`, …
 */
function nextMobileSubmissionFolderName(digits, folderNames) {
    const ranks = new Set();
    if (folderNames.includes(digits)) {
        ranks.add(1);
    }
    const re = new RegExp(`^${escapeRegExp(digits)}_(\\d+)$`);
    for (const n of folderNames) {
        const m = n.match(re);
        if (m) {
            const r = parseInt(m[1], 10);
            if (!Number.isNaN(r)) {
                ranks.add(r);
            }
        }
    }
    if (ranks.size === 0) {
        return digits;
    }
    const nextRank = Math.max(...ranks) + 1;
    return `${digits}_${nextRank}`;
}

/**
 * Sequential unknown1, unknown2, …
 */
function nextUnknownFolderName(folderNames) {
    const nums = [];
    const re = /^unknown(\d+)$/i;
    for (const n of folderNames) {
        const m = n.match(re);
        if (m) {
            const v = parseInt(m[1], 10);
            if (!Number.isNaN(v)) {
                nums.push(v);
            }
        }
    }
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `unknown${next}`;
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFilename(name) {
    const base = name.replace(/[/\\]/g, "_").replace(/\0/g, "");
    return base.slice(0, 200) || "file";
}
