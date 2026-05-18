(function () {
    "use strict";

    const API = "/api/live-agent";
    const LS_SECRET = "conversations_sheet_secret_v1";
    const LS_SECRET_LEGACY = "live_agent_secret_v1";
    const LS_NAME = "live_agent_name_v1";

    const $ = (id) => document.getElementById(id);

    const loginView = $("loginView");
    const appView = $("appView");
    const loginForm = $("loginForm");
    const loginSecret = $("loginSecret");
    const loginAgentName = $("loginAgentName");
    const loginMessage = $("loginMessage");
    const toggleSecretBtn = $("toggleSecretBtn");
    const agentLabel = $("agentLabel");
    const notifyPill = $("notifyPill");
    const inboxFilter = $("inboxFilter");
    const refreshInboxBtn = $("refreshInboxBtn");
    const logoutBtn = $("logoutBtn");
    const inboxStatus = $("inboxStatus");
    const clearTestQueueBtn = $("clearTestQueueBtn");
    const inboxList = $("inboxList");
    const chatEmpty = $("chatEmpty");
    const chatActive = $("chatActive");
    const chatTitle = $("chatTitle");
    const chatMeta = $("chatMeta");
    const claimBtn = $("claimBtn");
    const claimHint = $("claimHint");
    const chatClosedBanner = $("chatClosedBanner");
    const reopenChatBtn = $("reopenChatBtn");
    const messageList = $("messageList");
    const composerForm = $("composerForm");
    const composerInput = $("composerInput");
    const sendBtn = $("sendBtn");
    const chatActionsBar = $("chatActionsBar");
    const chatModeStatus = $("chatModeStatus");
    const enableChatbotBtn = $("enableChatbotBtn");
    const takeHumanBtn = $("takeHumanBtn");
    const endChatFooterBtn = $("endChatFooterBtn");
    const refreshChatBtn = $("refreshChatBtn");
    const copySessionBtn = $("copySessionBtn");
    const transcriptFooterBtn = $("transcriptFooterBtn");
    const dismissFooterBtn = $("dismissFooterBtn");
    const contextEmpty = $("contextEmpty");
    const contextBody = $("contextBody");
    const modeStatusLine = $("modeStatusLine");
    const contactDl = $("contactDl");
    const documentsList = $("documentsList");
    const documentsEmpty = $("documentsEmpty");
    const transcriptLink = $("transcriptLink");
    const leadsLink = $("leadsLink");
    const myAgentStatus = $("myAgentStatus");
    const agentsList = $("agentsList");
    const refreshAgentsBtn = $("refreshAgentsBtn");
    const agentsPanelStatus = $("agentsPanelStatus");

    let viewerSecret = "";
    let agentId = "Agent";
    let selectedId = "";
    let selectedConv = null;
    /** @type {Record<string, unknown> | null} */
    let selectedVisitorContext = null;
    let lastMessageIso = "";
    /** Tracks unread on the open chat so a bump forces a full message resync. */
    let lastSelectedUnreadAgent = 0;
    let pollTimer = null;
    let inboxPollTimer = null;
    let inboxInFlight = false;
    let messagesInFlight = false;
    let lastWaitingCount = 0;
    let notificationsOk = false;
    let deskSettings = null;
    const INBOX_POLL_INTERVAL_MS = 28000;
    const CHAT_POLL_INTERVAL_MS = 6000;
    const PRESENCE_INTERVAL_MS = 180000;
    let agentsPanelLoaded = false;
    let presenceTimer = null;

    function loadStoredAuth_() {
        try {
            viewerSecret =
                sessionStorage.getItem(LS_SECRET) ||
                localStorage.getItem(LS_SECRET) ||
                sessionStorage.getItem(LS_SECRET_LEGACY) ||
                localStorage.getItem(LS_SECRET_LEGACY) ||
                "";
        } catch (_) {
            viewerSecret = "";
        }
        try {
            agentId = normalizeAgentId_(sessionStorage.getItem(LS_NAME) || localStorage.getItem(LS_NAME));
        } catch (_) {
            agentId = "agent";
        }
        if (loginSecret && viewerSecret) loginSecret.value = viewerSecret;
        if (loginAgentName && agentId) loginAgentName.value = agentId;
    }

    function normalizeAgentId_(name) {
        const s = String(name || "").trim();
        return (s || "Agent").toLowerCase();
    }

    function agentIdsMatch_(assigned, mine) {
        return normalizeAgentId_(assigned) === normalizeAgentId_(mine);
    }

    function persistAuth_(secret, name) {
        viewerSecret = String(secret || "").trim();
        agentId = normalizeAgentId_(name);
        try {
            sessionStorage.setItem(LS_SECRET, viewerSecret);
            localStorage.setItem(LS_SECRET, viewerSecret);
            sessionStorage.setItem(LS_NAME, agentId);
            localStorage.setItem(LS_NAME, agentId);
        } catch (_) {
            /* ignore */
        }
    }

    function clearAuth_() {
        viewerSecret = "";
        try {
            sessionStorage.removeItem(LS_SECRET);
            localStorage.removeItem(LS_SECRET);
        } catch (_) {
            /* ignore */
        }
    }

    function authHeaders_() {
        return {
            Accept: "application/json",
            "X-Conversations-Sheet-Secret": viewerSecret,
            "X-Live-Agent-Email": agentId,
            "X-Live-Agent-Name": agentId
        };
    }

    function showLogin() {
        document.body.classList.remove("live-agent-locked");
        loginView.classList.remove("hidden");
        appView.classList.add("hidden");
        stopPolling();
        stopPresence_();
    }

    async function checkLiveAgentBackend_() {
        try {
            const h = await fetch("/api/live-agent/health", { credentials: "same-origin" });
            const data = await h.json().catch(() => ({}));
            if (!h.ok || !data.firestore_ready) {
                inboxStatus.textContent =
                    "Live agent storage not ready on server (check FIREBASE_SERVICE_ACCOUNT_JSON).";
                return false;
            }
            return true;
        } catch (e) {
            inboxStatus.textContent = e.message || "Cannot reach live agent API.";
            return false;
        }
    }

    function showApp() {
        document.body.classList.add("live-agent-locked");
        loginView.classList.add("hidden");
        appView.classList.remove("hidden");
        agentLabel.textContent = agentId;
        if (!agentId.includes("@") && inboxStatus) {
            inboxStatus.textContent =
                "Add your work email: lock the desk, sign in again with you@company.com (required for Accept chat).";
        }
        requestNotificationPermission_();
        loadDeskSettings_().then(() => {
            checkLiveAgentBackend_().then((ok) => {
                if (ok) loadInbox();
            });
        });
        startPresence_();
        startPolling();
    }

    function stopPresence_() {
        if (presenceTimer) {
            clearInterval(presenceTimer);
            presenceTimer = null;
        }
    }

    async function postPresence_(status) {
        if (!viewerSecret || !agentId || !agentId.includes("@")) return;
        try {
            const body = status ? { status } : {};
            const data = await apiFetch(`${API}/presence`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            if (data.agent && myAgentStatus && status) {
                const eff = data.agent.effectiveStatus || data.agent.status;
                if (eff && myAgentStatus.value !== eff && eff !== "offline") {
                    myAgentStatus.value = data.agent.status || eff;
                }
            }
        } catch (_) {
            /* ignore */
        }
    }

    function startPresence_() {
        stopPresence_();
        if (!agentId || !agentId.includes("@")) return;
        const st = myAgentStatus ? myAgentStatus.value || "online" : "online";
        postPresence_(st);
        presenceTimer = setInterval(() => {
            if (document.hidden) return;
            const cur = myAgentStatus ? myAgentStatus.value || "online" : "online";
            postPresence_(cur);
        }, PRESENCE_INTERVAL_MS);
    }

    function agentStatusLabel_(s) {
        const x = String(s || "offline").toLowerCase();
        if (x === "online") return "Online";
        if (x === "away") return "Away";
        return "Offline";
    }

    async function loadAgentsPanel_(force) {
        if (!agentsList) return;
        if (!force && agentsPanelLoaded) return;
        if (agentsPanelStatus) agentsPanelStatus.textContent = "Loading…";
        try {
            const data = await apiFetch(`${API}/agents`);
            renderAgentsList_(data.agents || []);
            agentsPanelLoaded = true;
            if (agentsPanelStatus) {
                agentsPanelStatus.textContent = (data.agents || []).length
                    ? ""
                    : "Add agent emails in Settings → Departments.";
            }
        } catch (e) {
            if (agentsPanelStatus) agentsPanelStatus.textContent = e.message || "Could not load agents";
        }
    }

    function renderAgentsList_(agents) {
        if (!agentsList) return;
        agentsList.innerHTML = "";
        for (const a of agents || []) {
            const li = document.createElement("li");
            li.className = "agents-list-item status-" + escapeHtml(a.effectiveStatus || "offline");
            const stats =
                (a.activeChats || 0) +
                " active · " +
                (a.totalAccepted || 0) +
                " accepted";
            li.innerHTML =
                '<span class="agents-list-email">' +
                escapeHtml(a.email) +
                '</span><span class="agents-list-badge">' +
                escapeHtml(agentStatusLabel_(a.effectiveStatus)) +
                '</span><span class="agents-list-meta muted small">' +
                escapeHtml(stats) +
                "</span>";
            li.title =
                a.lastAcceptedAt
                    ? "Last accept: " + formatTime(a.lastAcceptedAt)
                    : "No accepts yet";
            agentsList.appendChild(li);
        }
    }

    function buildInboxSubtitle_(c) {
        if (!c) return "";
        const parts = [];
        if (c.departmentName || c.departmentId) {
            parts.push(c.departmentName || c.departmentId);
        }
        if (c.currentAssigneeEmail) {
            parts.push("Queue: " + c.currentAssigneeEmail);
        }
        if (c.acceptedByEmail && c.status === "active") {
            parts.push("Accepted: " + c.acceptedByEmail);
            if (c.acceptedAt) parts.push(formatTime(c.acceptedAt));
        }
        return parts.join(" · ") || "—";
    }

    function startPolling() {
        stopPolling();
        const tick = () => {
            if (document.hidden) return;
            if (
                selectedId &&
                selectedConv &&
                (selectedConv.status === "active" || selectedConv.status === "waiting")
            ) {
                loadMessages(selectedId, true);
            }
        };
        loadInbox(true);
        tick();
        pollTimer = setInterval(tick, CHAT_POLL_INTERVAL_MS);
        inboxPollTimer = setInterval(() => {
            if (document.hidden) return;
            loadInbox(true);
        }, INBOX_POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (inboxPollTimer) {
            clearInterval(inboxPollTimer);
            inboxPollTimer = null;
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && appView && !appView.classList.contains("hidden")) {
            loadInbox(true);
            if (selectedId) loadMessages(selectedId, true);
        }
    });

    async function apiFetch(url, options) {
        const opts = options || {};
        const res = await fetch(url, {
            credentials: "same-origin",
            ...opts,
            headers: {
                ...authHeaders_(),
                ...(opts.headers || {})
            }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error((data && data.error) || res.statusText || "Request failed");
            err.status = res.status;
            throw err;
        }
        return data;
    }

    function requestNotificationPermission_() {
        if (!("Notification" in window) || Notification.permission === "granted") {
            notificationsOk = Notification.permission === "granted";
            return;
        }
        if (Notification.permission === "default") {
            Notification.requestPermission().then((p) => {
                notificationsOk = p === "granted";
            });
        }
    }

    function deskGeneral_() {
        return (deskSettings && deskSettings.general) || {};
    }

    function deskAccess_() {
        return (deskSettings && deskSettings.access) || {};
    }

    function resolveAgentDisplayName_(email) {
        const e = String(email || "")
            .trim()
            .toLowerCase();
        if (!e) return "Agent";
        const profiles = deskGeneral_().agentProfiles || [];
        for (let i = 0; i < profiles.length; i += 1) {
            const p = profiles[i];
            if (p && String(p.email || "").toLowerCase() === e && String(p.name || "").trim()) {
                return String(p.name).trim();
            }
        }
        return "Agent";
    }

    function agentLabelForMessage_(m) {
        const stored =
            m && typeof m.senderDisplayName === "string" ? m.senderDisplayName.trim() : "";
        if (stored) return stored;
        if (m && m.senderEmail) return resolveAgentDisplayName_(m.senderEmail);
        return "Agent";
    }

    function playNotificationSound_() {
        const sound = deskGeneral_().notificationSound || "default";
        if (sound === "none" || deskGeneral_().muteServiceDesk) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g);
            g.connect(ctx.destination);
            o.frequency.value = sound === "chime" ? 660 : 880;
            g.gain.value = sound === "chime" ? 0.05 : 0.04;
            o.start();
            o.stop(ctx.currentTime + (sound === "chime" ? 0.2 : 0.12));
        } catch (_) {
            /* ignore */
        }
    }

    function notifyNewRequests_(count) {
        if (count <= 0 || deskGeneral_().muteServiceDesk) return;
        document.title = count + " waiting · Live chat";
        if (notificationsOk) {
            try {
                new Notification("Live chat — visitor waiting", {
                    body: count + " request(s) need an agent.",
                    tag: "live-agent-waiting"
                });
            } catch (_) {
                /* ignore */
            }
        }
        playNotificationSound_();
    }

    function formatUnreadCount_(n) {
        const x = Number(n) || 0;
        if (x <= 0) return "";
        return x > 99 ? "99+" : String(x);
    }

    function applyInboxFilterOptions_() {
        if (!inboxFilter) return;
        const access = deskAccess_();
        const saved = inboxFilter.value;
        for (const opt of inboxFilter.options) {
            const key = opt.getAttribute("data-tab");
            if (!key) continue;
            opt.hidden = access[key] === false;
        }
        const visible = Array.from(inboxFilter.options).filter((o) => !o.hidden);
        if (!visible.length) return;
        if (!visible.some((o) => o.value === saved)) {
            inboxFilter.value = visible[0].value;
        }
    }

    async function loadDeskSettings_() {
        try {
            const data = await apiFetch(`${API}/settings`);
            deskSettings = data.settings || null;
            applyInboxFilterOptions_();
        } catch (_) {
            deskSettings = null;
        }
    }

    function updateNotifyPill_(conversations) {
        if (!notifyPill) return;
        if (deskGeneral_().muteServiceDesk) {
            notifyPill.classList.add("hidden");
            document.title = "Live chat — agent inbox";
            return;
        }
        let waiting = 0;
        let unreadChats = 0;
        for (const c of conversations || []) {
            if (c.status === "waiting") waiting += 1;
            if ((c.unreadForAgent || 0) > 0) unreadChats += 1;
        }
        if (lastWaitingCount > 0 && waiting > lastWaitingCount) {
            notifyNewRequests_(waiting - lastWaitingCount);
        }
        lastWaitingCount = waiting;
        let label = "";
        if (waiting > 0) {
            label = waiting + (waiting === 1 ? " waiting" : " waiting");
        } else if (unreadChats > 0) {
            label = unreadChats + (unreadChats === 1 ? " unread chat" : " unread chats");
        }
        if (label) {
            notifyPill.textContent = label;
            notifyPill.classList.remove("hidden");
        } else {
            notifyPill.classList.add("hidden");
            document.title = "Live chat — agent inbox";
        }
    }

    async function checkSession() {
        if (!viewerSecret) {
            showLogin();
            return false;
        }
        try {
            const data = await apiFetch(`${API}/me`);
            if (data.ok) {
                agentId = normalizeAgentId_(data.agentId || agentId);
                agentLabel.textContent = agentId;
                showApp();
                return true;
            }
        } catch (e) {
            if (e.status === 401 || e.status === 403) {
                clearAuth_();
            } else if (e.status !== 401) {
                console.warn("[live-agent]", e.message);
            }
        }
        showLogin();
        return false;
    }

    if (toggleSecretBtn && loginSecret) {
        toggleSecretBtn.addEventListener("click", () => {
            loginSecret.type = loginSecret.type === "password" ? "text" : "password";
        });
    }

    loginForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const secret = loginSecret.value.trim();
        const email = (loginAgentName && loginAgentName.value.trim()) || "";
        if (!secret) {
            loginMessage.textContent = "Enter the viewer secret.";
            return;
        }
        if (!email.includes("@")) {
            loginMessage.textContent = "Enter your work email (e.g. you@company.com). Accept chat will not work without it.";
            return;
        }
        persistAuth_(secret, email);
        loginMessage.textContent = "Checking…";
        try {
            const data = await apiFetch(`${API}/me`);
            agentId = normalizeAgentId_(data.agentId || agentId);
            loginMessage.textContent = "";
            showApp();
        } catch (e) {
            clearAuth_();
            loginMessage.textContent = e.message || "Secret rejected.";
        }
    });

    logoutBtn.addEventListener("click", () => {
        postPresence_("offline").finally(() => {
            clearAuth_();
            selectedId = "";
            selectedConv = null;
            if (loginSecret) loginSecret.value = "";
            showLogin();
        });
    });

    if (leadsLink) {
        leadsLink.addEventListener("click", () => {
            try {
                sessionStorage.setItem(LS_SECRET, viewerSecret);
                localStorage.setItem(LS_SECRET, viewerSecret);
            } catch (_) {
                /* ignore */
            }
        });
    }

    refreshInboxBtn.addEventListener("click", () => loadInbox());
    if (refreshAgentsBtn) {
        refreshAgentsBtn.addEventListener("click", () => loadAgentsPanel_(true));
    }
    const toggleAgentsPanelBtn = $("toggleAgentsPanelBtn");
    const agentsPanelBody = $("agentsPanelBody");
    if (toggleAgentsPanelBtn && agentsPanelBody) {
        toggleAgentsPanelBtn.addEventListener("click", () => {
            const hidden = agentsPanelBody.classList.toggle("hidden");
            toggleAgentsPanelBtn.textContent = hidden ? "Show agents" : "Hide agents";
            if (refreshAgentsBtn) refreshAgentsBtn.hidden = hidden;
            if (!hidden) loadAgentsPanel_(true);
        });
    }
    if (myAgentStatus) {
        myAgentStatus.addEventListener("change", () => {
            postPresence_(myAgentStatus.value);
        });
    }
    inboxFilter.addEventListener("change", () => loadInbox());
    if (clearTestQueueBtn) {
        clearTestQueueBtn.addEventListener("click", () => {
            clearTestQueue_().catch((e) => alert(e.message || "Clear failed"));
        });
    }

    function formatTime(iso) {
        if (!iso) return "";
        try {
            return new Date(iso).toLocaleString();
        } catch {
            return iso;
        }
    }

    function escapeHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function shortSessionId_(id) {
        const s = String(id || "");
        if (s.length <= 14) return s;
        return s.slice(0, 12) + "…";
    }

    function isTestConversation_(c) {
        const id = String((c && c.id) || "");
        return /^test[-_]/i.test(id);
    }

    function updateClearTestBtn_(conversations) {
        if (!clearTestQueueBtn) return;
        const n = (conversations || []).filter(
            (c) => isTestConversation_(c) && (c.status === "waiting" || c.status === "active")
        ).length;
        clearTestQueueBtn.hidden = n < 1;
        clearTestQueueBtn.textContent = n > 1 ? "Clear " + n + " test chats" : "Clear test chats";
    }

    async function dismissConversation_(conversationId, opts) {
        const reloadInbox = !opts || opts.reloadInbox !== false;
        await apiFetch(`${API}/conversations/${encodeURIComponent(conversationId)}/close`, {
            method: "POST"
        });
        if (selectedId === conversationId) {
            selectedId = "";
            selectedConv = null;
            chatActive.classList.add("hidden");
            chatEmpty.classList.remove("hidden");
            contextEmpty.classList.remove("hidden");
            contextBody.classList.add("hidden");
        }
        if (reloadInbox) await loadInbox(true);
    }

    async function clearTestQueue_() {
        const data = await apiFetch(`${API}/inbox?status=all&limit=80`);
        const tests = (data.conversations || []).filter(
            (c) => isTestConversation_(c) && (c.status === "waiting" || c.status === "active")
        );
        if (!tests.length) {
            inboxStatus.textContent = "No test chats to clear (session id must start with test-).";
            return;
        }
        const n = tests.length;
        if (
            !confirm(
                "Close up to " +
                    n +
                    " test chat(s) in one go? Use clientSessionId \"test-my-demo\" in console tests to avoid creating hundreds of rows."
            )
        ) {
            return;
        }
        clearTestQueueBtn.disabled = true;
        inboxStatus.textContent = "Closing test chats…";
        try {
            let totalClosed = 0;
            let capped = false;
            for (let pass = 0; pass < 10; pass += 1) {
                const result = await apiFetch(`${API}/bulk-close-tests`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ idPrefix: "test-", limit: 200 })
                });
                totalClosed += result.closed || 0;
                capped = Boolean(result.capped);
                if (!result.closed || !capped) break;
            }
            inboxStatus.textContent =
                "Closed " + totalClosed + " test chat(s)." + (capped ? " Run again if more remain." : "");
            if (selectedId && isTestConversation_({ id: selectedId })) {
                selectedId = "";
                selectedConv = null;
                chatActive.classList.add("hidden");
                chatEmpty.classList.remove("hidden");
            }
            await loadInbox();
        } catch (e) {
            inboxStatus.textContent = e.message || "Clear failed";
        } finally {
            clearTestQueueBtn.disabled = false;
        }
    }

    function renderInbox(conversations) {
        inboxList.innerHTML = "";
        const seenIds = new Set();
        const queue = inboxFilter ? inboxFilter.value || "all" : "all";
        const showClosed = queue === "closed";
        const open = (conversations || []).filter((c) => {
            if (!c.id) return false;
            if (showClosed) return c.status === "closed";
            if (c.status === "closed") return false;
            if (seenIds.has(c.id)) return false;
            seenIds.add(c.id);
            return true;
        });
        if (!showClosed) updateNotifyPill_(open);
        updateClearTestBtn_(open);
        if (!open.length) {
            inboxStatus.textContent = "No conversations in this queue.";
            return;
        }
        inboxStatus.textContent = open.length + " request(s)";
        for (const c of open) {
            const li = document.createElement("li");
            li.className = "inbox-item" + (c.id === selectedId ? " selected" : "");
            if (c.unreadForAgent > 0) li.classList.add("has-unread");
            const assignee = (c.currentAssigneeEmail || "").toLowerCase();
            if (assignee && assignee === agentId && c.status === "waiting") {
                li.classList.add("assigned-to-me");
            }
            const title = c.visitorName || "Visitor";
            const unreadN = formatUnreadCount_(c.unreadForAgent);
            const unread = unreadN ? " · " + unreadN + " unread" : "";
            const mode = c.humanMode || c.status;
            const main = document.createElement("div");
            main.className = "inbox-item-main";
            main.innerHTML =
                '<p class="inbox-item-title">' +
                escapeHtml(title) +
                ' <span class="badge ' +
                escapeHtml(c.status) +
                '">' +
                escapeHtml(c.status) +
                "</span></p>" +
                '<p class="inbox-item-preview">' +
                escapeHtml(c.lastMessagePreview || "—") +
                "</p>" +
                '<p class="inbox-item-meta">' +
                escapeHtml(shortSessionId_(c.id)) +
                " · " +
                escapeHtml(c.status) +
                escapeHtml(unread) +
                "</p>" +
                '<p class="inbox-item-sub">' +
                escapeHtml(buildInboxSubtitle_(c)) +
                "</p>";
            li.appendChild(main);
            if (c.status === "waiting" || c.status === "active") {
                const actions = document.createElement("div");
                actions.className = "inbox-item-actions";
                const dismissBtn = document.createElement("button");
                dismissBtn.type = "button";
                dismissBtn.className = "btn ghost small inbox-dismiss";
                dismissBtn.textContent = "Dismiss";
                dismissBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    dismissBtn.disabled = true;
                    dismissConversation_(c.id).catch((e) => {
                        alert(e.message || "Could not dismiss");
                    }).finally(() => {
                        dismissBtn.disabled = false;
                    });
                });
                actions.appendChild(dismissBtn);
                li.appendChild(actions);
            }
            li.addEventListener("click", () => selectConversation(c));
            inboxList.appendChild(li);
        }
    }

    async function loadInbox(quiet) {
        if (inboxInFlight) return;
        inboxInFlight = true;
        if (!quiet) inboxStatus.textContent = "Loading…";
        try {
            const status = inboxFilter.value || "waiting";
            const light = quiet ? "&light=1" : "";
            const data = await apiFetch(
                `${API}/inbox?status=${encodeURIComponent(status)}&limit=50${light}`
            );
            const list = data.conversations || [];
            renderInbox(list);
            if (selectedId) {
                const hit = list.find((c) => c.id === selectedId);
                if (hit) {
                    const unreadNow = hit.unreadForAgent || 0;
                    if (unreadNow > lastSelectedUnreadAgent) {
                        lastMessageIso = "";
                        loadMessages(selectedId, true);
                    }
                    lastSelectedUnreadAgent = unreadNow;
                    selectedConv = hit;
                } else if (quiet) {
                    refreshSelectedConversation_();
                }
            }
        } catch (e) {
            inboxStatus.textContent = e.message || "Failed to load inbox";
            if (e.status === 401) {
                clearAuth_();
                showLogin();
            }
        } finally {
            inboxInFlight = false;
        }
    }

    function renderContextPanel(conv, visitor) {
        if (!selectedId) {
            contextEmpty.classList.remove("hidden");
            contextBody.classList.add("hidden");
            if (chatActionsBar) chatActionsBar.classList.add("hidden");
            return;
        }
        contextEmpty.classList.add("hidden");
        contextBody.classList.remove("hidden");

        const aiOn = conv && conv.aiEnabled !== false;
        const hm = (conv && conv.humanMode) || "ai";
        const modeText =
            hm === "waiting"
                ? "Visitor is waiting for a human agent."
                : hm === "human"
                  ? "Human agent chat — AI replies are off."
                  : "AI mode — bot can auto-reply.";
        const routeLine =
            "Dept: " +
            (conv.departmentName || conv.departmentId || "General") +
            " · " +
            (conv.currentAssigneeEmail
                ? "Queue: " + conv.currentAssigneeEmail
                : "Queue: unassigned") +
            " · " +
            modeText;
        if (modeStatusLine) modeStatusLine.textContent = routeLine;
        renderChatActionsBar_(conv, modeText);

        const v = visitor || {};
        const viewContact = deskAccess_().viewContact || "all";
        const assignedToMe =
            conv &&
            conv.status === "active" &&
            agentIdsMatch_(conv.assignedAgentEmail, agentId);
        const hideContact =
            viewContact === "none" || (viewContact === "assigned" && !assignedToMe);
        if (contactDl) {
            if (hideContact) {
                contactDl.innerHTML =
                    '<dt>Contact</dt><dd><span class="muted">Hidden by settings</span></dd>';
            } else {
            const rows = [
                ["Name", v.name],
                ["Email", v.email],
                ["Mobile", v.mobile],
                ["Channel", v.channel],
                ["Session", v.sessionId || selectedId]
            ];
            contactDl.innerHTML = rows
                .map(
                    ([k, val]) =>
                        "<dt>" +
                        escapeHtml(k) +
                        "</dt><dd>" +
                        (val ? escapeHtml(val) : '<span class="muted">—</span>') +
                        "</dd>"
                )
                .join("");
            }
        }

        if (documentsList && documentsEmpty) {
            documentsList.innerHTML = "";
            const docs = v.documents || [];
            if (!docs.length) {
                documentsEmpty.classList.remove("hidden");
            } else {
                documentsEmpty.classList.add("hidden");
                for (const d of docs) {
                    const li = document.createElement("li");
                    if (d.url) {
                        li.innerHTML =
                            '<a href="' +
                            escapeHtml(d.url) +
                            '" target="_blank" rel="noopener noreferrer">' +
                            escapeHtml(d.label || "Document") +
                            "</a>";
                    } else {
                        li.textContent = d.label || "Document";
                    }
                    documentsList.appendChild(li);
                }
            }
        }

        if (transcriptLink) {
            const url = transcriptUrlForSession_(selectedId, v);
            transcriptLink.href = url;
            if (transcriptFooterBtn) transcriptFooterBtn.href = url;
        }
    }

    function transcriptUrlForSession_(sessionId, visitor) {
        const v = visitor || {};
        return v.transcriptUrl || "/conversation-transcript?session=" + encodeURIComponent(sessionId || "");
    }

    function renderChatActionsBar_(conv, modeText) {
        if (!chatActionsBar) return;
        if (!selectedId || !conv) {
            chatActionsBar.classList.add("hidden");
            return;
        }
        chatActionsBar.classList.remove("hidden");
        const hm = (conv && conv.humanMode) || conv.status || "ai";
        const aiOn = conv && conv.aiEnabled !== false;
        const st = conv.status || "";
        const statusLine =
            modeText ||
            (hm === "waiting"
                ? "Visitor is waiting for a human agent."
                : hm === "human"
                  ? "Human agent chat — AI replies are off."
                  : "AI mode — bot can auto-reply.");
        if (chatModeStatus) {
            chatModeStatus.textContent =
                statusLine +
                (aiOn ? " · Chatbot on" : " · Chatbot off") +
                " · " +
                st;
        }
        if (enableChatbotBtn) {
            enableChatbotBtn.classList.toggle("active-mode", hm === "ai" && aiOn);
            enableChatbotBtn.disabled = hm === "ai" && aiOn;
        }
        if (takeHumanBtn) {
            takeHumanBtn.disabled = (hm === "human" || hm === "waiting") && !aiOn;
        }
        if (endChatFooterBtn) {
            endChatFooterBtn.hidden = st !== "active" && st !== "waiting";
        }
        if (dismissFooterBtn) {
            dismissFooterBtn.hidden = st !== "waiting" && st !== "active";
        }
        if (transcriptFooterBtn && selectedId) {
            transcriptFooterBtn.href = transcriptUrlForSession_(selectedId, null);
        }
    }

    async function loadContext(conversationId) {
        try {
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(conversationId)}/context`
            );
            selectedConv = data.conversation || selectedConv;
            selectedVisitorContext = data.visitor || selectedVisitorContext;
            renderContextPanel(data.conversation, data.visitor);
        } catch (e) {
            renderContextPanel(selectedConv, null);
            console.warn("[live-agent] context", e.message);
        }
    }

    async function setMode_(patch) {
        if (!selectedId) return;
        const busy = [enableChatbotBtn, takeHumanBtn].filter(Boolean);
        const prevLabels = busy.map((b) => b.textContent);
        busy.forEach((b) => {
            b.disabled = true;
            if (patch.humanMode === "ai") {
                b.textContent = b.id === "enableChatbotBtn" ? "Enabling…" : b.textContent;
            } else if (patch.humanMode === "human") {
                b.textContent = b.id === "takeHumanBtn" ? "Taking over…" : b.textContent;
            }
        });
        try {
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(selectedId)}/mode`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch)
                }
            );
            if (!data || !data.conversation) {
                throw new Error("Mode update failed — no conversation returned");
            }
            selectedConv = data.conversation;
            applyConversationUi_(data.conversation, { skipContextReload: true });
            renderChatActionsBar_(data.conversation);
            void loadMessages(selectedId, true);
        } catch (e) {
            alert(e.message || "Could not update mode");
            if (selectedConv) {
                applyConversationUi_(selectedConv, { skipContextReload: true });
                renderChatActionsBar_(selectedConv);
            }
        } finally {
            busy.forEach((b, i) => {
                if (prevLabels[i]) b.textContent = prevLabels[i];
            });
            if (selectedConv) {
                renderChatActionsBar_(selectedConv);
            }
        }
    }

    if (enableChatbotBtn) {
        enableChatbotBtn.addEventListener("click", () =>
            setMode_({ humanMode: "ai", aiEnabled: true })
        );
    }
    if (takeHumanBtn) {
        takeHumanBtn.addEventListener("click", () =>
            setMode_({ humanMode: "human", aiEnabled: false })
        );
    }
    if (refreshChatBtn) {
        refreshChatBtn.addEventListener("click", () => {
            if (!selectedId) return;
            lastMessageIso = "";
            messageList.innerHTML = "";
            loadMessages(selectedId);
        });
    }
    if (copySessionBtn) {
        copySessionBtn.addEventListener("click", async () => {
            if (!selectedId) return;
            try {
                await navigator.clipboard.writeText(selectedId);
                copySessionBtn.textContent = "Copied!";
                setTimeout(() => {
                    copySessionBtn.textContent = "Copy session ID";
                }, 2000);
            } catch (_) {
                alert("Session ID: " + selectedId);
            }
        });
    }
    if (dismissFooterBtn) {
        dismissFooterBtn.addEventListener("click", () => {
            if (!selectedId) return;
            if (!confirm("Dismiss this request from the queue?")) return;
            dismissConversation_(selectedId).catch((e) => alert(e.message || "Dismiss failed"));
        });
    }

    function isStaleEndedSystemMsg_(m, conv) {
        if (!m || m.role !== "system" || !conv || conv.status === "closed") return false;
        const t = String(m.text || "").toLowerCase();
        return t.includes("chat has ended") || t.includes("ended.");
    }

    function applyConversationUi_(c, opts) {
        const conv = c || selectedConv;
        const skipContextReload = opts && opts.skipContextReload === true;
        if (!conv || !selectedId) return;

        const title = conv.visitorName || "Session " + conv.id.slice(0, 12);
        chatTitle.textContent = title;
        const statusLabel = conv.status === "closed" ? "closed" : conv.humanMode || conv.status;
        let meta =
            statusLabel +
            " · " +
            (conv.aiEnabled === false ? "AI off" : "AI on") +
            " · bot " +
            (conv.botid || "default");
        if (conv.acceptedByEmail) {
            meta += " · Accepted by " + resolveAgentDisplayName_(conv.acceptedByEmail);
            if (conv.acceptedAt) meta += " at " + formatTime(conv.acceptedAt);
        } else if (conv.assignedAgentEmail && conv.status === "active") {
            meta += " · Agent " + resolveAgentDisplayName_(conv.assignedAgentEmail);
        }
        if (conv.closedByEmail && conv.status === "closed") {
            meta += " · Closed by " + conv.closedByEmail;
        }
        chatMeta.textContent = meta;

        const isClosed = conv.status === "closed";
        const isWaiting = conv.status === "waiting";
        const isActive = conv.status === "active";
        const isMine = isActive && agentIdsMatch_(conv.assignedAgentEmail, agentId);
        const takenByOther =
            isActive && conv.assignedAgentEmail && !agentIdsMatch_(conv.assignedAgentEmail, agentId);
        const canReply = isMine;

        if (chatClosedBanner) chatClosedBanner.classList.toggle("hidden", !isClosed);
        if (claimBtn) claimBtn.hidden = !isWaiting || isClosed;
        if (claimHint) {
            claimHint.hidden = !isWaiting || isClosed;
            claimHint.textContent = isWaiting
                ? "Click Accept chat above — then you can type a reply below."
                : "";
        }
        if (composerForm) composerForm.classList.toggle("hidden", isClosed);
        if (chatActionsBar) chatActionsBar.classList.toggle("hidden", isClosed);
        if (composerInput) {
            composerInput.disabled = isClosed || !canReply;
            composerInput.placeholder = isClosed
                ? "Reopen this chat to reply…"
                : canReply
                  ? "Type a reply to the visitor…"
                  : isWaiting
                    ? "Accept this chat first to reply…"
                    : takenByOther
                      ? "Assigned to " +
                        (conv.assignedAgentEmail || "another agent") +
                        " — use another queue filter or ask them to close it."
                      : "Select a chat to reply…";
        }
        if (sendBtn) sendBtn.disabled = isClosed || !canReply;

        if (!skipContextReload) {
            renderContextPanel(conv, selectedVisitorContext);
        } else {
            renderChatActionsBar_(conv);
            if (modeStatusLine) {
                const hm = (conv && conv.humanMode) || "ai";
                const modeText =
                    hm === "waiting"
                        ? "Visitor is waiting for a human agent."
                        : hm === "human"
                          ? "Human agent chat — AI replies are off."
                          : "AI mode — bot can auto-reply.";
                const routeLine =
                    "Dept: " +
                    (conv.departmentName || conv.departmentId || "General") +
                    " · " +
                    modeText;
                modeStatusLine.textContent = routeLine;
            }
        }
        if (!skipContextReload) {
            renderChatActionsBar_(conv);
        }
    }

    async function refreshSelectedConversation_() {
        if (!selectedId) return null;
        try {
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(selectedId)}/context`
            );
            if (data.conversation) selectedConv = data.conversation;
            return data;
        } catch (e) {
            console.warn("[live-agent] refresh conversation", e.message);
            return null;
        }
    }

    async function reopenSelectedChat_() {
        if (!selectedId) return;
        if (reopenChatBtn) reopenChatBtn.disabled = true;
        try {
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(selectedId)}/reopen`,
                { method: "POST" }
            );
            selectedConv = data.conversation;
            lastMessageIso = "";
            messageList.innerHTML = "";
            applyConversationUi_(selectedConv);
            loadContext(selectedId);
            loadMessages(selectedId);
            loadInbox(true);
        } catch (e) {
            alert(e.message || "Could not reopen chat");
        } finally {
            if (reopenChatBtn) reopenChatBtn.disabled = false;
        }
    }

    function mergeConversationAfterRefresh_(picked, refreshed) {
        if (!refreshed || !refreshed.conversation) {
            return picked;
        }
        const r = refreshed.conversation;
        if (!picked || picked.status !== "active") {
            return r;
        }
        if (r.status === "active") {
            return r;
        }
        return {
            ...r,
            status: "active",
            humanMode: picked.humanMode || r.humanMode || "human",
            aiEnabled:
                typeof picked.aiEnabled === "boolean" ? picked.aiEnabled : r.aiEnabled,
            assignedAgentEmail: picked.assignedAgentEmail || r.assignedAgentEmail,
            acceptedByEmail: picked.acceptedByEmail || r.acceptedByEmail,
            acceptedAt: picked.acceptedAt || r.acceptedAt
        };
    }

    async function selectConversation(c, opts) {
        if (!c || !c.id) {
            throw new Error("Invalid conversation");
        }
        const skipRefresh = opts && opts.skipRefresh === true;
        selectedId = c.id;
        selectedConv = c;
        lastMessageIso = "";
        lastSelectedUnreadAgent = c.unreadForAgent || 0;
        messageList.innerHTML = "";
        chatEmpty.classList.add("hidden");
        chatActive.classList.remove("hidden");

        applyConversationUi_(c);

        if (!skipRefresh) {
            const refreshed = await refreshSelectedConversation_();
            const merged = mergeConversationAfterRefresh_(c, refreshed);
            selectedConv = merged;
            applyConversationUi_(merged);
            if (refreshed && refreshed.visitor) {
                selectedVisitorContext = refreshed.visitor;
                renderContextPanel(selectedConv, refreshed.visitor);
            } else {
                loadContext(c.id);
            }
        } else {
            loadContext(c.id);
        }
        loadMessages(c.id);
    }

    async function loadMessages(conversationId, quiet) {
        if (messagesInFlight) return;
        messagesInFlight = true;
        try {
            const q = lastMessageIso ? "?since=" + encodeURIComponent(lastMessageIso) : "";
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(conversationId)}/messages${q}`
            );
            const messages = data.messages || [];
            if (!messages.length && quiet) return;
            for (const m of messages) {
                if (document.querySelector('[data-msg-id="' + m.id + '"]')) continue;
                if (isStaleEndedSystemMsg_(m, selectedConv)) continue;
                appendMessageEl(m);
                if (m.createdAt) lastMessageIso = m.createdAt;
            }
            messageList.scrollTop = messageList.scrollHeight;
        } catch (e) {
            if (!quiet) {
                const p = document.createElement("p");
                p.className = "muted";
                p.textContent = e.message || "Could not load messages";
                messageList.appendChild(p);
            }
        } finally {
            messagesInFlight = false;
        }
    }

    function appendMessageEl(m) {
        const div = document.createElement("div");
        div.className = "msg " + (m.role || "visitor");
        div.dataset.msgId = m.id;
        let body = escapeHtml(m.text || "");
        if ((m.role === "agent" || m.role === "staff") && deskGeneral_().showAgentNameInChat !== false) {
            body =
                '<span class="msg-agent-name">' +
                escapeHtml(agentLabelForMessage_(m)) +
                "</span> " +
                body;
        }
        div.innerHTML = body + "<time>" + escapeHtml(formatTime(m.createdAt)) + "</time>";
        messageList.appendChild(div);
    }

    if (reopenChatBtn) {
        reopenChatBtn.addEventListener("click", () => reopenSelectedChat_());
    }

    claimBtn.addEventListener("click", async () => {
        if (!selectedId) return;
        claimBtn.disabled = true;
        try {
            const data = await apiFetch(`${API}/accept`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: selectedId })
            });
            if (!data || !data.conversation || !data.conversation.id) {
                throw new Error("Accept failed — no conversation returned from server");
            }
            await selectConversation(data.conversation, { skipRefresh: true });
            loadInbox(true);
            if (sendBtn) sendBtn.disabled = false;
            if (claimHint) {
                claimHint.classList.remove("claim-hint-error");
                claimHint.textContent = "";
            }
        } catch (e) {
            const msg = e.message || "Could not accept chat";
            if (claimHint) {
                claimHint.hidden = false;
                claimHint.textContent = msg;
                claimHint.classList.add("claim-hint-error");
            }
            if (/closed/i.test(msg) && confirm(msg + "\n\nReopen this chat and accept it?")) {
                await reopenSelectedChat_();
                try {
                    const data = await apiFetch(`${API}/accept`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ conversationId: selectedId })
                    });
                    await selectConversation(data.conversation);
                    if (claimHint) claimHint.classList.remove("claim-hint-error");
                } catch (e2) {
                    const m2 = e2.message || "Could not accept after reopen";
                    if (claimHint) claimHint.textContent = m2;
                    alert(m2);
                }
            } else if (/already have|maximum allowed/i.test(msg)) {
                alert(msg + "\n\nClose an active chat or raise Max concurrent windows in Live Agent Settings.");
            } else {
                alert(msg);
            }
            loadInbox(true);
        } finally {
            claimBtn.disabled = false;
        }
    });

    async function endChat_() {
        if (!selectedId || !confirm("End this chat for the visitor? They can request a human again later.")) return;
        try {
            await apiFetch(`${API}/conversations/${encodeURIComponent(selectedId)}/close`, {
                method: "POST"
            });
            selectedId = "";
            selectedConv = null;
            chatActive.classList.add("hidden");
            chatEmpty.classList.remove("hidden");
            contextEmpty.classList.remove("hidden");
            contextBody.classList.add("hidden");
            if (chatActionsBar) chatActionsBar.classList.add("hidden");
            loadInbox();
        } catch (e) {
            alert(e.message || "Could not close chat");
        }
    }

    if (endChatFooterBtn) {
        endChatFooterBtn.addEventListener("click", () => endChat_());
    }

    composerForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const text = composerInput.value.trim();
        if (!text || !selectedId) return;
        if (!agentId.includes("@")) {
            alert("Sign in with your work email to send messages.");
            return;
        }
        sendBtn.disabled = true;
        const optimisticId = "opt-" + Date.now();
        appendMessageEl({
            id: optimisticId,
            role: "agent",
            text,
            senderEmail: agentId,
            createdAt: new Date().toISOString()
        });
        composerInput.value = "";
        messageList.scrollTop = messageList.scrollHeight;
        try {
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(selectedId)}/messages`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text })
                }
            );
            const opt = messageList.querySelector('[data-msg-id="' + optimisticId + '"]');
            if (opt) opt.remove();
            if (data.message) {
                appendMessageEl(data.message);
                if (data.message.createdAt) lastMessageIso = data.message.createdAt;
            }
            if (data.conversation) {
                selectedConv = data.conversation;
                applyConversationUi_(data.conversation);
            }
            messageList.scrollTop = messageList.scrollHeight;
            loadInbox(true);
            loadMessages(selectedId, true);
        } catch (e) {
            const opt = messageList.querySelector('[data-msg-id="' + optimisticId + '"]');
            if (opt) opt.remove();
            composerInput.value = text;
            alert(e.message || "Send failed");
        } finally {
            if (sendBtn) sendBtn.disabled = !canReplyActive_();
        }
    });

    function canReplyActive_() {
        if (!selectedConv || !selectedId) return false;
        if (selectedConv.status === "closed") return false;
        if (selectedConv.status === "waiting") return true;
        if (selectedConv.status !== "active") return false;
        const assignee = (selectedConv.assignedAgentEmail || "").trim();
        if (!assignee) return true;
        return agentIdsMatch_(assignee, agentId);
    }

    loadStoredAuth_();
    checkSession();
})();
