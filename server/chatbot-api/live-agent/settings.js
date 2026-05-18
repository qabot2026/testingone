(function () {
    "use strict";

    const API = "/api/live-agent";
    const LS_SECRET = "conversations_sheet_secret_v1";

    const $ = (id) => document.getElementById(id);

    let viewerSecret = "";

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

    async function loadAll() {
        const data = await apiFetch(`${API}/settings`);
        $("claimWaitSeconds").value = String(data.settings.claimWaitSeconds || 30);
        renderDepartments(data.departments || []);
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
            ta.disabled = !!d.isSystem && d.id === "general" ? false : false;
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

    $("settingsForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        try {
            const data = await apiFetch(`${API}/settings`, {
                method: "PUT",
                body: JSON.stringify({
                    claimWaitSeconds: Number($("claimWaitSeconds").value) || 30
                })
            });
            $("settingsStatus").textContent =
                "Saved — round-robin wait is " + (data.settings.claimWaitSeconds || 30) + " seconds.";
        } catch (e) {
            $("settingsStatus").textContent = e.message;
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

    loadSecret();
    if (viewerSecret) {
        apiFetch(`${API}/me`)
            .then(() => showApp())
            .catch(() => showLogin());
    } else {
        showLogin();
    }
})();
