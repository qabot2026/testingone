(function () {
    "use strict";

    const API = "/api/live-agent";
    const DASHBOARD_API = "/api/dashboard";

    const $ = (id) => document.getElementById(id);

    const loginView = $("loginView");
    const appView = $("appView");
    const loginForm = $("loginForm");
    const loginEmail = $("loginEmail");
    const loginMessage = $("loginMessage");
    const agentEmailLabel = $("agentEmailLabel");
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

    let agentEmail = "";
    let selectedId = "";
    let selectedConversation = null;
    let lastMessageIso = "";
    let pollTimer = null;

    function showLogin() {
        loginView.classList.remove("hidden");
        appView.classList.add("hidden");
        stopPolling();
    }

    function showApp() {
        loginView.classList.add("hidden");
        appView.classList.remove("hidden");
        agentEmailLabel.textContent = agentEmail || "Signed in";
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
            if (selectedId) {
                loadMessages(selectedId, true);
            }
        }, 4000);
    }

    async function apiFetch(url, options) {
        const res = await fetch(url, {
            credentials: "same-origin",
            headers: { Accept: "application/json", ...(options && options.headers) },
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
        try {
            const data = await apiFetch(`${API}/me`);
            if (data.ok && data.email) {
                agentEmail = data.email;
                showApp();
                return true;
            }
        } catch (e) {
            if (e.status !== 401) {
                console.warn("[live-agent]", e.message);
            }
        }
        showLogin();
        return false;
    }

    loginForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        loginMessage.textContent = "Sending…";
        try {
            const data = await apiFetch(`${DASHBOARD_API}/login/request`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: loginEmail.value.trim() })
            });
            loginMessage.textContent = data.message || "If your email is allowed, a sign-in link was sent.";
        } catch (e) {
            loginMessage.textContent = e.message || "Could not request sign-in link.";
        }
    });

    logoutBtn.addEventListener("click", async () => {
        try {
            await apiFetch(`${DASHBOARD_API}/logout`, { method: "POST" });
        } catch (_) {
            /* ignore */
        }
        agentEmail = "";
        selectedId = "";
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
            li.dataset.id = c.id;
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

    function escapeHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    async function loadInbox(quiet) {
        if (!quiet) inboxStatus.textContent = "Loading…";
        try {
            const status = inboxFilter.value || "waiting";
            const data = await apiFetch(`${API}/inbox?status=${encodeURIComponent(status)}`);
            renderInbox(data.conversations || []);
        } catch (e) {
            inboxStatus.textContent = e.message || "Failed to load inbox";
        }
    }

    function selectConversation(c) {
        selectedId = c.id;
        selectedConversation = c;
        lastMessageIso = "";
        messageList.innerHTML = "";
        chatEmpty.classList.add("hidden");
        chatActive.classList.remove("hidden");

        const title = c.visitorName || `Session ${c.id.slice(0, 12)}`;
        chatTitle.textContent = title;
        chatMeta.textContent = `${c.status} · bot ${c.botid || "default"} · ${c.id}`;

        const isWaiting = c.status === "waiting";
        const isMine =
            c.status === "active" && c.assignedAgentEmail && c.assignedAgentEmail === agentEmail;
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
            const data = await apiFetch(`${API}/conversations/${encodeURIComponent(conversationId)}/messages${q}`);
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
            selectedConversation = null;
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
            if (data.message && data.message.createdAt) {
                lastMessageIso = data.message.createdAt;
            }
            composerInput.value = "";
            messageList.scrollTop = messageList.scrollHeight;
            loadInbox(true);
        } catch (e) {
            alert(e.message || "Send failed");
        } finally {
            sendBtn.disabled = false;
        }
    });

    checkSession();
})();
