/**
 * Railway API base URL — change ONLY here (no trailing slash).
 * Used by: company-loader.js, chat-frame.html, server fallbacks.
 *
 * Production override (optional): set CONVERSATIONS_PUBLIC_BASE_URL or
 * PUBLIC_BASE_URL on Railway — env wins over this file.
 *
 * Keep in sync with repo-root api-base.config.js (GitHub Pages static host).
 */
(function (global) {
  global.COMPANY_DEFAULT_API_BASE_URL =
    "https://cxchatbot.up.railway.app";
})(typeof window !== "undefined" ? window : globalThis);
