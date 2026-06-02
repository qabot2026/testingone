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

  function cellText(value) {
    var s = String(value || "").trim();
    return s || "—";
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var state = {
    filter: "",
    rows: []
  };

  var tableBody = $("#apptTableBody");
  var listStatus = $("#listStatus");
  var apptEmpty = $("#apptEmpty");
  var tableWrap = document.querySelector(".appt-table-scroll");

  function renderTable() {
    if (!tableBody) return;
    tableBody.innerHTML = "";
    var rows = state.rows;

    if (!rows.length) {
      if (apptEmpty) apptEmpty.classList.remove("hidden");
      if (tableWrap) tableWrap.classList.add("hidden");
      return;
    }
    if (apptEmpty) apptEmpty.classList.add("hidden");
    if (tableWrap) tableWrap.classList.remove("hidden");

    rows.forEach(function (row) {
      var st = row.staffStatus || "requested";
      var tr = document.createElement("tr");
      tr.dataset.key = row.key;

      var slotLabel =
        row.appointmentBooked === "Yes" ? "Booked" : "Pending";

      var actionsHtml = "—";
      if (st === "requested") {
        actionsHtml =
          '<div class="appt-row-actions">' +
          '<button type="button" class="btn primary small appt-act-accept" data-key="' +
          esc(row.key) +
          '">Accept</button>' +
          '<button type="button" class="btn ghost small appt-decline-btn appt-act-decline" data-key="' +
          esc(row.key) +
          '">Decline</button>' +
          "</div>";
      } else if (row.staffUpdatedBy || row.staffUpdatedAtMs) {
        var meta = esc(row.staffUpdatedBy || "staff");
        actionsHtml = '<span class="appt-act-meta muted">' + meta + "</span>";
      }

      tr.innerHTML =
        '<td><span class="appt-badge ' +
        esc(st) +
        '">' +
        esc(statusLabel(st)) +
        "</span></td>" +
        "<td><strong>" +
        esc(row.patientName || "Guest") +
        "</strong></td>" +
        "<td>" +
        esc(cellText(row.patientMobile)) +
        "</td>" +
        "<td class=\"appt-cell-email\">" +
        esc(cellText(row.patientEmail)) +
        "</td>" +
        "<td>" +
        esc(cellText(row.appointmentDate)) +
        "</td>" +
        "<td>" +
        esc(cellText(row.appointmentTime)) +
        "</td>" +
        "<td>" +
        esc(cellText(row.doctorDisplay)) +
        "</td>" +
        "<td>" +
        esc(cellText(row.department)) +
        "</td>" +
        "<td>" +
        esc(cellText(row.branchId)) +
        "</td>" +
        "<td>" +
        esc(slotLabel) +
        "</td>" +
        "<td class=\"appt-cell-actions\">" +
        actionsHtml +
        "</td>";

      tableBody.appendChild(tr);
    });

    tableBody.querySelectorAll(".appt-act-accept").forEach(function (btn) {
      btn.addEventListener("click", function () {
        patchStatus(btn.getAttribute("data-key"), "accepted");
      });
    });
    tableBody.querySelectorAll(".appt-act-decline").forEach(function (btn) {
      btn.addEventListener("click", function () {
        patchStatus(btn.getAttribute("data-key"), "declined");
      });
    });
  }

  function findRow(key) {
    return state.rows.find(function (r) {
      return r.key === key;
    });
  }

  function patchStatus(key, staffStatus) {
    var row = findRow(key);
    if (!row) return Promise.resolve();
    var label = staffStatus === "accepted" ? "Accept" : "Decline";
    if (
      !window.confirm(
        label + " appointment for " + (row.patientName || "guest") + "?"
      )
    ) {
      return Promise.resolve();
    }
    var tr = tableBody ? tableBody.querySelector('tr[data-key="' + key + '"]') : null;
    var rowBtns = tr ? tr.querySelectorAll("button") : [];
    rowBtns.forEach(function (b) {
      b.disabled = true;
    });

    return apiFetch("/api/dashboard/appointments/" + encodeURIComponent(key), {
      method: "PATCH",
      body: { staffStatus: staffStatus }
    })
      .then(function () {
        showToast("Marked as " + statusLabel(staffStatus), "ok");
        return loadAppointments();
      })
      .catch(function (err) {
        showToast(err.message || "Update failed", "err");
        rowBtns.forEach(function (b) {
          b.disabled = false;
        });
      });
  }

  function loadAppointments() {
    if (listStatus) listStatus.textContent = "Loading…";
    var q = state.filter ? "?status=" + encodeURIComponent(state.filter) : "";
    return apiFetch("/api/dashboard/appointments" + q)
      .then(function (data) {
        state.rows = Array.isArray(data.appointments) ? data.appointments : [];
        if (listStatus) {
          listStatus.textContent =
            state.rows.length +
            " appointment" +
            (state.rows.length === 1 ? "" : "s");
        }
        renderTable();
      })
      .catch(function (err) {
        if (listStatus) listStatus.textContent = "Could not load.";
        showToast(err.message || "Load failed", "err");
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

  loadAppointments();
})();
