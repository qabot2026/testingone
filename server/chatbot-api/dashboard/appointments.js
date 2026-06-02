(function () {
  "use strict";

  function $(sel) {
    return document.querySelector(sel);
  }

  function showToast(text, kind) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("ok", "err", "show");
    if (kind) el.classList.add(kind);
    el.hidden = false;
    requestAnimationFrame(function () {
      el.classList.add("show");
    });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () {
        el.hidden = true;
      }, 200);
    }, 2600);
  }

  function apiFetch(path, opts) {
    var o = Object.assign({ credentials: "same-origin", headers: {} }, opts || {});
    if (o.body && typeof o.body !== "string") {
      o.headers["Content-Type"] = "application/json";
      o.body = JSON.stringify(o.body);
    }
    return fetch(path, o).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) {
          var msg = (data && data.error) || "HTTP " + resp.status;
          var err = new Error(msg);
          err.status = resp.status;
          throw err;
        }
        return data;
      });
    });
  }

  function statusLabel(status) {
    if (status === "accepted") return "Accepted";
    if (status === "declined") return "Declined";
    return "Requested";
  }

  function formatWhen(dateStr, timeStr) {
    var d = String(dateStr || "").trim();
    var t = String(timeStr || "").trim();
    if (!d && !t) return "—";
    if (d && t) return d + " · " + t;
    return d || t;
  }

  function formatTs(ms) {
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
    } catch (e) {
      return "";
    }
  }

  var state = {
    filter: "",
    rows: [],
    selectedKey: ""
  };

  var listEl = $("#apptList");
  var listStatus = $("#listStatus");
  var apptEmpty = $("#apptEmpty");
  var detailEmpty = $("#detailEmpty");
  var detailPanel = $("#detailPanel");
  var detailBadge = $("#detailBadge");
  var detailTitle = $("#detailTitle");
  var detailWhen = $("#detailWhen");
  var detailDl = $("#detailDl");
  var detailActions = $("#detailActions");
  var detailStaffMeta = $("#detailStaffMeta");
  var acceptBtn = $("#acceptBtn");
  var declineBtn = $("#declineBtn");

  function selectedRow() {
    return state.rows.find(function (r) {
      return r.key === state.selectedKey;
    });
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    var rows = state.rows;
    if (!rows.length) {
      if (apptEmpty) apptEmpty.classList.remove("hidden");
      return;
    }
    if (apptEmpty) apptEmpty.classList.add("hidden");

    rows.forEach(function (row) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "appt-list-item" + (row.key === state.selectedKey ? " selected" : "");
      btn.dataset.key = row.key;

      var st = row.staffStatus || "requested";
      var badge = document.createElement("span");
      badge.className = "appt-list-badge " + st;
      badge.textContent = statusLabel(st);

      var name = document.createElement("p");
      name.className = "appt-list-name";
      name.textContent = row.patientName || "Guest";

      var sub = document.createElement("p");
      sub.className = "appt-list-sub";
      sub.textContent =
        formatWhen(row.appointmentDate, row.appointmentTime) +
        (row.doctorDisplay ? " · " + row.doctorDisplay : "");

      name.appendChild(badge);
      btn.appendChild(name);
      btn.appendChild(sub);
      btn.addEventListener("click", function () {
        state.selectedKey = row.key;
        renderList();
        renderDetail();
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  function detailField(label, value) {
    if (!value) return null;
    var dt = document.createElement("dt");
    dt.textContent = label;
    var dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  }

  function renderDetail() {
    var row = selectedRow();
    if (!row) {
      if (detailEmpty) detailEmpty.classList.remove("hidden");
      if (detailPanel) detailPanel.classList.add("hidden");
      return;
    }
    if (detailEmpty) detailEmpty.classList.add("hidden");
    if (detailPanel) detailPanel.classList.remove("hidden");

    var st = row.staffStatus || "requested";
    if (detailBadge) {
      detailBadge.textContent = statusLabel(st);
      detailBadge.className = "appt-badge " + st;
    }
    if (detailTitle) {
      detailTitle.textContent = row.patientName || "Guest";
    }
    if (detailWhen) {
      detailWhen.textContent = formatWhen(row.appointmentDate, row.appointmentTime);
    }

    if (detailDl) {
      detailDl.innerHTML = "";
      var fields = [
        detailField("Mobile", row.patientMobile),
        detailField("Email", row.patientEmail),
        detailField("Doctor", row.doctorDisplay),
        detailField("Department", row.department),
        detailField("Branch", row.branchId),
        detailField("Location", row.cityOrPlace),
        detailField(
          "Slot booked",
          row.appointmentBooked === "Yes" ? "Yes (chatbot)" : "Pending"
        ),
        detailField("Form", row.formId),
        detailField("Source", row.source),
        detailField("Session", row.sessionId)
      ];
      fields.forEach(function (pair) {
        if (!pair) return;
        detailDl.appendChild(pair[0]);
        detailDl.appendChild(pair[1]);
      });
    }

    var isRequested = st === "requested";
    if (detailActions) {
      detailActions.classList.toggle("hidden", !isRequested);
    }
    if (acceptBtn) acceptBtn.disabled = !isRequested;
    if (declineBtn) declineBtn.disabled = !isRequested;

    if (detailStaffMeta) {
      if (row.staffUpdatedBy || row.staffUpdatedAtMs) {
        detailStaffMeta.textContent =
          "Last updated by " +
          (row.staffUpdatedBy || "staff") +
          (row.staffUpdatedAtMs ? " · " + formatTs(row.staffUpdatedAtMs) : "");
        detailStaffMeta.classList.remove("hidden");
      } else {
        detailStaffMeta.classList.add("hidden");
      }
    }
  }

  function loadAppointments() {
    if (listStatus) listStatus.textContent = "Loading…";
    var q = state.filter ? "?status=" + encodeURIComponent(state.filter) : "";
    return apiFetch("/api/dashboard/appointments" + q)
      .then(function (data) {
        state.rows = Array.isArray(data.appointments) ? data.appointments : [];
        if (
          state.selectedKey &&
          !state.rows.some(function (r) {
            return r.key === state.selectedKey;
          })
        ) {
          state.selectedKey = state.rows[0] ? state.rows[0].key : "";
        }
        if (!state.selectedKey && state.rows[0]) {
          state.selectedKey = state.rows[0].key;
        }
        if (listStatus) {
          listStatus.textContent =
            state.rows.length +
            " appointment" +
            (state.rows.length === 1 ? "" : "s");
        }
        renderList();
        renderDetail();
      })
      .catch(function (err) {
        if (listStatus) listStatus.textContent = "Could not load.";
        showToast(err.message || "Load failed", "err");
      });
  }

  function patchStatus(staffStatus) {
    var row = selectedRow();
    if (!row) return Promise.resolve();
    var label = staffStatus === "accepted" ? "Accept" : "Decline";
    if (!window.confirm(label + " this appointment for " + (row.patientName || "guest") + "?")) {
      return Promise.resolve();
    }
    if (acceptBtn) acceptBtn.disabled = true;
    if (declineBtn) declineBtn.disabled = true;
    return apiFetch("/api/dashboard/appointments/" + encodeURIComponent(row.key), {
      method: "PATCH",
      body: { staffStatus: staffStatus }
    })
      .then(function () {
        showToast("Marked as " + statusLabel(staffStatus), "ok");
        return loadAppointments();
      })
      .catch(function (err) {
        showToast(err.message || "Update failed", "err");
        if (acceptBtn) acceptBtn.disabled = false;
        if (declineBtn) declineBtn.disabled = false;
      });
  }

  var filters = document.querySelectorAll(".appt-filter");
  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      filters.forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      state.filter = btn.getAttribute("data-status") || "";
      loadAppointments();
    });
  });

  var refreshBtn = $("#refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      loadAppointments();
    });
  }
  if (acceptBtn) {
    acceptBtn.addEventListener("click", function () {
      patchStatus("accepted");
    });
  }
  if (declineBtn) {
    declineBtn.addEventListener("click", function () {
      patchStatus("declined");
    });
  }

  loadAppointments();
})();
