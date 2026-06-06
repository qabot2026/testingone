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
    const notificationsWrap = $("notificationsWrap");
    const notificationsBtn = $("notificationsBtn");
    const notificationsBadge = $("notificationsBadge");
    const notificationsPanel = $("notificationsPanel");
    const notificationsList = $("notificationsList");
    const notificationsEmpty = $("notificationsEmpty");
    const markAllNotificationsReadBtn = $("markAllNotificationsReadBtn");
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
    const visitorTypingPreview = $("visitorTypingPreview");
    const composerForm = $("composerForm");
    const composerInput = $("composerInput");
    const sendBtn = $("sendBtn");
    const chatActionsBar = $("chatActionsBar");
    const chatModeStatus = $("chatModeStatus");
    const enableChatbotBtn = $("enableChatbotBtn");
    const endChatFooterBtn = $("endChatFooterBtn");
    const refreshChatBtn = $("refreshChatBtn");
    const copySessionBtn = $("copySessionBtn");
    const transcriptFooterBtn = $("transcriptFooterBtn");
    const dismissFooterBtn = $("dismissFooterBtn");
    const handoverBar = $("handoverBar");
    const handoverAgentSelect = $("handoverAgentSelect");
    const handoverBtn = $("handoverBtn");
    const contextEmpty = $("contextEmpty");
    const contextBody = $("contextBody");
    const modeStatusLine = $("modeStatusLine");
    const contactDl = $("contactDl");
    const documentsList = $("documentsList");
    const documentsEmpty = $("documentsEmpty");
    const transcriptLink = $("transcriptLink");
    const leadsLink = $("leadsLink");
    const myAgentStatus = $("myAgentStatus");
    const myAgentStatusIcon = $("myAgentStatusIcon");
    const agentsList = $("agentsList");
    const refreshAgentsBtn = $("refreshAgentsBtn");
    const agentsPanelStatus = $("agentsPanelStatus");
    const mobileBackBtn = $("mobileBackBtn");
    const deskHandoffToast = $("deskHandoffToast");
    const notificationsBackdrop = $("notificationsBackdrop");
    const enablePhoneNotifyBtn = $("enablePhoneNotifyBtn");
    const mobileDeskNav = $("mobileDeskNav");
    const mobileFilterChips = $("mobileFilterChips");
    const mobileAlertsView = $("mobileAlertsView");
    const notificationsListMobile = $("notificationsListMobile");
    const notificationsEmptyMobile = $("notificationsEmptyMobile");
    const mobileMenuSheet = $("mobileMenuSheet");
    const mobileDetailsSheet = $("mobileDetailsSheet");
    const mobileDetailsBody = $("mobileDetailsBody");
    const mobileKbSheet = $("mobileKbSheet");
    const kbPane = $("kbPane");
    const kbSearchInput = $("kbSearchInput");
    const kbResultsList = $("kbResultsList");
    const kbSearchHint = $("kbSearchHint");
    const kbSearchInputMobile = $("kbSearchInputMobile");
    const kbResultsListMobile = $("kbResultsListMobile");
    const mobileSheetBackdrop = $("mobileSheetBackdrop");
    const mobileNavWaitingBadge = $("mobileNavWaitingBadge");
    const mobileNavAlertsBadge = $("mobileNavAlertsBadge");
    const mobileRefreshInboxBtn = $("mobileRefreshInboxBtn");
    const mobileDetailsBtn = $("mobileDetailsBtn");
    let mobileDeskTab_ = "chats";

    let viewerSecret = "";
    let agentId = "Agent";
    let selectedId = "";
    let selectedConv = null;
    /** @type {Record<string, unknown> | null} */
    let selectedVisitorContext = null;
    let lastMessageIso = "";
    let lastMessageId = "";
    /** Tracks unread on the open chat so a bump forces a full message resync. */
    let lastSelectedUnreadAgent = 0;
    let pollTimer = null;
    let inboxPollTimer = null;
    let inboxInFlight = false;
    let messagesInFlight = false;
    let messagesPollPending = false;
    let messagePollsSinceFullSync = 0;
    let deskSyncRevision = 0;
    let liveSyncInFlight = false;
    let typingPulseInFlight = false;
    let typingPulseTimer = null;
    let lastPulseVisitorTyping = "";
    let agentTypingTimer = null;
    let lastAgentTypingSendMs = 0;
    let contextPollTicks = 0;
    let lastWaitingCount = 0;
    let notificationsOk = false;
    /** Conversation ids already seen in waiting queue (avoids duplicate alerts). */
    const knownHandoffIds_ = new Set();
    let handoffTrackingSeeded_ = false;
    /** Ms since epoch when this desk session opened — used to alert on chats requested after login. */
    let deskSessionStartedAt_ = 0;
    let handoffPollHiddenTimer = null;
    let notifySwRegistration_ = null;
    /** @type {Array<{id:string,conversationId:string,title:string,body:string,at:string,read:boolean}>} */
    let deskNotifications_ = [];
    let notificationsPanelOpen_ = false;
    const LS_DESK_NOTIFICATIONS = "live_agent_desk_notifications_v1";
    const MAX_DESK_NOTIFICATIONS = 40;
    let deskSettings = null;
    /** Last inbox payload — used for instant dismiss without waiting on refetch. */
    let lastInboxConversations_ = [];
    /** Chats being dismissed — hide until server close completes (avoids GCS race flash). */
    const dismissingConversationIds_ = new Set();
    const INBOX_POLL_INTERVAL_MS_DESKTOP = 4000;
    const INBOX_POLL_INTERVAL_MS_MOBILE = 6000;
    const CHAT_POLL_INTERVAL_MS = 800;
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
        const a = String(assigned || "").trim().toLowerCase();
        const m = String(mine || "").trim().toLowerCase();
        if (!a || !m) {
            return false;
        }
        if (a === m) {
            return true;
        }
        if (a.includes("@") && m.includes("@")) {
            return a === m;
        }
        if (a.includes("@") && !m.includes("@")) {
            return a.split("@")[0] === m;
        }
        if (!a.includes("@") && m.includes("@")) {
            return a === m.split("@")[0];
        }
        return false;
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
            if (!h.ok || !(data.firestore_ready || data.storage_ready)) {
                inboxStatus.textContent =
                    "Live agent storage not ready on server.";
                return false;
            }
            return true;
        } catch (e) {
            inboxStatus.textContent = e.message || "Cannot reach live agent API.";
            return false;
        }
    }

    function showApp() {
        deskSessionStartedAt_ = Date.now();
        handoffTrackingSeeded_ = false;
        knownHandoffIds_.clear();
        mobileDeskTab_ = "chats";
        document.body.classList.add("live-agent-locked");
        loginView.classList.add("hidden");
        appView.classList.remove("hidden");
        agentLabel.textContent = agentId;
        void registerNotificationServiceWorker_();
        if (!agentId.includes("@") && inboxStatus) {
            inboxStatus.textContent =
                "Add your work email: lock the desk, sign in again with you@company.com (required for Accept chat).";
        }
        loadDeskNotificationsFromStorage_();
        renderNotificationsPanel_();
        updateNotificationsBadge_();
        syncMobileDeskLayout_();
        syncMobileNavVisibility_();
        setMobileDeskTab_("chats");
        loadDeskSettings_().then(() => {
            updateNotificationPermissionUi_();
            if (!isMobileDevice_()) {
                void requestNotificationPermission_(false);
            }
            checkLiveAgentBackend_().then((ok) => {
                if (ok) {
                    void pollHandoffNotifications_(false).then(() => loadInbox());
                }
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
            syncMyAgentStatusIcon_();
        } catch (_) {
            /* ignore */
        }
    }

    function startPresence_() {
        stopPresence_();
        if (!agentId || !agentId.includes("@")) return;
        const st = myAgentStatus ? myAgentStatus.value || "online" : "online";
        syncMyAgentStatusIcon_();
        postPresence_(st);
        presenceTimer = setInterval(() => {
            if (document.hidden) return;
            const cur = myAgentStatus ? myAgentStatus.value || "online" : "online";
            postPresence_(cur);
        }, PRESENCE_INTERVAL_MS);
    }

    function agentStatusClass_(s) {
        const x = String(s || "offline").toLowerCase();
        if (x === "online" || x === "away") return x;
        return "offline";
    }

    function agentStatusLabel_(s) {
        const x = agentStatusClass_(s);
        if (x === "online") return "Online";
        if (x === "away") return "Away";
        return "Offline";
    }

    function agentStatusIconMarkup_(s) {
        return (
            '<span class="status-dot status-dot--' +
            escapeHtml(agentStatusClass_(s)) +
            '" aria-hidden="true"></span>'
        );
    }

    function syncMyAgentStatusIcon_() {
        if (!myAgentStatus) return;
        const cls = "status-dot status-dot--" + agentStatusClass_(myAgentStatus.value);
        if (myAgentStatusIcon) {
            myAgentStatusIcon.className = cls;
        }
        const menuIcon = $("myAgentStatusIconMenu");
        if (menuIcon) {
            menuIcon.className = cls;
        }
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
                agentStatusIconMarkup_(a.effectiveStatus) +
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

    function isPlausibleVisitorName_(s) {
        const t = String(s || "").trim();
        if (!t || t.length < 2 || t.length > 80) {
            return false;
        }
        if (/\d/.test(t) || /@/.test(t) || t.includes("?")) {
            return false;
        }
        const n = t.toLowerCase().replace(/\s+/g, " ");
        const blocked = new Set([
            "human agent",
            "live agent",
            "live chat",
            "request live agent",
            "request human agent",
            "speak to agent",
            "talk to agent",
            "connect to agent",
            "agent please",
            "customer service",
            "help",
            "menu",
            "hi",
            "hello"
        ]);
        if (blocked.has(n)) {
            return false;
        }
        if (/^(human|live)\s+(agent|chat)\b/.test(n)) {
            return false;
        }
        if (/\b(agent|chatbot|live\s*chat)\b/.test(n) && t.split(/\s+/).length <= 4) {
            return false;
        }
        return t.split(/\s+/).filter(Boolean).length <= 5;
    }

    function formatVisitorNameForDisplay_(s) {
        return String(s || "")
            .trim()
            .replace(/\s+/g, " ")
            .replace(/\b\w/g, (ch) => ch.toUpperCase());
    }

    function resolveVisitorDisplayName_(conv, visitor) {
        const v = visitor && typeof visitor === "object" ? visitor : {};
        const contactName =
            v.name && isPlausibleVisitorName_(v.name)
                ? formatVisitorNameForDisplay_(v.name)
                : "";
        const convName =
            conv && conv.visitorName && isPlausibleVisitorName_(conv.visitorName)
                ? formatVisitorNameForDisplay_(conv.visitorName)
                : "";
        if (contactName) {
            return contactName;
        }
        if (convName) {
            return convName;
        }
        const mobile = v.mobile ? String(v.mobile).trim() : "";
        const digits = mobile.replace(/\D/g, "");
        if (digits.length >= 4) {
            return "Visitor " + digits.slice(-4);
        }
        return "Visitor";
    }

    function inboxStatusLabel_(c) {
        const st = c && c.status ? String(c.status) : "";
        if (st === "waiting") {
            return "Waiting";
        }
        if (st === "active") {
            return "Active";
        }
        if (st === "closed") {
            return "Closed";
        }
        return st ? st.charAt(0).toUpperCase() + st.slice(1) : "—";
    }

    function deskRoutingMode_() {
        const r = deskSettings && deskSettings.routing;
        const algo =
            (r && r.algorithm) ||
            deskSettings.routingAlgorithm ||
            (r && r.mode) ||
            "online_parallel";
        return String(algo).toLowerCase() === "round_robin"
            ? "round_robin"
            : "online_parallel";
    }

    function isWaitingOfferedToMe_(c) {
        if (!c || c.status !== "waiting") return false;
        if (deskRoutingMode_() !== "round_robin") return true;
        const offered = (c.currentAssigneeEmail || "").trim();
        if (!offered) return true;
        return agentIdsMatch_(offered, agentId);
    }

    function buildInboxItemDetails_(c) {
        if (!c) {
            return "";
        }
        const dept = c.departmentName || c.departmentId || "General";
        const parts = ["Department: " + dept];
        if (c.status === "waiting" && deskRoutingMode_() === "round_robin") {
            const offered = (c.currentAssigneeEmail || "").trim();
            if (offered && agentIdsMatch_(offered, agentId)) {
                parts.push("Your turn — accept now");
            } else if (offered) {
                parts.push("Offered to " + resolveAgentDisplayName_(offered));
            }
        }
        const unreadN = Number(c.unreadForAgent) || 0;
        if (unreadN > 0) {
            parts.push("Unread: " + formatUnreadCount_(unreadN));
        }
        return parts.join(" · ");
    }

    function isMobileAgentDesk_() {
        try {
            if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) {
                return true;
            }
        } catch {
            /* ignore */
        }
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    }

    function setMobileSheetOpen_(which) {
        const menu = which === "menu";
        const details = which === "details";
        const chatmenu = which === "chatmenu";
        const kb = which === "kb";
        const mobileChatMenuSheet = $("mobileChatMenuSheet");
        if (mobileMenuSheet) {
            mobileMenuSheet.classList.toggle("hidden", !menu);
        }
        if (mobileDetailsSheet) {
            mobileDetailsSheet.classList.toggle("hidden", !details);
        }
        if (mobileKbSheet) {
            mobileKbSheet.classList.toggle("hidden", !kb);
        }
        if (mobileChatMenuSheet) {
            mobileChatMenuSheet.classList.toggle("hidden", !chatmenu);
        }
        const open = menu || details || chatmenu || kb;
        if (mobileSheetBackdrop) {
            mobileSheetBackdrop.classList.toggle("hidden", !open);
            mobileSheetBackdrop.setAttribute("aria-hidden", open ? "false" : "true");
        }
    }

    function syncMobileNavVisibility_() {
        if (!mobileDeskNav) return;
        const mobile = isMobileAgentDesk_();
        const inChatView =
            mobile && document.body.classList.contains("mobile-tab-chat");
        mobileDeskNav.hidden = !mobile || inChatView;
        document.body.classList.toggle("mobile-hide-bottom-nav", inChatView);
    }

    function setMobileDeskTab_(tab) {
        if (!isMobileAgentDesk_()) return;
        if (tab === "chat" && !selectedId) {
            tab = "chats";
        }
        mobileDeskTab_ = tab;
        document.body.classList.toggle("mobile-tab-chats", tab === "chats");
        document.body.classList.toggle("mobile-tab-alerts", tab === "alerts");
        document.body.classList.toggle("mobile-tab-chat", tab === "chat");
        if (mobileAlertsView) {
            mobileAlertsView.hidden = tab !== "alerts";
        }
        if (tab === "alerts") {
            setNotificationsPanelOpen_(false);
            renderNotificationsPanel_();
        }
        if (mobileDeskNav) {
            mobileDeskNav.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
                const t = btn.getAttribute("data-mobile-tab");
                btn.classList.toggle("active", t === tab || (tab === "chat" && t === "chats"));
                btn.setAttribute(
                    "aria-current",
                    t === tab || (tab === "chat" && t === "chats") ? "page" : "false"
                );
            });
        }
        syncMobileNavVisibility_();
    }

    function updateMobileNavBadges_(waitingCount, unreadAlerts) {
        const w = Number(waitingCount) || 0;
        const a = Number(unreadAlerts) || 0;
        if (mobileNavWaitingBadge) {
            mobileNavWaitingBadge.textContent = w > 99 ? "99+" : String(w);
            mobileNavWaitingBadge.classList.toggle("hidden", w <= 0);
        }
        if (mobileNavAlertsBadge) {
            mobileNavAlertsBadge.textContent = a > 99 ? "99+" : String(a);
            mobileNavAlertsBadge.classList.toggle("hidden", a <= 0);
        }
    }

    function buildMobileFilterChips_() {
        if (!mobileFilterChips || !inboxFilter) return;
        if (mobileFilterChips.dataset.built === "1") return;
        mobileFilterChips.dataset.built = "1";
        mobileFilterChips.innerHTML = "";
        const presets = [
            { value: "waiting", label: "Waiting" },
            { value: "mine", label: "Mine" },
            { value: "active", label: "Active" },
            { value: "all", label: "All" },
            { value: "unassigned", label: "New" }
        ];
        for (const p of presets) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "mobile-filter-chip";
            btn.setAttribute("data-filter", p.value);
            btn.textContent = p.label;
            btn.addEventListener("click", () => {
                inboxFilter.value = p.value;
                mobileFilterChips.querySelectorAll(".mobile-filter-chip").forEach((el) => {
                    el.classList.toggle("active", el.getAttribute("data-filter") === p.value);
                });
                loadInbox();
            });
            mobileFilterChips.appendChild(btn);
        }
        const cur = inboxFilter.value || "waiting";
        mobileFilterChips.querySelectorAll(".mobile-filter-chip").forEach((el) => {
            el.classList.toggle("active", el.getAttribute("data-filter") === cur);
        });
    }

    function syncMobileFilterChips_() {
        if (!mobileFilterChips || !inboxFilter) return;
        const cur = inboxFilter.value || "waiting";
        mobileFilterChips.querySelectorAll(".mobile-filter-chip").forEach((el) => {
            el.classList.toggle("active", el.getAttribute("data-filter") === cur);
        });
    }

    function openMobileDetailsSheet_() {
        if (!mobileDetailsBody || !contextBody) return;
        mobileDetailsBody.innerHTML = "";
        const clone = contextBody.cloneNode(true);
        clone.classList.remove("hidden");
        clone.id = "";
        mobileDetailsBody.appendChild(clone);
        setMobileSheetOpen_("details");
    }

    function syncMobileDeskLayout_() {
        const mobile = isMobileAgentDesk_();
        document.body.classList.toggle("mobile-desk", mobile);
        const inChat = mobile && !!selectedId;
        document.body.classList.toggle("mobile-chat-focus", inChat);
        syncMobileNavVisibility_();
        if (mobileBackBtn) {
            mobileBackBtn.hidden = !mobile || !inChat;
        }
        if (mobile) {
            buildMobileFilterChips_();
            syncMobileFilterChips_();
            if (inChat) {
                setMobileDeskTab_("chat");
            } else if (mobileDeskTab_ === "chat") {
                setMobileDeskTab_("chats");
            }
        } else {
            document.body.classList.remove(
                "mobile-tab-chats",
                "mobile-tab-alerts",
                "mobile-tab-chat"
            );
            if (mobileAlertsView) {
                mobileAlertsView.hidden = true;
            }
        }
    }

    function inboxPollIntervalMs_() {
        return isMobileAgentDesk_() ? INBOX_POLL_INTERVAL_MS_MOBILE : INBOX_POLL_INTERVAL_MS_DESKTOP;
    }

    function refreshDeskNow_() {
        if (appView && appView.classList.contains("hidden")) {
            return;
        }
        void pollHandoffNotifications_(true);
        loadInbox(true);
        if (selectedId) {
            loadMessages(selectedId, true);
        }
    }

    function removeVisitorTypingDraft_() {
        if (!messageList) return;
        const el = messageList.querySelector("[data-typing-draft]");
        if (el) el.remove();
    }

    function clearVisitorTypingDraft_() {
        lastPulseVisitorTyping = "";
        removeVisitorTypingDraft_();
        refreshChatHeaderMeta_(selectedConv);
    }

    /** Live draft as last message bubble (not a bar at the top). */
    function renderVisitorTypingPreview_(text, conv) {
        if (visitorTypingPreview) {
            visitorTypingPreview.classList.add("hidden");
            visitorTypingPreview.textContent = "";
        }
        if (!messageList) return;
        if (!shouldShowVisitorTypingDraft_()) {
            clearVisitorTypingDraft_();
            return;
        }
        const t = String(text || "").trim();
        if (!t) {
            removeVisitorTypingDraft_();
            return;
        }
        let el = messageList.querySelector("[data-typing-draft]");
        if (!el) {
            el = document.createElement("div");
            el.className = "msg visitor typing-draft";
            el.dataset.typingDraft = "1";
            messageList.appendChild(el);
        }
        const name = resolveVisitorDisplayName_(conv || selectedConv, selectedVisitorContext);
        el.innerHTML =
            '<span class="typing-draft-name">' +
            escapeHtml(name) +
            '</span><p class="typing-draft-text">' +
            escapeHtml(t) +
            '</p><span class="typing-draft-hint" aria-hidden="true">●●●</span>';
        messageList.scrollTop = messageList.scrollHeight;
    }

    async function runLiveSync_() {
        if (!selectedId || liveSyncInFlight) return;
        const st = selectedConv && selectedConv.status;
        if (st !== "active" && st !== "waiting") return;
        liveSyncInFlight = true;
        try {
            const params = new URLSearchParams({
                rev: String(deskSyncRevision),
                waitMs: "900"
            });
            if (lastMessageId) {
                params.set("sinceId", lastMessageId);
                params.set("lastMessageId", lastMessageId);
            }
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(selectedId)}/live-sync?` +
                    params.toString()
            );
            if (data.revision != null) {
                deskSyncRevision = Number(data.revision) || deskSyncRevision;
            }
            syncVisitorTypingDraftFromPulse_(data);
            if (data.unchanged) {
                contextPollTicks += 1;
                return;
            }
            if (data.conversation) {
                selectedConv = data.conversation;
                applyConversationUi_(selectedConv, { skipContextReload: true });
            }
            if (!data.unchanged && data.messages && data.messages.length) {
                let maxIso = lastMessageIso;
                let gotVisitorMsg = false;
                for (const m of data.messages) {
                    if (document.querySelector('[data-msg-id="' + m.id + '"]')) {
                        if (m.id) lastMessageId = m.id;
                        continue;
                    }
                    if (isStaleEndedSystemMsg_(m, selectedConv)) continue;
                    if (isStaleBotHandoffSystemMsg_(m, selectedConv)) continue;
                    if (m.role === "visitor") gotVisitorMsg = true;
                    appendMessageEl(m);
                    if (m.id) lastMessageId = m.id;
                    if (m.createdAt && (!maxIso || m.createdAt > maxIso)) {
                        maxIso = m.createdAt;
                    }
                }
                if (gotVisitorMsg) {
                    clearVisitorTypingDraft_();
                }
                if (maxIso) lastMessageIso = maxIso;
                messageList.scrollTop = messageList.scrollHeight;
            }
            contextPollTicks += 1;
            const v = selectedVisitorContext || {};
            const sparseContact = !v.name && !v.email && !v.mobile;
            const contextEvery = sparseContact ? 4 : 15;
            if (contextPollTicks % contextEvery === 0) {
                void loadContext(selectedId);
            }
        } catch (e) {
            console.warn("[live-agent] live-sync", e.message);
        } finally {
            liveSyncInFlight = false;
            if (
                selectedId &&
                selectedConv &&
                (selectedConv.status === "active" || selectedConv.status === "waiting")
            ) {
                setTimeout(runLiveSync_, 5);
            }
        }
    }

    function postAgentTyping_(text, active) {
        if (!selectedId || !agentId.includes("@")) return;
        apiFetch(`${API}/conversations/${encodeURIComponent(selectedId)}/typing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text || "", active: active !== false })
        }).catch(() => {});
    }

    async function runTypingPulse_() {
        if (!selectedId || typingPulseInFlight) return;
        const st = selectedConv && selectedConv.status;
        if (st !== "active" && st !== "waiting") return;
        typingPulseInFlight = true;
        try {
            const params = new URLSearchParams({
                rev: String(deskSyncRevision),
                visitorTyping: lastPulseVisitorTyping,
                lastMessageId: lastMessageId || ""
            });
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(selectedId)}/typing-pulse?` +
                    params.toString()
            );
            if (data.revision != null) {
                deskSyncRevision = Math.max(
                    deskSyncRevision,
                    Number(data.revision) || deskSyncRevision
                );
            }
            syncVisitorTypingDraftFromPulse_(data);
            if (
                data.newMessage ||
                data.lastMessageRole === "visitor"
            ) {
                clearVisitorTypingDraft_();
            }
            if (data.newMessage) {
                void loadMessages(selectedId, true);
            }
        } catch (e) {
            /* ignore pulse errors */
        } finally {
            typingPulseInFlight = false;
        }
    }

    function startTypingPulse_() {
        stopTypingPulse_();
        typingPulseTimer = setInterval(() => {
            if (document.hidden) return;
            void runTypingPulse_();
        }, 100);
        void runTypingPulse_();
    }

    function stopTypingPulse_() {
        if (typingPulseTimer) {
            clearInterval(typingPulseTimer);
            typingPulseTimer = null;
        }
        clearVisitorTypingDraft_();
    }

    function shouldShowVisitorTypingDraft_() {
        return !!(selectedConv && !isAiCopilotConv_(selectedConv));
    }

    function isHandoffRequestLine_(text) {
        const t = String(text || "").trim();
        return /requested a (chat with an|human) agent/i.test(t) || /^__GO_/i.test(t);
    }

    function getLastVisitorBubbleText_() {
        if (!messageList) return "";
        const nodes = messageList.querySelectorAll(
            ".msg.visitor:not(.typing-draft)[data-msg-id]"
        );
        if (!nodes.length) return "";
        const last = nodes[nodes.length - 1];
        const timeEl = last.querySelector("time");
        if (timeEl) {
            return String(last.textContent || "")
                .slice(0, Math.max(0, last.textContent.length - timeEl.textContent.length))
                .trim();
        }
        return String(last.textContent || "").trim();
    }

    function shouldRenderVisitorTypingPreview_(text) {
        const t = String(text || "").trim();
        if (!t) return false;
        if (isHandoffRequestLine_(t)) return false;
        const sent = getLastVisitorBubbleText_();
        if (sent && t === sent) return false;
        return true;
    }

    function syncVisitorTypingDraftFromPulse_(data) {
        if (!shouldShowVisitorTypingDraft_()) {
            clearVisitorTypingDraft_();
            return;
        }
        if (!data || data.visitorTyping == null) return;
        const t = String(data.visitorTyping || "").trim();
        if (t && shouldRenderVisitorTypingPreview_(t)) {
            lastPulseVisitorTyping = t;
            renderVisitorTypingPreview_(t, data.conversation || selectedConv);
            refreshChatHeaderMeta_(data.conversation || selectedConv);
        } else {
            clearVisitorTypingDraft_();
        }
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
                void runLiveSync_();
            }
        };
        void pollHandoffNotifications_(true);
        loadInbox(true);
        if (selectedId) {
            void runLiveSync_();
            startTypingPulse_();
        }
        const scheduleInboxPoll = () => {
            if (inboxPollTimer) {
                clearInterval(inboxPollTimer);
            }
            inboxPollTimer = setInterval(() => {
                if (!document.hidden) {
                    void pollHandoffNotifications_(true);
                    loadInbox(true);
                }
            }, inboxPollIntervalMs_());
        };
        scheduleInboxPoll();
        window.addEventListener("resize", scheduleInboxPoll);
        if (handoffPollHiddenTimer) {
            clearInterval(handoffPollHiddenTimer);
        }
        handoffPollHiddenTimer = setInterval(() => {
            if (document.hidden) {
                void pollHandoffNotifications_(true);
            }
        }, 5000);
    }

    function stopPolling() {
        stopTypingPulse_();
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (inboxPollTimer) {
            clearInterval(inboxPollTimer);
            inboxPollTimer = null;
        }
        if (handoffPollHiddenTimer) {
            clearInterval(handoffPollHiddenTimer);
            handoffPollHiddenTimer = null;
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && appView && !appView.classList.contains("hidden")) {
            refreshDeskNow_();
        }
    });
    window.addEventListener("pageshow", () => {
        if (appView && !appView.classList.contains("hidden")) {
            refreshDeskNow_();
        }
    });
    window.addEventListener("focus", () => {
        if (appView && !appView.classList.contains("hidden")) {
            refreshDeskNow_();
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

    function isMobileDevice_() {
        if (isMobileAgentDesk_()) return true;
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    }

    function notificationIconUrl_() {
        return "";
    }

    async function registerNotificationServiceWorker_() {
        if (!("serviceWorker" in navigator)) return;
        try {
            notifySwRegistration_ = await navigator.serviceWorker.register(
                "/live-agent/notification-sw.js",
                { scope: "/live-agent/" }
            );
            await navigator.serviceWorker.ready;
        } catch (_) {
            notifySwRegistration_ = null;
        }
    }

    function showNotificationViaServiceWorker_(title, body, tag, conversationId) {
        if (!navigator.serviceWorker) return false;
        const payload = {
            type: "SHOW_HANDOFF",
            title: title,
            body: body,
            tag: tag || "live-agent-handoff",
            conversationId: conversationId || ""
        };
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage(payload);
            return true;
        }
        if (notifySwRegistration_ && notifySwRegistration_.active) {
            notifySwRegistration_.active.postMessage(payload);
            return true;
        }
        return false;
    }

    function deskPanelNotificationsEnabled_() {
        const g = deskGeneral_();
        if (g.muteServiceDesk) return false;
        return g.notifyDeskPanel !== false;
    }

    function browserPopupEnabled_() {
        const g = deskGeneral_();
        if (g.muteServiceDesk) return false;
        if (isMobileDevice_()) {
            return g.notifyMobilePopup !== false;
        }
        return g.notifyDesktopPopup !== false;
    }

    function syncNotificationsPermissionState_() {
        notificationsOk =
            !!(
                "Notification" in window &&
                Notification.permission === "granted" &&
                browserPopupEnabled_()
            );
    }

    function updateNotificationPermissionUi_() {
        syncNotificationsPermissionState_();
        if (Notification.permission === "granted" && notificationsBtn) {
            notificationsBtn.classList.remove("notifications-btn--pulse");
        }
        if (enablePhoneNotifyBtn) {
            const showPhone =
                isMobileDevice_() &&
                browserPopupEnabled_() &&
                "Notification" in window &&
                Notification.permission !== "granted";
            enablePhoneNotifyBtn.classList.toggle("hidden", !showPhone);
        }
        const enablePhoneMenu = $("enablePhoneNotifyBtnMenu");
        if (enablePhoneMenu) {
            enablePhoneMenu.classList.toggle(
                "hidden",
                !(
                    isMobileDevice_() &&
                    browserPopupEnabled_() &&
                    "Notification" in window &&
                    Notification.permission !== "granted"
                )
            );
        }
    }

    async function requestNotificationPermission_(userInitiated) {
        if (!browserPopupEnabled_()) {
            syncNotificationsPermissionState_();
            updateNotificationPermissionUi_();
            return false;
        }
        if (!("Notification" in window)) {
            notificationsOk = false;
            updateNotificationPermissionUi_();
            return false;
        }
        if (Notification.permission === "granted") {
            notificationsOk = true;
            updateNotificationPermissionUi_();
            return true;
        }
        if (Notification.permission === "denied") {
            notificationsOk = false;
            updateNotificationPermissionUi_();
            return false;
        }
        if (isMobileDevice_() && !userInitiated) {
            updateNotificationPermissionUi_();
            return false;
        }
        try {
            const p = await Notification.requestPermission();
            notificationsOk = p === "granted" && browserPopupEnabled_();
            updateNotificationPermissionUi_();
            if (notificationsOk) {
                const testTitle = "Live agent alerts enabled";
                const testBody = "Pop-ups are on for new visitor requests.";
                if (
                    !showNotificationViaServiceWorker_(
                        testTitle,
                        testBody,
                        "live-agent-enabled",
                        ""
                    )
                ) {
                    try {
                        new Notification(testTitle, {
                            body: testBody,
                            tag: "live-agent-enabled"
                        });
                    } catch (_) {
                        /* ignore */
                    }
                }
            }
            return notificationsOk;
        } catch (_) {
            notificationsOk = false;
            updateNotificationPermissionUi_();
            return false;
        }
    }

    function tryMobileVibrate_() {
        try {
            if (isMobileDevice_() && navigator.vibrate) {
                navigator.vibrate([120, 60, 120]);
            }
        } catch (_) {
            /* ignore */
        }
    }

    function showBrowserNotification_(title, body, tag, conversationId) {
        if (!browserPopupEnabled_()) return false;
        syncNotificationsPermissionState_();
        if (!notificationsOk) {
            return false;
        }
        if (
            showNotificationViaServiceWorker_(title, body, tag, conversationId)
        ) {
            return true;
        }
        try {
            const opts = {
                body: body,
                tag: tag || "live-agent",
                renotify: true
            };
            const n = new Notification(title, opts);
            n.onclick = function () {
                try {
                    window.focus();
                    n.close();
                } catch (_) {
                    /* ignore */
                }
                if (conversationId) {
                    const hit = lastInboxConversations_.find((c) => c.id === conversationId);
                    if (hit) {
                        selectConversation(hit);
                    } else {
                        selectedId = conversationId;
                        if (inboxFilter) inboxFilter.value = "waiting";
                        void loadInbox(false, true).then(() => {
                            const c = lastInboxConversations_.find((x) => x.id === conversationId);
                            if (c) selectConversation(c);
                        });
                    }
                }
            };
            return true;
        } catch (_) {
            return false;
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
        const local = e.split("@")[0];
        return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Agent";
    }

    function isAiCopilotConv_(conv) {
        if (!conv || conv.status !== "active") {
            return false;
        }
        const hm = conv.humanMode ? String(conv.humanMode).toLowerCase() : "";
        return hm === "ai" && conv.aiEnabled !== false;
    }

    /** One-line status for footer / side panel (desk-oriented). */
    function formatConvStatusShort_(conv) {
        if (!conv) {
            return "";
        }
        const st = conv.status || "";
        const hm = conv.humanMode ? String(conv.humanMode).toLowerCase() : "";
        if (st === "waiting") {
            return "Waiting for you";
        }
        if (st === "closed") {
            return "Closed";
        }
        if (st === "active") {
            if (hm === "ai" && conv.aiEnabled !== false) {
                return "Bot is replying";
            }
            return "You are replying";
        }
        return st || "—";
    }

    /** WhatsApp-style subtitle under visitor name in chat header. */
    function formatChatHeaderSubtitle_(conv, opts) {
        if (!conv) {
            return "";
        }
        const o = opts || {};
        const dept = conv.departmentName || conv.departmentId || "General";
        const st = conv.status || "";
        if (o.visitorTyping) {
            return "Typing… · " + dept;
        }
        if (st === "waiting") {
            if (deskRoutingMode_() === "round_robin") {
                const offered = (conv.currentAssigneeEmail || "").trim();
                if (offered && agentIdsMatch_(offered, agentId)) {
                    return "Your turn — accept · " + dept;
                }
                if (offered) {
                    return (
                        "Offered to " +
                        resolveAgentDisplayName_(offered) +
                        " · " +
                        dept
                    );
                }
            }
            return "Waiting for an agent · " + dept;
        }
        if (st === "closed") {
            return "Chat closed · " + dept;
        }
        if (st === "active") {
            if (isAiCopilotConv_(conv)) {
                return "AI assistant is replying · " + dept;
            }
            const assignee = (conv.assignedAgentEmail || "").trim();
            if (assignee && agentIdsMatch_(assignee, agentId)) {
                return "You · " + dept;
            }
            if (assignee) {
                return resolveAgentDisplayName_(assignee) + " · " + dept;
            }
            return "Active · " + dept;
        }
        return dept;
    }

    function refreshChatHeaderMeta_(conv) {
        if (!chatMeta) {
            return;
        }
        const c = conv || selectedConv;
        chatMeta.textContent = formatChatHeaderSubtitle_(c, {
            visitorTyping: !!(lastPulseVisitorTyping && String(lastPulseVisitorTyping).trim()),
        });
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

    function loadDeskNotificationsFromStorage_() {
        try {
            let raw = localStorage.getItem(LS_DESK_NOTIFICATIONS);
            if (!raw) {
                raw = sessionStorage.getItem(LS_DESK_NOTIFICATIONS);
            }
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                deskNotifications_ = parsed
                    .slice(0, MAX_DESK_NOTIFICATIONS)
                    .map(function (n) {
                        if (!n || !n.body) return n;
                        if (
                            !isHandoffPreviewNoise_(n.body) &&
                            !/requested a (chat with an |human )?agent/i.test(
                                String(n.title || "")
                            )
                        ) {
                            return n;
                        }
                        const conv =
                            lastInboxConversations_.find(function (c) {
                                return c.id === n.conversationId;
                            }) || {
                                id: n.conversationId,
                                visitorName: n.title,
                            };
                        const fmt = formatHandoffNotification_(conv);
                        return Object.assign({}, n, {
                            title: fmt.title,
                            body: fmt.body,
                        });
                    });
            }
        } catch (_) {
            deskNotifications_ = [];
        }
    }

    function saveDeskNotificationsToStorage_() {
        const payload = JSON.stringify(
            deskNotifications_.slice(0, MAX_DESK_NOTIFICATIONS)
        );
        try {
            localStorage.setItem(LS_DESK_NOTIFICATIONS, payload);
        } catch (_) {
            /* ignore */
        }
        try {
            sessionStorage.setItem(LS_DESK_NOTIFICATIONS, payload);
        } catch (_) {
            /* ignore */
        }
    }

    function unreadNotificationsCount_() {
        let n = 0;
        for (const item of deskNotifications_) {
            if (!item.read) n += 1;
        }
        return n;
    }

    function updateNotificationsBadge_() {
        const n = unreadNotificationsCount_();
        if (notificationsBadge) {
            if (n > 0) {
                notificationsBadge.textContent = n > 99 ? "99+" : String(n);
                notificationsBadge.classList.remove("hidden");
            } else {
                notificationsBadge.classList.add("hidden");
            }
        }
        let waiting = 0;
        for (const c of lastInboxConversations_ || []) {
            if (c.status === "waiting") waiting += 1;
        }
        updateMobileNavBadges_(waiting, n);
    }

    function isHandoffPreviewNoise_(text) {
        const t = String(text || "").trim();
        if (!t) return true;
        if (/^__go_/i.test(t)) return true;
        if (/requested a (chat with an |human )?agent/i.test(t)) return true;
        if (/visitor requested/i.test(t)) return true;
        if (/new live agent request/i.test(t)) return true;
        return false;
    }

    function formatHandoffNotification_(conv) {
        const name = resolveVisitorDisplayName_(conv, null) || "Visitor";
        const dept = String(conv.departmentName || conv.departmentId || "").trim();
        const deptShort =
            dept && dept.toLowerCase() !== "general" ? dept : "";
        const title = name;
        let body = "Waiting for an agent";
        if (deptShort) {
            body += " · " + deptShort;
        }
        const preview = String(conv.lastMessagePreview || "").trim();
        if (preview && !isHandoffPreviewNoise_(preview)) {
            body =
                preview.length > 90 ? preview.slice(0, 87) + "…" : preview;
        }
        return { title, body };
    }

    function showDeskHandoffToast_(entry) {
        if (!deskHandoffToast || !entry) return;
        deskHandoffToast.textContent =
            (entry.title ? entry.title + " — " : "") +
            (entry.body || "Waiting for an agent");
        deskHandoffToast.classList.remove("hidden");
        if (deskHandoffToast._hideTimer) {
            clearTimeout(deskHandoffToast._hideTimer);
        }
        deskHandoffToast._hideTimer = setTimeout(function () {
            deskHandoffToast.classList.add("hidden");
        }, 12000);
        deskHandoffToast.onclick = function () {
            deskHandoffToast.classList.add("hidden");
            setNotificationsPanelOpen_(true);
            const hit = lastInboxConversations_.find(function (c) {
                return c.id === entry.conversationId;
            });
            if (hit) {
                selectConversation(hit);
            }
        };
    }

    function pushDeskNotification_(conv, opts) {
        opts = opts || {};
        if (!conv || !conv.id || !deskPanelNotificationsEnabled_()) return;
        const fmt = formatHandoffNotification_(conv);
        const at = conv.requestedAt || conv.lastMessageAt || new Date().toISOString();
        const entry = {
            id: conv.id + "|" + at,
            conversationId: conv.id,
            title: fmt.title,
            body: fmt.body,
            at,
            read: false
        };
        const dup = deskNotifications_.some(
            (n) => n.conversationId === entry.conversationId && !n.read
        );
        if (dup) return;
        deskNotifications_.unshift(entry);
        if (deskNotifications_.length > MAX_DESK_NOTIFICATIONS) {
            deskNotifications_.length = MAX_DESK_NOTIFICATIONS;
        }
        saveDeskNotificationsToStorage_();
        renderNotificationsPanel_();
        updateNotificationsBadge_();
        if (!opts.silent) {
            showDeskHandoffToast_(entry);
            if (notificationsBtn) {
                notificationsBtn.classList.add("notifications-btn--pulse");
            }
            if (isMobileAgentDesk_() && mobileDeskTab_ !== "chat") {
                /* user stays on current tab; badge updates */
            }
            tryMobileVibrate_();
            if (browserPopupEnabled_()) {
                showBrowserNotification_(
                    entry.title,
                    entry.body,
                    "live-agent-handoff-" + conv.id,
                    conv.id
                );
            }
        }
        return entry;
    }

    /** Keep 🔔 panel in sync with waiting chats shown in the left inbox. */
    function syncDeskPanelFromInbox_(conversations, opts) {
        if (!deskPanelNotificationsEnabled_()) return;
        let added = false;
        for (const c of conversations || []) {
            if (!c || c.status !== "waiting") continue;
            const hasUnread = deskNotifications_.some(function (n) {
                return n.conversationId === c.id && !n.read;
            });
            if (!hasUnread) {
                const entry = pushDeskNotification_(c, { silent: true, ...(opts || {}) });
                if (entry) added = true;
            }
        }
        if (added) {
            updateNotificationsBadge_();
        }
    }

    function syncDeskPanelFromWaiting_(waitingConversations) {
        syncDeskPanelFromInbox_(waitingConversations, { silent: true });
    }

    function markNotificationRead_(conversationId) {
        let changed = false;
        for (const n of deskNotifications_) {
            if (n.conversationId === conversationId && !n.read) {
                n.read = true;
                changed = true;
            }
        }
        if (changed) {
            saveDeskNotificationsToStorage_();
            renderNotificationsPanel_();
            updateNotificationsBadge_();
        }
    }

    function markAllNotificationsRead_() {
        let changed = false;
        for (const n of deskNotifications_) {
            if (!n.read) {
                n.read = true;
                changed = true;
            }
        }
        if (changed) {
            saveDeskNotificationsToStorage_();
            renderNotificationsPanel_();
            updateNotificationsBadge_();
        }
    }

    function onNotificationItemClick_(n) {
        n.read = true;
        saveDeskNotificationsToStorage_();
        updateNotificationsBadge_();
        renderNotificationsPanel_();
        setNotificationsPanelOpen_(false);
        setMobileSheetOpen_(null);
        if (isMobileAgentDesk_()) {
            setMobileDeskTab_("chat");
        }
        const hit = lastInboxConversations_.find((c) => c.id === n.conversationId);
        if (hit) {
            selectConversation(hit);
        } else {
            selectedId = n.conversationId;
            if (inboxFilter) inboxFilter.value = "waiting";
            void loadInbox(false, true).then(() => {
                const c = lastInboxConversations_.find((x) => x.id === n.conversationId);
                if (c) selectConversation(c);
            });
        }
    }

    function appendNotificationItemsToList_(root) {
        if (!root) return;
        root.innerHTML = "";
        const items = deskNotifications_.slice();
        for (const n of items) {
            const li = document.createElement("li");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "notifications-item" + (n.read ? "" : " unread");
            btn.innerHTML =
                '<p class="notifications-item-title">' +
                escapeHtml(n.title) +
                "</p>" +
                '<p class="notifications-item-body">' +
                escapeHtml(n.body) +
                "</p>" +
                '<p class="notifications-item-time">' +
                escapeHtml(formatTime(n.at)) +
                "</p>";
            btn.addEventListener("click", () => onNotificationItemClick_(n));
            li.appendChild(btn);
            root.appendChild(li);
        }
        return items.length;
    }

    function renderNotificationsPanel_() {
        appendNotificationItemsToList_(notificationsList);
        appendNotificationItemsToList_(notificationsListMobile);
        const has = deskNotifications_.length > 0;
        if (notificationsEmpty) {
            notificationsEmpty.classList.toggle("hidden", has);
        }
        if (notificationsEmptyMobile) {
            notificationsEmptyMobile.classList.toggle("hidden", has);
        }
        updateNotificationsBadge_();
    }

    function setNotificationsPanelOpen_(open) {
        if (isMobileAgentDesk_() && open) {
            setMobileDeskTab_("alerts");
            return;
        }
        notificationsPanelOpen_ = !!open;
        if (notificationsPanel) {
            notificationsPanel.classList.toggle("hidden", !notificationsPanelOpen_);
        }
        if (notificationsBackdrop) {
            notificationsBackdrop.classList.toggle("hidden", !notificationsPanelOpen_);
            notificationsBackdrop.setAttribute(
                "aria-hidden",
                notificationsPanelOpen_ ? "false" : "true"
            );
        }
        if (notificationsBtn) {
            notificationsBtn.setAttribute("aria-expanded", notificationsPanelOpen_ ? "true" : "false");
        }
        if (notificationsPanelOpen_) {
            renderNotificationsPanel_();
        }
    }

    function toggleNotificationsPanel_() {
        setNotificationsPanelOpen_(!notificationsPanelOpen_);
        if (notificationsPanelOpen_) {
            renderNotificationsPanel_();
        }
    }

    function handoffRequestedAfterDeskOpen_(conv) {
        if (!conv) return false;
        const reqMs = Date.parse(conv.requestedAt || conv.createdAt || "");
        if (!reqMs || !deskSessionStartedAt_) return true;
        return reqMs >= deskSessionStartedAt_ - 8000;
    }

    function seedHandoffTracking_(waitingConversations) {
        for (const c of waitingConversations || []) {
            if (!c || !c.id || c.status !== "waiting") continue;
            if (handoffRequestedAfterDeskOpen_(c)) {
                if (!knownHandoffIds_.has(c.id)) {
                    knownHandoffIds_.add(c.id);
                    notifyNewHandoffRequest_(c);
                }
            } else {
                knownHandoffIds_.add(c.id);
            }
        }
        handoffTrackingSeeded_ = true;
    }

    function notifyNewHandoffRequest_(conv) {
        if (!conv || deskGeneral_().muteServiceDesk) return;
        const entry = pushDeskNotification_(conv);
        const waitingN = Array.from(knownHandoffIds_).length;
        document.title = (waitingN > 0 ? waitingN + " waiting · " : "") + "Live chat";
        if (entry && deskPanelNotificationsEnabled_()) {
            playNotificationSound_();
        }
    }

    function processNewHandoffRequests_(waitingConversations) {
        if (deskGeneral_().muteServiceDesk) return;
        const waiting = (waitingConversations || []).filter((c) => c && c.status === "waiting");
        if (!handoffTrackingSeeded_) {
            seedHandoffTracking_(waiting);
            return;
        }
        for (const c of waiting) {
            if (!c.id || knownHandoffIds_.has(c.id)) continue;
            if (!isWaitingOfferedToMe_(c)) continue;
            knownHandoffIds_.add(c.id);
            notifyNewHandoffRequest_(c);
        }
        for (const id of knownHandoffIds_) {
            if (!waiting.some((c) => c.id === id)) {
                knownHandoffIds_.delete(id);
            }
        }
    }

    async function pollHandoffNotifications_(quiet) {
        if (!viewerSecret || deskGeneral_().muteServiceDesk) return;
        try {
            const data = await apiFetch(
                `${API}/inbox?status=waiting&limit=50&fresh=1${quiet ? "&light=1" : ""}`
            );
            const waiting = data.conversations || [];
            processNewHandoffRequests_(waiting);
            syncDeskPanelFromWaiting_(waiting);
        } catch (_) {
            /* ignore */
        }
    }

    function notifyNewRequests_(count, sampleConv) {
        if (count <= 0 || deskGeneral_().muteServiceDesk) return;
        if (sampleConv) {
            notifyNewHandoffRequest_(sampleConv);
            return;
        }
        document.title = count + " waiting · Live chat";
        showBrowserNotification_(
            count === 1 ? "Visitor waiting" : count + " visitors waiting",
            count === 1
                ? "A chat needs an agent."
                : count + " chats need an agent.",
            "live-agent-waiting"
        );
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

    function normalizeDeskSettings_(settings) {
        const s = settings || {};
        s.general = s.general || {};
        if (s.general.notifyDeskPanel === undefined) {
            s.general.notifyDeskPanel = true;
        }
        if (s.general.notifyDesktopPopup === undefined) {
            s.general.notifyDesktopPopup = true;
        }
        if (s.general.notifyMobilePopup === undefined) {
            s.general.notifyMobilePopup = true;
        }
        s.knowledgeBase = s.knowledgeBase || { enabled: true, articles: [] };
        return s;
    }

    function kbEnabled_() {
        const kb = deskSettings && deskSettings.knowledgeBase;
        return !!(kb && kb.enabled !== false);
    }

    function syncKbPaneVisibility_() {
        if (!kbPane) return;
        kbPane.classList.toggle("hidden", !kbEnabled_());
    }

    let kbSearchTimer = null;
    let kbSearchInFlight = false;

    function insertKbAnswerIntoComposer_(text) {
        if (!composerInput || !text) return;
        const add = String(text).trim();
        if (!add) return;
        const cur = (composerInput.value || "").trim();
        composerInput.value = cur ? cur + "\n\n" + add : add;
        composerInput.focus();
        composerInput.dispatchEvent(new Event("input", { bubbles: true }));
        messageList.scrollTop = messageList.scrollHeight;
    }

    function renderKbResults_(results, listEl) {
        const ul = listEl || kbResultsList;
        if (!ul) return;
        ul.innerHTML = "";
        const items = results || [];
        if (!items.length) {
            const li = document.createElement("li");
            li.className = "kb-result-empty muted small";
            li.textContent = "No matching articles.";
            ul.appendChild(li);
            return;
        }
        for (const r of items) {
            const li = document.createElement("li");
            li.className = "kb-result-item";
            const title = document.createElement("p");
            title.className = "kb-result-title";
            title.textContent = r.title || "Article";
            const preview = document.createElement("p");
            preview.className = "kb-result-preview muted small";
            const ans = String(r.answer || "");
            preview.textContent = ans.length > 120 ? ans.slice(0, 117) + "…" : ans;
            const actions = document.createElement("div");
            actions.className = "kb-result-actions";
            const useBtn = document.createElement("button");
            useBtn.type = "button";
            useBtn.className = "btn primary small";
            useBtn.textContent = "Use reply";
            useBtn.addEventListener("click", () => {
                insertKbAnswerIntoComposer_(r.answer);
                setMobileSheetOpen_(null);
            });
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "btn ghost small";
            copyBtn.textContent = "Copy";
            copyBtn.addEventListener("click", () => {
                const t = String(r.answer || "");
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(t).catch(() => {});
                }
            });
            actions.appendChild(useBtn);
            actions.appendChild(copyBtn);
            li.appendChild(title);
            li.appendChild(preview);
            li.appendChild(actions);
            ul.appendChild(li);
        }
    }

    async function runKbSearch_(query) {
        const q = String(query || "").trim();
        if (!kbEnabled_() || q.length < 2) {
            if (kbResultsList) kbResultsList.innerHTML = "";
            if (kbResultsListMobile) kbResultsListMobile.innerHTML = "";
            if (kbSearchHint) {
                kbSearchHint.textContent = kbEnabled_()
                    ? "Type keywords (refund, hours, pricing…)"
                    : "Knowledge base is disabled in Settings.";
            }
            return;
        }
        if (kbSearchInFlight) return;
        kbSearchInFlight = true;
        const dept =
            (selectedConv && (selectedConv.departmentId || selectedConv.departmentName)) ||
            "general";
        try {
            const data = await apiFetch(
                `${API}/knowledge/search?q=${encodeURIComponent(q)}&departmentId=${encodeURIComponent(dept)}`
            );
            renderKbResults_(data.results || [], kbResultsList);
            renderKbResults_(data.results || [], kbResultsListMobile);
            if (kbSearchHint) {
                const n = (data.results || []).length;
                kbSearchHint.textContent = n
                    ? n + " article(s) — tap Use reply to paste into your message."
                    : "No matches — try different keywords.";
            }
        } catch (e) {
            if (kbSearchHint) kbSearchHint.textContent = e.message || "Search failed";
        } finally {
            kbSearchInFlight = false;
        }
    }

    function scheduleKbSearch_(query) {
        clearTimeout(kbSearchTimer);
        kbSearchTimer = setTimeout(() => {
            void runKbSearch_(query);
        }, 280);
    }

    function bindKbSearchInput_(input) {
        if (!input) return;
        input.addEventListener("input", () => scheduleKbSearch_(input.value));
    }

    async function loadDeskSettings_() {
        try {
            const data = await apiFetch(`${API}/settings`);
            deskSettings = normalizeDeskSettings_(data.settings || null);
            if (data.knowledgeBase) {
                deskSettings.knowledgeBase = data.knowledgeBase;
            }
            syncKbPaneVisibility_();
            applyInboxFilterOptions_();
            updateNotificationPermissionUi_();
        } catch (_) {
            deskSettings = null;
            syncKbPaneVisibility_();
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
        if (waiting > lastWaitingCount) {
            const newConvs = (conversations || []).filter(
                (c) => c.status === "waiting" && !knownHandoffIds_.has(c.id)
            );
            const delta = waiting - lastWaitingCount;
            if (newConvs.length) {
                for (const c of newConvs) {
                    if (!knownHandoffIds_.has(c.id)) {
                        knownHandoffIds_.add(c.id);
                        notifyNewHandoffRequest_(c);
                    }
                }
            } else if (handoffTrackingSeeded_ && delta > 0) {
                notifyNewRequests_(delta);
            }
        }
        lastWaitingCount = waiting;
        updateMobileNavBadges_(waiting, unreadNotificationsCount_());
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
            loginMessage.textContent =
                e.status === 403
                    ? e.message ||
                      "This email is not registered. Add it in Live Agent Settings → Departments or agent profiles."
                    : e.message || "Secret rejected.";
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

    if (enablePhoneNotifyBtn) {
        enablePhoneNotifyBtn.addEventListener("click", () => {
            void requestNotificationPermission_(true);
        });
    }
    if (notificationsBackdrop) {
        notificationsBackdrop.addEventListener("click", () => {
            setNotificationsPanelOpen_(false);
        });
    }
    if (notificationsBtn) {
        notificationsBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            toggleNotificationsPanel_();
        });
    }
    if (markAllNotificationsReadBtn) {
        markAllNotificationsReadBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            markAllNotificationsRead_();
        });
    }
    document.addEventListener("click", (ev) => {
        if (!notificationsPanelOpen_ || !notificationsWrap) return;
        if (notificationsWrap.contains(ev.target)) return;
        setNotificationsPanelOpen_(false);
    });
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
        syncMyAgentStatusIcon_();
        myAgentStatus.addEventListener("change", () => {
            syncMyAgentStatusIcon_();
            postPresence_(myAgentStatus.value);
        });
    }
    inboxFilter.addEventListener("change", () => {
        syncMobileFilterChips_();
        loadInbox();
    });
    if (mobileBackBtn) {
        mobileBackBtn.addEventListener("click", () => {
            clearSelectedChatUi_();
            loadInbox(true);
        });
    }
    if (mobileDeskNav) {
        mobileDeskNav.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const tab = btn.getAttribute("data-mobile-tab");
                if (tab === "menu") {
                    setMobileSheetOpen_("menu");
                    return;
                }
                setMobileSheetOpen_(null);
                if (tab === "chats") {
                    clearSelectedChatUi_();
                    setMobileDeskTab_("chats");
                    return;
                }
                if (tab === "alerts") {
                    setMobileDeskTab_("alerts");
                }
            });
        });
    }
    if (mobileRefreshInboxBtn) {
        mobileRefreshInboxBtn.addEventListener("click", () => loadInbox());
    }
    if (mobileDetailsBtn) {
        mobileDetailsBtn.addEventListener("click", () => openMobileDetailsSheet_());
    }
    const mobileMenuInfoBtn = $("mobileMenuInfoBtn");
    if (mobileMenuInfoBtn) {
        mobileMenuInfoBtn.addEventListener("click", () => {
            setMobileSheetOpen_(null);
            openMobileDetailsSheet_();
        });
    }
    const mobileChatMenuBtn = $("mobileChatMenuBtn");
    if (mobileChatMenuBtn) {
        mobileChatMenuBtn.addEventListener("click", () => setMobileSheetOpen_("chatmenu"));
    }
    if ($("closeMobileChatMenuBtn")) {
        $("closeMobileChatMenuBtn").addEventListener("click", () => setMobileSheetOpen_(null));
    }
    function forwardMobileMenuClick_(sourceId, target) {
        const src = $(sourceId);
        if (!src || !target) return;
        src.addEventListener("click", () => {
            setMobileSheetOpen_(null);
            target.click();
        });
    }
    forwardMobileMenuClick_("mobileMenuRefreshBtn", refreshChatBtn);
    forwardMobileMenuClick_("mobileMenuCopyIdBtn", copySessionBtn);
    forwardMobileMenuClick_("mobileMenuDismissBtn", dismissFooterBtn);
    const mobileMenuTranscriptBtn = $("mobileMenuTranscriptBtn");
    if (mobileMenuTranscriptBtn) {
        mobileMenuTranscriptBtn.addEventListener("click", () => setMobileSheetOpen_(null));
    }
    if ($("closeMobileMenuBtn")) {
        $("closeMobileMenuBtn").addEventListener("click", () => setMobileSheetOpen_(null));
    }
    if ($("closeMobileDetailsBtn")) {
        $("closeMobileDetailsBtn").addEventListener("click", () => setMobileSheetOpen_(null));
    }
    if ($("mobileMenuKbBtn")) {
        $("mobileMenuKbBtn").addEventListener("click", () => {
            setMobileSheetOpen_("kb");
            if (kbSearchInputMobile && kbSearchInput && kbSearchInputMobile.value !== kbSearchInput.value) {
                kbSearchInputMobile.value = kbSearchInput.value;
            }
            void runKbSearch_(kbSearchInputMobile && kbSearchInputMobile.value);
        });
    }
    if ($("closeMobileKbBtn")) {
        $("closeMobileKbBtn").addEventListener("click", () => setMobileSheetOpen_(null));
    }
    bindKbSearchInput_(kbSearchInput);
    bindKbSearchInput_(kbSearchInputMobile);
    if (mobileSheetBackdrop) {
        mobileSheetBackdrop.addEventListener("click", () => setMobileSheetOpen_(null));
    }
    const markAllMobile = $("markAllNotificationsReadBtnMobile");
    if (markAllMobile) {
        markAllMobile.addEventListener("click", (ev) => {
            ev.stopPropagation();
            markAllNotificationsRead_();
        });
    }
    const myAgentStatusMenu = $("myAgentStatusMenu");
    if (myAgentStatusMenu && myAgentStatus) {
        myAgentStatusMenu.addEventListener("change", () => {
            myAgentStatus.value = myAgentStatusMenu.value;
            syncMyAgentStatusIcon_();
            postPresence_(myAgentStatusMenu.value);
        });
        myAgentStatus.addEventListener("change", () => {
            myAgentStatusMenu.value = myAgentStatus.value;
        });
    }
    const logoutBtnMenu = $("logoutBtnMenu");
    if (logoutBtnMenu && logoutBtn) {
        logoutBtnMenu.addEventListener("click", () => logoutBtn.click());
    }
    const leadsLinkMenu = $("leadsLinkMenu");
    if (leadsLinkMenu && leadsLink) {
        leadsLinkMenu.addEventListener("click", () => {
            try {
                sessionStorage.setItem(LS_SECRET, viewerSecret);
                localStorage.setItem(LS_SECRET, viewerSecret);
            } catch (_) {
                /* ignore */
            }
        });
    }
    const enablePhoneMenu = $("enablePhoneNotifyBtnMenu");
    if (enablePhoneMenu) {
        enablePhoneMenu.addEventListener("click", () => {
            void requestNotificationPermission_(true).then(() => updateNotificationPermissionUi_());
        });
    }
    window.addEventListener("resize", () => syncMobileDeskLayout_());
    if (clearTestQueueBtn) {
        clearTestQueueBtn.addEventListener("click", () => {
            clearTestQueue_().catch((e) => alert(e.message || "Clear failed"));
        });
    }

    function formatTime(iso) {
        if (!iso) return "";
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

    function clearSelectedChatUi_() {
        selectedId = "";
        selectedConv = null;
        selectedVisitorContext = null;
        chatActive.classList.add("hidden");
        chatEmpty.classList.remove("hidden");
        contextEmpty.classList.remove("hidden");
        contextBody.classList.add("hidden");
        if (chatActionsBar) {
            chatActionsBar.classList.add("hidden");
        }
        if (isMobileAgentDesk_()) {
            setMobileDeskTab_("chats");
        }
        syncMobileDeskLayout_();
    }

    function removeConversationFromInboxUi_(conversationId) {
        lastInboxConversations_ = lastInboxConversations_.filter((c) => c.id !== conversationId);
        renderInbox(lastInboxConversations_);
    }

    async function dismissConversation_(conversationId) {
        const id = conversationId;
        markNotificationRead_(id);
        knownHandoffIds_.delete(id);
        dismissingConversationIds_.add(id);
        removeConversationFromInboxUi_(id);
        if (selectedId === id) {
            clearSelectedChatUi_();
        }
        try {
            await apiFetch(`${API}/conversations/${encodeURIComponent(id)}/close`, {
                method: "POST"
            });
            if (inboxStatus) {
                const n = lastInboxConversations_.length;
                inboxStatus.textContent = n ? n + " request(s)" : "No conversations in this queue.";
            }
            await loadInbox(true, true);
        } catch (e) {
            const msg = e.message || "Dismiss failed";
            if (!/closed/i.test(msg)) {
                if (inboxStatus) {
                    inboxStatus.textContent = msg;
                }
                await loadInbox(true, true);
            }
        }
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

    function pruneDismissingConversationIds_(conversations) {
        for (const id of dismissingConversationIds_) {
            const hit = (conversations || []).find((c) => c.id === id);
            if (!hit || hit.status === "closed") {
                dismissingConversationIds_.delete(id);
            }
        }
    }

    function renderInbox(conversations) {
        pruneDismissingConversationIds_(conversations);
        inboxList.innerHTML = "";
        const seenIds = new Set();
        const queue = inboxFilter ? inboxFilter.value || "all" : "all";
        const showClosed = queue === "closed";
        const open = (conversations || []).filter((c) => {
            if (!c.id) return false;
            if (dismissingConversationIds_.has(c.id)) return false;
            if (showClosed) return c.status === "closed";
            if (c.status === "closed") return false;
            if (seenIds.has(c.id)) return false;
            seenIds.add(c.id);
            return true;
        });
        if (!showClosed) updateNotifyPill_(open);
        updateClearTestBtn_(open);
        syncDeskPanelFromInbox_(open, { silent: true });
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
            const title = resolveVisitorDisplayName_(c, null);
            const avatar = document.createElement("div");
            avatar.className = "inbox-avatar";
            avatar.setAttribute("aria-hidden", "true");
            const initial = String(title || "?").trim().charAt(0).toUpperCase() || "?";
            avatar.textContent = initial;
            li.appendChild(avatar);
            const main = document.createElement("div");
            main.className = "inbox-item-main";
            main.innerHTML =
                '<p class="inbox-item-title">' +
                '<span class="inbox-item-name">' +
                escapeHtml(title) +
                "</span>" +
                '<span class="badge ' +
                escapeHtml(c.status) +
                '">' +
                escapeHtml(inboxStatusLabel_(c)) +
                "</span></p>" +
                '<p class="inbox-item-meta">' +
                escapeHtml(buildInboxItemDetails_(c)) +
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
                    void dismissConversation_(c.id);
                });
                actions.appendChild(dismissBtn);
                li.appendChild(actions);
            }
            li.addEventListener("click", () => selectConversation(c));
            inboxList.appendChild(li);
        }
    }

    async function loadInbox(quiet, fresh) {
        if (inboxInFlight) return;
        inboxInFlight = true;
        if (!quiet) inboxStatus.textContent = "Loading…";
        try {
            const status = inboxFilter.value || "waiting";
            const light = quiet ? "&light=1" : "";
            const forcePull = fresh ? "&fresh=1" : "";
            const data = await apiFetch(
                `${API}/inbox?status=${encodeURIComponent(status)}&limit=50${light}${forcePull}`
            );
            const list = data.conversations || [];
            lastInboxConversations_ = list;
            renderInbox(list);
            const st = (inboxFilter && inboxFilter.value) || "all";
            if (st !== "waiting" && st !== "all" && st !== "unassigned") {
                void apiFetch(`${API}/inbox?status=waiting&limit=50&fresh=1`)
                    .then(function (wd) {
                        syncDeskPanelFromInbox_(wd.conversations || [], { silent: true });
                    })
                    .catch(function () {});
            }
            if (selectedId) {
                const hit = list.find((c) => c.id === selectedId);
                if (hit) {
                    const unreadNow = hit.unreadForAgent || 0;
                    if (unreadNow > lastSelectedUnreadAgent) {
                        lastMessageIso = "";
                        lastMessageId = "";
                        loadMessages(selectedId, true, true);
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

        const dept = conv.departmentName || conv.departmentId || "General";
        const routeLine = formatConvStatusShort_(conv) + " · " + dept;
        if (modeStatusLine) modeStatusLine.textContent = routeLine;
        renderChatActionsBar_(conv);

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
            const displayName = isPlausibleVisitorName_(v.name) ? String(v.name).trim() : "";
            const rows = [
                ["Name", displayName],
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
        if (chatTitle && conv) {
            chatTitle.textContent = resolveVisitorDisplayName_(conv, v);
            refreshChatHeaderMeta_(conv);
        }
    }

    function transcriptUrlForSession_(sessionId, visitor) {
        const v = visitor || {};
        return v.transcriptUrl || "/conversation-transcript?session=" + encodeURIComponent(sessionId || "");
    }

    async function populateHandoverSelect_() {
        if (!handoverAgentSelect) {
            return;
        }
        handoverAgentSelect.innerHTML = "";
        const deptId =
            (selectedConv && selectedConv.departmentId) || "general";
        const depts =
            (deskSettings && deskSettings.departments) || [];
        let dept = null;
        for (let i = 0; i < depts.length; i += 1) {
            if (depts[i] && depts[i].id === deptId) {
                dept = depts[i];
                break;
            }
        }
        if (!dept && depts.length) {
            dept = depts[0];
        }
        const emails = dept && Array.isArray(dept.agentEmails) ? dept.agentEmails : [];
        let n = 0;
        for (let j = 0; j < emails.length; j += 1) {
            const e = String(emails[j] || "")
                .trim()
                .toLowerCase();
            if (!e || !e.includes("@") || agentIdsMatch_(e, agentId)) {
                continue;
            }
            const opt = document.createElement("option");
            opt.value = e;
            opt.textContent = e;
            handoverAgentSelect.appendChild(opt);
            n += 1;
        }
        if (!n) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No other agents in this department";
            handoverAgentSelect.appendChild(opt);
        }
    }

    function updateHandoverBar_(conv) {
        if (!handoverBar) {
            return;
        }
        const show =
            conv
            && conv.status === "active"
            && agentIdsMatch_(conv.assignedAgentEmail, agentId)
            && !isAiCopilotConv_(conv);
        handoverBar.classList.toggle("hidden", !show);
        if (show) {
            void populateHandoverSelect_();
        }
    }

    function renderChatActionsBar_(conv) {
        if (!chatActionsBar) return;
        if (!selectedId || !conv) {
            chatActionsBar.classList.add("hidden");
            if (handoverBar) {
                handoverBar.classList.add("hidden");
            }
            return;
        }
        chatActionsBar.classList.remove("hidden");
        updateHandoverBar_(conv);
        const st = conv.status || "";
        if (chatModeStatus) {
            chatModeStatus.textContent = formatConvStatusShort_(conv);
        }
        if (enableChatbotBtn) {
            const isWaiting = st === "waiting";
            const isMine =
                st === "active" && agentIdsMatch_(conv.assignedAgentEmail, agentId);
            const aiCopilot = isAiCopilotConv_(conv);
            enableChatbotBtn.hidden = false;
            if (isWaiting) {
                const myTurn = isWaitingOfferedToMe_(conv);
                enableChatbotBtn.dataset.deskAction = "accept";
                enableChatbotBtn.textContent = "Accept";
                enableChatbotBtn.title = myTurn
                    ? "Accept and reply to this visitor"
                    : "Waiting for another agent’s turn (round robin)";
                enableChatbotBtn.disabled = !myTurn;
                enableChatbotBtn.classList.remove("active-mode");
            } else if (isMine && aiCopilot) {
                enableChatbotBtn.dataset.deskAction = "takeover";
                enableChatbotBtn.textContent = "You reply";
                enableChatbotBtn.title = "Stop the bot — you reply to the visitor";
                enableChatbotBtn.classList.add("active-mode");
            } else if (isMine && st === "active") {
                enableChatbotBtn.dataset.deskAction = "enable-ai";
                enableChatbotBtn.textContent = "Bot on";
                enableChatbotBtn.title = "Let the bot reply again";
                enableChatbotBtn.classList.remove("active-mode");
            } else {
                enableChatbotBtn.dataset.deskAction = "";
                enableChatbotBtn.hidden = true;
                enableChatbotBtn.disabled = st === "closed";
            }
            if (!isWaiting) {
                enableChatbotBtn.disabled = st === "closed";
            }
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
        const mobileMenuTx = $("mobileMenuTranscriptBtn");
        if (mobileMenuTx && transcriptFooterBtn) {
            mobileMenuTx.href = transcriptFooterBtn.href;
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
        if (selectedConv) {
            selectedConv = {
                ...selectedConv,
                humanMode: patch.humanMode || selectedConv.humanMode,
                aiEnabled:
                    patch.humanMode === "ai"
                        ? true
                        : patch.humanMode === "human"
                          ? false
                          : typeof patch.aiEnabled === "boolean"
                            ? patch.aiEnabled
                            : selectedConv.aiEnabled
            };
            applyConversationUi_(selectedConv, { skipContextReload: true });
            renderChatActionsBar_(selectedConv);
        }
        if (patch.humanMode === "ai") {
            clearVisitorTypingDraft_();
        }
        const busy = enableChatbotBtn ? [enableChatbotBtn] : [];
        const prevLabel = enableChatbotBtn ? enableChatbotBtn.textContent : "";
        if (enableChatbotBtn) {
            enableChatbotBtn.disabled = true;
            enableChatbotBtn.textContent =
                patch.humanMode === "ai" ? "Bot on…" : "You reply…";
        }
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
            if (isAiCopilotConv_(data.conversation)) {
                clearVisitorTypingDraft_();
                void loadMessages(selectedId, true);
            } else {
                removeStaleBotHandoffMessages_();
                lastMessageId = "";
                lastMessageIso = "";
                void loadMessages(selectedId, false, true);
            }
        } catch (e) {
            alert(e.message || "Could not update mode");
            if (selectedConv) {
                applyConversationUi_(selectedConv, { skipContextReload: true });
                renderChatActionsBar_(selectedConv);
            }
        } finally {
            if (selectedConv) {
                renderChatActionsBar_(selectedConv);
            } else if (enableChatbotBtn && prevLabel) {
                enableChatbotBtn.textContent = prevLabel;
                enableChatbotBtn.disabled = false;
            }
        }
    }

    async function acceptSelectedChat_() {
        if (!selectedId) return;
        const prevLabel = enableChatbotBtn ? enableChatbotBtn.textContent : "";
        if (enableChatbotBtn) {
            enableChatbotBtn.disabled = true;
            enableChatbotBtn.textContent = "Accepting…";
        }
        try {
            const data = await apiFetch(`${API}/accept`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: selectedId })
            });
            if (!data || !data.conversation || !data.conversation.id) {
                throw new Error("Accept failed — no conversation returned from server");
            }
            markNotificationRead_(selectedId);
            knownHandoffIds_.delete(selectedId);
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
            if (enableChatbotBtn) {
                enableChatbotBtn.disabled = false;
                if (selectedConv) {
                    renderChatActionsBar_(selectedConv);
                } else if (prevLabel) {
                    enableChatbotBtn.textContent = prevLabel;
                }
            }
        }
    }

    if (enableChatbotBtn) {
        enableChatbotBtn.addEventListener("click", () => {
            if (!selectedConv) return;
            const action = enableChatbotBtn.dataset.deskAction || "";
            if (action === "accept") {
                void acceptSelectedChat_();
                return;
            }
            if (action === "takeover") {
                setMode_({ humanMode: "human", aiEnabled: false });
            } else if (action === "enable-ai") {
                setMode_({ humanMode: "ai", aiEnabled: true });
            }
        });
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
            void dismissConversation_(selectedId);
        });
    }

    function isStaleEndedSystemMsg_(m, conv) {
        if (!m || m.role !== "system" || !conv || conv.status === "closed") return false;
        const t = String(m.text || "").toLowerCase();
        return t.includes("chat has ended") || t.includes("ended.");
    }

    /** Hide "assistant is replying again" after agent clicks You reply. */
    function isStaleBotHandoffSystemMsg_(m, conv) {
        if (!m || m.role !== "system" || !conv) return false;
        const t = String(m.text || "").toLowerCase();
        if (
            !t.includes("assistant is replying") &&
            !t.includes("ai assistant is replying")
        ) {
            return false;
        }
        return !isAiCopilotConv_(conv);
    }

    function removeStaleBotHandoffMessages_() {
        if (!messageList) return;
        messageList.querySelectorAll(".msg.system").forEach((el) => {
            if (
                /assistant is replying/i.test(el.textContent || "") ||
                /ai assistant is replying/i.test(el.textContent || "")
            ) {
                el.remove();
            }
        });
    }

    function applyConversationUi_(c, opts) {
        const conv = c || selectedConv;
        const skipContextReload = opts && opts.skipContextReload === true;
        if (!conv || !selectedId) return;

        chatTitle.textContent = resolveVisitorDisplayName_(conv, selectedVisitorContext);
        refreshChatHeaderMeta_(conv);

        const isClosed = conv.status === "closed";
        const isWaiting = conv.status === "waiting";
        const isActive = conv.status === "active";
        const isMine = isActive && agentIdsMatch_(conv.assignedAgentEmail, agentId);
        const takenByOther =
            isActive && conv.assignedAgentEmail && !agentIdsMatch_(conv.assignedAgentEmail, agentId);
        const aiCopilot = isAiCopilotConv_(conv);
        const canReply = isMine && !aiCopilot;
        if (aiCopilot) {
            clearVisitorTypingDraft_();
        }

        if (chatClosedBanner) chatClosedBanner.classList.toggle("hidden", !isClosed);
        if (claimBtn) claimBtn.hidden = true;
        if (claimHint) {
            const showClaimHint = isWaiting && !isClosed && !isMobileAgentDesk_();
            claimHint.hidden = !showClaimHint;
            claimHint.textContent = showClaimHint
                ? isWaitingOfferedToMe_(conv)
                    ? "Your turn — use Accept below (round robin)."
                    : "Another agent’s turn — this chat will rotate to you."
                : "";
        }
        if (isMobileAgentDesk_() && chatMeta && isWaiting && !isClosed) {
            const dept = conv.departmentName || conv.departmentId || "General";
            chatMeta.textContent = isWaitingOfferedToMe_(conv)
                ? "Your turn — tap Accept · " + dept
                : "Round robin — waiting for next turn · " + dept;
        }
        if (composerForm) composerForm.classList.toggle("hidden", isClosed);
        if (chatActionsBar) chatActionsBar.classList.toggle("hidden", isClosed);
        const canPrivateNote = !isClosed && agentId.includes("@");
        if (composerInput) {
            composerInput.disabled = isClosed || (!canReply && !canPrivateNote);
            composerInput.placeholder = isClosed
                ? "Reopen this chat to reply…"
                : canReply
                  ? "Reply to visitor, or start with / for a private team note…"
                  : canPrivateNote
                    ? "Private team note (start with /) — visitor cannot see this…"
                    : isWaiting
                      ? "Press Accept below to reply…"
                      : takenByOther
                        ? "Assigned to " +
                          (conv.assignedAgentEmail || "another agent") +
                          " — / for private note to team"
                        : "Select a chat to reply…";
        }
        if (sendBtn) {
            sendBtn.disabled = isClosed || !canReply;
            sendBtn.classList.remove("hidden");
        }
        if (composerForm && !isClosed) {
            composerForm.classList.remove("hidden");
        }

        if (!skipContextReload) {
            renderContextPanel(conv, selectedVisitorContext);
        } else {
            renderChatActionsBar_(conv);
            if (modeStatusLine) {
                const dept = conv.departmentName || conv.departmentId || "General";
                modeStatusLine.textContent = formatConvStatusShort_(conv) + " · " + dept;
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
        deskSyncRevision = Number(c.revision) || 0;
        lastMessageIso = "";
        lastMessageId = "";
        lastSelectedUnreadAgent = c.unreadForAgent || 0;
        clearVisitorTypingDraft_();
        messageList.innerHTML = "";
        chatEmpty.classList.add("hidden");
        chatActive.classList.remove("hidden");
        const chatFooter = $("waChatFooter");
        if (chatFooter) {
            chatFooter.classList.remove("hidden");
        }
        if (composerForm) {
            composerForm.classList.remove("hidden");
        }
        syncMobileDeskLayout_();

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
        startTypingPulse_();
        void runLiveSync_();
    }

    if (composerInput) {
        composerInput.addEventListener("input", () => {
            if (!selectedId) return;
            const st = selectedConv && selectedConv.status;
            if (st !== "active" && st !== "waiting") return;
            const val = composerInput.value || "";
            const now = Date.now();
            if (now - lastAgentTypingSendMs > 45) {
                lastAgentTypingSendMs = now;
                postAgentTyping_(val, true);
            } else {
                clearTimeout(agentTypingTimer);
                agentTypingTimer = setTimeout(() => {
                    lastAgentTypingSendMs = Date.now();
                    postAgentTyping_(val, true);
                }, 45);
            }
        });
        composerInput.addEventListener("blur", () => {
            clearTimeout(agentTypingTimer);
            postAgentTyping_("", false);
        });
    }

    async function loadMessages(conversationId, quiet, forceFull) {
        if (messagesInFlight) {
            messagesPollPending = true;
            return;
        }
        messagesInFlight = true;
        const useFull = forceFull === true || messagePollsSinceFullSync >= 12;
        if (useFull) {
            messagePollsSinceFullSync = 0;
        } else {
            messagePollsSinceFullSync += 1;
        }
        try {
            const qParts = ["limit=80"];
            if (!useFull && lastMessageId) {
                qParts.push("sinceId=" + encodeURIComponent(lastMessageId));
            } else if (!useFull && lastMessageIso) {
                qParts.push("since=" + encodeURIComponent(lastMessageIso));
            }
            if (useFull) {
                qParts.push("markRead=1");
            }
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(conversationId)}/messages?` +
                    qParts.join("&")
            );
            const messages = data.messages || [];
            if (data.revision != null) {
                deskSyncRevision = Number(data.revision) || deskSyncRevision;
            }
            if (messages.some((m) => m.role === "visitor")) {
                clearVisitorTypingDraft_();
            } else if (data.visitorTyping != null) {
                syncVisitorTypingDraftFromPulse_(data);
            }
            if (!messages.length && quiet) return;
            let maxIso = lastMessageIso;
            for (const m of messages) {
                if (document.querySelector('[data-msg-id="' + m.id + '"]')) {
                    if (m.id) {
                        lastMessageId = m.id;
                    }
                    if (m.createdAt && (!maxIso || m.createdAt > maxIso)) {
                        maxIso = m.createdAt;
                    }
                    continue;
                }
                if (isStaleEndedSystemMsg_(m, selectedConv)) continue;
                if (isStaleBotHandoffSystemMsg_(m, selectedConv)) continue;
                appendMessageEl(m);
                if (m.id) {
                    lastMessageId = m.id;
                }
                if (m.createdAt && (!maxIso || m.createdAt > maxIso)) {
                    maxIso = m.createdAt;
                }
            }
            if (maxIso) {
                lastMessageIso = maxIso;
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
            if (messagesPollPending) {
                messagesPollPending = false;
                void loadMessages(conversationId, true);
            }
        }
    }

    function formatSystemLineForDesk_(text, msg) {
        const t = String(text || "").trim();
        if (!t) {
            return t;
        }
        if (
            !t.startsWith("live_agent_") &&
            !/^Agent\s+\S+@\S+\s+accepted the chat/i.test(t) &&
            !/stepped away/i.test(t) &&
            !/joined again/i.test(t) &&
            !/^you are now chatting with\s+/i.test(t) &&
            !/ai assistant is replying/i.test(t)
        ) {
            return t;
        }
        const senderEmail =
            (msg && msg.senderEmail) ||
            (selectedConv && selectedConv.assignedAgentEmail) ||
            "";
        const senderName =
            (msg && (msg.senderDisplayName || msg.senderName)) ||
            resolveAgentDisplayName_(senderEmail) ||
            "Agent";
        const isMe = agentIdsMatch_(senderEmail, agentId);
        const visitorName = resolveVisitorDisplayName_(selectedConv, selectedVisitorContext);

        if (
            t === "live_agent_human_connected" ||
            /^Agent\s+\S+@\S+\s+accepted the chat\.?$/i.test(t) ||
            /^you are now chatting with\s+/i.test(t)
        ) {
            return visitorName + " joined the chat.";
        }
        if (
            t === "live_agent_bot_active" ||
            t === "live_agent_handoff_to_bot" ||
            /ai assistant is replying/i.test(t) ||
            /the assistant is replying/i.test(t) ||
            /stepped away/i.test(t)
        ) {
            return isMe
                ? "You stepped away. AI assistant is replying to the visitor."
                : senderName + " stepped away. AI assistant is replying to the visitor.";
        }
        if (t === "live_agent_human_rejoined" || /joined again/i.test(t)) {
            return isMe ? "You joined again." : senderName + " joined again.";
        }
        return t;
    }

    function formatVisitorLineForDesk_(text) {
        const raw = String(text || "").trim();
        if (!raw) {
            return "";
        }
        const inner = raw.replace(/^(?:query|event):/i, "").trim() || raw;
        if (/^__GO_/i.test(inner) && /human\s*agent/i.test(inner)) {
            const name = resolveVisitorDisplayName_(selectedConv, selectedVisitorContext);
            if (name && name !== "Visitor") {
                return name + " requested a chat with an agent.";
            }
            return "Visitor requested a chat with an agent.";
        }
        if (/^__GO_/i.test(inner)) {
            return "";
        }
        return raw;
    }

    function stripOptimisticAgentMessages_() {
        if (!messageList) return;
        messageList.querySelectorAll('[data-msg-id^="opt-"]').forEach((el) => el.remove());
    }

    function appendMessageEl(m) {
        if (!m || !messageList) return;
        const msgId = m.id ? String(m.id) : "";
        if (msgId && messageList.querySelector('[data-msg-id="' + msgId + '"]')) {
            return;
        }
        if (msgId && !msgId.startsWith("opt-") && m.role === "agent") {
            stripOptimisticAgentMessages_();
        }
        const div = document.createElement("div");
        const role = m.role || "visitor";
        div.className = "msg " + role;
        div.dataset.msgId = m.id;
        let body;
        if (role === "system") {
            body = escapeHtml(formatSystemLineForDesk_(m.text || "", m));
        } else if (role === "internal") {
            const who = escapeHtml(
                (m.senderDisplayName || m.senderEmail || "Agent").split("@")[0]
            );
            body =
                '<span class="internal-badge">Private note</span> ' +
                '<span class="internal-author">' +
                who +
                "</span>: " +
                escapeHtml(m.text || "");
        } else if (role === "visitor") {
            const line = formatVisitorLineForDesk_(m.text || "");
            if (!line) {
                return;
            }
            if (isHandoffRequestLine_(line)) {
                if (messageList.querySelector("[data-handoff-request]")) {
                    return;
                }
                div.dataset.handoffRequest = "1";
            }
            removeVisitorTypingDraft_();
            lastPulseVisitorTyping = "";
            body = escapeHtml(line);
        } else {
            body = escapeHtml(m.text || "");
        }
        div.innerHTML = body + "<time>" + escapeHtml(formatTime(m.createdAt)) + "</time>";
        messageList.appendChild(div);
    }

    if (reopenChatBtn) {
        reopenChatBtn.addEventListener("click", () => reopenSelectedChat_());
    }

    if (claimBtn) {
        claimBtn.addEventListener("click", () => {
            void acceptSelectedChat_();
        });
    }

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

    if (handoverBtn) {
        handoverBtn.addEventListener("click", async () => {
            if (!selectedId || !handoverAgentSelect) {
                return;
            }
            const to = handoverAgentSelect.value.trim().toLowerCase();
            if (!to || !to.includes("@")) {
                alert("Choose an agent to transfer this chat to.");
                return;
            }
            handoverBtn.disabled = true;
            try {
                const data = await apiFetch(
                    `${API}/conversations/${encodeURIComponent(selectedId)}/transfer`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ toAgentEmail: to })
                    }
                );
                if (data.conversation) {
                    selectedConv = data.conversation;
                    applyConversationUi_(data.conversation, { skipContextReload: true });
                }
                alert("Chat transferred. It will appear in the other agent's queue.");
                selectedId = "";
                selectedConv = null;
                chatActive.classList.add("hidden");
                chatEmpty.classList.remove("hidden");
                loadInbox(true);
            } catch (e) {
                alert(e.message || "Transfer failed");
            } finally {
                handoverBtn.disabled = false;
            }
        });
    }

    composerForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const raw = composerInput.value.trim();
        if (!raw || !selectedId) return;
        const isPrivate = raw.startsWith("/");
        const text = isPrivate ? raw.replace(/^\//, "").trim() : raw;
        if (!text) return;
        if (!isPrivate && selectedConv && isAiCopilotConv_(selectedConv)) {
            alert("Chatbot is replying to the visitor. Click Take over before sending a message.");
            return;
        }
        if (!agentId.includes("@")) {
            alert("Sign in with your work email to send messages.");
            return;
        }
        sendBtn.disabled = true;
        const optimisticId = "opt-" + Date.now();
        appendMessageEl({
            id: optimisticId,
            role: isPrivate ? "internal" : "agent",
            text: text,
            senderEmail: agentId,
            senderDisplayName: agentId.split("@")[0],
            createdAt: new Date().toISOString()
        });
        composerInput.value = "";
        postAgentTyping_("", false);
        messageList.scrollTop = messageList.scrollHeight;
        try {
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(selectedId)}/messages`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: isPrivate ? "/" + text : text })
                }
            );
            const opt = messageList.querySelector('[data-msg-id="' + optimisticId + '"]');
            if (data.message && data.message.id) {
                const realId = String(data.message.id);
                const existing = messageList.querySelector('[data-msg-id="' + realId + '"]');
                if (opt && !existing) {
                    opt.dataset.msgId = realId;
                    if (data.message.role === "internal") {
                        opt.className = "msg internal";
                        const who = escapeHtml(
                            (data.message.senderDisplayName || agentId).split("@")[0]
                        );
                        opt.innerHTML =
                            '<span class="internal-badge">Private note</span> ' +
                            '<span class="internal-author">' +
                            who +
                            "</span>: " +
                            escapeHtml(data.message.text || "") +
                            "<time>" +
                            escapeHtml(formatTime(data.message.createdAt)) +
                            "</time>";
                    } else {
                        const timeEl = opt.querySelector("time");
                        if (timeEl && data.message.createdAt) {
                            timeEl.textContent = formatTime(data.message.createdAt);
                        }
                    }
                } else {
                    if (opt) opt.remove();
                    if (!existing) appendMessageEl(data.message);
                }
                lastMessageId = realId;
                if (data.message.createdAt) lastMessageIso = data.message.createdAt;
            } else if (opt) {
                opt.remove();
            }
            if (data.conversation) {
                selectedConv = data.conversation;
                deskSyncRevision = Number(data.conversation.revision) || deskSyncRevision;
                applyConversationUi_(data.conversation);
            }
            messageList.scrollTop = messageList.scrollHeight;
            loadInbox(true);
        } catch (e) {
            const opt = messageList.querySelector('[data-msg-id="' + optimisticId + '"]');
            if (opt) opt.remove();
            composerInput.value = raw;
            alert(e.message || "Send failed");
        } finally {
            if (sendBtn) sendBtn.disabled = !canReplyActive_();
        }
    });

    function canReplyActive_() {
        if (!selectedConv || !selectedId) return false;
        if (selectedConv.status === "closed") return false;
        if (composerInput) {
            const raw = (composerInput.value || "").trim();
            if (raw.startsWith("/") && raw.replace(/^\//, "").trim()) {
                return true;
            }
        }
        if (isAiCopilotConv_(selectedConv)) return false;
        if (selectedConv.status === "waiting") return false;
        if (selectedConv.status !== "active") return false;
        const assignee = (selectedConv.assignedAgentEmail || "").trim();
        if (!assignee) return true;
        return agentIdsMatch_(assignee, agentId);
    }

    loadStoredAuth_();
    checkSession();
})();
