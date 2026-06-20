/**
 * Chat media library — upload reusable images/PDFs to the GCS bucket and expose
 * public links the dashboard can drop into chat responses.
 *
 * Kept deliberately separate from the customer-submission catalog: a single flat
 * prefix (bot-assets/) with public objects, no transcript/session enrichment.
 */

const gcsUpload = require('./gcs-upload');
const documentDisplay = require('./document-display');
const folderName = require('./submission-folder-name');

const ASSET_PREFIX = String(process.env.GCS_CHAT_ASSETS_PREFIX || 'bot-assets')
  .trim()
  .replace(/^\/+|\/+$/g, '');

const ASSETS_MAX_MB = Math.min(
  100,
  Math.max(1, Number(process.env.ASSETS_MAX_UPLOAD_MB || 20) || 20)
);
const ASSETS_MAX_BYTES = ASSETS_MAX_MB * 1024 * 1024;

function assetsRejectMessage() {
  return `File is too large. Maximum size is ${ASSETS_MAX_MB} MB.`;
}

function assertAssetsUploadSize(bytes, filename) {
  const size = Number(bytes) || 0;
  if (size <= 0) {
    const err = new Error('File is empty.');
    err.code = 'empty_file';
    throw err;
  }
  if (size > ASSETS_MAX_BYTES) {
    const name = String(filename || '').trim();
    const msg = assetsRejectMessage();
    const err = new Error(name ? `${name}: ${msg}` : msg);
    err.code = 'file_too_large';
    throw err;
  }
}

function isConfigured() {
  return gcsUpload.isConfigured();
}

function prefixPath() {
  return ASSET_PREFIX ? `${ASSET_PREFIX}/` : '';
}

function bucket() {
  const storage = gcsUpload.getStorage();
  if (!storage) return null;
  return storage.bucket(gcsUpload.BUCKET_NAME);
}

/** Public URL namespace served by this app (decoupled from the GCS prefix). */
const PUBLIC_ROUTE = '/media/bot-assets/';

function validateObjectName(objectName) {
  const obj = String(objectName || '').trim();
  if (!obj) return { ok: false, error: 'object_required' };
  const prefix = prefixPath();
  if (prefix && !obj.startsWith(prefix)) {
    return { ok: false, error: 'invalid_object' };
  }
  return { ok: true };
}

/** /media/bot-assets/<tail> — a durable public link served by this server. */
function publicPath(objectName) {
  const obj = String(objectName || '').trim();
  const prefix = prefixPath();
  const tail = prefix && obj.startsWith(prefix) ? obj.slice(prefix.length) : obj;
  if (!tail) return '';
  const encoded = tail.split('/').map(encodeURIComponent).join('/');
  return PUBLIC_ROUTE + encoded;
}

function displayNameFromObject(objectName, fileMetadata) {
  const custom = (fileMetadata && fileMetadata.metadata) || {};
  if (custom.original_filename) return String(custom.original_filename).trim();
  const base = String(objectName || '').split('/').pop() || '';
  return documentDisplay.parseStoredObjectFileName(base);
}

function normalizeAssetFileName(name) {
  return String(name || '').trim().toLowerCase();
}

function assertAssetNameNotTaken(name, takenSet) {
  const key = normalizeAssetFileName(name);
  if (!key) return;
  if (takenSet.has(key)) {
    const display = String(name || '').trim() || 'file';
    const err = new Error('This file already exists: ' + display);
    err.code = 'file_already_exists';
    throw err;
  }
}

async function listAssets() {
  if (!isConfigured()) return { ok: false, error: 'gcs_not_configured' };
  const bkt = bucket();
  if (!bkt) return { ok: false, error: 'gcs_not_configured' };

  const prefix = prefixPath();
  let files = [];
  try {
    [files] = await bkt.getFiles({ prefix, autoPaginate: true });
  } catch (err) {
    return { ok: false, error: err.message || 'list_failed' };
  }

  const assets = (files || [])
    .filter((f) => f && f.name && !f.name.endsWith('/'))
    .map((f) => {
      const meta = f.metadata || {};
      return {
        gcs_object: f.name,
        file_name: displayNameFromObject(f.name, meta),
        content_type: meta.contentType || 'application/octet-stream',
        size_bytes: Number(meta.size) || 0,
        uploaded_at: meta.timeCreated || meta.updated || '',
        public_path: publicPath(f.name),
      };
    })
    .sort((a, b) =>
      String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || ''))
    );

  return {
    ok: true,
    bucket: gcsUpload.BUCKET_NAME,
    prefix: ASSET_PREFIX,
    count: assets.length,
    assets,
    max_upload_mb: ASSETS_MAX_MB,
  };
}

/**
 * @param {Array<{ buffer: Buffer, originalname?: string, mimetype?: string }>} files
 */
