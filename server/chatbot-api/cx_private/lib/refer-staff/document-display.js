/**
 * Human-readable document names for Sheet, chat script summary, and uploads.
 */

function gcsBucketName() {
  return String(process.env.GCS_BUCKET_NAME || '').trim();
}

function splitExt(name) {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  if (i <= 0) return { base: s, ext: '' };
  return { base: s.slice(0, i), ext: s.slice(i) };
}

/** GCS object basename → display name (legacy timestamp_uuid_prefix or plain name). */
function parseStoredObjectFileName(base) {
  const b = String(base || '').trim();
  if (!b) return '';
  const parts = b.split('_');
  if (parts.length >= 3 && /^\d{13,}$/.test(parts[0])) {
    return parts.slice(2).join('_') || b;
  }
  return b;
}

function gcsObjectFromStorageUrl(url, bucketName) {
  const bucket = String(bucketName || gcsBucketName()).trim();
  const s = String(url || '').trim();
  if (!s || !bucket || !/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    if (
      !/storage\.googleapis\.com$/i.test(u.hostname) &&
      !/storage\.cloud\.google\.com$/i.test(u.hostname)
    ) {
      return '';
    }
    const parts = u.pathname.split('/').filter(Boolean).map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    });
    if (!parts.length) return '';
    if (parts[0] === bucket) return parts.slice(1).join('/');
    const idx = parts.indexOf(bucket);
    if (idx >= 0) return parts.slice(idx + 1).join('/');
  } catch {
    /* ignore */
  }
  return '';
}

function filenameFromGcsUrl(url) {
  const s = String(url || '').trim();
  if (!s || !/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return parseStoredObjectFileName(seg);
  } catch {
    const m = s.match(/\/([^/?]+)(?:\?|$)/);
    return m ? parseStoredObjectFileName(decodeURIComponent(m[1])) : '';
  }
}

function isStorageFolderId(value) {
  return /^\d{10,}_\d{2}_\d{2}_\d{4}_\d{2,}$/.test(String(value || '').trim())
    || /^[a-zA-Z0-9_-]+__\d{2}_\d{2}_\d{4}_\d{2,}$/.test(String(value || '').trim());
}

/**
 * Comma-separated display names for Sheet / summary from transcript meta.
 */
/** Permanent GCS object URL for Sheet / staff (not signed). */
function storageObjectHttpsUrl(objectName) {
  const bucket = gcsBucketName();
  const obj = String(objectName || '').trim();
  if (!bucket || !obj) return '';
  const path = obj.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${path}`;
}

/**
 * Exact storage links for Google Sheet Document column (one per line if many).
 */
function documentStorageLinksFromMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const links = [];

  if (Array.isArray(m.uploaded_files) && m.uploaded_files.length) {
    m.uploaded_files.forEach((f) => {
      const url = storageObjectHttpsUrl(f && f.gcs_object);
      if (url) links.push(url);
    });
  }
  if (Array.isArray(m.uploads) && m.uploads.length) {
    m.uploads.forEach((f) => {
      const url = storageObjectHttpsUrl(f && f.gcs_object);
      if (url && links.indexOf(url) < 0) links.push(url);
    });
  }
  if (!links.length && m.storage_path) {
    const bucket = gcsBucketName();
    const base = String(m.storage_path || '').trim().replace(/\\/g, '/');
    if (bucket && base) {
      const path = base.split('/').map((seg) => encodeURIComponent(seg)).join('/');
      links.push(`https://storage.googleapis.com/${encodeURIComponent(bucket)}/${path}`);
    }
  }
  if (!links.length && m.document_link) {
    const fromSigned = String(m.document_link).trim();
    if (/^https?:\/\//i.test(fromSigned)) links.push(fromSigned);
  }
  if (!links.length && m.document_links) {
    String(m.document_links)
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//i.test(line))
      .forEach((line) => {
        if (links.indexOf(line) < 0) links.push(line);
      });
  }

  return links.join('\n');
}

function documentNamesFromMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  if (m.document_names) {
    return String(m.document_names).trim();
  }
  if (Array.isArray(m.uploaded_files) && m.uploaded_files.length) {
    return m.uploaded_files
      .map((f) => (f && (f.original_name || f.name || f.file_name)) || '')
      .filter(Boolean)
      .join(', ');
  }
  if (Array.isArray(m.uploads) && m.uploads.length) {
    return m.uploads
      .map((f) => (f && (f.original_name || f.name)) || '')
      .filter(Boolean)
      .join(', ');
  }
  const doc = String(m.document || m.upload || '').trim();
  if (!doc) {
    if (m.document_link) return filenameFromGcsUrl(m.document_link);
    if (m.document_links) {
      return String(m.document_links)
        .split(/\n/)
        .map((line) => filenameFromGcsUrl(line) || line.trim())
        .filter(Boolean)
        .join(', ');
    }
    return '';
  }
  if (/^https?:\/\//i.test(doc)) {
    return filenameFromGcsUrl(doc);
  }
  if (isStorageFolderId(doc)) {
    return '';
  }
  return doc;
}

/** Format any stored Document cell value for staff UI. */
function formatDocumentFieldForDisplay(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    const fromUrl = filenameFromGcsUrl(s);
    return fromUrl || s;
  }
  if (s.includes('\n') && s.includes('https://')) {
    return s
      .split(/\n/)
      .map((line) => formatDocumentFieldForDisplay(line))
      .filter(Boolean)
      .join(', ');
  }
  if (isStorageFolderId(s)) return '';
  if (s.includes(',')) {
    return s
      .split(',')
      .map((x) => formatDocumentFieldForDisplay(x.trim()))
      .filter(Boolean)
      .join(', ');
  }
  return s;
}

function uniqueStoredFileName(orig, usedNames, sanitize) {
  const safe = sanitize(orig);
  if (!usedNames.has(safe)) {
    usedNames.add(safe);
    return safe;
  }
  const { base, ext } = splitExt(safe);
  let n = 2;
  let candidate = `${base}_${n}${ext}`;
  while (usedNames.has(candidate)) {
    n += 1;
    candidate = `${base}_${n}${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}

module.exports = {
  documentNamesFromMeta,
  documentStorageLinksFromMeta,
  storageObjectHttpsUrl,
  formatDocumentFieldForDisplay,
  filenameFromGcsUrl,
  gcsObjectFromStorageUrl,
  parseStoredObjectFileName,
  uniqueStoredFileName,
  isStorageFolderId,
};
