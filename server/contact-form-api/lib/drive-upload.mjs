/**
 * Upload multipart buffers into a per-submission subfolder under GOOGLE_DRIVE_FOLDER_ID.
 *
 * **Service account:** parent folder must be on a **Workspace Shared drive** (Team Drive).
 * **OAuth user:** use GOOGLE_DRIVE_OAUTH_* env; folder can be in that user’s My Drive or Shared drives.
 */

import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { getDriveClient, isDriveAuthOAuthUser } from "./drive-auth.mjs";
import { nextSubmissionFolderName, sanitizeFilename } from "./submission-folder-name.mjs";

const FOLDER_ID = (process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim();

const DRIVE_CREATE = { supportsAllDrives: true };
const DRIVE_LIST = { supportsAllDrives: true, includeItemsFromAllDrives: true };

/** Service accounts have no My Drive quota; uploads only work under a Shared drive (driveId set). */
async function assertFolderIsOnSharedDrive(drive, folderId) {
    let res;
    try {
        res = await drive.files.get({
            fileId: folderId,
            fields: "id, name, mimeType, driveId",
            supportsAllDrives: true
        });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        throw new Error(
            `Could not read GOOGLE_DRIVE_FOLDER_ID (${folderId}). Check the id, Drive API access, and that the service account can see the folder. ${msg}`
        );
    }
    const data = res && res.data ? res.data : {};
    if (data.mimeType && data.mimeType !== "application/vnd.google-apps.folder") {
        throw new Error(
            "GOOGLE_DRIVE_FOLDER_ID must be a folder, not a file. Create a folder on a Shared drive and use its id from the URL."
        );
    }
    if (!data.driveId) {
        throw new Error(
            [
                "This folder is in personal My Drive. Google does not give service accounts storage there,",
                "even if the folder is shared with the service account email.",
                "Fix: In Google Workspace, open Drive → Shared drives → create or pick a Shared drive →",
                "add your service account (Manage members) as Content manager → create a folder inside →",
                "set GOOGLE_DRIVE_FOLDER_ID to that folder’s id (from the URL).",
                "Shared drives require Google Workspace; consumer Gmail alone cannot create them."
            ].join(" ")
        );
    }
}

/**
 * @param {Array<import("multer").File & { buffer: Buffer }>} files
 * @param {{ mobile: string, clientSessionId?: string }} opts
 * @returns {Promise<{ uploads: Array<Record<string, unknown>>; drive_subfolder_id: string; drive_subfolder_name: string }>}
 */
export async function uploadSubmissionFilesToDrive(files, { mobile, clientSessionId = "" }) {
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
            "Set GOOGLE_DRIVE_FOLDER_ID to the target folder id (from the Drive URL)."
        );
    }

    const drive = await getDriveClient();
    if (!isDriveAuthOAuthUser()) {
        await assertFolderIsOnSharedDrive(drive, FOLDER_ID);
    }
    const childFolders = await listChildFolders(drive, FOLDER_ID);
    const folderNames = childFolders.map((f) => (f.name ? String(f.name) : "")).filter(Boolean);

    const newFolderName = nextSubmissionFolderName({
        mobile,
        clientSessionId,
        folderNames
    });

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