async function uploadAssets(files) {
  if (!isConfigured()) {
    throw new Error(
      'GCS not configured. Set GCS_BUCKET_NAME and GOOGLE_CREDENTIALS_JSON on the server.'
    );
  }
  const parts = (files || []).filter(
    (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
  );
  if (!parts.length) throw new Error('No file bytes received.');

  const listed = await listAssets();
  const taken = new Set(
    (listed.assets || []).map((a) => normalizeAssetFileName(a.file_name))
  );

  const bkt = bucket();
  const prefix = prefixPath();
  const uploads = [];
  const usedNames = new Set();

  for (const f of parts) {
    const orig = typeof f.originalname === 'string' ? f.originalname : 'file';
    assertAssetsUploadSize(f.buffer.length, orig);
    assertAssetNameNotTaken(orig, taken);
    taken.add(normalizeAssetFileName(orig));

    const safeName = documentDisplay.uniqueStoredFileName(
      orig,
      usedNames,
      folderName.sanitizeFilename
    );
    // Timestamp prefix keeps objects unique while parseStoredObjectFileName()
    // still recovers the original display name.
    const objectName = `${prefix}${Date.now()}_${cryptoRandom()}_${safeName}`;
    const mime =
      typeof f.mimetype === 'string' && f.mimetype
        ? f.mimetype
        : 'application/octet-stream';

    const file = bkt.file(objectName);
    await file.save(f.buffer, {
      metadata: {
        contentType: mime,
        metadata: { original_filename: orig.slice(0, 200) },
      },
      resumable: false,
    });

    uploads.push({
      gcs_object: objectName,
      file_name: orig,
      content_type: mime,
      size_bytes: f.buffer.length,
      uploaded_at: new Date().toISOString(),
      public_path: publicPath(objectName),
    });
  }

  return { ok: true, uploaded: uploads.length, assets: uploads };
}

function cryptoRandom() {
  return require('crypto').randomBytes(4).toString('hex');
}

async function getDownloadUrl(objectName) {
  if (!isConfigured()) return { ok: false, error: 'gcs_not_configured' };
  const check = validateObjectName(objectName);
  if (!check.ok) return check;

  const file = bucket().file(String(objectName).trim());
  const [exists] = await file.exists();
  if (!exists) return { ok: false, error: 'not_found' };

  let fileMeta = {};
  try {
    const [gm] = await file.getMetadata();
    fileMeta = gm || {};
  } catch {
    /* ignore */
  }

  const days = Math.min(
    7,
    Math.max(1, Number(process.env.GCS_SIGNED_URL_DAYS || 7) || 7)
  );
  const expires = Date.now() + days * 24 * 60 * 60 * 1000;
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires,
  });

  return {
    ok: true,
    url: signedUrl,
    expires_in_days: days,
    file_name: displayNameFromObject(objectName, fileMeta),
  };
}

/**
 * Stream a chat asset publicly (no auth) for use as an <img>/PDF src — e.g. the
 * chatbot image carousel. Restricted to the chat-assets prefix so it can never
 * be used to read private customer uploads elsewhere in the bucket.
 */
async function streamPublicAsset(tail, res) {
  if (!isConfigured()) return { ok: false, error: 'gcs_not_configured' };
  const safe = String(tail || '').replace(/^\/+/, '').trim();
  if (!safe || safe.includes('..') || safe.includes('/')) {
    return { ok: false, error: 'invalid_object' };
  }
  const objectName = `${prefixPath()}${safe}`;
  const file = bucket().file(objectName);
  const [exists] = await file.exists();
  if (!exists) return { ok: false, error: 'not_found' };

  let meta = {};
  try {
    const [gm] = await file.getMetadata();
    meta = gm || {};
  } catch {
    /* use defaults */
  }

  res.setHeader('Content-Type', meta.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');

  return new Promise((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on('error', (err) => {
      if (!res.headersSent) reject(err);
      else res.end();
    });
    stream.on('end', () => resolve({ ok: true }));
    stream.pipe(res);
  });
}

async function deleteAsset(objectName) {
  if (!isConfigured()) return { ok: false, error: 'gcs_not_configured' };
  const check = validateObjectName(objectName);
  if (!check.ok) return check;

  const file = bucket().file(String(objectName).trim());
  const [exists] = await file.exists();
  if (!exists) {
    return { ok: true, deleted: false, already_gone: true, gcs_object: objectName };
  }
  await file.delete();
  return { ok: true, deleted: true, gcs_object: objectName };
}

module.exports = {
  isConfigured,
  listAssets,
  uploadAssets,
  getDownloadUrl,
  streamPublicAsset,
  deleteAsset,
  ASSET_PREFIX,
  PUBLIC_ROUTE,
  ASSETS_MAX_MB,
  assetsRejectMessage,
};
