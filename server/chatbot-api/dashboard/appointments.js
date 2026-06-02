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

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function isoFromParts(y, m, d) {
    return y + "-" + pad2(m) + "-" + pad2(d);
  }

  function isoFromDate(dt) {
    return isoFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  function parseIso(iso) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function todayIso() {
    return isoFromDate(new Date());
  }

  function tomorrowIso() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    return isoFromDate(d);
  }

  function monthStart(y, m) {
    return new Date(y, m, 1);
  }

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
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
        return isoFromParts(y, m, d);
      }
    }
    return "";
  }

  function formatIsoDdMmYyyy(iso) {
    var n = appointmentDateToIso(iso);
    if (!n) return "—";
    var parts = n.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function formatDateDdMmYyyy(row) {
    if (row && row.appointmentDateDisplay) {
      return row.appointmentDateDisplay;
    }
    return formatIsoDdMmYyyy(row && row.appointmentDate);
  }

  var t0 = todayIso();
  var now = new Date();

  var state = {
    filter: "",
    dateFrom: t0,
    dateTo: "",
    datePreset: "today",
    calAnchor: "",
    viewYear: now.getFullYear(),
    viewMonth: now.getMonth(),
    rows: []
  };

  var tableBody = $("#apptTableBody");
  var listStatus = $("#listStatus");
  var apptEmpty = $("#apptEmpty");
  var tableWrap = document.querySelector(".appt-table-scroll");
  var calGrid = $("#calGrid");
  var calMonthLabel = $("#calMonthLabel");
  var calRangeLabel = $("#calRangeLabel");
  var calPrev = $("#calPrev");
  var calNext = $("#calNext");
  var btnToday = $("#btnToday");
  var btnTomorrow = $("#btnTomorrow");
  var dayBtns = document.querySelectorAll(".appt-day-btn");

  function effectiveDateTo() {
    if (state.dateTo && state.dateTo !== state.dateFrom) {
      return state.dateTo;
    }
    return "";
  }

  function isRange() {
    return Boolean(effectiveDateTo());
  }

  function syncQuickButtons() {
    dayBtns.forEach(function (btn) {
      var preset = btn.getAttribute("data-preset") || "";
      btn.classList.toggle("active", preset === state.datePreset);
    });
  }

  function updateRangeLabel() {
    if (!calRangeLabel) return;
    var from = formatIsoDdMmYyyy(state.dateFrom);
    var toIso = effectiveDateTo();
    if (state.datePreset === "today") {
      calRangeLabel.textContent = "Showing today · " + from;
      return;
    }
    if (state.datePreset === "tomorrow") {
      calRangeLabel.textContent = "Showing tomorrow · " + from;
      return;
    }
    if (toIso) {
      calRangeLabel.textContent =
        "Showing " + from + " – " + formatIsoDdMmYyyy(toIso);
      return;
    }
    calRangeLabel.textContent = "Showing " + from;
  }

  function setDateFilter(fromIso, toIso, preset) {
    state.dateFrom = fromIso;
    state.dateTo = toIso && toIso !== fromIso ? toIso : "";
    state.datePreset = preset || "custom";
    state.calAnchor = "";
    var d = parseIso(fromIso);
    if (d) {
      state.viewYear = d.getFullYear();
      state.viewMonth = d.getMonth();
    }
    syncQuickButtons();
    updateRangeLabel();
    renderCalendar();
    loadAppointments();
  }

  function selectToday() {
    setDateFilter(todayIso(), "", "today");
  }

  function selectTomorrow() {
    setDateFilter(tomorrowIso(), "", "tomorrow");
  }

  function isPastIso(iso) {
    return iso < todayIso();
  }

  function isInSelectedRange(iso) {
    if (!state.dateFrom) return false;
    var to = effectiveDateTo() || state.dateFrom;
    var a = state.dateFrom < to ? state.dateFrom : to;
    var b = state.dateFrom < to ? to : state.dateFrom;
    return iso >= a && iso <= b;
  }

  function isRangeEdge(iso) {
    var to = effectiveDateTo();
    if (!to) return iso === state.dateFrom;
    return iso === state.dateFrom || iso === to;
  }

  function renderCalendar() {
    if (!calGrid) return;

    var y = state.viewYear;
    var m = state.viewMonth;
    var monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    if (calMonthLabel) {
      calMonthLabel.textContent = monthNames[m] + " " + y;
    }

    var first = monthStart(y, m);
    var startPad = (first.getDay() + 6) % 7;
    var dim = daysInMonth(y, m);
    var today = todayIso();

    var curMonth = now.getFullYear() === y && now.getMonth() === m;
    if (calPrev) {
      calPrev.disabled = curMonth;
    }

    calGrid.innerHTML = "";
    var i;
    for (i = 0; i < startPad; i++) {
      var blank = document.createElement("span");
      blank.className = "appt-cal-cell appt-cal-cell--blank";
      calGrid.appendChild(blank);
    }

    for (var day = 1; day <= dim; day++) {
      var iso = isoFromParts(y, m + 1, day);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "appt-cal-cell appt-cal-day";
      btn.textContent = String(day);
      btn.dataset.iso = iso;
      btn.setAttribute("aria-label", formatIsoDdMmYyyy(iso));

      if (isPastIso(iso)) {
        btn.classList.add("appt-cal-day--past");
        btn.disabled = true;
      } else {
        if (iso === today) {
          btn.classList.add("appt-cal-day--today");
        }
        if (isInSelectedRange(iso)) {
          btn.classList.add("appt-cal-day--in-range");
        }
        if (isRangeEdge(iso)) {
          btn.classList.add("appt-cal-day--selected");
        }
        if (state.calAnchor === iso) {
          btn.classList.add("appt-cal-day--anchor");
        }
        btn.addEventListener("click", function () {
          onCalendarDayClick(iso);
        });
      }
      calGrid.appendChild(btn);
    }
  }

  function onCalendarDayClick(iso) {
    if (isPastIso(iso)) return;

    state.datePreset = "custom";
    syncQuickButtons();

    if (!state.calAnchor) {
      state.calAnchor = iso;
      state.dateFrom = iso;
      state.dateTo = "";
      updateRangeLabel();
      renderCalendar();
      loadAppointments();
      return;
    }

    if (state.calAnchor === iso) {
      state.dateFrom = iso;
      state.dateTo = "";
      state.calAnchor = "";
      updateRangeLabel();
      renderCalendar();
      loadAppointments();
      return;
    }

    var a = state.calAnchor < iso ? state.calAnchor : iso;
    var b = state.calAnchor < iso ? iso : state.calAnchor;
    state.dateFrom = a;
    state.dateTo = b;
    state.calAnchor = "";
    updateRangeLabel();
    renderCalendar();
    loadAppointments();
  }

  function buildQueryString() {
    var parts = [];
    if (state.filter) {
      parts.push("status=" + encodeURIComponent(state.filter));
    }
    if (state.dateFrom) {
      parts.push("dateFrom=" + encodeURIComponent(state.dateFrom));
    }
    var to = effectiveDateTo();
    if (to) {
      parts.push("dateTo=" + encodeURIComponent(to));
    }
    return parts.length ? "?" + parts.join("&") : "";
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
    return n + " appointment" + (n === 1 ? "" : "s");
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

  if (btnToday) {
    btnToday.addEventListener("click", selectToday);
  }
  if (btnTomorrow) {
    btnTomorrow.addEventListener("click", selectTomorrow);
  }

  if (calPrev) {
    calPrev.addEventListener("click", function () {
      if (calPrev.disabled) return;
      state.viewMonth -= 1;
      if (state.viewMonth < 0) {
        state.viewMonth = 11;
        state.viewYear -= 1;
      }
      renderCalendar();
    });
  }

  if (calNext) {
    calNext.addEventListener("click", function () {
      state.viewMonth += 1;
      if (state.viewMonth > 11) {
        state.viewMonth = 0;
        state.viewYear += 1;
      }
      renderCalendar();
    });
  }

  var refreshBtn = $("#refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      loadAppointments();
    });
  }

  syncQuickButtons();
  updateRangeLabel();
  renderCalendar();
  loadAppointments();
})();
