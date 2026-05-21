/**
 * Download YouTube as MP4 for WhatsApp native video (yt-dlp on server, youtubei.js fallback).
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Innertube, Platform } from "youtubei.js";

export const WA_VIDEO_MAX_BYTES = 16 * 1024 * 1024;

function trim_(v) {
    return (v == null ? "" : String(v)).trim();
}

/** @param {string} id */
export function isValidYoutubeVideoId_(id) {
    return /^[\w-]{11}$/.test(trim_(id));
}

/**
 * @param {string} videoId
 * @param {string} baseUrl
 */
export function youtubeMp4ProxyUrl_(videoId, baseUrl) {
    const base = trim_(baseUrl).replace(/\/+$/, "");
    const id = trim_(videoId);
    return `${base}/api/whatsapp/media/youtube/${encodeURIComponent(id)}.mp4`;
}

let youtubeiEvalReady_ = false;

function ensureYoutubeiEval_() {
    if (!youtubeiEvalReady_) {
        Platform.shim.eval = async (data) => new Function(data.output)();
        youtubeiEvalReady_ = true;
    }
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} timeoutMs
 */
function runCommand_(cmd, args, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
        /** @type {Buffer[]} */
        const outChunks = [];
        /** @type {Buffer[]} */
        const errChunks = [];
        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        proc.stdout.on("data", (chunk) => outChunks.push(chunk));
        proc.stderr.on("data", (chunk) => errChunks.push(chunk));
        proc.on("error", (err) => {
            clearTimeout(timer);
            const code = err && typeof err === "object" && "code" in err ? err.code : "";
            if (code === "ENOENT") {
                reject(new Error(`${cmd} is not installed`));
                return;
            }
            reject(err);
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            const stdout = Buffer.concat(outChunks);
            const stderr = Buffer.concat(errChunks).toString("utf8");
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`));
        });
    });
}

/**
 * @param {string} watchUrl
 * @param {number} maxBytes
 */
async function downloadViaYtDlpFile_(watchUrl, maxBytes) {
    const dir = await mkdtemp(path.join(tmpdir(), "wa-vid-"));
    const outTemplate = path.join(dir, "video.%(ext)s");
    try {
        await runCommand_("yt-dlp", [
            watchUrl,
            "-f",
            "b[ext=mp4]/b/best[height<=480][ext=mp4]/best[height<=480]",
            "--merge-output-format",
            "mp4",
            "--max-filesize",
            String(Math.floor(maxBytes * 0.98)),
            "--no-playlist",
            "--no-warnings",
            "--no-part",
            "-o",
            outTemplate
        ]);
        const files = await readdir(dir);
        const mp4Name = files.find((f) => f.endsWith(".mp4"));
        if (!mp4Name) {
            throw new Error("yt-dlp produced no mp4 file");
        }
        const buf = await readFile(path.join(dir, mp4Name));
        if (buf.length > maxBytes) {
            throw new Error("Video exceeds WhatsApp 16 MB limit");
        }
        if (buf.length < 2048) {
            throw new Error("yt-dlp output too small");
        }
        return buf;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/**
 * @param {string} watchUrl
 * @param {number} maxBytes
 */
async function downloadViaYtDlpStdout_(watchUrl, maxBytes) {
    const { stdout } = await runCommand_("yt-dlp", [
        watchUrl,
        "-f",
        "b[ext=mp4]/b/best[height<=480][ext=mp4]/best[height<=480]",
        "--merge-output-format",
        "mp4",
        "--max-filesize",
        String(Math.floor(maxBytes * 0.98)),
        "--no-playlist",
        "--no-warnings",
        "-o",
        "-"
    ]);
    if (stdout.length > maxBytes) {
        throw new Error("Video exceeds WhatsApp 16 MB limit");
    }
    if (stdout.length < 2048) {
        throw new Error("yt-dlp stdout too small");
    }
    return stdout;
}

/**
 * @param {string} videoId
 * @param {number} maxBytes
 */
async function downloadViaYoutubei_(videoId, maxBytes) {
    ensureYoutubeiEval_();
    const yt = await Innertube.create();
    const info = await yt.getInfo(videoId);
    const stream = await info.download({
        quality: "360p",
        type: "video+audio",
        format: "mp4"
    });
    const reader = stream.getReader();
    /** @type {Buffer[]} */
    const chunks = [];
    let bytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        bytes += value.length;
        if (bytes > maxBytes) {
            throw new Error("Video exceeds WhatsApp 16 MB limit");
        }
        chunks.push(Buffer.from(value));
    }
    const buf = Buffer.concat(chunks);
    if (buf.length < 2048) {
        throw new Error("youtubei.js download too small");
    }
    return buf;
}

/**
 * @param {string} videoId
 * @param {number} [maxBytes]
 * @returns {Promise<Buffer>}
 */
export async function downloadYoutubeMp4Buffer_(videoId, maxBytes = WA_VIDEO_MAX_BYTES) {
    const id = trim_(videoId);
    if (!isValidYoutubeVideoId_(id)) {
        throw new Error("Invalid YouTube video id");
    }
    const watchUrl = `https://www.youtube.com/watch?v=${id}`;
    /** @type {Error[]} */
    const errors = [];

    try {
        return await downloadViaYtDlpFile_(watchUrl, maxBytes);
    } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
    }

    try {
        return await downloadViaYtDlpStdout_(watchUrl, maxBytes);
    } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
    }

    try {
        return await downloadViaYoutubei_(id, maxBytes);
    } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
    }

    const detail = errors.map((err) => err.message).join(" | ").slice(0, 400);
    throw new Error(`YouTube download failed: ${detail}`);
}

