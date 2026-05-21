/**
 * Stream or download YouTube as MP4 for Meta channels.
 * WhatsApp Cloud API accepts uploaded video up to 16 MB.
 */

import ytdl from "@distube/ytdl-core";

const WA_VIDEO_MAX_BYTES = 16 * 1024 * 1024;

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

/**
 * @param {import("@distube/ytdl-core").videoFormat[]} formats
 */
function pickSmallMp4Format_(formats) {
    const mp4 = formats.filter(
        (f) => f.container === "mp4" && f.hasVideo && f.hasAudio && f.url
    );
    if (!mp4.length) {
        return null;
    }
    const underCap = mp4.filter((f) => {
        const len = Number(f.contentLength || 0);
        return len > 0 && len <= WA_VIDEO_MAX_BYTES;
    });
    const pool = underCap.length ? underCap : mp4;
    pool.sort((a, b) => Number(a.contentLength || 0) - Number(b.contentLength || 0));
    return pool[0] || null;
}

/**
 * @param {import("@distube/ytdl-core").videoFormat[]} formats
 */
function chooseYoutubeMp4Format_(formats) {
    return (
        ytdl.chooseFormat(formats, {
            quality: "lowest",
            filter: (f) => f.container === "mp4" && f.hasVideo && f.hasAudio
        }) || pickSmallMp4Format_(formats)
    );
}

/**
 * @param {string} videoId
 */
export async function getYoutubeVideoInfo_(videoId) {
    const id = trim_(videoId);
    if (!isValidYoutubeVideoId_(id)) {
        throw new Error("Invalid YouTube video id");
    }
    return ytdl.getInfo(`https://www.youtube.com/watch?v=${id}`);
}

/**
 * @param {string} videoId
 * @param {number} [maxBytes]
 * @returns {Promise<Buffer>}
 */
export async function downloadYoutubeMp4Buffer_(videoId, maxBytes = WA_VIDEO_MAX_BYTES) {
    const info = await getYoutubeVideoInfo_(videoId);
    const format = chooseYoutubeMp4Format_(info.formats);
    if (!format?.url) {
        throw new Error("No MP4 stream available for this video");
    }
    const declaredLen = Number(format.contentLength || 0);
    if (declaredLen > maxBytes) {
        throw new Error("Video exceeds WhatsApp 16 MB limit");
    }

    return new Promise((resolve, reject) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let bytes = 0;
        const stream = ytdl.downloadFromInfo(info, { format });
        stream.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
                stream.destroy();
                reject(new Error("Video exceeds WhatsApp 16 MB limit"));
                return;
            }
            chunks.push(chunk);
        });
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
    });
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

    let info;
    try {
        info = await getYoutubeVideoInfo_(id);
    } catch (e) {
        res.status(502).json({
            ok: false,
            error: "Could not load YouTube video",
            detail: e && e.message ? String(e.message).slice(0, 160) : String(e)
        });
        return;
    }

    const format = chooseYoutubeMp4Format_(info.formats);
    if (!format?.url) {
        res.status(502).json({ ok: false, error: "No MP4 stream available for this video" });
        return;
    }

    const contentLength = Number(format.contentLength || 0);
    if (contentLength > WA_VIDEO_MAX_BYTES) {
        res.status(413).json({
            ok: false,
            error: "Video exceeds WhatsApp 16 MB limit; use a shorter clip or direct MP4 URL"
        });
        return;
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (contentLength > 0) {
        res.setHeader("Content-Length", String(contentLength));
    }

    const stream = ytdl.downloadFromInfo(info, { format });
    let bytes = 0;
    stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > WA_VIDEO_MAX_BYTES) {
            stream.destroy();
            if (!res.headersSent) {
                res.status(413).end();
            } else {
                res.end();
            }
        }
    });
    stream.on("error", (e) => {
        if (!res.headersSent) {
            res.status(502).json({
                ok: false,
                error: "Stream failed",
                detail: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        } else {
            res.end();
        }
    });
    stream.pipe(res);
}
