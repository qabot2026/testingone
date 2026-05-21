/**
 * Stream YouTube as MP4 for Meta channels (WhatsApp native video player, Messenger attach).
 * WhatsApp Cloud API accepts public HTTPS MP4 links up to 16 MB.
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
 * @param {Array<{ container?: string, hasVideo?: boolean, hasAudio?: boolean, url?: string, contentLength?: string }>} formats
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
        info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${id}`);
    } catch (e) {
        res.status(502).json({
            ok: false,
            error: "Could not load YouTube video",
            detail: e && e.message ? String(e.message).slice(0, 160) : String(e)
        });
        return;
    }

    const format = ytdl.chooseFormat(info.formats, {
        quality: "lowest",
        filter: (f) => f.container === "mp4" && f.hasVideo && f.hasAudio
    }) || pickSmallMp4Format_(info.formats);

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
