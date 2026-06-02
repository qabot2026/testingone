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

  /** Normalize stored date to YYYY-MM-DD for filters. */
  function appointmentDateToIso(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var dmY = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmY) {
      var d = Number(dmY[1]);
      var m = Number(dmY[2]);
      var y = Number(dmY[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return (
          y +
          "-" +
          String(m).padStart(2, "0") +
          "-" +
          String(d).padStart(2, "0")
        );
      }
    }
    return "";
  }

  /** Display as DD/MM/YYYY. */
  function formatDateDdMmYyyy(row) {
    if (row && row.appointmentDateDisplay) {
      return row.appointmentDateDisplay;
    }
    var iso = appointmentDateToIso(row && row.appointmentDate);
    if (!iso) return cellText(row && row.appointmentDate);
    var parts = iso.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  var state = {
    filter: "",
    dateMode: "single",
    dateFrom: "",
    dateTo: "",
    rows: []
  };

  var tableBody = $("#apptTableBody");
  var listStatus = $("#listStatus");
  var apptEmpty = $("#apptEmpty");
  var tableWrap = document.querySelector(".appt-table-scroll");
  var dateFromInput = $("#dateFrom");
  var dateToInput = $("#dateTo");
  var dateToLabel = $("#dateToLabel");
  var dateFromLabel = $("#dateFromLabel");
  var dateFilterHint = $("#dateFilterHint");

  function readDateModeFromUi() {
    var checked = document.querySelector('input[name="dateMode"]:checked');
    state.dateMode = checked && checked.value === "range" ? "range" : "single";
  }

  function syncDateModeUi() {
    var isRange = state.dateMode === "range";
    if (dateToLabel) dateToLabel.classList.toggle("hidden", !isRange);
    if (dateFromLabel) {
      var span = dateFromLabel.querySelector(".appt-date-label-text");
      if (span) span.textContent = isRange ? "From" : "Date";
    }
    if (dateFilterHint) {
      dateFilterHint.textContent = isRange
        ? "Dates shown as DD/MM/YYYY. Set From and To, then Apply."
        : "Dates shown as DD/MM/YYYY. Pick one day, then Apply.";
    }
  }

  function readDatesFromInputs() {
    state.dateFrom = dateFromInput ? String(dateFromInput.value || "").trim() : "";
    state.dateTo = dateToInput ? String(dateToInput.value || "").trim() : "";
  }

  function buildQueryString() {
    var parts = [];
    if (state.filter) {
      parts.push("status=" + encodeURIComponent(state.filter));
    }
    if (state.dateFrom) {
      parts.push("dateFrom=" + encodeURIComponent(state.dateFrom));
    }
    if (state.dateMode === "range" && state.dateTo) {
      parts.push("dateTo=" + encodeURIComponent(state.dateTo));
    }
    return parts.length ? "?" + parts.join("&") : "";
  }

  function validateDateFilter() {
    readDatesFromInputs();
    if (!state.dateFrom && !state.dateTo) {
      return true;
    }
    if (!state.dateFrom) {
      showToast("Choose a date (From).", "err");
      return false;
    }
    if (state.dateMode === "range" && state.dateTo && state.dateFrom > state.dateTo) {
      showToast("'From' must be on or before 'To'.", "err");
      return false;
    }
    return true;
  }

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
        '<td class="appt-cell-email">' +
        esc(cellText(row.patientEmail)) +
        "</td>" +
        "<td>" +
        esc(formatDateDdMmYyyy(row)) +
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
        '<td class="appt-cell-actions">' +
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

  function statusLineText() {
    var n = state.rows.length;
    var base = n + " appointment" + (n === 1 ? "" : "s");
    if (!state.dateFrom) return base;
    if (state.dateMode === "range" && state.dateTo) {
      return (
        base +
        " · " +
        formatDateDdMmYyyy({ appointmentDate: state.dateFrom }) +
        " – " +
        formatDateDdMmYyyy({ appointmentDate: state.dateTo })
      );
    }
    return base + " · " + formatDateDdMmYyyy({ appointmentDate: state.dateFrom });
  }

  function loadAppointments() {
    if (listStatus) listStatus.textContent = "Loading…";
    return apiFetch("/api/dashboard/appointments" + buildQueryString())
      .then(function (data) {
        state.rows = Array.isArray(data.appointments) ? data.appointments : [];
        if (listStatus) listStatus.textContent = statusLineText();
        renderTable();
      })
      .catch(function (err) {
        if (listStatus) listStatus.textContent = "Could not load.";
        showToast(err.message || "Load failed", "err");
      });
  }

  function applyDateFilter() {
    readDateModeFromUi();
    syncDateModeUi();
    if (!validateDateFilter()) return;
    if (!state.dateFrom && !state.dateTo) {
      loadAppointments();
      return;
    }
    loadAppointments();
  }

  function clearDateFilter() {
    state.dateFrom = "";
    state.dateTo = "";
    if (dateFromInput) dateFromInput.value = "";
    if (dateToInput) dateToInput.value = "";
    loadAppointments();
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

  document.querySelectorAll('input[name="dateMode"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      readDateModeFromUi();
      syncDateModeUi();
      if (state.dateMode === "single" && dateToInput) {
        dateToInput.value = "";
        state.dateTo = "";
      }
    });
  });

  var applyDateBtn = $("#applyDateBtn");
  if (applyDateBtn) {
    applyDateBtn.addEventListener("click", applyDateFilter);
  }

  var clearDateBtn = $("#clearDateBtn");
  if (clearDateBtn) {
    clearDateBtn.addEventListener("click", clearDateFilter);
  }

  var refreshBtn = $("#refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      readDatesFromInputs();
      loadAppointments();
    });
  }

  syncDateModeUi();
  loadAppointments();
})();
