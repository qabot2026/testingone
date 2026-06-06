/**
 * Railway API base URL — edit this file (no trailing slash).
 * GitHub Pages / chat-frame load this copy from repo root.
 * Railway Docker uses server/chatbot-api/api-base.config.js — keep both identical.
 *
 * Production override (optional): set CONVERSATIONS_PUBLIC_BASE_URL or
 * PUBLIC_BASE_URL on Railway — env wins over this file.
 */
(function (global) {
  global.COMPANY_DEFAULT_API_BASE_URL =
    "https://cxchatbot.up.railway.app";
})(typeof window !== "undefined" ? window : globalThis);
