/**
 * Wellness page shell + photo gallery. All customer-facing ids/classes use the `df-` prefix.
 * Loaded by df-wellness.entry.js after df-wellness.css.
 */
(function () {
    function injectDfWellnessMarkup() {
        if (document.getElementById("df-wellness-site")) {
            return;
        }
        document.body.innerHTML =
            '<div id="df-wellness-site">' +
                '<header class="df-wellness-banner">' +
                    "<h1>Wellness Center</h1>" +
                    "<p>Your Health, Our Priority</p>" +
                "</header>" +
                '<nav class="df-wellness-nav" id="df-wellness-nav">' +
                    '<a href="#">Home</a>' +
                    '<a href="#df-wellness-services">Services</a>' +
                    '<a href="#df-wellness-contact">Contact</a>' +
                "</nav>" +
                '<section class="df-wellness-section" id="df-wellness-welcome">' +
                    "<h2>Welcome</h2>" +
                    "<p>We provide holistic wellness services to improve your mind and body.</p>" +
                    '<button type="button" class="df-wellness-cta" onclick="alert(\'Booking feature coming soon!\')">Book Appointment</button>' +
                "</section>" +
                '<section class="df-wellness-section" id="df-wellness-services">' +
                    "<h2>Our Services</h2>" +
                    '<div class="df-wellness-services">' +
                        '<div class="df-wellness-card"><h3>Yoga</h3><p>Relax and improve flexibility.</p></div>' +
                        '<div class="df-wellness-card"><h3>Nutrition</h3><p>Personalized diet plans.</p></div>' +
                        '<div class="df-wellness-card"><h3>Meditation</h3><p>Reduce stress and anxiety.</p></div>' +
                    "</div>" +
                "</section>" +
                '<section id="df-photo-gallery-section" style="padding:20px 24px 48px;text-align:center;color:#334155;">' +
                    '<h2 id="df-wellness-gallery-heading" style="margin:0 0 8px;color:#21867a;">Photo gallery</h2>' +
                    '<p style="margin:0 0 16px;font-size:14px;">Tap a thumbnail to enlarge — scroll sideways for more.</p>' +
                    '<div id="df-gallery-root" class="df-gallery-root" aria-hidden="false">' +
                        '<div class="df-gallery__topbar">' +
                            '<button class="df-gallery__leave" id="df-gallery-leave-btn" type="button">Close viewer</button>' +
                        "</div>" +
                        '<div class="df-gallery__stage">' +
                            '<p class="df-gallery__hint" id="df-gallery-hint">Swipe or scroll the row — tap an image to enlarge.</p>' +
                            '<div class="df-gallery__carousel-wrap">' +
                                '<div class="df-gallery__carousel" id="df-gallery-carousel" role="list" aria-label="Image carousel"></div>' +
                            "</div>" +
                            '<div class="df-gallery__empty" id="df-gallery-empty" hidden>' +
                                "<strong>No images loaded.</strong> Add URLs via <code>?p=…</code> or <code>?img=…</code>" +
                            "</div>" +
                        "</div>" +
                        '<div class="df-wellness-lightbox" id="df-wellness-lightbox" role="dialog" aria-modal="true" aria-label="Enlarged image" hidden>' +
                            '<div class="df-wellness-lightbox__bg" id="df-wellness-lightbox-bg"></div>' +
                            '<button class="df-wellness-lb-btn df-wellness-lb-btn--close" id="df-gallery-lb-close" type="button" aria-label="Close">×</button>' +
                            '<button class="df-wellness-lb-btn df-wellness-lb-btn--prev" id="df-gallery-lb-prev" type="button" aria-label="Previous image">‹</button>' +
                            '<button class="df-wellness-lb-btn df-wellness-lb-btn--next" id="df-gallery-lb-next" type="button" aria-label="Next image">›</button>' +
                            '<div class="df-wellness-lightbox__panel">' +
                                '<img id="df-gallery-lb-img" alt="" />' +
                                '<div class="df-wellness-lightbox__caption" id="df-gallery-lb-caption"></div>' +
                            "</div>" +
                        "</div>" +
                    "</div>" +
                "</section>" +
                '<section class="df-wellness-section" id="df-wellness-contact">' +
                    "<h2>Contact Us</h2>" +
                    "<p>Email: wellness@example.com</p>" +
                    "<p>Phone: +91 98765 43210</p>" +
                "</section>" +
                '<footer class="df-wellness-footer"><p>© 2026 Wellness Center</p></footer>' +
            "</div>";
    }

    injectDfWellnessMarkup();

    var galleryRoot = document.getElementById("df-gallery-root");
    if (!galleryRoot) {
        return;
    }
    galleryRoot.setAttribute("aria-hidden", "false");

    if (document.documentElement.getAttribute("data-embed") === "1") {
        var wrapSec = galleryRoot.closest ? galleryRoot.closest("section") : null;
        if (wrapSec && wrapSec.parentNode) {
            document.body.insertBefore(wrapSec, document.body.firstChild);
        } else {
            document.body.insertBefore(galleryRoot, document.body.firstChild);
        }
    }

    function decodeUrlCandidate(s) {
        if (!s) {
            return "";
        }
        try {
            return decodeURIComponent(s.trim());
        } catch (e) {
            return s.trim();
        }
    }
    function splitPipeOrAmp(s) {
        if (s.indexOf("|") >= 0) {
            return s.split("|");
        }
        if (/&amp;img=/i.test(s)) {
            return s.split(/\s*&(?:amp;)?img=\s*/i);
        }
        return [s];
    }
    function gatherImages(params) {
        var out = [];
        function pushMany(arr) {
            var j = 0;
            for (; j < arr.length; j += 1) {
                var t = decodeUrlCandidate(arr[j]);
                if (t) {
                    out.push(t);
                }
            }
        }
        pushMany(params.getAll("img"));
        pushMany(params.getAll("src"));
        pushMany(params.getAll("imgs"));
        var urlsParam = params.get("urls");
        if (urlsParam) {
            pushMany(urlsParam.split("|"));
        }
        var one = "";
        if (out.length <= 1) {
            one = out[0] || params.get("img") || params.get("imgs") || params.get("url") || "";
        }
        if (one.indexOf("|") >= 0) {
            out = [];
            pushMany(splitPipeOrAmp(one));
        }
        var imgListRaw = params.get("imgList") || params.get("images");
        if (imgListRaw) {
            var decoded = imgListRaw;
            try {
                decoded = decodeURIComponent(imgListRaw);
            } catch (e1) {}
            try {
                var parsed = JSON.parse(decoded);
                if (Array.isArray(parsed)) {
                    out = [];
                    var k = 0;
                    for (; k < parsed.length; k += 1) {
                        if (typeof parsed[k] === "string" && parsed[k]) {
                            out.push(parsed[k].trim());
                        }
                    }
                }
            } catch (e2) {
                if (decoded.indexOf(",") >= 0) {
                    out = [];
                    pushMany(decoded.split(","));
                }
            }
        }
        var seen = {};
        var uniq = [];
        var ix = 0;
        for (; ix < out.length; ix += 1) {
            var u = out[ix];
            if (!u || seen[u]) {
                continue;
            }
            seen[u] = 1;
            uniq.push(u);
        }
        return uniq;
    }
    function dedupeUrls(arr) {
        var seen = {};
        var uniq = [];
        var d = 0;
        for (; d < arr.length; d += 1) {
            var uu = arr[d];
            if (!uu || seen[uu]) {
                continue;
            }
            seen[uu] = 1;
            uniq.push(uu);
        }
        return uniq;
    }
    function gatherImagesFromHash() {
        var h = (window.location.hash || "").replace(/^#/, "");
        if (!h) {
            return [];
        }
        var out = [];
        if (h.indexOf("img=") === 0) {
            var raw = h.slice(4);
            try {
                raw = decodeURIComponent(raw);
            } catch (e0) {}
            var first = raw.replace(/^\s+/, "").charAt(0);
            if (first === "[" || (first === '"' && raw.indexOf(",") >= 0)) {
                try {
                    var pj = JSON.parse(raw);
                    if (Array.isArray(pj)) {
                        var p = 0;
                        for (; p < pj.length; p += 1) {
                            if (typeof pj[p] === "string" && pj[p]) {
                                out.push(pj[p].trim());
                            }
                        }
                        return out;
                    }
                } catch (e1) {}
            }
            raw.split("|").forEach(function (part) {
                var tt = decodeUrlCandidate(part);
                if (tt) {
                    out.push(tt);
                }
            });
        } else if (h.indexOf("images=") === 0) {
            var raw2 = h.slice(7);
            try {
                raw2 = decodeURIComponent(raw2);
            } catch (e2) {}
            try {
                var j = JSON.parse(raw2);
                if (Array.isArray(j)) {
                    var q = 0;
                    for (; q < j.length; q += 1) {
                        if (typeof j[q] === "string" && j[q]) {
                            out.push(j[q].trim());
                        }
                    }
                }
            } catch (e3) {}
        }
        return out;
    }
    function normalizeSearchStr(search) {
        return (search || "").replace(/^\?/, "").replace(/&amp;/gi, "&");
    }
    function getRawQueryParamNorm(norm, key) {
        var re = new RegExp("(?:^|&)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^&]*)");
        var m = re.exec(norm + "&");
        return m ? m[1] : "";
    }
    function decodePayloadBase64(raw) {
        if (!raw) {
            return [];
        }
        var s0 = String(raw).replace(/[\s\u200b\uFEFF]/g, "").trim();
        var attempts = [];
        attempts.push(s0);
        try {
            attempts.push(decodeURIComponent(s0));
        } catch (eA) {}
        function tryDecode(sIn) {
            var ss = sIn.replace(/-/g, "+").replace(/_/g, "/");
            while (ss.length % 4) {
                ss += "=";
            }
            try {
                var jsonStr = atob(ss);
                var jo = JSON.parse(jsonStr);
                if (Array.isArray(jo)) {
                    var or = [];
                    var t = 0;
                    for (; t < jo.length; t += 1) {
                        if (typeof jo[t] === "string" && jo[t]) {
                            or.push(jo[t].trim());
                        }
                    }
                    return or.length ? or : null;
                }
                if (jo && typeof jo === "object" && Array.isArray(jo.urls)) {
                    var u = jo.urls;
                    var ot = [];
                    var t2 = 0;
                    for (; t2 < u.length; t2 += 1) {
                        if (typeof u[t2] === "string" && u[t2]) {
                            ot.push(u[t2].trim());
                        }
                    }
                    return ot.length ? ot : null;
                }
            } catch (eJ) {}
            return null;
        }
        var ai = 0;
        for (; ai < attempts.length; ai += 1) {
            var decoded = tryDecode(attempts[ai]);
            if (decoded && decoded.length) {
                return decoded;
            }
        }
        var spaced = tryDecode(s0.replace(/ /g, "+"));
        if (spaced && spaced.length) {
            return spaced;
        }
        return [];
    }
    function gatherFromBase64Search(norm) {
        var keys = ["p", "payload", "data", "g"];
        var kk = 0;
        for (; kk < keys.length; kk += 1) {
            var raw = getRawQueryParamNorm(norm, keys[kk]);
            if (!raw) {
                continue;
            }
            var list = decodePayloadBase64(raw);
            if (list.length) {
                return list;
            }
        }
        return [];
    }
    function extractImgParamsRaw(search) {
        var norm = normalizeSearchStr(search);
        var outp = [];
        var re = /(?:^|&)img=([^&]*)/g;
        var mm;
        while ((mm = re.exec(norm)) !== null) {
            var v = mm[1];
            try {
                v = decodeURIComponent(v.replace(/\+/g, "%20"));
            } catch (e) {}
            v = (v || "").trim();
            if (v) {
                outp.push(v);
            }
        }
        return outp;
    }
    function extractUrlsCommaRaw(search) {
        var norm = normalizeSearchStr(search);
        var rawu = getRawQueryParamNorm(norm, "urls");
        if (!rawu) {
            return [];
        }
        try {
            rawu = decodeURIComponent(rawu.replace(/\+/g, "%20"));
        } catch (e) {}
        return rawu.split(",").map(function (st) {
            return st.trim();
        }).filter(Boolean);
    }
    function resolveImages() {
        var search = window.location.search || "";
        var norm = normalizeSearchStr(search);
        var fromB64 = gatherFromBase64Search(norm);
        if (fromB64.length) {
            return fromB64;
        }
        var paramsQ = new URLSearchParams(search);
        var fromQuery = gatherImages(paramsQ);
        if (fromQuery.length) {
            return fromQuery;
        }
        var fromRegexImg = extractImgParamsRaw(search);
        if (fromRegexImg.length) {
            return dedupeUrls(fromRegexImg);
        }
        var fromUrls = extractUrlsCommaRaw(search);
        if (fromUrls.length) {
            return dedupeUrls(fromUrls);
        }
        var fromHash = gatherImagesFromHash();
        if (fromHash.length) {
            return fromHash;
        }
        var href = window.location.href || "";
        var qPos = href.indexOf("?");
        if (qPos >= 0) {
            var afterQ = href.slice(qPos + 1);
            var hashPos = afterQ.indexOf("#");
            if (hashPos >= 0) {
                afterQ = afterQ.slice(0, hashPos);
            }
            afterQ = normalizeSearchStr(afterQ);
            var againB64 = gatherFromBase64Search(afterQ);
            if (againB64.length) {
                return againB64;
            }
            var fromHrefParams = gatherImages(new URLSearchParams("?" + afterQ));
            if (fromHrefParams.length) {
                return fromHrefParams;
            }
            var againRegex = extractImgParamsRaw("?" + afterQ);
            if (againRegex.length) {
                return dedupeUrls(againRegex);
            }
        }
        return [];
    }

    var params = new URLSearchParams(window.location.search || "");
    var imgs = resolveImages();
    if (!imgs.length && params.get("nodemo") !== "1") {
        imgs = [
            "https://placehold.co/220x140/334155/e2e8f0/png?text=1",
            "https://placehold.co/220x140/1e293b/94a3b8/png?text=2",
            "https://placehold.co/220x140/0f172a/64748b/png?text=3"
        ];
    }
    var idx = 0;
    if (params.get("debug") === "1") {
        var dbg = document.createElement("pre");
        dbg.id = "df-wellness-debug";
        dbg.style.cssText =
            "position:fixed;bottom:0;left:0;right:0;max-height:140px;overflow:auto;background:#020617;color:#4ade80;font:11px/1.4 ui-monospace,monospace;padding:8px;margin:0;z-index:200;border-top:1px solid #334155;";
        var normD = normalizeSearchStr(window.location.search || "");
        var pr = getRawQueryParamNorm(normD, "p");
        dbg.textContent =
            "imgs=" +
            imgs.length +
            "\nsearch=" +
            String(window.location.search || "(empty)") +
            "\nhash=" +
            String(window.location.hash || "(empty)") +
            "\np_param_len=" +
            (pr ? pr.length : 0) +
            "\nfrom_p_urls=" +
            decodePayloadBase64(pr).length +
            "\nhref=\n" +
            String(window.location.href || "");
        document.body.appendChild(dbg);
    }

    var carousel = document.getElementById("df-gallery-carousel");
    var empty = document.getElementById("df-gallery-empty");
    var hint = document.getElementById("df-gallery-hint");
    var lightbox = document.getElementById("df-wellness-lightbox");
    var lbImg = document.getElementById("df-gallery-lb-img");
    var lbCaption = document.getElementById("df-gallery-lb-caption");
    var lbClose = document.getElementById("df-gallery-lb-close");
    var lbPrev = document.getElementById("df-gallery-lb-prev");
    var lbNext = document.getElementById("df-gallery-lb-next");
    var lightboxBg = document.getElementById("df-wellness-lightbox-bg");
    var leaveBtn = document.getElementById("df-gallery-leave-btn");

    function clampIndex(n) {
        var L = imgs.length;
        if (!L) {
            return 0;
        }
        return ((n % L) + L) % L;
    }
    function leaveViewer() {
        if (document.documentElement.getAttribute("data-embed") === "1") {
            window.location.href = "wellness.html";
            return;
        }
        closeLightbox();
        var gh = document.getElementById("df-wellness-gallery-heading");
        if (gh) {
            gh.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }
    function setNavVisibility() {
        var multi = imgs.length > 1;
        lbPrev.style.display = multi ? "grid" : "none";
        lbNext.style.display = multi ? "grid" : "none";
    }
    function openLightbox(index) {
        if (!imgs.length) {
            return;
        }
        idx = clampIndex(index);
        lbImg.src = imgs[idx];
        lbImg.alt = "Image " + (idx + 1) + " of " + imgs.length;
        lbCaption.textContent = imgs.length > 1 ? idx + 1 + " / " + imgs.length : "";
        setNavVisibility();
        lightbox.hidden = false;
        lightbox.classList.add("df-wellness-lightbox--open");
        lightbox.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
        lbClose.focus();
    }
    function closeLightbox() {
        lightbox.classList.remove("df-wellness-lightbox--open");
        lightbox.hidden = true;
        lightbox.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
    }
    function stepLightbox(delta) {
        if (!imgs.length) {
            return;
        }
        idx = clampIndex(idx + delta);
        lbImg.src = imgs[idx];
        lbImg.alt = "Image " + (idx + 1) + " of " + imgs.length;
        lbCaption.textContent = imgs.length > 1 ? idx + 1 + " / " + imgs.length : "";
    }
    function buildCarousel() {
        carousel.innerHTML = "";
        if (!imgs.length) {
            empty.hidden = false;
            hint.hidden = true;
            return;
        }
        empty.hidden = true;
        hint.hidden = false;
        imgs.forEach(function (src, iix) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "df-gallery__thumb";
            b.setAttribute("role", "listitem");
            b.setAttribute("aria-label", "View image " + (iix + 1));
            var im = document.createElement("img");
            im.src = src;
            im.alt = "";
            im.loading = iix < 4 ? "eager" : "lazy";
            b.appendChild(im);
            b.addEventListener("click", function () {
                openLightbox(iix);
            });
            carousel.appendChild(b);
        });
    }

    if (params.get("embed") === "1") {
        if (!galleryRoot) {
            return;
        }
        galleryRoot.classList.add("df-gallery--embed-iframe");
        var tb = galleryRoot.querySelector(".df-gallery__topbar");
        if (tb) {
            tb.style.display = "none";
        }
        var st = galleryRoot.querySelector(".df-gallery__stage");
        if (st) {
            st.style.minHeight = "min(420px, 100vh)";
        }
    }
    buildCarousel();
    setNavVisibility();
    lbClose.addEventListener("click", closeLightbox);
    lightboxBg.addEventListener("click", closeLightbox);
    lbPrev.addEventListener("click", function (e) {
        e.stopPropagation();
        stepLightbox(-1);
    });
    lbNext.addEventListener("click", function (e) {
        e.stopPropagation();
        stepLightbox(1);
    });
    leaveBtn.addEventListener("click", leaveViewer);
    document.addEventListener("keydown", function (e) {
        if (!lightbox.classList.contains("df-wellness-lightbox--open")) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            closeLightbox();
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            stepLightbox(-1);
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            stepLightbox(1);
        }
    });

    if (document.documentElement.getAttribute("data-embed") === "1") {
        return;
    }
    var chatScript = document.createElement("script");
    chatScript.src = "company-loader.js?botid=0001&v=48";
    document.body.appendChild(chatScript);
})();
