/**
 * Optional: mirror dashboard "Make live" into one JSON file on GitHub (Contents API — same commit/push UX as editing in repo).
 * Env (all required to enable publish):
 *   GITHUB_WIDGET_PUBLISH_TOKEN=fine‑grained or classic PAT — repo Contents read/write on target branch
 *   GITHUB_WIDGET_PUBLISH_OWNER=owner
 *   GITHUB_WIDGET_PUBLISH_REPO=repo
 * Branch / path defaults:
 *   GITHUB_WIDGET_PUBLISH_BRANCH   main
 *   GITHUB_WIDGET_PUBLISH_PATH     published-widget-settings.json
 *
 * Format written to repo: { version: 1, bots: { "<botId>": { flat, advancedPatchJson, updatedAt } } }
 */

/** @typedef {{ flat: Record<string, unknown>, advancedPatchJson?: string }} BotRow */

const SCHEMA_VER = 1;

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

export function githubWidgetPublishConfigured_() {
    const token = trim_(process.env.GITHUB_WIDGET_PUBLISH_TOKEN);
    const owner = trim_(process.env.GITHUB_WIDGET_PUBLISH_OWNER);
    const repo = trim_(process.env.GITHUB_WIDGET_PUBLISH_REPO);
    return Boolean(token && owner && repo);
}

function ghHeaders_(token) {
    return {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "chatbot-dashboard-widget-publish",
        "X-GitHub-Api-Version": "2022-11-28"
    };
}

/**
 * Upsert bots map for one bot — merge with existing repo file when present.
 * @param {{
 *   botid: string,
 *   flat: Record<string, unknown>,
 *   advancedPatchJson: string,
 *   updatedBy: string,
 * }} arg
 */
export async function publishWidgetBotToGithub_(arg) {
    if (!githubWidgetPublishConfigured_()) {
        return { skipped: true, reason: "not_configured" };
    }

    const token = trim_(process.env.GITHUB_WIDGET_PUBLISH_TOKEN);
    const owner = trim_(process.env.GITHUB_WIDGET_PUBLISH_OWNER);
    const repo = trim_(process.env.GITHUB_WIDGET_PUBLISH_REPO);
    const branch = trim_(process.env.GITHUB_WIDGET_PUBLISH_BRANCH) || "main";
    const pathRel = trim_(process.env.GITHUB_WIDGET_PUBLISH_PATH) || "published-widget-settings.json";

    const encodedPath = encodeURIComponent(pathRel.replace(/\\/g, "/")).replace(/%2F/g, "/");
    const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;

    /** @type {{ version?: number, bots?: Record<string, BotRow & { updatedAt?: string | null }> }} */
    let root = { version: SCHEMA_VER, bots: {} };
    /** @type {string | undefined} */
    let existingSha;

    const getResp = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
        headers: ghHeaders_(token)
    });

    if (getResp.ok) {
        const meta = await getResp.json();
        if (meta && typeof meta.content === "string" && typeof meta.sha === "string") {
            existingSha = meta.sha;
            try {
                const raw = Buffer.from(String(meta.content).replace(/\s/g, ""), "base64").toString("utf8");
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    const bots = parsed.bots && typeof parsed.bots === "object" ? parsed.bots : {};
                    root = { version: SCHEMA_VER, bots };
                }
            } catch {
                root = { version: SCHEMA_VER, bots: {} };
            }
        }
    } else if (getResp.status !== 404) {
        const t = await getResp.text();
        throw new Error(`GitHub read ${pathRel}: HTTP ${getResp.status} ${t.slice(0, 200)}`);
    }

    if (!root.bots || typeof root.bots !== "object") root.bots = {};
    root.version = SCHEMA_VER;
    root.bots[arg.botid] = {
        flat: arg.flat && typeof arg.flat === "object" ? arg.flat : {},
        advancedPatchJson: typeof arg.advancedPatchJson === "string" ? arg.advancedPatchJson : "",
        updatedAt: new Date().toISOString(),
        updatedBy: trim_(arg.updatedBy)
    };

    const bodyUtf8 = `${JSON.stringify(root, null, 2)}\n`;
    const payload = {
        message: `chatbot dashboard: publish widget settings (bot ${arg.botid})`,
        content: Buffer.from(bodyUtf8, "utf8").toString("base64"),
        branch
    };
    if (existingSha) {
        payload.sha = existingSha;
    }

    const putResp = await fetch(base, {
        method: "PUT",
        headers: { ...ghHeaders_(token), "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!putResp.ok) {
        const t = await putResp.text();
        throw new Error(`GitHub write ${pathRel}: HTTP ${putResp.status} ${t.slice(0, 200)}`);
    }

    return {
        skipped: false,
        path: pathRel,
        branch,
        repo: `${owner}/${repo}`
    };
}
