/**
 * WhatsApp inbound media → GCS (same path as web /api/upload/documents).
 */

const meta = require('./meta-shared');
const gcsUpload = require('../gcs-upload');
const chatTranscript = require('../chat-transcript');
const conversationSheet = require('../conversation-sheet');
const appEnv = require('../app-env');
const waUploadSequence = require('../wa-upload-sequence');
const uploadLimits = require('../upload-limits');

const ALLOWED_MEDIA_TYPES = new Set(['image', 'document']);
const REJECTED_MIME_PREFIXES = ['video/', 'audio/'];

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
};

function queueSheetSync(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  conversationSheet
    .syncSessionToSheet(sid)
    .then((result) => {
      if (result && result.skipped) conversationSheet.scheduleSheetSync(sid);
    })
    .catch((err) => {
      console.warn('[whatsapp-media-upload] sheet sync:', err.message);
      conversationSheet.scheduleSheetSync(sid);
    });
}

function waPhoneForFilename(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function dateStampDDMM(date = new Date()) {
  const tz =
    appEnv.CONTACT_FORM_SUBMISSION_TZ ||
    appEnv.SHEETS_CONV_DATETIME_TZ ||
    'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(date);
  const day = parts.find((p) => p.type === 'day');
  const month = parts.find((p) => p.type === 'month');
  return `${day ? day.value : '01'}${month ? month.value : '01'}`;
}

function extensionForMedia(media, mime) {
  const raw = media && media.filename ? String(media.filename).trim() : '';
  const fromName = raw.match(/(\.[a-zA-Z0-9]{1,8})$/);
  if (fromName) return fromName[1].toLowerCase();
  return MIME_EXT[String(mime || '').toLowerCase()] || '';
}

/** Next _NN from local counter (transcript bootstrap once) — no GCS list API */
function nextUploadSequence(sessionId, phone, dateStr) {
  const waNo = waPhoneForFilename(phone);
  return waUploadSequence.reserveNext(waNo, dateStr);
}

/** {whatsappNo}_{DDMM}_{01}.ext — e.g. 9887766554_1406_01.jpg */
function filenameForMedia(media, mime, sessionId, phone) {
  const waNo = waPhoneForFilename(phone);
  const dateStr = dateStampDDMM();
  const seq = nextUploadSequence(sessionId, phone, dateStr);
  const ext = extensionForMedia(media, mime);
  return `${waNo}_${dateStr}_${seq}${ext}`;
}

function isUploadForm(form) {
  const fid = String(form.formId || form.form_id || '')
    .trim()
    .toLowerCase();
  if (fid === 'upload' || fid === 'uploaddocument') return true;
  const fields = Array.isArray(form.fields) ? form.fields : [];
  return fields.some((f) => f && String(f.type || '').toLowerCase() === 'file');
}

/** Dialogflow upload form — tag from open_form; direct WA upload stays blank */
function resolveUploadTag(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  if (m.wa_upload_form_active === true) {
    return String(m.upload_tag || m.tag || '').trim();
  }
  return '';
}

function markWaUploadForms(sessionId, forms) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const list = Array.isArray(forms) ? forms : [];
  for (const form of list) {
    const tag = String(form.tag || form.upload_tag || '').trim();
    const uploadForm = isUploadForm(form);
    if (!uploadForm && !tag) continue;
    const patch = { wa_upload_form_active: true };
    if (tag) {
      patch.upload_tag = tag;
      patch.tag = tag;
    } else {
      patch.upload_tag = '';
      patch.tag = '';
    }
    chatTranscript.mergeSessionMeta(sid, patch, { scheduleSheet: false });
  }
}

function sessionContext(sessionId, phone) {
  let doc = { meta: {} };
  try {
    doc = chatTranscript.getSessionDoc(sessionId);
  } catch {
    /* ignore */
  }
  const meta = doc && doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  return {
    name: String(meta.name || meta.visitorName || '').trim(),
    email: String(meta.email || '').trim(),
    mobile: String(meta.mobile || meta.whatsappPhone || phone || '').trim(),
    dialCode: String(meta.dial_code || meta.dialCode || '').trim(),
    tag: resolveUploadTag(meta),
    fromFormFlow: meta.wa_upload_form_active === true,
  };
}

