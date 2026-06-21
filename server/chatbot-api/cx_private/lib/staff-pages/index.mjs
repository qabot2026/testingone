/**
 * Staff dashboard pages — routes aligned with "Only for Refer" (DF CX reference), ES backend.
 * Static assets: /dashboard/*, /uc-conversations, /ua-conversations, /qa, /live-agent/*
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import express from "express";

import { liveAgentSecretFromReq_ } from "../live-agent/auth.mjs";
import { listInbox_ } from "../live-agent/store.mjs";
import { probeSheetsSpreadsheetAccess } from "../sheets.mjs";

const LOG_TAG = "[staff-pages]";
const __dirname_lib = path.dirname(fileURLToPath(import.meta.url));
const REFER_STAFF_DIR = path.resolve(__dirname_lib, "..", "refer-staff");
const requireRefer = createRequire(pathToFileURL(path.join(REFER_STAFF_DIR, "package.json")));

/** Lazy-load refer-compatible CJS modules (copied from Only for Refer/lib). */
function referMod_(name) {
    return requireRefer(path.join(REFER_STAFF_DIR, name));
}

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function setNoCache_(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
}

function setConversationsSheetCors_(req, res) {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Conversations-Sheet-Secret, X-Agent-Token, X-Desk-Token"
    );
}

/** Same auth as /conversations-sheet and live-agent desk. */
function requireDeskAuth_(req, res, next) {
    const check = liveAgentSecretFromReq_(req);
    const secretConfigured = !!trim_(process.env.CONVERSATIONS_SHEET_VIEW_SECRET);
    if (!secretConfigured) {
        res.status(503).json({
            ok: false,
            error: "Server has no CONVERSATIONS_SHEET_VIEW_SECRET."
        });
        return;
    }
    if (!check.ok) {
        res.status(401).json({
            ok: false,
            error:
                check.reason === "bad"
                    ? "Unauthorized — secret does not match CONVERSATIONS_SHEET_VIEW_SECRET."
                    : "Unauthorized — use X-Conversations-Sheet-Secret or desk token."
        });
        return;
    }
    next();
}

function requireConversationsViewer_(req, res, opts = {}) {
    const check = liveAgentSecretFromReq_(req);
    const secretConfigured = !!trim_(process.env.CONVERSATIONS_SHEET_VIEW_SECRET);
    if (!secretConfigured) {
        res.status(503).json({
            ok: false,
            error: "Server has no CONVERSATIONS_SHEET_VIEW_SECRET."
        });
        return false;
    }
    if (!check.ok) {
        res.status(401).json({
            ok: false,
            error: "Unauthorized — use X-Conversations-Sheet-Secret or desk token."
        });
        return false;
    }
    if (!opts.allowWithoutSheet) {
        const sheetsId = trim_(process.env.SHEETS_SPREADSHEET_ID);
        if (!sheetsId) {
            res.status(503).json({
                ok: false,
                error: "Google Sheets not configured (SHEETS_SPREADSHEET_ID)."
            });
            return false;
        }
    }
    return true;
}

function parseSheetListParams_(req) {
    let maxRows = 200;
    if (req.query && req.query.limit != null) {
        const n = Number.parseInt(String(req.query.limit), 10);
        if (Number.isFinite(n) && n >= 5 && n <= 500) maxRows = n;
    }
    let offset = 0;
    if (req.query && req.query.offset != null) {
        const o = Number.parseInt(String(req.query.offset), 10);
        if (Number.isFinite(o) && o >= 0 && o <= 500000) offset = o;
    }
    const rawFrom = req.query && typeof req.query.from === "string" ? req.query.from.trim() : "";
    const rawTo = req.query && typeof req.query.to === "string" ? req.query.to.trim() : "";
    const allInRange = req.query.all !== "0" && req.query.all !== "false";
    const includeStats = req.query.includeStats !== "0" && req.query.includeStats !== "false";
    return { maxRows, offset, rawFrom, rawTo, allInRange, includeStats };
}

