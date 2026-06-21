/**
 * Max upload size for web chat, WhatsApp, Instagram, and Facebook.
 * Override with MAX_UPLOAD_MB on Railway (default 15).
 */

const MAX_UPLOAD_MB = Math.min(
  100,
  Math.max(1, Number(process.env.MAX_UPLOAD_MB || 15) || 15)
);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const REJECT_MESSAGE = `File is too large. Maximum size is ${MAX_UPLOAD_MB} MB.`;

function validateUploadSize(bytes, filename) {
  const size = Number(bytes) || 0;
  if (size <= 0) {
    return { ok: false, error: 'empty_file', message: 'File is empty.' };
  }
  if (size > MAX_UPLOAD_BYTES) {
    const name = String(filename || '').trim();
    return {
      ok: false,
      error: 'file_too_large',
      message: name ? `${name}: ${REJECT_MESSAGE}` : REJECT_MESSAGE,
    };
  }
  return { ok: true };
}

function assertUploadSize(bytes, filename) {
  const check = validateUploadSize(bytes, filename);
  if (!check.ok) {
    const err = new Error(check.message);
    err.code = check.error;
    throw err;
  }
}

module.exports = {
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES,
  REJECT_MESSAGE,
  validateUploadSize,
  assertUploadSize,
};
