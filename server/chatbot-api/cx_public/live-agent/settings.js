(function () {
    "use strict";

    const API = "/api/live-agent";
    const LS_SECRET = "conversations_sheet_secret_v1";
    const LS_SETTINGS_PANEL = "live_agent_settings_panel_v1";

    const $ = (id) => document.getElementById(id);

    let viewerSecret = "";
    /** @type {Record<string, unknown> | null} */
    let lastDeskSettings = null;
    /** @type {{ id: string, name: string }[]} */
    let lastDepartments_ = [];

    function authHeaders_() {
        return {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Conversations-Sheet-Secret": viewerSecret
        };
    }

    async function apiFetch(url, options) {
        const opts = options || {};
        const res = await fetch(url, {
            credentials: "same-origin",
            ...opts,
            headers: { ...authHeaders_(), ...(opts.headers || {}) }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data && data.error) || res.statusText || "Request failed");
        return data;
    }

    function getNextPath_() {
        try {
            const p = new URLSearchParams(window.location.search).get("next");
            if (!p || p.includes("://") || p.includes("..")) return "";
            return p.replace(/^\//, "");
        } catch (_) {
            return "";
        }
    }

    function redirectNextIfPresent_() {
        const next = getNextPath_();
        if (!next) return false;
        window.location.href = "/" + next;
        return true;
    }

    function loadSecret() {
        try {
            viewerSecret =
                sessionStorage.getItem(LS_SECRET) || localStorage.getItem(LS_SECRET) || "";
        } catch (_) {
            viewerSecret = "";
        }
        if ($("loginSecret") && viewerSecret) $("loginSecret").value = viewerSecret;
    }

    function showLogin() {
        $("loginView").classList.remove("hidden");
        $("appView").classList.add("hidden");
    }

    function showSettingsPanel_(panelId) {
        const id = panelId || "general";
        const buttons = document.querySelectorAll(".settings-nav-btn");
        const panels = document.querySelectorAll(".settings-panel");
        let title = "Settings";
        for (const btn of buttons) {
            const on = btn.getAttribute("data-settings-panel") === id;
            btn.classList.toggle("active", on);
            if (on) title = btn.textContent.trim() || title;
        }
        for (const panel of panels) {
            const on = panel.id === "settingsPanel-" + id;
            panel.classList.toggle("active", on);
            if (on && panel.dataset.panelTitle) {
                title = panel.dataset.panelTitle;
            }
        }
        const titleEl = $("settingsPanelTitle");
        if (titleEl) titleEl.textContent = title;
        try {
            sessionStorage.setItem(LS_SETTINGS_PANEL, id);
        } catch (_) {
            /* ignore */
        }
        if (id === "activity") {
            loadAgentsOverview_();
        }
    }

    function initSettingsNav_() {
        document.querySelectorAll(".settings-nav-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const panelId = btn.getAttribute("data-settings-panel");
                if (panelId) showSettingsPanel_(panelId);
            });
        });
        let saved = "general";
        try {
            saved = sessionStorage.getItem(LS_SETTINGS_PANEL) || "general";
        } catch (_) {
            /* ignore */
        }
        if (!document.getElementById("settingsPanel-" + saved)) {
            saved = "general";
        }
        showSettingsPanel_(saved);
    }

    function showApp() {
        $("loginView").classList.add("hidden");
        $("appView").classList.remove("hidden");
        loadAll();
        updateNotifyPermissionStatus_();
        initSettingsNav_();
    }

    function setChecked_(id, on) {
        const el = $(id);
        if (el) el.checked = !!on;
    }

    function setVal_(id, v) {
        const el = $(id);
        if (el) el.value = v == null ? "" : String(v);
    }

    const BH_DAY_FIELDS_ = [
        { id: "bhMon", day: "monday" },
        { id: "bhTue", day: "tuesday" },
        { id: "bhWed", day: "wednesday" },
        { id: "bhThu", day: "thursday" },
        { id: "bhFri", day: "friday" },
        { id: "bhSat", day: "saturday" },
        { id: "bhSun", day: "sunday" }
    ];

    function readBusinessHoursFromDom_() {
        const workDays = [];
        for (const f of BH_DAY_FIELDS_) {
            const el = $(f.id);
            if (el && el.checked) workDays.push(f.day);
        }
        return {
            enabled: $("bhEnabled") && $("bhEnabled").checked,
            timezone: $("bhTimezone") && $("bhTimezone").value ? $("bhTimezone").value.trim() : "Asia/Kolkata",
            workDays,
            start: $("bhStart") && $("bhStart").value ? $("bhStart").value.trim() : "9:00 AM",
            end: $("bhEnd") && $("bhEnd").value ? $("bhEnd").value.trim() : "5:00 PM",
            outsideHoursMessage:
                $("bhMessage") && $("bhMessage").value
                    ? $("bhMessage").value.trim()
                    : ""
        };
    }

    function applyBusinessHours_(bh) {
        const base = bh && typeof bh === "object" ? bh : {};
        setChecked_("bhEnabled", base.enabled === true);
        setVal_("bhTimezone", base.timezone || "Asia/Kolkata");
        setVal_("bhStart", base.start || "9:00 AM");
        setVal_("bhEnd", base.end || "5:00 PM");
        setVal_("bhMessage", base.outsideHoursMessage || "");
        const days = new Set(
            (Array.isArray(base.workDays) ? base.workDays : ["monday", "tuesday", "wednesday", "thursday", "friday"]).map(
                (d) => String(d).toLowerCase()
            )
        );
        for (const f of BH_DAY_FIELDS_) {
            setChecked_(f.id, days.has(f.day));
        }
    }

    function readDeskPayload_() {
        return {
            claimWaitSeconds: Number($("claimWaitSeconds").value) || 30,
            endConvWaitMinutes: Number($("endConvWaitMinutes").value) || 3,
            queueMaxWaitEnabled: !$("queueMaxWaitEnabled") || $("queueMaxWaitEnabled").checked,
            queueMaxWaitMinutes: Number($("queueMaxWaitMinutes").value) || 10,
            queueTimeoutReply:
                $("queueTimeoutReply") && $("queueTimeoutReply").value
                    ? $("queueTimeoutReply").value.trim()
                    : "",
            general: {
                muteServiceDesk: $("muteServiceDesk").checked,
                showAgentNameInChat: $("showAgentNameInChat").checked,
                enableAgentChatFeedback: $("enableAgentChatFeedback").checked,
                disableUserTextTranslation: $("disableUserTextTranslation").checked,
                sortChatsByLastMessage: $("sortChatsByLastMessage").checked,
                notificationSound: $("notificationSound").value || "default",
                notifyDeskPanel: $("notifyDeskPanel").checked,
                notifyDesktopPopup: $("notifyDesktopPopup").checked,
                notifyMobilePopup: $("notifyMobilePopup").checked,
                agentProfiles: readAgentProfilesFromDom_()
            },
            routing: {
                algorithm: $("routingAlgorithm").value || "online_parallel",
                maxConcurrentChats: Number($("maxConcurrentChats").value) || 2,
                agentInactivityMinutes: Number($("agentInactivityMinutes").value) || 15,
                exitAgentOnInactive: $("exitAgentOnInactive").checked
            },
            access: {
                tabAllChats: $("tabAllChats").checked,
                tabAllAssigned: $("tabAllAssigned").checked,
                tabUnassigned: $("tabUnassigned").checked,
                tabAiChats: $("tabAiChats").checked,
                tabAgentChats: $("tabAgentChats").checked,
                tabCompleted: $("tabCompleted").checked,
                uploadFile: $("uploadFile").checked,
                viewContact: $("viewContact").value || "all"
            },
            reporting: {
                dailyRecipients: $("dailyRecipients").value.trim(),
                weeklyMonthlyEnabled: $("weeklyMonthlyEnabled").checked
            },
            knowledgeBase: readKnowledgeBaseFromDom_(),
            businessHours: readBusinessHoursFromDom_()
        };
    }

    function kbRowValues_(tr) {
        const titleEl = tr.querySelector("[data-kb-title]");
        const keysEl = tr.querySelector("[data-kb-keywords]");
        const answerEl = tr.querySelector("[data-kb-answer]");
        const deptEl = tr.querySelector("[data-kb-dept]");
        const title = titleEl && titleEl.value ? titleEl.value.trim() : "";
        const answer = answerEl && answerEl.value ? answerEl.value.trim() : "";
        const keywords = keysEl && keysEl.value ? keysEl.value.trim() : "";
        const departmentId = deptEl && deptEl.value ? deptEl.value.trim() : "";
        const hasAny = !!(title || answer || keywords || departmentId);
        const complete = !!(title && answer);
        return { titleEl, answerEl, keysEl, deptEl, title, answer, keywords, departmentId, hasAny, complete };
    }

    function clearKbValidationUi_() {
        const banner = $("kbValidationBanner");
        if (banner) {
            banner.textContent = "";
            banner.classList.add("hidden");
        }
        const body = $("kbArticlesBody");
        if (!body) return;
        for (const tr of body.querySelectorAll("tr[data-kb-article]")) {
            tr.classList.remove("kb-row-invalid");
            for (const el of tr.querySelectorAll(".kb-field-missing")) {
                el.classList.remove("kb-field-missing");
            }
        }
    }

    function updateKbArticleLabels_() {
        const body = $("kbArticlesBody");
        if (!body) return;
        const rows = body.querySelectorAll("tr[data-kb-article]");
        rows.forEach((tr, idx) => {
            const label = tr.querySelector(".kb-article-label");
            const hint = tr.querySelector(".kb-saved-hint");
            const v = kbRowValues_(tr);
            const n = idx + 1;
            if (label) {
                label.textContent = v.title
                    ? "Article " + n + ": " + (v.title.length > 48 ? v.title.slice(0, 45) + "…" : v.title)
                    : "Article " + n;
            }
            if (hint) {
                hint.textContent = tr.dataset.kbId
                    ? "Saved — edit below and save again"
                    : "New — add title and reply text, then save";
            }
        });
    }

    function validateKnowledgeBaseDom_() {
        clearKbValidationUi_();
        const body = $("kbArticlesBody");
        if (!body) return { ok: true };
        const rows = [...body.querySelectorAll("tr[data-kb-article]")];
        const problems = [];
        let completeCount = 0;
        for (let i = 0; i < rows.length; i++) {
            const tr = rows[i];
            const v = kbRowValues_(tr);
            if (!v.hasAny) continue;
            if (v.complete) {
                completeCount++;
                continue;
            }
            tr.classList.add("kb-row-invalid");
            const missing = [];
            if (!v.title) {
                missing.push("title");
                if (v.titleEl) v.titleEl.classList.add("kb-field-missing");
            }
            if (!v.answer) {
                missing.push("reply text");
                if (v.answerEl) v.answerEl.classList.add("kb-field-missing");
            }
            problems.push({ index: i + 1, missing });
        }
        if (!problems.length) return { ok: true, completeCount };
        const first = problems[0];
        const msg =
            "Article " +
            first.index +
            " is incomplete — add " +
            first.missing.join(" and ") +
            " before saving. Your text was not cleared.";
        const banner = $("kbValidationBanner");
        if (banner) {
            banner.textContent = msg;
            banner.classList.remove("hidden");
        }
        showSettingsPanel_("knowledge");
        const kbSection = $("knowledgeBaseSection");
        if (kbSection && typeof kbSection.scrollIntoView === "function") {
            kbSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        return { ok: false, message: msg, problems };
    }

    function readKnowledgeBaseFromDom_() {
        const body = $("kbArticlesBody");
        const articles = [];
        if (!body) {
            return { enabled: $("kbEnabled") && $("kbEnabled").checked, articles: [] };
        }
        const rows = body.querySelectorAll("tr[data-kb-article]");
        for (const tr of rows) {
            const v = kbRowValues_(tr);
            if (!v.complete) continue;
            articles.push({
                id: tr.dataset.kbId || undefined,
                title: v.title,
                keywords: v.keywords,
                answer: v.answer,
                departmentId: v.departmentId,
                enabled: true
            });
        }
        return {
            enabled: !$("kbEnabled") || $("kbEnabled").checked,
            articles
        };
    }

    function deptOptionsHtml_(selected) {
        const sel = String(selected || "").toLowerCase();
        let html =
            '<option value="">All departments</option><option value="general">General</option>';
        for (const d of lastDepartments_) {
            if (!d || !d.id || d.id === "general") continue;
            const id = String(d.id);
            const name = String(d.name || id);
            html +=
                '<option value="' +
                escapeHtml_(id) +
                '"' +
                (sel === id.toLowerCase() ? " selected" : "") +
                ">" +
                escapeHtml_(name) +
                "</option>";
        }
        return html;
    }

    function addKbArticleRow_(article) {
        const body = $("kbArticlesBody");
        if (!body) return;
        const a = article || {};
        const tr = document.createElement("tr");
        tr.dataset.kbArticle = "1";
        tr.dataset.kbId = a.id || "";
        tr.innerHTML =
            '<td colspan="4" class="kb-article-cell">' +
            '<div class="kb-article-head">' +
            '<strong class="kb-article-label">Article</strong>' +
            '<span class="kb-saved-hint muted small"></span>' +
            "</div>" +
            '<div class="kb-article-fields">' +
            '<div class="kb-field-block">' +
            '<span class="kb-field-label">Title <span class="required">*</span></span>' +
            '<input type="text" data-kb-title placeholder="e.g. Refund policy" value="' +
            escapeHtml_(a.title || "") +
            '" />' +
            "</div>" +
            '<div class="kb-field-block">' +
            '<span class="kb-field-label">Keywords</span>' +
            '<input type="text" data-kb-keywords placeholder="refund, cancel, return" value="' +
            escapeHtml_(a.keywords || "") +
            '" />' +
            "</div>" +
            '<div class="kb-field-block">' +
            '<span class="kb-field-label">Department</span>' +
            '<select data-kb-dept>' +
            deptOptionsHtml_(a.departmentId || "") +
            "</select>" +
            "</div>" +
            '<button type="button" class="btn ghost small kb-remove">Remove</button>' +
            "</div>" +
            '<span class="kb-field-label">Reply text <span class="required">*</span></span>' +
            '<textarea data-kb-answer rows="5" placeholder="Full reply agents can paste to the visitor…">' +
            escapeHtml_(a.answer || "") +
            "</textarea>" +
            "</td>";
        const onInput = () => {
            clearKbValidationUi_();
            updateKbArticleLabels_();
        };
        tr.querySelectorAll("input, textarea, select").forEach((el) => {
            el.addEventListener("input", onInput);
            el.addEventListener("change", onInput);
        });
        tr.querySelector(".kb-remove").addEventListener("click", () => {
            tr.remove();
            updateKbArticleLabels_();
        });
        body.appendChild(tr);
        updateKbArticleLabels_();
    }

    function renderKnowledgeBase_(kb) {
        const body = $("kbArticlesBody");
        if (!body) return;
        clearKbValidationUi_();
        const base = kb && typeof kb === "object" ? kb : {};
        setChecked_("kbEnabled", base.enabled !== false);
        body.innerHTML = "";
        const list = Array.isArray(base.articles) ? base.articles : [];
        if (!list.length) {
            addKbArticleRow_({});
        } else {
            for (const a of list) {
                addKbArticleRow_(a);
            }
            addKbArticleRow_({});
        }
        updateKbArticleLabels_();
    }

    function applyDeskSettings_(s) {
        const settings = s || {};
        lastDeskSettings = settings;
        const g = settings.general || {};
        const r = settings.routing || {};
        const a = settings.access || {};
        const rep = settings.reporting || {};

        setVal_("claimWaitSeconds", settings.claimWaitSeconds || 30);
        setVal_("endConvWaitMinutes", settings.endConvWaitMinutes || 3);
        setChecked_("queueMaxWaitEnabled", settings.queueMaxWaitEnabled !== false);
        setVal_("queueMaxWaitMinutes", settings.queueMaxWaitMinutes || 10);
        setVal_("queueTimeoutReply", settings.queueTimeoutReply || "");
        setChecked_("muteServiceDesk", g.muteServiceDesk);
        setChecked_("showAgentNameInChat", g.showAgentNameInChat !== false);
        setChecked_("enableAgentChatFeedback", g.enableAgentChatFeedback);
        setChecked_("disableUserTextTranslation", g.disableUserTextTranslation);
        setChecked_("sortChatsByLastMessage", g.sortChatsByLastMessage !== false);
        setVal_("notificationSound", g.notificationSound || "default");
        setChecked_("notifyDeskPanel", g.notifyDeskPanel !== false);
        setChecked_("notifyDesktopPopup", g.notifyDesktopPopup !== false);
        setChecked_("notifyMobilePopup", g.notifyMobilePopup !== false);
        setVal_("routingAlgorithm", r.algorithm || "online_parallel");
        setVal_("maxConcurrentChats", r.maxConcurrentChats || 2);
        setVal_("agentInactivityMinutes", r.agentInactivityMinutes || 15);
        setChecked_("exitAgentOnInactive", r.exitAgentOnInactive);
        setChecked_("tabAllChats", a.tabAllChats !== false);
        setChecked_("tabAllAssigned", a.tabAllAssigned !== false);
        setChecked_("tabUnassigned", a.tabUnassigned !== false);
        setChecked_("tabAiChats", a.tabAiChats);
        setChecked_("tabAgentChats", a.tabAgentChats !== false);
        setChecked_("tabCompleted", a.tabCompleted !== false);
        setChecked_("uploadFile", a.uploadFile !== false);
        setVal_("viewContact", a.viewContact || "all");
        setVal_("dailyRecipients", rep.dailyRecipients || "");
        setChecked_("weeklyMonthlyEnabled", rep.weeklyMonthlyEnabled);
        renderAgentProfiles_((g.agentProfiles || []));
        renderKnowledgeBase_(settings.knowledgeBase || {});
        applyBusinessHours_(settings.businessHours || {});
    }

    function readAgentProfilesFromDom_() {
        const body = $("agentProfilesBody");
        if (!body) return [];
        const rows = body.querySelectorAll("tr[data-agent-profile-row]");
        const out = [];
        for (const tr of rows) {
            const emailEl = tr.querySelector("[data-profile-email]");
            const nameEl = tr.querySelector("[data-profile-name]");
            const email = emailEl && emailEl.value ? emailEl.value.trim().toLowerCase() : "";
            const name = nameEl && nameEl.value ? nameEl.value.trim() : "";
            if (email && email.includes("@") && name) {
                out.push({ email, name });
            }
        }
        return out;
    }

    function renderAgentProfiles_(profiles) {
        const body = $("agentProfilesBody");
        if (!body) return;
        body.innerHTML = "";
        const list = Array.isArray(profiles) ? profiles : [];
        if (!list.length) {
            addAgentProfileRow_("", "");
        } else {
            for (const p of list) {
                addAgentProfileRow_(p.email || "", p.name || "");
            }
        }
    }

    function addAgentProfileRow_(email, name) {
        const body = $("agentProfilesBody");
        if (!body) return;
        const tr = document.createElement("tr");
        tr.dataset.agentProfileRow = "1";
        const tdEmail = document.createElement("td");
        const emailInput = document.createElement("input");
        emailInput.type = "email";
        emailInput.className = "profile-email";
        emailInput.dataset.profileEmail = "1";
        emailInput.placeholder = "agent@company.com";
        emailInput.autocomplete = "off";
        emailInput.value = email || "";
        tdEmail.appendChild(emailInput);
        const tdName = document.createElement("td");
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "profile-name";
        nameInput.dataset.profileName = "1";
        nameInput.placeholder = "Display name";
        nameInput.autocomplete = "off";
        nameInput.value = name || "";
        tdName.appendChild(nameInput);
        const tdAct = document.createElement("td");
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "btn ghost small profile-remove";
        rm.title = "Remove";
        rm.textContent = "Remove";
        rm.addEventListener("click", () => tr.remove());
        tdAct.appendChild(rm);
        tr.appendChild(tdEmail);
        tr.appendChild(tdName);
        tr.appendChild(tdAct);
        body.appendChild(tr);
    }

    function formatTime_(iso) {
        if (!iso) return "—";
        try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return String(iso);
            let h = d.getHours();
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12;
            if (h === 0) h = 12;
            const hh = String(h).padStart(2, "0");
            const mm = String(d.getMinutes()).padStart(2, "0");
            const ss = String(d.getSeconds()).padStart(2, "0");
            return hh + ":" + mm + ":" + ss + " " + ampm;
        } catch {
            return iso;
        }
    }

    function activitySummary_(row) {
        const t = row.type || "event";
        const who = row.agentEmail || "—";
        const conv = row.conversationId ? shortId_(row.conversationId) : "";
        const visitor = row.visitorName ? " · " + row.visitorName : "";
        if (t === "accept") return who + " accepted " + conv + visitor;
        if (t === "close") return who + " closed " + conv + visitor;
        if (t === "reopen") return who + " reopened " + conv;
        if (t === "status") {
            const m = row.meta || {};
            return who + " status " + (m.from || "?") + " → " + (m.to || "?");
        }
        return who + " · " + t + (conv ? " " + conv : "");
    }

    function shortId_(id) {
        const s = String(id || "");
        return s.length > 16 ? s.slice(0, 14) + "…" : s;
    }

    async function loadAgentsOverview_() {
        const statusEl = $("agentsOverviewStatus");
        const body = $("agentsOverviewBody");
        const activityList = $("agentsActivityList");
        if (!body) return;
        if (statusEl) statusEl.textContent = "Loading…";
        try {
            const [agentsRes, activityRes] = await Promise.all([
                apiFetch(`${API}/agents`),
                apiFetch(`${API}/activity?limit=40`)
            ]);
            body.innerHTML = "";
            const profiles =
                (lastDeskSettings &&
                    lastDeskSettings.general &&
                    lastDeskSettings.general.agentProfiles) ||
                [];
            const profileMap = new Map(
                profiles.map((p) => [String(p.email || "").toLowerCase(), String(p.name || "").trim()])
            );
            for (const a of agentsRes.agents || []) {
                const tr = document.createElement("tr");
                const display =
                    profileMap.get(String(a.email || "").toLowerCase()) || "—";
                tr.innerHTML =
                    "<td>" +
                    escapeHtml_(display) +
                    '<br /><span class="muted small">' +
                    escapeHtml_(a.email) +
                    "</span></td><td><span class=\"agent-pill status-" +
                    escapeHtml_(a.effectiveStatus || "offline") +
                    "\">" +
                    escapeHtml_(a.effectiveStatus || "offline") +
                    "</span></td><td>" +
                    String(a.activeChats || 0) +
                    "</td><td>" +
                    String(a.totalAccepted || 0) +
                    "</td><td>" +
                    String(a.totalClosed || 0) +
                    "</td><td>" +
                    escapeHtml_(formatTime_(a.lastAcceptedAt)) +
                    "</td>";
                body.appendChild(tr);
            }
            if (activityList) {
                activityList.innerHTML = "";
                for (const row of activityRes.activity || []) {
                    const li = document.createElement("li");
                    li.className = "agents-activity-item type-" + (row.type || "event");
                    li.innerHTML =
                        "<span class=\"agents-activity-when muted small\">" +
                        escapeHtml_(formatTime_(row.createdAt)) +
                        "</span> " +
                        escapeHtml_(activitySummary_(row));
                    activityList.appendChild(li);
                }
            }
            if (statusEl) {
                statusEl.textContent = (agentsRes.agents || []).length
                    ? "Updated " + formatTime_(new Date().toISOString())
                    : "No agents yet — add emails under Departments.";
            }
        } catch (e) {
            if (statusEl) statusEl.textContent = e.message;
        }
    }

    function escapeHtml_(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    async function loadAll() {
        const data = await apiFetch(`${API}/settings`);
        applyDeskSettings_(data.settings || {});
        lastDepartments_ = data.departments || [];
        renderKnowledgeBase_(data.knowledgeBase || (data.settings && data.settings.knowledgeBase) || {});
        renderDepartments(data.departments || []);
        loadAgentsOverview_();
    }

    function parseEmails_(text) {
        return String(text || "")
            .split(/[\n,;]+/)
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s && s.includes("@"));
    }

    function renderDepartments(list) {
        const root = $("deptList");
        root.innerHTML = "";
        for (const d of list) {
            const card = document.createElement("div");
            card.className = "dept-item";
            const title = document.createElement("h3");
            title.textContent = d.name + (d.isSystem ? " (default)" : "");
            const meta = document.createElement("p");
            meta.className = "dept-meta";
            meta.textContent =
                "ID: " +
                d.id +
                " · " +
                (d.agentEmails.length ? d.agentEmails.length + " agent(s)" : "No agents — any staff can accept");
            const ta = document.createElement("textarea");
            ta.value = (d.agentEmails || []).join("\n");
            const actions = document.createElement("div");
            actions.className = "dept-item-actions";
            const saveBtn = document.createElement("button");
            saveBtn.type = "button";
            saveBtn.className = "btn primary small";
            saveBtn.textContent = "Save department";
            saveBtn.addEventListener("click", async () => {
                saveBtn.disabled = true;
                try {
                    await apiFetch(`${API}/departments/${encodeURIComponent(d.id)}`, {
                        method: "PUT",
                        body: JSON.stringify({ agentEmails: parseEmails_(ta.value) })
                    });
                    $("deptFormStatus").textContent = "Department saved: " + d.name;
                    await loadAll();
                } catch (e) {
                    alert(e.message);
                } finally {
                    saveBtn.disabled = false;
                }
            });
            actions.appendChild(saveBtn);
            if (!d.isSystem) {
                const delBtn = document.createElement("button");
                delBtn.type = "button";
                delBtn.className = "btn danger small";
                delBtn.textContent = "Delete";
                delBtn.addEventListener("click", async () => {
                    if (!confirm("Delete department " + d.name + "?")) return;
                    try {
                        await apiFetch(`${API}/departments/${encodeURIComponent(d.id)}`, {
                            method: "DELETE"
                        });
                        await loadAll();
                    } catch (e) {
                        alert(e.message);
                    }
                });
                actions.appendChild(delBtn);
            }
            card.appendChild(title);
            card.appendChild(meta);
            card.appendChild(ta);
            card.appendChild(actions);
            root.appendChild(card);
        }
    }

    $("loginForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        viewerSecret = $("loginSecret").value.trim();
        if (!viewerSecret) return;
        try {
            sessionStorage.setItem(LS_SECRET, viewerSecret);
            localStorage.setItem(LS_SECRET, viewerSecret);
        } catch (_) {
            /* ignore */
        }
        try {
            await apiFetch(`${API}/me`);
            if (redirectNextIfPresent_()) return;
            showApp();
        } catch (e) {
            $("loginMessage").textContent = e.message;
        }
    });

    async function saveDeskConfiguration_(statusEl, sectionLabel) {
        const kbCheck = validateKnowledgeBaseDom_();
        if (!kbCheck.ok) {
            if (statusEl) statusEl.textContent = kbCheck.message;
            throw new Error(kbCheck.message);
        }
        if (statusEl) statusEl.textContent = "Saving…";
        const payload = readDeskPayload_();
        const kbCount = (payload.knowledgeBase && payload.knowledgeBase.articles) || [];
        await apiFetch(`${API}/settings`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
        await loadAll();
        let msg = sectionLabel ? sectionLabel + " saved." : "Configuration saved.";
        if (sectionLabel === "Knowledge base" || (kbCount.length && sectionLabel)) {
            msg +=
                " " +
                kbCount.length +
                " article" +
                (kbCount.length === 1 ? "" : "s") +
                " — scroll up in Knowledge base to edit.";
        }
        if (statusEl) statusEl.textContent = msg;
        return msg;
    }

    document.querySelectorAll(".section-save-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const bar = btn.closest(".section-save-bar");
            const statusEl = bar && bar.querySelector(".section-save-status");
            const label = btn.getAttribute("data-section-label") || "";
            btn.disabled = true;
            try {
                await saveDeskConfiguration_(statusEl, label);
            } catch (e) {
                if (statusEl) statusEl.textContent = e.message;
            } finally {
                btn.disabled = false;
            }
        });
    });

    $("deskConfigForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const status = $("deskConfigStatus");
        const submitBtn = ev.submitter;
        if (submitBtn) submitBtn.disabled = true;
        try {
            await saveDeskConfiguration_(status, "All configuration");
        } catch (e) {
            status.textContent = e.message;
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });

    $("deptForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const name = $("deptName").value.trim();
        if (!name) return;
        try {
            await apiFetch(`${API}/departments`, {
                method: "POST",
                body: JSON.stringify({
                    name,
                    agentEmails: parseEmails_($("deptEmails").value)
                })
            });
            $("deptName").value = "";
            $("deptEmails").value = "";
            $("deptFormStatus").textContent = "Department created.";
            await loadAll();
        } catch (e) {
            $("deptFormStatus").textContent = e.message;
        }
    });

    $("logoutBtn").addEventListener("click", () => {
        viewerSecret = "";
        try {
            sessionStorage.removeItem(LS_SECRET);
            localStorage.removeItem(LS_SECRET);
        } catch (_) {
            /* ignore */
        }
        showLogin();
    });

    if ($("toggleSecretBtn") && $("loginSecret")) {
        $("toggleSecretBtn").addEventListener("click", () => {
            $("loginSecret").type = $("loginSecret").type === "password" ? "text" : "password";
        });
    }

    if ($("refreshAgentsOverviewBtn")) {
        $("refreshAgentsOverviewBtn").addEventListener("click", () => loadAgentsOverview_());
    }

    if ($("addAgentProfileBtn")) {
        $("addAgentProfileBtn").addEventListener("click", () => addAgentProfileRow_("", ""));
    }

    if ($("addKbArticleBtn")) {
        $("addKbArticleBtn").addEventListener("click", () => addKbArticleRow_({}));
    }

    function updateNotifyPermissionStatus_() {
        const el = $("notifyPermissionStatus");
        if (!el) return;
        if (!("Notification" in window)) {
            el.textContent =
                "This browser does not support pop-ups. Use the 🔔 panel on the service desk.";
            return;
        }
        const p = Notification.permission;
        if (p === "granted") {
            el.textContent = "Allowed on this device — pop-ups are enabled.";
        } else if (p === "denied") {
            el.textContent =
                "Blocked. In Chrome: site settings → Notifications → Allow, then tap the button again.";
        } else {
            el.textContent = "Not allowed yet — tap the button (required on mobile Chrome).";
        }
    }

    const allowNotifyThisDeviceBtn = $("allowNotifyThisDeviceBtn");
    if (allowNotifyThisDeviceBtn) {
        allowNotifyThisDeviceBtn.addEventListener("click", async () => {
            if (!("Notification" in window)) {
                updateNotifyPermissionStatus_();
                return;
            }
            try {
                const p = await Notification.requestPermission();
                updateNotifyPermissionStatus_();
                if (p === "granted") {
                    const title = "Live agent alerts enabled";
                    const body = "You will get pop-ups when a visitor requests a human agent.";
                    let shown = false;
                    if ("serviceWorker" in navigator) {
                        try {
                            const reg = await navigator.serviceWorker.register(
                                "/live-agent/notification-sw.js",
                                { scope: "/live-agent/" }
                            );
                            await navigator.serviceWorker.ready;
                            const active = reg.active || navigator.serviceWorker.controller;
                            if (active) {
                                active.postMessage({
                                    type: "SHOW_HANDOFF",
                                    title: title,
                                    body: body,
                                    tag: "live-agent-settings-test"
                                });
                                shown = true;
                            }
                        } catch (_) {
                            /* fallback below */
                        }
                    }
                    if (!shown) {
                        try {
                            new Notification(title, { body: body, tag: "live-agent-settings-test" });
                        } catch (_) {
                            /* ignore */
                        }
                    }
                }
            } catch (e) {
                const el = $("notifyPermissionStatus");
                if (el) el.textContent = e.message || "Could not request permission";
            }
        });
    }

    loadSecret();
    if (viewerSecret) {
        apiFetch(`${API}/me`)
            .then(() => {
                if (!redirectNextIfPresent_()) showApp();
            })
            .catch(() => showLogin());
    } else {
        showLogin();
    }
})();
