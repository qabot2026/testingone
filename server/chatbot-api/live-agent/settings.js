(function () {
    "use strict";

    const API = "/api/live-agent";
    const LS_SECRET = "conversations_sheet_secret_v1";

    const $ = (id) => document.getElementById(id);

    let viewerSecret = "";
    /** @type {Record<string, unknown> | null} */
    let lastDeskSettings = null;

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

    function showApp() {
        $("loginView").classList.add("hidden");
        $("appView").classList.remove("hidden");
        loadAll();
    }

    function setChecked_(id, on) {
        const el = $(id);
        if (el) el.checked = !!on;
    }

    function setVal_(id, v) {
        const el = $(id);
        if (el) el.value = v == null ? "" : String(v);
    }

    function readDeskPayload_() {
        return {
            claimWaitSeconds: Number($("claimWaitSeconds").value) || 30,
            endConvWaitMinutes: Number($("endConvWaitMinutes").value) || 3,
            general: {
                muteServiceDesk: $("muteServiceDesk").checked,
                showAgentNameInChat: $("showAgentNameInChat").checked,
                enableAgentChatFeedback: $("enableAgentChatFeedback").checked,
                disableUserTextTranslation: $("disableUserTextTranslation").checked,
                sortChatsByLastMessage: $("sortChatsByLastMessage").checked,
                notificationSound: $("notificationSound").value || "default",
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
            }
        };
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
        setChecked_("muteServiceDesk", g.muteServiceDesk);
        setChecked_("showAgentNameInChat", g.showAgentNameInChat !== false);
        setChecked_("enableAgentChatFeedback", g.enableAgentChatFeedback);
        setChecked_("disableUserTextTranslation", g.disableUserTextTranslation);
        setChecked_("sortChatsByLastMessage", g.sortChatsByLastMessage !== false);
        setVal_("notificationSound", g.notificationSound || "default");
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
            return new Date(iso).toLocaleString();
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
                    ? "Updated " + new Date().toLocaleTimeString()
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
            saveBtn.textContent = "Save agents";
            saveBtn.addEventListener("click", async () => {
                saveBtn.disabled = true;
                try {
                    await apiFetch(`${API}/departments/${encodeURIComponent(d.id)}`, {
                        method: "PUT",
                        body: JSON.stringify({ agentEmails: parseEmails_(ta.value) })
                    });
                    $("deptFormStatus").textContent = "Saved " + d.name;
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
            showApp();
        } catch (e) {
            $("loginMessage").textContent = e.message;
        }
    });

    $("deskConfigForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const status = $("deskConfigStatus");
        try {
            const data = await apiFetch(`${API}/settings`, {
                method: "PUT",
                body: JSON.stringify(readDeskPayload_())
            });
            applyDeskSettings_(data.settings || {});
            status.textContent = "Configuration saved.";
        } catch (e) {
            status.textContent = e.message;
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

    loadSecret();
    if (viewerSecret) {
        apiFetch(`${API}/me`)
            .then(() => showApp())
            .catch(() => showLogin());
    } else {
        showLogin();
    }
})();
