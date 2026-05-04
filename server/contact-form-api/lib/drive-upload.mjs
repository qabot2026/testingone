/**
 * Upload multipart buffers into a per-submission subfolder under GOOGLE_DRIVE_FOLDER_ID.
 *
 * **Drive only works reliably with a folder on a Google Shared drive (Team Drive).**
 * Personal “My Drive” shared folders → “Service Accounts do not have storage quota”.
 *
 * Prefer **`FILE_UPLOAD_BACKEND=firebase`** (default) if you do not use Workspace Shared drives.
 */

import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { google } from "googleapis";
import { getServiceAccountCredentials } from "./google-service-account.mjs";
import {
    normalizeMobileDigits,
    nextMobileSubmissionFolderName,
    nextUnknownFolderName,
    sanitizeFilename
} from "./submission-folder-name.mjs";

const FOLDER_ID = (process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim();

const DRIVE_CREATE = { supportsAllDrives: true };
const DRIVE_LIST = { supportsAllDrives: true, includeItemsFromAllDrives: true };

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
    const fileParts = files.filter(
        (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
    );
    if (fileParts.length === 0) {
        throw new Error(
            "No file bytes received (0-byte or missing buffers). The browser may not have sent file data; check form multipart or server body limits."
        );
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
        ...DRIVE_CREATE
    });

    const parentId = subfolder.data.id || "";
    const parentName = typeof subfolder.data.name === "string" ? subfolder.data.name : newFolderName;

    if (!parentId) {
        throw new Error("Drive: could not create subfolder.");
    }

    /** @type {Array<Record<string, unknown>>} */
    const out = [];
    try {
        for (const f of fileParts) {
            const orig = typeof f.originalname === "string" ? f.originalname : "file";
            const safeName = sanitizeFilename(orig);
            const uploadName = `${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`;
            const mime = typeof f.mimetype === "string" && f.mimetype
                ? f.mimetype
                : "application/octet-stream";

            const mediaStream = new PassThrough();
            mediaStream.end(f.buffer);

            const created = await drive.files.create({
                requestBody: {
                    name: uploadName,
                    parents: [parentId]
                },
                media: {
                    mimeType: mime,
                    body: mediaStream
                },
                fields: "id, name, mimeType, size, webViewLink, webContentLink",
                ...DRIVE_CREATE
            });

            const data = created.data;
            const id = data.id || "";
            if (!id) {
                throw new Error("Drive returned no file id after upload.");
            }
            const view =
                (typeof data.webViewLink === "string" && data.webViewLink)
                    ? data.webViewLink
                    : `https://drive.google.com/file/d/${id}/view`;

            out.push({
                field: f.fieldname,
                original_name: orig,
                content_type: data.mimeType || mime,
                size_bytes: f.buffer.length,
                drive_file_id: id,
                drive_file_name: typeof data.name === "string" ? data.name : uploadName,
                web_view_link: view,
                web_content_link: typeof data.webContentLink === "string" ? data.webContentLink : "",
                drive_subfolder_name: parentName,
                drive_subfolder_id: parentId,
                upload_backend: "google_drive"
            });
        }
    } catch (err) {
        try {
            await drive.files.delete({ fileId: parentId, ...DRIVE_CREATE });
        } catch {
            /* best-effort cleanup */
        }
        throw err;
    }

    if (out.length !== fileParts.length) {
        throw new Error("Drive: not every file was stored successfully.");
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
        ...DRIVE_LIST
    });
    return Array.isArray(res.data.files) ? res.data.files : [];
}
