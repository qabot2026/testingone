/**
 * Upload form files to Google Cloud Storage (production — no client Drive OAuth).
 */

const { Storage } = require('@google-cloud/storage');
const googleCredentials = require('./google-credentials');
const folderName = require('./submission-folder-name');
const documentDisplay = require('./document-display');
const uploadLimits = require('./upload-limits');

const BUCKET_NAME = String(process.env.GCS_BUCKET_NAME || '').trim();
const UPLOAD_PREFIX = String(process.env.GCS_UPLOAD_PREFIX || 'user-uploads')
  .trim()
  .replace(/^\/+|\/+$/g, '');
const SIGNED_URL_DAYS = Math.min(
  30,
  Math.max(1, Number(process.env.GCS_SIGNED_URL_DAYS || 7) || 7)
);

function isConfigured() {
  return !!(BUCKET_NAME && googleCredentials.getServiceAccountCredentials());
}

function getStorage() {
  const creds = googleCredentials.getServiceAccountCredentials();
  if (!creds) return null;
  return new Storage({
    credentials: creds,
    projectId: creds.project_id,
  });
}

/** List folder names already under uploads/ (prefix folders in GCS). */
async function listExistingFolderNames(bucket) {
  try {
    const prefix = UPLOAD_PREFIX ? `${UPLOAD_PREFIX}/` : '';
    const [, , apiResponse] = await bucket.getFiles({
      prefix,
      delimiter: '/',
      autoPaginate: false,
      maxResults: 1000,
    });
    const prefixes = (apiResponse && apiResponse.prefixes) || [];
    const names = [];
    const esc = String(UPLOAD_PREFIX || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = esc
      ? new RegExp(`^${esc}/([^/]+)/$`)
      : new RegExp(/^([^/]+)\/$/);
    prefixes.forEach((p) => {
      const m = String(p).match(re);
      if (m && m[1]) names.push(m[1]);
    });
    return names;
  } catch (err) {
    console.warn('[gcs-upload] listExistingFolderNames:', err.message);
    return [];
  }
}

/**
 * @param {Array<{ buffer: Buffer, originalname?: string, mimetype?: string }>} files
 * @param {{ mobile?: string, dialCode?: string, clientSessionId?: string, name?: string, email?: string, tag?: string }} opts
 */
async function uploadSubmissionFilesToGcs(files, opts) {
  opts = opts || {};
  if (!isConfigured()) {
    throw new Error(
      'GCS not configured. Set GCS_BUCKET_NAME and GOOGLE_CREDENTIALS_JSON on Railway.'
    );
  }
  const fileParts = (files || []).filter(
    (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
  );
  if (!fileParts.length) {
    throw new Error('No file bytes received.');
  }

  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const existing = await listExistingFolderNames(bucket);
  const folder = folderName.nextSubmissionFolderName({
    mobile: opts.mobile,
    dialCode: opts.dialCode,
    clientSessionId: opts.clientSessionId,
    folderNames: existing,
    submittedAt: new Date(),
  });

  const basePath = UPLOAD_PREFIX ? `${UPLOAD_PREFIX}/${folder}` : folder;
  const expires = Date.now() + SIGNED_URL_DAYS * 24 * 60 * 60 * 1000;
  const uploads = [];
  const usedNames = new Set();

  for (const f of fileParts) {
    const orig =
      typeof f.originalname === 'string' ? f.originalname : 'file';
    uploadLimits.assertUploadSize(f.buffer.length, orig);
    const storedName = documentDisplay.uniqueStoredFileName(
      orig,
      usedNames,
      folderName.sanitizeFilename
    );
    const objectName = `${basePath}/${storedName}`;
    const mime =
      typeof f.mimetype === 'string' && f.mimetype
        ? f.mimetype
        : 'application/octet-stream';

    const file = bucket.file(objectName);
    const customMeta = {
      session_id: String(opts.clientSessionId || '').slice(0, 120),
      storage_folder: folder,
      original_filename: orig.slice(0, 200),
    };
    const customerName = String(opts.name || '').trim().slice(0, 200);
    const customerMobile = String(opts.mobile || '').trim().slice(0, 32);
    const customerDial = String(opts.dialCode || '').trim().slice(0, 8);
    const customerEmail = String(opts.email || '').trim().slice(0, 200);
    if (customerName) customMeta.customer_name = customerName;
    if (customerMobile) customMeta.mobile = customerMobile;
    if (customerDial) customMeta.dial_code = customerDial;
    if (customerEmail) customMeta.email = customerEmail;
    const uploadTag = String(opts.tag || '').trim().slice(0, 64);
    if (uploadTag) customMeta.upload_tag = uploadTag;
    const channel = String(opts.channel || 'Web').trim().slice(0, 32);
    if (channel) customMeta.channel = channel;

    await file.save(f.buffer, {
      metadata: {
        contentType: mime,
        metadata: customMeta,
      },
      resumable: false,
    });

    let signedUrl = documentDisplay.storageObjectHttpsUrl(objectName);
    try {
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires,
      });
      if (url) signedUrl = url;
    } catch (err) {
      console.warn(
        '[gcs-upload] signed URL failed for',
        objectName,
        '— using storage URL:',
        err.message
      );
    }

    uploads.push({
      original_name: orig,
      gcs_object: objectName,
      content_type: mime,
      size_bytes: f.buffer.length,
      signed_url: signedUrl,
      storage_folder: folder,
    });
  }

  const documentLinks = uploads.map((u) => u.signed_url).filter(Boolean).join('\n');
  const documentNames = uploads
    .map((u) => u.original_name)
    .filter(Boolean)
    .join(', ');

  return {
    uploads,
    storage_folder: folder,
    storage_path: basePath,
    document_names: documentNames,
    document_links: documentLinks,
    document_link: uploads[0] ? uploads[0].signed_url : '',
  };
}

module.exports = {
  isConfigured,
  getStorage,
  uploadSubmissionFilesToGcs,
  BUCKET_NAME,
  UPLOAD_PREFIX,
  MAX_UPLOAD_BYTES: uploadLimits.MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB: uploadLimits.MAX_UPLOAD_MB,
};
