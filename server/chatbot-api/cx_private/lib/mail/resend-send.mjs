/**
 * Resend HTTPS API mail sender.
 *
 * Use case: Railway Free / Trial / Hobby plans block outbound SMTP. Resend is
 * an HTTPS-based transactional email API, so it works on all Railway tiers.
 *
 * Required env:
 *   RESEND_API_KEY               API key from https://resend.com/api-keys
 *
 * Optional env:
 *   RESEND_FROM                  Override "from" address (e.g. "onboarding@resend.dev"
 *                                while testing without a verified domain).
 *   RESEND_BASE_URL              Default "https://api.resend.com" — override for sandbox.
 *   RESEND_SEND_TIMEOUT_MS       Default 25000 (5..120000).
 *
 * Test-mode quirk: Until you verify your sending domain in Resend, the API
 * will refuse to deliver to recipients other than the email you signed up
 * with. The exact error is surfaced to the caller; the dashboard route logs
 * it and falls back to printing the magic link.
 */

const LOG_TAG = "[resend]";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function envInt_(key, fallback, min, max) {
    const raw = trim_(process.env[key]);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    const c = Math.round(n);
    if (Number.isFinite(min) && c < min) return min;
    if (Number.isFinite(max) && c > max) return max;
    return c;
}

export function isResendConfigured_() {
    return !!trim_(process.env.RESEND_API_KEY);
}

/** Default sender — RESEND_FROM wins, else MAIL_FROM, else Resend's onboarding alias. */
export function resendFromAddress_() {
    return (
        trim_(process.env.RESEND_FROM) ||
        trim_(process.env.MAIL_FROM) ||
        trim_(process.env.SMTP_USER) ||
        "onboarding@resend.dev"
    );
}

function toArray_(v) {
    if (v == null || v === "") return [];
    if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
    if (typeof v === "object" && v.address) return [String(v.address)];
    return [];
}

function pickAddress_(v, fallback) {
    if (!v) return fallback;
    if (typeof v === "string") return v;
    if (typeof v === "object" && v.address) {
        const name = v.name ? `${v.name} <${v.address}>` : v.address;
        return name;
    }
    return fallback;
}

/**
 * Send one email via the Resend HTTPS API.
 *
 * Accepts the same shape as nodemailer's `transport.sendMail(opts)` for the
 * common fields used in this codebase (from, to, cc, bcc, replyTo, subject,
 * html, text). Attachments are forwarded as base64-encoded blobs.
 *
 * @param {{
 *   from?: string | { address: string, name?: string },
 *   to: string | string[] | { address: string }[],
 *   cc?: string | string[],
 *   bcc?: string | string[],
 *   replyTo?: string,
 *   subject: string,
 *   text?: string,
 *   html?: string,
 *   attachments?: Array<{ filename: string, content: Buffer | string, contentType?: string, encoding?: string }>
 * }} opts
 */
export async function sendViaResend_(opts) {
    const apiKey = trim_(process.env.RESEND_API_KEY);
    if (!apiKey) {
        throw new Error("RESEND_API_KEY not configured");
    }
    if (!apiKey.startsWith("re_")) {
        console.warn(
            LOG_TAG,
            "RESEND_API_KEY should start with \"re_\" (create one at https://resend.com/api-keys ). This value looks wrong — sends will usually fail with 401."
        );
    }
    const baseUrl = (trim_(process.env.RESEND_BASE_URL) || "https://api.resend.com").replace(/\/+$/, "");
    const timeoutMs = envInt_("RESEND_SEND_TIMEOUT_MS", 25000, 5000, 120000);

    const fromAddr = pickAddress_(opts && opts.from, resendFromAddress_());
    const to = toArray_(opts && opts.to);
    if (!to.length) {
        throw new Error("Resend send: at least one 'to' recipient is required");
    }
    /** @type {Record<string, unknown>} */
    const body = {
        from: fromAddr,
        to,
        subject: trim_(opts && opts.subject)
    };
    const cc = toArray_(opts && opts.cc);
    if (cc.length) body.cc = cc;
    const bcc = toArray_(opts && opts.bcc);
    if (bcc.length) body.bcc = bcc;
    const replyTo = trim_(opts && opts.replyTo);
    if (replyTo) body.reply_to = replyTo;
    if (typeof opts.html === "string" && opts.html) body.html = opts.html;
    if (typeof opts.text === "string" && opts.text) body.text = opts.text;

    if (Array.isArray(opts && opts.attachments) && opts.attachments.length) {
        body.attachments = opts.attachments.map((a) => {
            /** @type {Buffer} */
            let buf;
            if (Buffer.isBuffer(a.content)) {
                buf = a.content;
            } else if (typeof a.content === "string") {
                const enc = (a.encoding || "utf8").toLowerCase();
                buf = enc === "base64" ? Buffer.from(a.content, "base64") : Buffer.from(a.content, /** @type {BufferEncoding} */ (enc));
            } else {
                buf = Buffer.from(String(a.content == null ? "" : a.content));
            }
            return {
                filename: String(a.filename || "attachment"),
                content: buf.toString("base64")
            };
        });
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let resp;
    try {
        resp = await fetch(`${baseUrl}/emails`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            signal: ac.signal
        });
    } catch (err) {
        clearTimeout(timer);
        const msg = err && err.message ? err.message : String(err);
        if (err && err.name === "AbortError") {
            throw new Error(`Resend send timed out after ${timeoutMs}ms`);
        }
        throw new Error(`Resend network error: ${msg}`);
    }
    clearTimeout(timer);

    /** @type {unknown} */
    let data = null;
    try {
        data = await resp.json();
    } catch {
        /* keep null */
    }

    if (!resp.ok) {
        const d = /** @type {Record<string, unknown> | null} */ (data);
        const remote =
            (d && typeof d.message === "string" && d.message) ||
            (d && typeof d.error === "string" && d.error) ||
            `HTTP ${resp.status}`;
        const isTestMode = /testing emails to your own email|verify a domain/i.test(remote);
        const hint = isTestMode
            ? " (Resend test mode — verify a domain at https://resend.com/domains, or set RESEND_FROM=onboarding@resend.dev and only send to your signed-up email)"
            : "";
        const err = new Error(`Resend send failed: ${remote}${hint}`);
        /** @type {{ status?: number, body?: unknown }} */ (err).status = resp.status;
        /** @type {{ status?: number, body?: unknown }} */ (err).body = data;
        throw err;
    }

    const ok = /** @type {{ id?: string } | null} */ (data);
    if (trim_(process.env.RESEND_DEBUG) === "1") {
        console.log(LOG_TAG, "send ok", ok && ok.id ? ok.id : "(no id)", "to:", to.join(","));
    }
    return { ok: true, id: (ok && ok.id) || "" };
}
