/**
 * Live-agent dashboard auth — same secret as /conversations-sheet.
 * Header: X-Conversations-Sheet-Secret or Authorization: Bearer <secret>
 * Env: CONVERSATIONS_SHEET_VIEW_SECRET
 */

import crypto from "node:crypto";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function timingSafeEqStr_(a, b) {
    const ba = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

export function conversationsViewSecret_() {
    return trim_(process.env.CONVERSATIONS_SHEET_VIEW_SECRET);
}

/** @returns {{ want: string, got: string, ok: boolean, reason: "unset" | "missing" | "bad" | "ok" }} */
export function liveAgentSecretFromReq_(req) {
    const want = conversationsViewSecret_();
    if (!want) {
        return { want: "", got: "", ok: false, reason: "unset" };
    }
    const auth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    let bearer = "";
    if (/^Bearer\s+/i.test(auth)) {
        bearer = auth.replace(/^Bearer\s+/i, "").trim();
    }
    const hdr =
        (typeof req.headers["x-conversations-sheet-secret"] === "string"
            ? req.headers["x-conversations-sheet-secret"].trim()
            : "") || bearer;
    const q = req.query && typeof req.query.secret === "string" ? req.query.secret.trim() : "";
    const got = hdr || q;
    if (!got) {
        return { want, got: "", ok: false, reason: "missing" };
    }
    if (!timingSafeEqStr_(got, want)) {
        return { want, got, ok: false, reason: "bad" };
    }
    return { want, got, ok: true, reason: "ok" };
}

export function readLiveAgentSessionFromReq_(req) {
    const check = liveAgentSecretFromReq_(req);
    if (!check.ok) return null;
    const agentId = (
        trim_(req.headers["x-live-agent-email"]) ||
        trim_(req.headers["x-live-agent-name"]) ||
        trim_(process.env.LIVE_AGENT_DEFAULT_AGENT_NAME) ||
        "agent@example.com"
    ).toLowerCase();
    return { agentId };
}

export function liveAgentAuthRequired_() {
    const v = trim_(process.env.LIVE_AGENT_REQUIRE_AUTH).toLowerCase();
    if (v === "0" || v === "false" || v === "no") return false;
    return true;
}

export function requireLiveAgentSession_() {
    return (req, res, next) => {
        if (!liveAgentAuthRequired_()) {
            req.liveAgentSession = {
                agentId: trim_(process.env.LIVE_AGENT_DEV_AGENT_NAME) || "dev"
            };
            next();
            return;
        }
        const configured = conversationsViewSecret_();
        if (!configured) {
            res.status(503).json({
                ok: false,
                error:
                    "Server has no CONVERSATIONS_SHEET_VIEW_SECRET. Set it in Railway Variables (same as conversations inbox)."
            });
            return;
        }
        const sess = readLiveAgentSessionFromReq_(req);
        if (!sess) {
            const check = liveAgentSecretFromReq_(req);
            const msg =
                check.reason === "bad"
                    ? "Unauthorized — secret does not match CONVERSATIONS_SHEET_VIEW_SECRET."
                    : "Unauthorized — send header X-Conversations-Sheet-Secret matching CONVERSATIONS_SHEET_VIEW_SECRET.";
            res.status(401).json({ ok: false, error: msg });
            return;
        }
        req.liveAgentSession = sess;
        next();
    };
}

export function liveAgentAuthConfigured_() {
    return !!conversationsViewSecret_();
}