async function analyticsSummary_() {
    const chatTranscript = referMod_("chat-transcript.js");
    let liveWaiting = 0;
    let liveActive = 0;
    try {
        const inbox = await listInbox_({ status: "all", agentEmail: "", limit: 500 });
        const rows = Array.isArray(inbox) ? inbox : [];
        for (const c of rows) {
            const st = trim_(c && c.status).toLowerCase();
            if (st === "waiting") liveWaiting += 1;
            else if (st === "active" || st === "assigned") liveActive += 1;
        }
    } catch (err) {
        console.warn(LOG_TAG, "live-agent inbox for summary:", err.message || err);
    }
    const queue = { waiting: liveWaiting, active: liveActive };
    const base = chatTranscript.getAnalyticsSummary(queue);
    let sheetsConfigured = false;
    try {
        const probe = await probeSheetsSpreadsheetAccess();
        sheetsConfigured = !!(probe && probe.ok);
    } catch {
        sheetsConfigured = !!trim_(process.env.SHEETS_SPREADSHEET_ID);
    }
    return {
        ok: true,
        sheetsConfigured,
        liveWaiting,
        liveActive,
        ...base
    };
}

/**
 * @param {import('express').Express} app
 * @param {{ conversationsSheetHtml: string, qaIndexHtml: string }} opts
 */
