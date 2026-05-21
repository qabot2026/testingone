/**
 * Download YouTube as H.264 MP4 for WhatsApp native in-app video player.
 * Requires yt-dlp + ffmpeg in the container (see Dockerfile).
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Innertube, Platform } from "youtubei.js";

export const WA_VIDEO_MAX_BYTES = 16 * 1024 * 1024;

/** yt-dlp format: 360p combined MP4 (itag 18) — H.264 + AAC, WhatsApp-compatible. */
const YT_DLP_FORMAT =
    "18/b[height<=360][ext=mp4][vcodec^=avc1]/b[height<=480][ext=mp4]/b[height<=480]/b";

function trim_(v) {
    return (v == null ? "" : String(v)).trim();
}

/** @param {string} id */
export function isValidYoutubeVideoId_(id) {
    return /^[\w-]{11}$/.test(trim_(id));
}

/** @returns {boolean} */
export function isYtDlpAvailable_() {
    const r = spawnSync("yt-dlp", ["--version"], { encoding: "utf8" });
    return r.status === 0;
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
function runCommand_(cmd, args, timeoutMs = 180000) {
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
            reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
        });
    });
}

/**
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} maxBytes
 */
async function compressMp4ForWhatsapp_(inputPath, outputPath, maxBytes) {
    /** Scale down long clips so they fit WhatsApp 16 MB cap. */
    await runCommand_("ffmpeg", [
        "-y",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-profile:v",
        "baseline",
        "-level",
        "3.0",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "scale='min(640,iw)':-2",
        "-b:v",
        "600k",
        "-maxrate",
        "700k",
        "-bufsize",
        "1400k",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-ac",
        "1",
        "-movflags",
        "+faststart",
        outputPath
    ]);
    const buf = await readFile(outputPath);
    if (buf.length > maxBytes) {
        throw new Error("Video still exceeds WhatsApp 16 MB after compression");
    }
    return buf;
}

/**
 * @param {string} filePath
 * @param {number} maxBytes
 */
async function readMp4MaybeCompress_(filePath, maxBytes) {
    let buf = await readFile(filePath);
    if (buf.length <= maxBytes) {
        return buf;
    }
    const dir = path.dirname(filePath);
    const compressed = path.join(dir, "compressed.mp4");
    return compressMp4ForWhatsapp_(filePath, compressed, maxBytes);
}

/**
 * @param {string} watchUrl
 * @param {number} maxBytes
 */
async function downloadViaYtDlpFile_(watchUrl, maxBytes) {
    const dir = await mkdtemp(path.join(tmpdir(), "wa-yt-"));
    const outTemplate = path.join(dir, "video.%(ext)s");
    try {
        await runCommand_("yt-dlp", [
            watchUrl,
            "-f",
            YT_DLP_FORMAT,
            "--merge-output-format",
            "mp4",
            "--postprocessor-args",
            "ffmpeg:-movflags +faststart",
            "--no-playlist",
            "--no-warnings",
            "--no-part",
            "--retries",
            "3",
            "--socket-timeout",
            "30",
            "-o",
            outTemplate
        ]);
        const files = await readdir(dir);
        const mp4Name = files.find((f) => f.endsWith(".mp4"));
        if (!mp4Name) {
            throw new Error("yt-dlp produced no mp4 file");
        }
        const filePath = path.join(dir, mp4Name);
        const buf = await readMp4MaybeCompress_(filePath, maxBytes);
        if (buf.length < 2048) {
            throw new Error("yt-dlp output too small");
        }
        return buf;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
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
        if (bytes > maxBytes * 2) {
            throw new Error("YouTube stream too large before compression");
        }
        chunks.push(Buffer.from(value));
    }
    let buf = Buffer.concat(chunks);
    if (buf.length > maxBytes) {
        const dir = await mkdtemp(path.join(tmpdir(), "wa-yt-compress-"));
        const input = path.join(dir, "input.mp4");
        const output = path.join(dir, "output.mp4");
        try {
            await writeFile(input, buf);
            buf = await compressMp4ForWhatsapp_(input, output, maxBytes);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
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
        return await downloadViaYoutubei_(id, maxBytes);
    } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
    }

    const detail = errors.map((err) => err.message).join(" | ").slice(0, 500);
    throw new Error(`YouTube download failed: ${detail}`);
}

/**
 * @param {string} videoId
 * @param {import("express").Response} res
 */
export async function streamYoutubeMp4ToResponse_(videoId, res) {
    try {
        const buf = await downloadYoutubeMp4Buffer_(videoId);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Length", String(buf.length));
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.end(buf);
    } catch (e) {
        res.status(502).json({
            ok: false,
            error: "Could not stream YouTube video",
            detail: e && e.message ? String(e.message).slice(0, 200) : String(e)
        });
    }
}
