/**
 * Upload multipart file buffers to the Firebase project’s default Storage bucket
 * (or FIREBASE_STORAGE_BUCKET). Requires Firebase credentials + Storage enabled in GCP.
 */

import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";

const BUCKET_OVERRIDE = (process.env.FIREBASE_STORAGE_BUCKET || "").trim();

/**
 * @param {import("express").Request} files from multer: array of { fieldname, originalname, mimetype, size, buffer }
 * @param {{ sessionId: string }} opts
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function uploadSubmissionFiles(files, { sessionId }) {
    if (!Array.isArray(files) || files.length === 0) {
        return [];
    }
    const storage = getStorage();
    const bucket = BUCKET_OVERRIDE ? storage.bucket(BUCKET_OVERRIDE) : storage.bucket();
    const safeSession = sanitizePathSegment(sessionId || "unknown");
    const folderPrefix = `contact-submissions/${safeSession}/${Date.now()}`;

    /** @type {Array<Record<string, unknown>>} */
    const out = [];
    for (const f of files) {
        if (!f || !f.buffer) {
            continue;
        }
        const orig = typeof f.originalname === "string" ? f.originalname : "file";
        const safeName = sanitizeFilename(orig);
        const dest = `${folderPrefix}/${randomUUID()}_${safeName}`;
        const ref = bucket.file(dest);
        await ref.save(f.buffer, {
            resumable: false,
            contentType: typeof f.mimetype === "string" && f.mimetype
                ? f.mimetype
                : "application/octet-stream"
        });
        const gsUri = `gs://${bucket.name}/${dest}`;
        out.push({
            field: f.fieldname,
            original_name: orig,
            content_type: f.mimetype || "",
            size_bytes: typeof f.size === "number" ? f.size : f.buffer.length,
            bucket: bucket.name,
            storage_path: dest,
            gs_uri: gsUri
        });
    }
    return out;
}

function sanitizePathSegment(s) {
    return String(s)
        .replace(/[/\\\0]/g, "_")
        .slice(0, 120) || "unknown";
}

function sanitizeFilename(name) {
    const base = name.replace(/[/\\]/g, "_").replace(/\0/g, "");
    return base.slice(0, 200) || "file";
}
