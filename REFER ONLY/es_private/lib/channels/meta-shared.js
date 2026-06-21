/**
 * Shared Meta Graph API helpers (WhatsApp Cloud API + Messenger / Instagram).
 */

const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { URL } = require('url');
const axios = require('axios');
const appEnv = require('../app-env');

const execFileAsync = promisify(execFile);

/** Railway/Docker: lookaside CDN is more reliable over IPv4. */
dns.setDefaultResultOrder('ipv4first');

const GRAPH_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
/** Meta lookaside CDN is picky about User-Agent (undocumented). */
const WA_MEDIA_USER_AGENTS = ['curl/7.64.1', 'node', 'curl/8.4.0'];
/** Meta CDN may need a moment after webhook before bytes are available. */
const MEDIA_DOWNLOAD_DELAYS_MS = [500, 1500, 3000, 5000, 8000, 12000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendAccessToken(url, token) {
  const base = String(url || '').trim();
  if (!base) return '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}access_token=${encodeURIComponent(token)}`;
}

function isHtmlPayload(headers, buffer) {
  const ct = String((headers && headers['content-type']) || '').toLowerCase();
  if (ct.includes('text/html')) return true;
  const head = buffer.slice(0, 48).toString('utf8').toLowerCase();
  return head.includes('<!doctype') || head.includes('<html');
}

function httpGetBinary(targetUrl, headers, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
        family: 4,
        timeout: 60000,
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const next = new URL(res.headers.location, targetUrl).toString();
          res.resume();
          httpGetBinary(next, headers, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('WhatsApp media download timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Download binary from Meta CDN via native https (IPv4).
 */
async function downloadViaHttps(url, token) {
  const mediaUrl = String(url || '').trim();
  const urlWithToken = appendAccessToken(mediaUrl, token);
  let lastStatus = 0;
  let lastDetail = '';

  for (let round = 0; round < 2; round += 1) {
    if (round > 0) await sleep(400 * round);
    for (const userAgent of WA_MEDIA_USER_AGENTS) {
      const attempts = [
        {
          url: mediaUrl,
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': userAgent,
            Accept: '*/*',
          },
        },
        {
          url: urlWithToken,
          headers: {
            'User-Agent': userAgent,
            Accept: '*/*',
          },
        },
        {
          url: urlWithToken,
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': userAgent,
            Accept: '*/*',
          },
        },
      ];
      for (const attempt of attempts) {
        try {
          const res = await httpGetBinary(attempt.url, attempt.headers);
          lastStatus = res.status;
          if (res.status >= 200 && res.status < 300 && res.buffer.length) {
            if (!isHtmlPayload(res.headers, res.buffer)) {
              return res;
            }
            lastDetail = 'CDN returned HTML instead of file bytes';
            continue;
          }
          if (res.status) lastDetail = `CDN status ${res.status}`;
        } catch (err) {
          lastDetail = err.message || 'network error';
        }
      }
    }
  }

  throw new Error(
    `https HTTP ${lastStatus || 'unknown'}${
      lastDetail ? ` (${lastDetail})` : ''
    }`
  );
}

function uniqueStrings(list) {
  const out = [];
  for (const raw of list) {
    const v = String(raw || '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function resolveWhatsAppTokens(opts = {}) {
  const c = metaConfig();
  const tokens = [];
  try {
    const social = require('../social-integration-store');
    const botId = String((opts && opts.botId) || '10002').trim();
    const cfg = social.readChannelConfig(botId, 'whatsapp');
    const prov =
      cfg && cfg.providers && cfg.providers.meta ? cfg.providers.meta : null;
    if (prov && prov.accessToken) tokens.push(String(prov.accessToken).trim());
  } catch {
    /* ignore */
  }
  if (c.whatsappToken) tokens.push(String(c.whatsappToken).trim());
  if (c.pageAccessToken) tokens.push(String(c.pageAccessToken).trim());
  return uniqueStrings(tokens);
}

function phoneNumberIdVariants(opts = {}) {
  const c = metaConfig();
  return uniqueStrings([
    opts && opts.phoneNumberId,
    c.whatsappPhoneNumberId,
  ]);
}

async function fetchMediaMetadata(mediaId, token, phoneNumberId) {
  const id = encodeURIComponent(String(mediaId || '').trim());
  const phoneIds = uniqueStrings([phoneNumberId, '']);
  let lastErr = null;
  for (const pid of phoneIds) {
    const params = new URLSearchParams();
    if (pid) params.set('phone_number_id', pid);
    const qs = params.toString();
    const path = `/${id}${qs ? `?${qs}` : ''}`;
    try {
      const metaRes = await graphGet(path, token);
      return { metaRes, phoneNumberIdUsed: pid || '(none)' };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('WhatsApp media metadata failed');
}

/** axios works when Node fetch/https fail against lookaside.fbsbx.com */
async function downloadViaAxios(url, token) {
  const mediaUrl = String(url || '').trim();
  const urlWithToken = appendAccessToken(mediaUrl, token);
  const configs = [
    { url: urlWithToken, headers: { 'User-Agent': 'curl/7.64.1' } },
    { url: urlWithToken, headers: { 'User-Agent': 'node' } },
    {
      url: mediaUrl,
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'node' },
    },
    {
      url: mediaUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'curl/7.64.1',
      },
    },
    {
      url: urlWithToken,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'curl/7.64.1',
      },
    },
  ];
  let lastStatus = 0;
  for (const cfg of configs) {
    const res = await axios.get(cfg.url, {
      headers: cfg.headers,
      responseType: 'arraybuffer',
      timeout: 60000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    lastStatus = res.status;
    if (res.status >= 200 && res.status < 300 && res.data && res.data.byteLength) {
      const buffer = Buffer.from(res.data);
      if (!isHtmlPayload(res.headers, buffer)) {
        return { buffer, headers: res.headers, status: res.status };
      }
    }
  }
  throw new Error(`axios HTTP ${lastStatus || 'unknown'}`);
}

/** Last resort: system curl binary (matches Meta docs examples). */
async function downloadViaCurl(url, token) {
  const mediaUrl = String(url || '').trim();
  const urlWithToken = appendAccessToken(mediaUrl, token);
  const tmp = path.join(
    os.tmpdir(),
    `wa-media-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`
  );
  let lastErr = 'curl failed';
  for (const target of [mediaUrl, urlWithToken]) {
    try {
      await execFileAsync(
        'curl',
        [
          '-sS',
          '-L',
          '--fail',
          '-H',
          `Authorization: Bearer ${token}`,
          '-H',
          'User-Agent: curl/7.64.1',
          '-o',
          tmp,
          target,
        ],
        { timeout: 90000, windowsHide: true }
      );
      const buffer = fs.readFileSync(tmp);
      fs.unlinkSync(tmp);
      if (buffer.length && !isHtmlPayload({}, buffer)) {
        return { buffer, headers: { 'content-type': '' }, status: 200 };
      }
      lastErr = 'curl returned empty or HTML';
    } catch (err) {
      lastErr = err.message || lastErr;
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error(lastErr);
}

/**
 * Download binary from Meta's temporary media URL (lookaside.fbsbx.com).
 */
async function fetchWhatsAppMediaBinary(url, token) {
  const mediaUrl = String(url || '').trim();
  if (!mediaUrl) throw new Error('WhatsApp media URL missing');

  const failures = [];
  const strategies = [
    ['axios', () => downloadViaAxios(mediaUrl, token)],
    ['https', () => downloadViaHttps(mediaUrl, token)],
    ['curl', () => downloadViaCurl(mediaUrl, token)],
  ];

  for (const [name, run] of strategies) {
    try {
      const res = await run();
      console.log('[meta-shared] WhatsApp CDN download ok via', name);
      return res;
    } catch (err) {
      const detail = err.message || String(err);
      failures.push(`${name}:${detail}`);
      console.warn('[meta-shared] WhatsApp CDN download failed via', name, detail);
    }
  }

  throw new Error(`WhatsApp media download failed (${failures.join('; ')})`);
}

function mediaMetadataPath(mediaId, phoneNumberId) {
  const id = encodeURIComponent(String(mediaId || '').trim());
  const params = new URLSearchParams();
  const phoneId = String(phoneNumberId || '').trim();
  if (phoneId) params.set('phone_number_id', phoneId);
  const qs = params.toString();
  return `/${id}${qs ? `?${qs}` : ''}`;
}

function metaConfig() {
  return {
    appSecret: appEnv.META_APP_SECRET,
    verifyToken: appEnv.META_VERIFY_TOKEN,
    whatsappToken: appEnv.WHATSAPP_ACCESS_TOKEN,
    whatsappPhoneNumberId: appEnv.WHATSAPP_PHONE_NUMBER_ID,
    pageAccessToken: appEnv.FB_PAGE_ACCESS_TOKEN,
    instagramPageId: appEnv.INSTAGRAM_PAGE_ID,
  };
}

function isWhatsAppConfigured() {
  const c = metaConfig();
  return Boolean(c.whatsappToken && c.whatsappPhoneNumberId);
}

function isMessengerConfigured() {
  return Boolean(metaConfig().pageAccessToken);
}

function verifyWebhookChallenge(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = metaConfig().verifyToken;

  if (mode === 'subscribe' && token && expected && token === expected) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

function verifySignature(req) {
  const secret = metaConfig().appSecret;
  if (!secret) return true;
  const sig = req.get('X-Hub-Signature-256') || '';
  const raw = req.rawBody;
  if (!sig || !raw || !Buffer.isBuffer(raw)) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function graphPost(path, body, accessToken) {
  const token = accessToken || metaConfig().pageAccessToken;
  if (!token) throw new Error('Meta access token not configured');

  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data.error && data.error.message) || res.statusText || 'Meta API error';
    throw new Error(msg);
  }
  return data;
}

async function graphGet(path, accessToken) {
  const token = accessToken || metaConfig().pageAccessToken;
  if (!token) throw new Error('Meta access token not configured');

  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data.error && data.error.message) || res.statusText || 'Meta API error';
    throw new Error(msg);
  }
  return data;
}

/**
 * Download WhatsApp media by Meta media ID (document / image / video / audio).
 * @param {string} mediaId
 * @param {{ phoneNumberId?: string }} [opts] — webhook metadata.phone_number_id
 * @returns {Promise<{ buffer: Buffer, mimetype: string, fileSize?: number }>}
 */
async function downloadWhatsAppMedia(mediaId, opts = {}) {
  const c = metaConfig();
  if (!c.whatsappToken && !c.pageAccessToken) {
    throw new Error('WhatsApp token not configured');
  }
  const id = String(mediaId || '').trim();
  if (!id) throw new Error('WhatsApp media id required');

  const tokens = resolveWhatsAppTokens(opts);
  const phoneIds = phoneNumberIdVariants(opts);
  if (
    opts &&
    opts.phoneNumberId &&
    c.whatsappPhoneNumberId &&
    String(opts.phoneNumberId).trim() !== String(c.whatsappPhoneNumberId).trim()
  ) {
    console.warn('[meta-shared] WhatsApp phone_number_id mismatch', {
      webhook: opts.phoneNumberId,
      env: c.whatsappPhoneNumberId,
    });
  }

  let lastError = null;
  for (const delayMs of MEDIA_DOWNLOAD_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);

    let metaRes = null;
    let phoneNumberIdUsed = '';
    for (const token of tokens) {
      for (const phoneNumberId of phoneIds) {
        try {
          const fetched = await fetchMediaMetadata(id, token, phoneNumberId);
          metaRes = fetched.metaRes;
          phoneNumberIdUsed = fetched.phoneNumberIdUsed;
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (metaRes) break;
    }

    const url = metaRes && metaRes.url ? String(metaRes.url).trim() : '';
    if (!url) continue;

    let cdnHost = '';
    try {
      cdnHost = new URL(url).hostname;
    } catch {
      cdnHost = 'unknown';
    }
    console.log('[meta-shared] WhatsApp media metadata ok', {
      mediaId: id,
      phoneNumberId: phoneNumberIdUsed,
      mime: metaRes.mime_type || '',
      fileSize: metaRes.file_size || 0,
      cdnHost,
      delayMs,
    });

    for (const cdnToken of tokens) {
      try {
        const binRes = await fetchWhatsAppMediaBinary(url, cdnToken);
        const buffer = binRes.buffer;
        if (!buffer.length) throw new Error('WhatsApp media empty');

        console.log('[meta-shared] WhatsApp media downloaded', {
          mediaId: id,
          bytes: buffer.length,
          delayMs,
        });

        return {
          buffer,
          mimetype:
            (metaRes.mime_type && String(metaRes.mime_type).trim()) ||
            binRes.headers['content-type'] ||
            'application/octet-stream',
          fileSize: Number(metaRes.file_size) || buffer.length,
        };
      } catch (err) {
        lastError = err;
        console.warn('[meta-shared] WhatsApp CDN attempt failed', {
          mediaId: id,
          delayMs,
          error: err.message,
        });
      }
    }
  }

  const msg =
    lastError && lastError.message
      ? lastError.message
      : 'WhatsApp media download failed';
  if (/500|HTML|axios|https|curl/i.test(msg)) {
    throw new Error(
      `${msg} — if this persists, replace WHATSAPP_TOKEN with a permanent System User token from Meta Business Settings (whatsapp_business_messaging permission).`
    );
  }
  throw lastError || new Error(msg);
}

/**
 * Desk diagnostic — metadata + CDN steps without exposing the token.
 */
async function inspectWhatsAppMediaDownload(mediaId, opts = {}) {
  const c = metaConfig();
  const id = String(mediaId || '').trim();
  const phoneNumberId = String(
    (opts && opts.phoneNumberId) || c.whatsappPhoneNumberId || ''
  ).trim();
  const out = {
    ok: false,
    configured: isWhatsAppConfigured(),
    tokenSet: Boolean(c.whatsappToken),
    phoneNumberIdEnv: c.whatsappPhoneNumberId || '',
    phoneNumberIdUsed: phoneNumberId,
    mediaId: id,
    steps: {},
  };
  if (!id) {
    out.error = 'media_id_required';
    return out;
  }
  if (!out.configured) {
    out.steps.config = { ok: false, error: 'whatsapp_not_configured' };
    out.error = 'whatsapp_not_configured';
    return out;
  }
  try {
    const metaPath = mediaMetadataPath(id, phoneNumberId);
    const metaRes = await graphGet(metaPath, c.whatsappToken);
    let cdnHost = '';
    try {
      cdnHost = new URL(metaRes.url).hostname;
    } catch {
      cdnHost = '';
    }
    out.steps.metadata = {
      ok: true,
      mime: metaRes.mime_type || '',
      fileSize: metaRes.file_size || 0,
      cdnHost,
    };
    const binRes = await fetchWhatsAppMediaBinary(metaRes.url, c.whatsappToken);
    out.steps.cdn = { ok: true, bytes: binRes.buffer.length };
    out.ok = true;
    return out;
  } catch (err) {
    const msg = err.message || String(err);
    if (!out.steps.metadata) {
      out.steps.metadata = { ok: false, error: msg };
    } else if (!out.steps.cdn) {
      out.steps.cdn = { ok: false, error: msg };
    }
    out.error = msg;
    return out;
  }
}

async function sendWhatsAppPayload(to, payload) {
  const c = metaConfig();
  if (!isWhatsAppConfigured()) throw new Error('WhatsApp not configured');
  return graphPost(
    `/${c.whatsappPhoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: String(to).replace(/\D/g, ''),
      ...payload,
    },
    c.whatsappToken
  );
}

async function sendWhatsAppText(to, text) {
  const body = text == null ? '' : String(text).trim();
  if (!body) return null;
  return sendWhatsAppPayload(to, {
    type: 'text',
    text: { body: body.slice(0, 4096) },
  });
}

async function sendMessengerText(recipientId, text) {
  if (!isMessengerConfigured()) throw new Error('Messenger not configured');
  const body = text == null ? '' : String(text).trim();
  if (!body) return null;
  return sendMessengerPayload(recipientId, { text: body.slice(0, 2000) });
}

async function sendMessengerPayload(recipientId, message, accessToken) {
  if (!isMessengerConfigured() && !accessToken) {
    throw new Error('Messenger not configured');
  }
  const msg = message && typeof message === 'object' ? message : {};
  if (!Object.keys(msg).length) return null;
  return graphPost(
    '/me/messages',
    {
      recipient: { id: String(recipientId) },
      message: msg,
    },
    accessToken
  );
}

function resolveMessengerTokens(opts = {}) {
  const c = metaConfig();
  const tokens = [];
  try {
    const social = require('../social-integration-store');
    const botId = String((opts && opts.botId) || '10002').trim();
    for (const ch of ['instagram', 'facebook']) {
      const cfg = social.readChannelConfig(botId, ch);
      const prov =
        cfg && cfg.providers && cfg.providers.meta ? cfg.providers.meta : null;
      if (prov && prov.pageAccessToken) {
        tokens.push(String(prov.pageAccessToken).trim());
      }
    }
  } catch {
    /* ignore */
  }
  if (c.pageAccessToken) tokens.push(String(c.pageAccessToken).trim());
  return uniqueStrings(tokens);
}

/**
 * Download attachment from Messenger / Instagram webhook payload_url.
 * @param {string} url
 * @param {{ botId?: string }} [opts]
 */
async function downloadMessengerAttachment(url, opts = {}) {
  const mediaUrl = String(url || '').trim();
  if (!mediaUrl) throw new Error('Messenger attachment URL missing');

  const tokens = resolveMessengerTokens(opts);
  if (!tokens.length) throw new Error('Messenger token not configured');

  let lastError = null;
  for (const delayMs of MEDIA_DOWNLOAD_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    for (const token of tokens) {
      try {
        const binRes = await fetchWhatsAppMediaBinary(mediaUrl, token);
        const buffer = binRes.buffer;
        if (!buffer.length) throw new Error('Messenger attachment empty');
        return {
          buffer,
          mimetype:
            (binRes.headers['content-type'] &&
              String(binRes.headers['content-type']).split(';')[0].trim()) ||
            'application/octet-stream',
          fileSize: buffer.length,
        };
      } catch (err) {
        lastError = err;
      }
    }
  }

  const msg =
    lastError && lastError.message
      ? lastError.message
      : 'Messenger attachment download failed';
  throw new Error(
    `${msg} — verify FB_PAGE_ACCESS_TOKEN is a permanent Page token with pages_messaging permission.`
  );
}

module.exports = {
  metaConfig,
  isWhatsAppConfigured,
  isMessengerConfigured,
  verifyWebhookChallenge,
  verifySignature,
  graphGet,
  downloadWhatsAppMedia,
  downloadMessengerAttachment,
  inspectWhatsAppMediaDownload,
  resolveMessengerTokens,
  sendWhatsAppText,
  sendWhatsAppPayload,
  sendMessengerText,
  sendMessengerPayload,
};