export function mountStaffPageRoutes(app, opts) {
    const conversationsSheetHtml = opts && opts.conversationsSheetHtml;
    const qaIndexHtml = opts && opts.qaIndexHtml;

    function sendConversationsDashboardPage_(res) {
        if (!conversationsSheetHtml) {
            res.status(404).type("text/plain").send("conversations-sheet.html missing");
            return;
        }
        setNoCache_(res);
        res.sendFile(conversationsSheetHtml);
    }

    app.get("/uc-conversations", (_req, res) => sendConversationsDashboardPage_(res));
    app.get("/ua-conversations", (_req, res) => sendConversationsDashboardPage_(res));

    app.get("/dashboard/uc-conversations", (_req, res) => sendConversationsDashboardPage_(res));
    app.get("/dashboard/ua-conversations", (_req, res) => sendConversationsDashboardPage_(res));

    app.get("/dashboard/uc-conversation", (req, res) => {
        const bid = req.query.bid;
        res.redirect(302, "/dashboard/uc-conversations" + (bid ? "?bid=" + bid : ""));
    });

    app.get("/dashboard/ua-conversation", (req, res) => {
        const bid = req.query.bid;
        res.redirect(302, "/dashboard/ua-conversations" + (bid ? "?bid=" + bid : ""));
    });

    app.get("/conversations-sheet", (req, res) => {
        const bid = req.query.bid;
        res.redirect(301, "/dashboard/uc-conversations" + (bid ? "?bid=" + bid : ""));
    });

    app.get("/conversations.html", (req, res) => {
        const bid = req.query.bid;
        res.redirect(301, "/dashboard/uc-conversations" + (bid ? "?bid=" + bid : ""));
    });

    app.get("/qa", (_req, res) => {
        res.redirect(301, "/qa/");
    });

    app.get("/qa/", (_req, res) => {
        if (!qaIndexHtml) {
            res.status(404).type("text/plain").send("qa/index.html missing");
            return;
        }
        setNoCache_(res);
        res.sendFile(qaIndexHtml);
    });

    const router = express.Router();
    router.use(express.json({ limit: "512kb" }));

    router.get("/analytics/summary", requireDeskAuth_, async (_req, res) => {
        setNoCache_(res);
        try {
            res.json(await analyticsSummary_());
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "analytics/summary:", msg);
            res.status(500).json({ ok: false, error: msg });
        }
    });

    router.get("/analytics/queries", requireDeskAuth_, (req, res) => {
        setNoCache_(res);
        try {
            const queryAnalytics = referMod_("query-analytics.js");
            res.json(
                queryAnalytics.getQueryAnalytics({
                    days: req.query.days,
                    from: req.query.from,
                    to: req.query.to,
                    limit: req.query.limit,
                    answeredPage: req.query.answeredPage,
                    unansweredPage: req.query.unansweredPage
                })
            );
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "analytics/queries:", msg);
            res.status(500).json({ ok: false, error: msg || "query_analytics_failed" });
        }
    });

    router.get("/documents/catalog", requireDeskAuth_, async (req, res) => {
        setNoCache_(res);
        try {
            const documentsCatalog = referMod_("documents-catalog.js");
            const result = await documentsCatalog.listDocumentCatalog({ limit: req.query.limit });
            if (!result.ok) {
                res.status(503).json(result);
                return;
            }
            res.json(result);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "documents/catalog:", msg);
            res.status(500).json({ ok: false, error: "catalog_failed", message: msg });
        }
    });

    router.get("/documents/download-url", requireDeskAuth_, async (req, res) => {
        setNoCache_(res);
        try {
            const documentsCatalog = referMod_("documents-catalog.js");
            const result = await documentsCatalog.getDownloadUrl(req.query.object);
            if (!result.ok) {
                const status = result.error === "not_found" ? 404 : 503;
                res.status(status).json(result);
                return;
            }
            res.json(result);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "documents/download-url:", msg);
            res.status(500).json({ ok: false, error: "download_failed", message: msg });
        }
    });

    router.get("/documents/download", requireDeskAuth_, async (req, res) => {
        setNoCache_(res);
        try {
            const documentsCatalog = referMod_("documents-catalog.js");
            const result = await documentsCatalog.streamFileDownload(req.query.object, res);
            if (!result.ok && !res.headersSent) {
                const status =
                    result.error === "not_found" ? 404 : result.error === "gcs_not_configured" ? 503 : 400;
                res.status(status).json(result);
            }
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "documents/download:", msg);
            if (!res.headersSent) {
                res.status(500).json({ ok: false, error: "download_failed", message: msg });
            }
        }
    });

    router.post("/documents/delete", requireDeskAuth_, async (req, res) => {
        setNoCache_(res);
        try {
            const documentsCatalog = referMod_("documents-catalog.js");
            const gcsObject = trim_((req.body && req.body.object) || req.query.object);
            const result = await documentsCatalog.deleteDocumentObject(gcsObject);
            if (!result.ok) {
                const status = result.error === "gcs_not_configured" ? 503 : 400;
                res.status(status).json(result);
                return;
            }
            res.json(result);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "documents/delete:", msg);
            res.status(500).json({ ok: false, error: "delete_failed", message: msg });
        }
    });

    router.get("/appointments", async (req, res) => {
        setConversationsSheetCors_(req, res);
        setNoCache_(res);
        if (!requireConversationsViewer_(req, res, { allowWithoutSheet: true })) return;
        try {
            const appointmentsView = referMod_("appointments-view.js");
            const rawFrom = req.query && typeof req.query.from === "string" ? req.query.from.trim() : "";
            const rawTo = req.query && typeof req.query.to === "string" ? req.query.to.trim() : "";
            const rawStatus = req.query && typeof req.query.status === "string" ? req.query.status.trim() : "";
            const payload = await appointmentsView.fetchAppointmentsList({
                from: rawFrom,
                to: rawTo,
                status: rawStatus
            });
            res.json(payload);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "appointments:", msg);
            res.status(500).json({ ok: false, error: msg || "appointments_failed" });
        }
    });

    router.post("/appointments/action", (req, res) => {
        setConversationsSheetCors_(req, res);
        setNoCache_(res);
        if (!requireConversationsViewer_(req, res, { allowWithoutSheet: true })) return;
        try {
            const appointmentStatus = referMod_("appointment-status-store.js");
            const chatTranscript = referMod_("chat-transcript.js");
            const body = req.body && typeof req.body === "object" ? req.body : {};
            const sessionId = trim_(body.sessionId || body.session_id);
            const action = trim_(body.action).toLowerCase();
            if (!sessionId) {
                res.status(400).json({ ok: false, error: "sessionId required" });
                return;
            }
            const formId = trim_(body.formId || body.form_id) || "appointment";
            const dateRaw = body.appointmentDate || body.appointmentdate || "";
            const timeRaw = body.appointmentTime || body.appointmenttime || "";
            const updated = appointmentStatus.applyAction({
                sessionId,
                action,
                formId,
                appointmentDate: dateRaw,
                appointmentTime: timeRaw,
                name: body.name,
                mobile: body.mobile,
                email: body.email,
                updatedBy: body.updatedBy || body.agentEmail,
                note: body.note
            });
            if (action === "accept" || action === "decline") {
                chatTranscript.mergeSessionMeta(sessionId, {
                    appointmentStatus: action === "accept" ? "accepted" : "declined"
                });
            }
            res.json({ ok: true, ...updated });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "appointments/action:", msg);
            res.status(400).json({ ok: false, error: msg });
        }
    });

    app.use("/api", router);

    app.options("/api/appointments", (req, res) => {
        setConversationsSheetCors_(req, res);
        res.sendStatus(204);
    });
    app.options("/api/appointments/action", (req, res) => {
        setConversationsSheetCors_(req, res);
        res.sendStatus(204);
    });
    app.options("/api/live-agent-sheet", (req, res) => {
        setConversationsSheetCors_(req, res);
        res.sendStatus(204);
    });
    app.options("/api/live-agent-sheet-sync", (req, res) => {
        setConversationsSheetCors_(req, res);
        res.sendStatus(204);
    });

    app.get("/api/live-agent-sheet", async (req, res) => {
        setConversationsSheetCors_(req, res);
        setNoCache_(res);
        if (!requireConversationsViewer_(req, res)) return;
        try {
            const conversationsSheetView = referMod_("conversations-sheet-view.js");
            const p = parseSheetListParams_(req);
            const payload = await conversationsSheetView.fetchLiveAgentSheetPreview({
                maxRows: p.maxRows,
                offset: p.offset,
                allInRange: p.allInRange,
                from: p.rawFrom,
                to: p.rawTo
            });
            res.json({ ok: true, ...payload });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "live-agent-sheet:", msg);
            const status = msg.includes("Invalid date parameter") ? 400 : 500;
            res.status(status).json({ ok: false, error: msg.slice(0, 500) });
        }
    });

    async function handleLiveAgentSheetSync_(req, res) {
        setConversationsSheetCors_(req, res);
        setNoCache_(res);
        if (!requireConversationsViewer_(req, res)) return;
        try {
            const liveAgentSheet = referMod_("live-agent-sheet.js");
            const q = req.query || {};
            const from = typeof q.from === "string" ? q.from.trim() : "";
            const to = typeof q.to === "string" ? q.to.trim() : "";
            const result = await liveAgentSheet.syncDashboardToSheet2(
                from || to ? { from: from || undefined, to: to || undefined } : {}
            );
            if (!result || result.ok === false) {
                res.status(503).json({
                    ok: false,
                    error: (result && result.error) || "Live agent sheet sync failed."
                });
                return;
            }
            res.json({ ok: true, ...result });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "live-agent-sheet-sync:", msg);
            const status = msg.includes("Invalid") && msg.includes("date") ? 400 : 500;
            res.status(status).json({ ok: false, error: msg.slice(0, 500) });
        }
    }

    app.get("/api/live-agent-sheet-sync", handleLiveAgentSheetSync_);
    app.post("/api/live-agent-sheet-sync", handleLiveAgentSheetSync_);

    console.log(
        LOG_TAG,
        "mounted /uc-conversations /ua-conversations /qa + staff /api/analytics/* /api/documents/* /api/appointments /api/live-agent-sheet /api/live-agent-sheet-sync"
    );
}

export { referMod_ as referStaffModule_ };

/** @returns {boolean} */
export function isQaRequest_(req, sessionId) {
    try {
        const qaMode = referMod_("qa-mode.js");
        return qaMode.isQaRequest(req, sessionId);
    } catch {
        return false;
    }
}