/**
 * @param {string} videoId
 * @param {import("express").Response} res
 */
export async function streamYoutubeMp4ToResponse_(videoId, res) {
    const id = trim_(videoId);
    if (!isValidYoutubeVideoId_(id)) {
        res.status(400).json({ ok: false, error: "Invalid YouTube video id" });
        return;
    }

    const watchUrl = `https://www.youtube.com/watch?v=${id}`;
    try {
        const proc = spawn("yt-dlp", [
            watchUrl,
            "-f",
            "b[ext=mp4]/b/best[height<=480][ext=mp4]/best[height<=480]",
            "--merge-output-format",
            "mp4",
            "--max-filesize",
            String(Math.floor(WA_VIDEO_MAX_BYTES * 0.98)),
            "--no-playlist",
            "--no-warnings",
            "-o",
            "-"
        ]);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Cache-Control", "public, max-age=3600");
        let bytes = 0;
        proc.stdout.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > WA_VIDEO_MAX_BYTES) {
                proc.kill("SIGKILL");
                if (!res.headersSent) {
                    res.status(413).end();
                } else {
                    res.end();
                }
                return;
            }
            res.write(chunk);
        });
        proc.stderr.on("data", () => {});
        proc.on("error", async () => {
            try {
                const buf = await downloadYoutubeMp4Buffer_(id);
                if (!res.headersSent) {
                    res.setHeader("Content-Length", String(buf.length));
                }
                res.end(buf);
            } catch (e) {
                if (!res.headersSent) {
                    res.status(502).json({
                        ok: false,
                        error: "Could not stream YouTube video",
                        detail: e && e.message ? String(e.message).slice(0, 160) : String(e)
                    });
                }
            }
        });
        proc.on("close", (code) => {
            if (code === 0) {
                res.end();
                return;
            }
            if (!res.headersSent) {
                downloadYoutubeMp4Buffer_(id)
                    .then((buf) => {
                        res.setHeader("Content-Length", String(buf.length));
                        res.end(buf);
                    })
                    .catch((e) => {
                        res.status(502).json({
                            ok: false,
                            error: "Could not stream YouTube video",
                            detail: e && e.message ? String(e.message).slice(0, 160) : String(e)
                        });
                    });
            }
        });
    } catch (e) {
        try {
            const buf = await downloadYoutubeMp4Buffer_(id);
            res.setHeader("Content-Type", "video/mp4");
            res.setHeader("Content-Length", String(buf.length));
            res.end(buf);
        } catch (err) {
            res.status(502).json({
                ok: false,
                error: "Could not stream YouTube video",
                detail: err && err.message ? String(err.message).slice(0, 160) : String(err)
            });
        }
    }
}
