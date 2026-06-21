/**
 * Instagram / Facebook inbound attachments → GCS (same path as web /api/upload/documents).
 */

const meta = require('./meta-shared');
const gcsUpload = require('../gcs-upload');
const chatTranscript = require('../chat-transcript');
const conversationSheet = require('../conversation-sheet');
const appEnv = require('../app-env');
const waUploadSequence = require('../wa-upload-sequence');
const uploadLimits = require('../upload-limits');

const ALLOWED_MEDIA_TYPES = new Set(['image', 'file']);
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
      console.warn('[messenger-media-upload] sheet sync:', err.message);
      conversationSheet.scheduleSheetSync(sid);
    });
}

function userIdForFilename(userId) {
  const digits = String(userId || '').replace(/\D/g, '');
  if (digits.length > 10) return digits.slice(-10);
  return digits || 'user';
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

function nextUploadSequence(sessionId, userId, dateStr) {
  const key = userIdForFilename(userId);
  return waUploadSequence.reserveNext(key, dateStr);
}

function filenameForMedia(media, mime, sessionId, userId) {
  const uid = userIdForFilename(userId);
  const dateStr = dateStampDDMM();
  const seq = nextUploadSequence(sessionId, userId, dateStr);
  const ext = extensionForMedia(media, mime);
  return `${uid}_${dateStr}_${seq}${ext}`;
}

function isUploadForm(form) {
  const fid = String(form.formId || form.form_id || '')
    .trim()
    .toLowerCase();
  if (fid === 'upload' || fid === 'uploaddocument') return true;
  const fields = Array.isArray(form.fields) ? form.fields : [];
  return fields.some((f) => f && String(f.type || '').toLowerCase() === 'file');
}

function resolveUploadTag(metaDoc) {
  const m = metaDoc && typeof metaDoc === 'object' ? metaDoc : {};
  if (m.messenger_upload_form_active === true) {
    return String(m.upload_tag || m.tag || '').trim();
  }
  return '';
}

function markUploadForms(sessionId, forms) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const list = Array.isArray(forms) ? forms : [];
  for (const form of list) {
    const tag = String(form.tag || form.upload_tag || '').trim();
    const uploadForm = isUploadForm(form);
    if (!uploadForm && !tag) continue;
    const patch = { messenger_upload_form_active: true };
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

function sessionContext(sessionId, userId, channelName) {
  let doc = { meta: {} };
  try {
    doc = chatTranscript.getSessionDoc(sessionId);
  } catch {
    /* ignore */
  }
  const metaDoc = doc && doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  return {
    name: String(metaDoc.name || metaDoc.visitorName || '').trim(),
    email: String(metaDoc.email || '').trim(),
    mobile: String(
      metaDoc.mobile ||
        metaDoc.whatsappPhone ||
        metaDoc.instagramUserId ||
        metaDoc.facebookPsid ||
        userId ||
        ''
    ).trim(),
    dialCode: String(metaDoc.dial_code || metaDoc.dialCode || '').trim(),
    tag: resolveUploadTag(metaDoc),
    fromFormFlow: metaDoc.messenger_upload_form_active === true,
    channelName: channelName || metaDoc.channel || 'Messenger',
  };
}

function mergeUploadMeta(sessionId, pack, userId, ctx) {
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
    channel: ctx.channelName,
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
 * @param {string} opts.userId
 * @param {object} opts.media — { type, url, mimeType?, filename? }
 * @param {string} opts.channelName — Instagram | Facebook
 * @param {string} [opts.botId]
 * @param {boolean} [opts.logTranscript=true]
 */
async function uploadInboundMedia(opts) {
  const sessionId = String((opts && opts.sessionId) || '').trim();
  const userId = String((opts && opts.userId) || '').trim();
  const media = opts && opts.media ? opts.media : null;
  const mediaUrl = media && media.url ? String(media.url).trim() : '';
  const channelName = String((opts && opts.channelName) || 'Messenger').trim();
  const logTranscript = opts && opts.logTranscript !== false;

  if (!sessionId || !mediaUrl) {
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
  if (!meta.isMessengerConfigured()) {
    return { ok: false, error: 'messenger_not_configured' };
  }

  try {
    const downloaded = await meta.downloadMessengerAttachment(mediaUrl, {
      botId: opts && opts.botId,
    });
    const sizeCheck = uploadLimits.validateUploadSize(
      downloaded.buffer.length,
      media.filename || mediaUrl
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
      userId
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

    const ctx = sessionContext(sessionId, userId, channelName);
    const pack = await gcsUpload.uploadSubmissionFilesToGcs(filtered, {
      mobile: ctx.mobile,
      dialCode: ctx.dialCode,
      clientSessionId: sessionId,
      name: ctx.name,
      email: ctx.email,
      tag: ctx.tag,
      channel: channelName,
    });

    mergeUploadMeta(sessionId, pack, userId, ctx);

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
    console.error('[messenger-media-upload]', mediaUrl.slice(0, 80), msg);
    const isCdnFailure =
      msg.includes('download failed') ||
      msg.includes('HTML instead') ||
      msg.includes('FB_PAGE_ACCESS_TOKEN');
    return {
      ok: false,
      error: 'upload_failed',
      message: isCdnFailure
        ? 'Could not save your file. Please ask admin to set a permanent Page access token (FB_PAGE_ACCESS_TOKEN) in Railway.'
        : msg.slice(0, 200) || 'Upload failed',
    };
  }
}

module.exports = {
  uploadInboundMedia,
  markUploadForms,
  isUploadForm,
};
