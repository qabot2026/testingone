(function () {
    "use strict";

    const API = "/api/live-agent";
    const LS_SECRET = "live_agent_secret_v1";
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
    const inboxFilter = $("inboxFilter");
    const refreshInboxBtn = $("refreshInboxBtn");
    const logoutBtn = $("logoutBtn");
    const inboxStatus = $("inboxStatus");
    const inboxList = $("inboxList");
    const chatEmpty = $("chatEmpty");
    const chatActive = $("chatActive");
    const chatTitle = $("chatTitle");
    const chatMeta = $("chatMeta");
    const claimBtn = $("claimBtn");
    const closeChatBtn = $("closeChatBtn");
    const messageList = $("messageList");
    const composerForm = $("composerForm");
    const composerInput = $("composerInput");
    const sendBtn = $("sendBtn");

    let viewerSecret = "";
    let agentId = "Agent";
    let selectedId = "";
    let lastMessageIso = "";
    let pollTimer = null;

    function loadStoredAuth_() {
        try {
            viewerSecret =
                sessionStorage.getItem(LS_SECRET) || localStorage.getItem(LS_SECRET) || "";
        } catch (_) {
            viewerSecret = "";
        }
        try {
            agentId = sessionStorage.getItem(LS_NAME) || localStorage.getItem(LS_NAME) || "Agent";
        } catch (_) {
            agentId = "Agent";
        }
        if (loginSecret && viewerSecret) loginSecret.value = viewerSecret;
        if (loginAgentName && agentId) loginAgentName.value = agentId;
    }

    function persistAuth_(secret, name) {
        viewerSecret = String(secret || "").trim();
        agentId = String(name || "").trim() || "Agent";
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
        const h = {
            Accept: "application/json",
            "X-Conversations-Sheet-Secret": viewerSecret,
            "X-Live-Agent-Name": agentId
        };
        return h;
    }

    function showLogin() {
        loginView.classList.remove("hidden");
        appView.classList.add("hidden");
        stopPolling();
    }

    function showApp() {
        loginView.classList.add("hidden");
        appView.classList.remove("hidden");
        agentLabel.textContent = agentId;
        loadInbox();
        startPolling();
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(() => {
            loadInbox(true);
            if (selectedId) loadMessages(selectedId, true);
        }, 4000);
    }

    async function apiFetch(url, options) {
        const res = await fetch(url, {
            credentials: "same-origin",
            headers: { ...authHeaders_(), ...(options && options.headers) },
            ...options
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error((data && data.error) || res.statusText || "Request failed");
            err.status = res.status;
            throw err;
        }
        return data;
    }

    async function checkSession() {
        if (!viewerSecret) {
            showLogin();
            return false;
        }
        try {
            const data = await apiFetch(`${API}/me`);
            if (data.ok) {
                agentId = data.agentId || agentId;
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

    toggleSecretBtn.addEventListener("click", () => {
        loginSecret.type = loginSecret.type === "password" ? "text" : "password";
    });

    loginForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const secret = loginSecret.value.trim();
        if (!secret) {
            loginMessage.textContent = "Enter the viewer secret.";
            return;
        }
        persistAuth_(secret, loginAgentName.value.trim());
        loginMessage.textContent = "Checking…";
        try {
            const data = await apiFetch(`${API}/me`);
            agentId = data.agentId || agentId;
            loginMessage.textContent = "";
            showApp();
        } catch (e) {
            clearAuth_();
            loginMessage.textContent = e.message || "Secret rejected.";
        }
    });

    logoutBtn.addEventListener("click", () => {
        clearAuth_();
        selectedId = "";
        if (loginSecret) loginSecret.value = "";
        showLogin();
    });

    refreshInboxBtn.addEventListener("click", () => loadInbox());
    inboxFilter.addEventListener("change", () => loadInbox());

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

    function renderInbox(conversations) {
        inboxList.innerHTML = "";
        if (!conversations.length) {
            inboxStatus.textContent = "No conversations in this queue.";
            return;
        }
        inboxStatus.textContent = `${conversations.length} conversation(s)`;
        for (const c of conversations) {
            const li = document.createElement("li");
            li.className = "inbox-item" + (c.id === selectedId ? " selected" : "");
            const title = c.visitorName || `Session ${c.id.slice(0, 8)}…`;
            const unread = c.unreadForAgent > 0 ? ` · ${c.unreadForAgent} new` : "";
            li.innerHTML =
                `<p class="inbox-item-title">${escapeHtml(title)} <span class="badge ${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></p>` +
                `<p class="inbox-item-preview">${escapeHtml(c.lastMessagePreview || "—")}</p>` +
                `<p class="inbox-item-meta">${escapeHtml(c.assignedAgentEmail || "Unassigned")}${escapeHtml(unread)}</p>`;
            li.addEventListener("click", () => selectConversation(c));
            inboxList.appendChild(li);
        }
    }

    async function loadInbox(quiet) {
        if (!quiet) inboxStatus.textContent = "Loading…";
        try {
            const status = inboxFilter.value || "waiting";
            const data = await apiFetch(`${API}/inbox?status=${encodeURIComponent(status)}`);
            renderInbox(data.conversations || []);
        } catch (e) {
            inboxStatus.textContent = e.message || "Failed to load inbox";
            if (e.status === 401) {
                clearAuth_();
                showLogin();
            }
        }
    }

    function selectConversation(c) {
        selectedId = c.id;
        lastMessageIso = "";
        messageList.innerHTML = "";
        chatEmpty.classList.add("hidden");
        chatActive.classList.remove("hidden");

        const title = c.visitorName || `Session ${c.id.slice(0, 12)}`;
        chatTitle.textContent = title;
        chatMeta.textContent = `${c.status} · bot ${c.botid || "default"} · ${c.id}`;

        const isWaiting = c.status === "waiting";
        const isMine = c.status === "active" && c.assignedAgentEmail === agentId;
        const canReply = isMine;

        claimBtn.hidden = !isWaiting;
        closeChatBtn.hidden = c.status !== "active" || (!isMine && !!c.assignedAgentEmail);
        composerForm.classList.toggle("hidden", !canReply);
        composerInput.disabled = !canReply;

        loadInbox(true);
        loadMessages(c.id);
    }

    async function loadMessages(conversationId, quiet) {
        try {
            const q = lastMessageIso ? `?since=${encodeURIComponent(lastMessageIso)}` : "";
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(conversationId)}/messages${q}`
            );
            const messages = data.messages || [];
            if (!messages.length && quiet) return;
            for (const m of messages) {
                if (document.querySelector(`[data-msg-id="${m.id}"]`)) continue;
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
        }
    }

    function appendMessageEl(m) {
        const div = document.createElement("div");
        div.className = `msg ${m.role || "visitor"}`;
        div.dataset.msgId = m.id;
        div.innerHTML = `${escapeHtml(m.text)}<time>${escapeHtml(formatTime(m.createdAt))}</time>`;
        messageList.appendChild(div);
    }

    claimBtn.addEventListener("click", async () => {
        if (!selectedId) return;
        claimBtn.disabled = true;
        try {
            const data = await apiFetch(`${API}/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: selectedId })
            });
            selectConversation(data.conversation);
        } catch (e) {
            alert(e.message || "Could not claim chat");
        } finally {
            claimBtn.disabled = false;
        }
    });

    closeChatBtn.addEventListener("click", async () => {
        if (!selectedId || !confirm("End this chat for the visitor?")) return;
        try {
            await apiFetch(`${API}/conversations/${encodeURIComponent(selectedId)}/close`, {
                method: "POST"
            });
            selectedId = "";
            chatActive.classList.add("hidden");
            chatEmpty.classList.remove("hidden");
            loadInbox();
        } catch (e) {
            alert(e.message || "Could not close chat");
        }
    });

    composerForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const text = composerInput.value.trim();
        if (!text || !selectedId) return;
        sendBtn.disabled = true;
        try {
            const data = await apiFetch(
                `${API}/conversations/${encodeURIComponent(selectedId)}/messages`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text })
                }
            );
            appendMessageEl(data.message);
            if (data.message && data.message.createdAt) lastMessageIso = data.message.createdAt;
            composerInput.value = "";
            messageList.scrollTop = messageList.scrollHeight;
            loadInbox(true);
        } catch (e) {
            alert(e.message || "Send failed");
        } finally {
            sendBtn.disabled = false;
        }
    });

    loadStoredAuth_();
    checkSession();
})();
