/**
 * Upload files to Firebase / Google Cloud Storage (default bucket).
 * Works with the Firebase Admin service account — no Google Drive “My Drive” quota issues.
 *
 * Firebase Console → Storage → enable; rules must allow the admin SDK (server bypasses client rules with service account).
 */

import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import {
    normalizeMobileDigits,
    nextMobileSubmissionFolderName,
    nextUnknownFolderName,
    sanitizeFilename
} from "./submission-folder-name.mjs";

const PREFIX = "contact-submissions";

/**
 * @param {Array<import("multer").File & { buffer: Buffer }>} files
 * @param {{ mobile: string }} opts
 * @returns {Promise<{ uploads: Array<Record<string, unknown>>; storage_subfolder_name: string }>}
 */
export async function uploadSubmissionFilesToFirebaseStorage(files, { mobile }) {
    if (!Array.isArray(files) || files.length === 0) {
        return { uploads: [], storage_subfolder_name: "" };
    }

    const fileParts = files.filter(
        (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
    );
    if (fileParts.length === 0) {
        throw new Error(
            "No file bytes received (0-byte or missing buffers). The browser may not have sent file data; check form multipart or server body limits."
        );
    }

    const bucket = getStorage().bucket();
    const folderNames = await listExistingFolderKeys(bucket);

    const digits = normalizeMobileDigits(mobile);
    const folderKey = digits
        ? nextMobileSubmissionFolderName(digits, folderNames)
        : nextUnknownFolderName(folderNames);

    /** @type {Array<Record<string, unknown>>} */
    const out = [];

    for (const f of fileParts) {
        const orig = typeof f.originalname === "string" ? f.originalname : "file";
        const safeName = sanitizeFilename(orig);
        const objectPath = `${PREFIX}/${folderKey}/${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`;
        const mime = typeof f.mimetype === "string" && f.mimetype
            ? f.mimetype
            : "application/octet-stream";

        const ref = bucket.file(objectPath);
        await ref.save(f.buffer, {
            resumable: false,
            contentType: mime,
            metadata: { cacheControl: "private, max-age=0" }
        });

        const gsUri = `gs://${bucket.name}/${objectPath}`;
        out.push({
            field: f.fieldname,
            original_name: orig,
            content_type: mime,
            size_bytes: f.buffer.length,
            bucket: bucket.name,
            storage_path: objectPath,
            gs_uri: gsUri,
            upload_backend: "firebase_storage",
            storage_subfolder: folderKey
        });
    }

    return {
        uploads: out,
        storage_subfolder_name: folderKey
    };
}

async function listExistingFolderKeys(bucket) {
    const prefix = `${PREFIX}/`;
    const [files] = await bucket.getFiles({ prefix });
    const keys = new Set();
    for (const f of files) {
        if (!f.name.startsWith(prefix)) {
            continue;
        }
        const rest = f.name.slice(prefix.length);
        const seg = rest.split("/")[0];
        if (seg) {
            keys.add(seg);
        }
    }
    return [...keys];
}