function mergeUploadMeta(sessionId, pack, phone, ctx) {
  const sid = String(sessionId || '').trim();
  const doc = chatTranscript.getSessionDoc(sid);
  const prev = doc && doc.meta && typeof doc.meta === 'object' ? doc.meta : {};

  const prevFiles = Array.isArray(prev.uploaded_files) ? prev.uploaded_files : [];
  const newFiles = (pack.uploads || []).map((u) => ({
    original_name: u.original_name,
    gcs_object: u.gcs_object,
    size_bytes: u.size_bytes,
  }));
  const uploaded_files = prevFiles.concat(newFiles);

  const prevNames = String(prev.document_names || prev.document || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const newNames = String(pack.document_names || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nameSet = new Set(prevNames);
  newNames.forEach((n) => nameSet.add(n));
  const document_names = [...nameSet].join(', ');

  const prevLinks = String(prev.document_links || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const newLinks = String(pack.document_links || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const linkSet = new Set(prevLinks);
  newLinks.forEach((l) => linkSet.add(l));
  const document_links = [...linkSet].join('\n');

  const uploadMeta = {
    document: document_names,
    document_names,
    uploaded_files,
    storage_folder: pack.storage_folder || prev.storage_folder || '',
    storage_path: pack.storage_path || prev.storage_path || '',
    document_link: pack.document_link || prev.document_link || '',
    document_links,
    channel: 'WhatsApp',
    whatsappPhone: phone,
    tag: ctx.fromFormFlow ? ctx.tag : '',
    userEngaged: true,
    last_upload_at: new Date().toISOString(),
    opportunistic_upload: !ctx.fromFormFlow,
  };
  if (ctx.name) uploadMeta.name = ctx.name;
  if (ctx.email) uploadMeta.email = ctx.email;
  if (ctx.mobile) uploadMeta.mobile = ctx.mobile;
  if (ctx.dialCode) uploadMeta.dial_code = ctx.dialCode;

  chatTranscript.mergeSessionMeta(sid, uploadMeta, { scheduleSheet: false });
  return uploadMeta;
}

/**
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.phone
 * @param {object} opts.media — { type, id, mimeType?, filename?, caption? }
 * @param {string} [opts.phoneNumberId] — webhook metadata.phone_number_id
 * @param {boolean} [opts.logTranscript=true]
 */
async function uploadInboundMedia(opts) {
  const sessionId = String((opts && opts.sessionId) || '').trim();
  const phone = String((opts && opts.phone) || '').replace(/\D/g, '');
  const media = opts && opts.media ? opts.media : null;
  const mediaId = media && media.id ? String(media.id).trim() : '';
  const logTranscript = opts && opts.logTranscript !== false;

  if (!sessionId || !mediaId) {
    return { ok: false, error: 'missing_session_or_media' };
  }
  const mediaType = String((media && media.type) || '').toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return {
      ok: false,
      error: 'unsupported_media_type',
      message:
        'Video and audio files are not accepted. Please send images or documents (PDF, Word) only.',
    };
  }
  if (!gcsUpload.isConfigured()) {
    return {
      ok: false,
      error: 'gcs_not_configured',
      message: 'File storage is not configured on the server.',
    };
  }
  if (!meta.isWhatsAppConfigured()) {
    return { ok: false, error: 'whatsapp_not_configured' };
  }

  try {
    const downloaded = await meta.downloadWhatsAppMedia(mediaId, {
      phoneNumberId: opts && opts.phoneNumberId,
      botId: opts && opts.botId,
    });
    const sizeCheck = uploadLimits.validateUploadSize(
      downloaded.buffer.length,
      media.filename || mediaId
    );
    if (!sizeCheck.ok) {
      return {
        ok: false,
        error: sizeCheck.error,
        message: sizeCheck.message,
      };
    }
    const mime = String(downloaded.mimetype || '').toLowerCase();
    if (REJECTED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
      return {
        ok: false,
        error: 'unsupported_media_type',
        message:
          'Video and audio files are not accepted. Please send images or documents (PDF, Word) only.',
      };
    }
    const originalname = filenameForMedia(
      media,
      downloaded.mimetype,
      sessionId,
      phone
    );
    const fileRow = {
      buffer: downloaded.buffer,
      originalname,
      mimetype: downloaded.mimetype,
      size: downloaded.buffer.length,
    };

    const filtered = chatTranscript.filterDuplicateUploadFilesForSession(
      sessionId,
      [fileRow]
    );
    if (!filtered.length) {
      queueSheetSync(sessionId);
      return {
        ok: true,
        duplicate_skipped: true,
        document_names: originalname,
        ackMessage: `📎 ${originalname} was already received.`,
      };
    }

    const ctx = sessionContext(sessionId, phone);
    const pack = await gcsUpload.uploadSubmissionFilesToGcs(filtered, {
      mobile: ctx.mobile,
      dialCode: ctx.dialCode,
      clientSessionId: sessionId,
      name: ctx.name,
      email: ctx.email,
      tag: ctx.tag,
      channel: 'WhatsApp',
    });

    mergeUploadMeta(sessionId, pack, phone, ctx);

    const uploadLabel = pack.document_names || originalname;
    if (logTranscript) {
      chatTranscript.appendTurn(
        sessionId,
        'user',
        `📎 ${uploadLabel}`,
        undefined,
        { scheduleSheet: false }
      );
    }
    queueSheetSync(sessionId);

    return {
      ok: true,
      document_names: pack.document_names,
      document_link: pack.document_link,
      storage_folder: pack.storage_folder,
      ackMessage: `📎 Received: ${uploadLabel}. Your file has been saved.`,
    };
  } catch (err) {
    const msg = String(err.message || '');
    console.error('[whatsapp-media-upload]', mediaId, msg);
    const isCdnFailure =
      msg.includes('media download failed') ||
      msg.includes('HTML instead') ||
      msg.includes('System User token');
    return {
      ok: false,
      error: 'upload_failed',
      message: isCdnFailure
        ? 'Could not save your file from WhatsApp. Please ask admin to set a permanent System User token (WHATSAPP_TOKEN) in Railway.'
        : msg.slice(0, 200) || 'Upload failed',
    };
  }
}

module.exports = {
  uploadInboundMedia,
  markWaUploadForms,
  isUploadForm,
};
