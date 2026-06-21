/**
 * Register Meta webhook routes — one URL for all channels, plus per-channel aliases.
 *
 * Meta App Dashboard callback URL:
 *   https://YOUR_DOMAIN/webhooks/meta
 */

const express = require('express');
const meta = require('./meta-shared');
const whatsapp = require('./whatsapp');
const instagram = require('./instagram');
const facebook = require('./facebook');

const rawJson = express.raw({ type: 'application/json', limit: '512kb' });

function parseRawBody(req, res, next) {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }
  }
  next();
}

function verifyGet(req, res) {
  return meta.verifyWebhookChallenge(req, res);
}

async function dispatchPost(req, res) {
  if (!meta.verifySignature(req)) {
    console.warn('[webhooks] invalid Meta signature');
    return res.sendStatus(403);
  }

  const body = req.body || {};
  try {
    const wa = await whatsapp.processWebhookPayload(body);
    const ig = await instagram.processWebhookPayload(body);
    const fb = await facebook.processWebhookPayload(body);
    const total = (wa.count || 0) + (ig.count || 0) + (fb.count || 0);
    if (total > 0) {
      console.log(
        '[webhooks] processed — wa:',
        wa.count,
        'ig:',
        ig.count,
        'fb:',
        fb.count
      );
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhooks]', err.message);
    res.sendStatus(200);
  }
}

function mountWebhook(app, path) {
  app.get(path, verifyGet);
  app.post(path, rawJson, parseRawBody, dispatchPost);
}

function registerRoutes(app) {
  const paths = [
    '/webhooks/meta',
    '/webhooks/whatsapp',
    '/webhooks/instagram',
    '/webhooks/facebook',
  ];
  for (const p of paths) {
    mountWebhook(app, p);
  }

  app.get('/api/channels/status', (_req, res) => {
    res.json({
      integrationsDir: 'es_private/client-based/integrations',
      whatsapp: {
        enabled: whatsapp.enabled,
        configured: whatsapp.isConfigured(),
        sessionPrefix: whatsapp.sessionPrefix,
      },
      instagram: {
        enabled: instagram.enabled,
        configured: instagram.isConfigured(),
        sessionPrefix: instagram.sessionPrefix,
      },
      facebook: {
        enabled: facebook.enabled,
        configured: facebook.isConfigured(),
        sessionPrefix: facebook.sessionPrefix,
      },
      webSessionPrefix: 'web-',
      webhookUrl: '/webhooks/meta',
    });
  });
}

module.exports = {
  registerRoutes,
};
