/**
 * Read default API base URL: env (Railway) first, then api-base.config.js at repo root / app root.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname_lib = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} raw */
function trimUrl_(raw) {
    return String(raw || "")
        .trim()
        .replace(/\/+$/, "");
}

/** @returns {string} */
function fromEnv_() {
    for (const key of [
        "CONVERSATIONS_PUBLIC_BASE_URL",
        "PUBLIC_BASE_URL",
        "DASHBOARD_PUBLIC_BASE_URL"
    ]) {
        const v = trimUrl_(process.env[key]);
        if (v) {
            return v;
        }
    }
    const railway = trimUrl_(process.env.RAILWAY_PUBLIC_DOMAIN);
    if (railway) {
        return `https://${railway.replace(/^https?:\/\//i, "")}`;
    }
    const staticUrl = trimUrl_(process.env.RAILWAY_STATIC_URL);
    if (staticUrl) {
        return staticUrl;
    }
    return "";
}

/** @returns {string} */
function fromConfigFile_() {
    const candidates = [
        path.resolve(process.cwd(), "api-base.config.js"),
        path.resolve(process.cwd(), "..", "api-base.config.js"),
        path.resolve(process.cwd(), "..", "..", "api-base.config.js"),
        path.resolve(__dirname_lib, "..", "api-base.config.js"),
        path.resolve(__dirname_lib, "..", "..", "..", "api-base.config.js")
    ];
    for (const filePath of candidates) {
        try {
            if (!fs.existsSync(filePath)) {
                continue;
            }
            const raw = fs.readFileSync(filePath, "utf8");
            const m = raw.match(/COMPANY_DEFAULT_API_BASE_URL\s*=\s*["']([^"']+)["']/);
            if (m && m[1]) {
                return trimUrl_(m[1]);
            }
        } catch {
            /* try next path */
        }
    }
    return "";
}

let cached_ = "";

/** @returns {string} */
export function defaultApiBaseUrl_() {
    if (cached_) {
        return cached_;
    }
    cached_ = fromEnv_() || fromConfigFile_();
    return cached_;
}
