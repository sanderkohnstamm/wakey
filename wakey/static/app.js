/* Wakey frontend */

(function () {
  "use strict";

  var DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var currentAlarmId = null;

  // ── Helpers ──

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function showView(id) {
    var views = $$(".view");
    for (var i = 0; i < views.length; i++) {
      views[i].classList.remove("active");
    }
    document.getElementById("view-" + id).classList.add("active");
  }

  function json(method, url, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) { opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) { return r.json(); });
  }

  // ── Clock ──

  function updateClock() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, "0");
    var m = String(now.getMinutes()).padStart(2, "0");
    $("#clock").textContent = h + ":" + m;

    var opts = { weekday: "long", day: "numeric", month: "long" };
    $("#date-display").textContent = now.toLocaleDateString("en-GB", opts);
  }

  setInterval(updateClock, 1000);
  updateClock();

  // ── Status polling ──

  function pollStatus() {
    fetch("/api/status")
      .then(function (r) { return r.json(); })
      .then(function (data) { updateStatusUI(data); })
      .catch(function () {});
  }

  function updateStatusUI(data) {
    var panel = $("#alarm-active-panel");
    var statusText = $("#alarm-status-text");
    var nextAlarm = $("#next-alarm");

    if (data.state === "idle") {
      panel.classList.add("hidden");
      if (data.next_fire_time) {
        var next = new Date(data.next_fire_time);
        var diff = next - new Date();
        if (diff > 0) {
          var hours = Math.floor(diff / 3600000);
          var mins = Math.floor((diff % 3600000) / 60000);
          nextAlarm.textContent = "Next alarm in " + hours + "h " + mins + "m";
        } else {
          nextAlarm.textContent = "";
        }
      } else {
        nextAlarm.textContent = "No alarms set";
      }
    } else {
      panel.classList.remove("hidden");
      nextAlarm.textContent = "";
      var labels = {
        sunrise: "Sunrise in progress...",
        active: "Alarm ringing!",
        snoozed: "Snoozed..."
      };
      statusText.textContent = labels[data.state] || data.state;
    }
  }

  setInterval(pollStatus, 2000);
  pollStatus();

  // ── Home alarm list ──

  function loadHomeAlarms() {
    fetch("/api/alarms")
      .then(function (r) { return r.json(); })
      .then(function (alarms) { renderHomeAlarms(alarms); });
  }

  function renderHomeAlarms(alarms) {
    var el = $("#home-alarms");
    if (alarms.length === 0) {
      el.innerHTML = "";
      return;
    }
    var html = "";
    for (var i = 0; i < alarms.length; i++) {
      var a = alarms[i];
      var daysStr;
      if (a.days.length === 7) {
        daysStr = "Every day";
      } else if (a.days.length === 5 && a.days.indexOf(0) !== -1 && a.days.indexOf(1) !== -1 &&
                 a.days.indexOf(2) !== -1 && a.days.indexOf(3) !== -1 && a.days.indexOf(4) !== -1) {
        daysStr = "Weekdays";
      } else if (a.days.length === 2 && a.days.indexOf(5) !== -1 && a.days.indexOf(6) !== -1) {
        daysStr = "Weekends";
      } else {
        daysStr = a.days.map(function (d) { return DAY_NAMES[d]; }).join(", ");
      }
      var label = a.label ? a.label + " \u00b7 " : "";
      html += '<div class="home-alarm ' + (a.enabled ? "" : "disabled") + '">' +
        '<div class="ha-time">' + a.time + '</div>' +
        '<div class="ha-info">' + label + daysStr + '</div>' +
        '<label class="toggle" onclick="event.stopPropagation()">' +
          '<input type="checkbox" ' + (a.enabled ? "checked" : "") + ' data-alarm-id="' + a.id + '">' +
          '<span class="slider"></span>' +
        '</label>' +
      '</div>';
    }
    el.innerHTML = html;

    var toggles = el.querySelectorAll(".toggle input");
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].addEventListener("change", function () {
        var id = this.getAttribute("data-alarm-id");
        json("PUT", "/api/alarms/" + id, { enabled: this.checked }).then(function () {
          loadHomeAlarms();
        });
      });
    }
  }

  loadHomeAlarms();

  // ── Dismiss / Snooze ──

  $("#btn-dismiss").addEventListener("click", function () {
    fetch("/api/dismiss", { method: "POST" }).then(pollStatus);
  });

  $("#btn-snooze").addEventListener("click", function () {
    fetch("/api/snooze", { method: "POST" }).then(pollStatus);
  });

  // ── Navigation ──

  $("#btn-go-settings").addEventListener("click", function () {
    loadAlarmList();
    showView("settings");
  });

  $("#btn-go-configure").addEventListener("click", function () {
    loadConfigureView();
    showView("configure");
  });

  $("#btn-back-main").addEventListener("click", function () { loadHomeAlarms(); showView("main"); });
  $("#btn-back-main-cfg").addEventListener("click", function () { loadHomeAlarms(); showView("main"); });

  $("#btn-back-settings").addEventListener("click", function () {
    loadAlarmList();
    showView("settings");
  });

  // ── Alarm list ──

  function loadAlarmList() {
    fetch("/api/alarms")
      .then(function (r) { return r.json(); })
      .then(function (alarms) { renderAlarmList(alarms); });
  }

  function renderAlarmList(alarms) {
    var list = $("#alarm-list");

    if (alarms.length === 0) {
      list.innerHTML = '<div class="empty-state">No alarms yet. Tap + to add one.</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < alarms.length; i++) {
      var a = alarms[i];
      var daysStr;
      if (a.days.length === 7) {
        daysStr = "Every day";
      } else if (a.days.length === 5 && a.days.indexOf(0) !== -1 && a.days.indexOf(1) !== -1 &&
                 a.days.indexOf(2) !== -1 && a.days.indexOf(3) !== -1 && a.days.indexOf(4) !== -1) {
        daysStr = "Weekdays";
      } else {
        daysStr = a.days.map(function (d) { return DAY_NAMES[d]; }).join(", ");
      }
      html += '<div class="alarm-card ' + (a.enabled ? "" : "disabled") + '" data-id="' + a.id + '">' +
        '<div class="time">' + a.time + '</div>' +
        '<div class="info">' +
          '<div class="label">' + (a.label || "") + '</div>' +
          '<div class="days-text">' + daysStr + '</div>' +
        '</div>' +
        '<label class="toggle" onclick="event.stopPropagation()">' +
          '<input type="checkbox" ' + (a.enabled ? "checked" : "") + ' data-alarm-id="' + a.id + '">' +
          '<span class="slider"></span>' +
        '</label>' +
      '</div>';
    }
    list.innerHTML = html;

    // Toggle handlers
    var toggles = list.querySelectorAll(".toggle input");
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].addEventListener("change", function () {
        var id = this.getAttribute("data-alarm-id");
        json("PUT", "/api/alarms/" + id, { enabled: this.checked });
      });
    }

    // Click to edit
    var cards = list.querySelectorAll(".alarm-card");
    for (var k = 0; k < cards.length; k++) {
      cards[k].addEventListener("click", function () {
        openEditView(this.getAttribute("data-id"));
      });
    }
  }

  // ── Add alarm ──

  $("#btn-add-alarm").addEventListener("click", function () {
    currentAlarmId = null;
    $("#edit-title").textContent = "New Alarm";
    $("#btn-delete-alarm").style.display = "none";
    resetForm();
    loadStations($("#f-station"), null);
    loadHueRoomsForEdit(null);
    showView("edit");
  });

  // ── Edit alarm ──

  function openEditView(id) {
    currentAlarmId = id;
    $("#edit-title").textContent = "Edit Alarm";
    $("#btn-delete-alarm").style.display = "";

    fetch("/api/alarms/" + id)
      .then(function (r) { return r.json(); })
      .then(function (a) {
        $("#f-time").value = a.time;
        $("#f-label").value = a.label;

        var pills = $$(".pill");
        for (var i = 0; i < pills.length; i++) {
          var day = parseInt(pills[i].getAttribute("data-day"));
          pills[i].classList.toggle("active", a.days.indexOf(day) !== -1);
        }

        loadStations($("#f-station"), a.audio.station);
        $("#f-volume").value = a.audio.volume;
        $("#f-volume-val").textContent = a.audio.volume;

        $("#f-hue-enabled").checked = a.hue.enabled;
        loadHueRoomsForEdit(a.hue.room_id);
        $("#f-hue-offset").value = a.hue.offset_minutes;
        $("#f-offset-val").textContent = a.hue.offset_minutes;

        $("#f-snooze").value = a.snooze_minutes;
        $("#f-snooze-val").textContent = a.snooze_minutes;
        $("#f-autostop").value = a.auto_stop_minutes;
        $("#f-autostop-val").textContent = a.auto_stop_minutes;

        showView("edit");
      });
  }

  function resetForm() {
    $("#f-time").value = "07:00";
    $("#f-label").value = "";
    var pills = $$(".pill");
    for (var i = 0; i < pills.length; i++) {
      var day = parseInt(pills[i].getAttribute("data-day"));
      pills[i].classList.toggle("active", day < 5);
    }
    $("#f-volume").value = 70;
    $("#f-volume-val").textContent = "70";
    $("#f-hue-enabled").checked = true;
    $("#f-hue-room").innerHTML = '<option value="">--</option>';
    $("#f-hue-offset").value = 20;
    $("#f-offset-val").textContent = "20";
    $("#f-snooze").value = 9;
    $("#f-snooze-val").textContent = "9";
    $("#f-autostop").value = 30;
    $("#f-autostop-val").textContent = "30";
  }

  function loadHueRoomsForEdit(selectedId) {
    var sel = $("#f-hue-room");
    sel.innerHTML = '<option value="">Loading...</option>';
    fetch("/api/hue/rooms")
      .then(function (r) { return r.json(); })
      .then(function (rooms) {
        if (rooms.length === 0) {
          sel.innerHTML = '<option value="">No rooms (configure Hue first)</option>';
          return;
        }
        var html = "";
        for (var i = 0; i < rooms.length; i++) {
          var r = rooms[i];
          html += '<option value="' + r.id + '"' + (r.id === selectedId ? " selected" : "") + '>' + r.name + '</option>';
        }
        sel.innerHTML = html;
      })
      .catch(function () {
        sel.innerHTML = '<option value="">Error loading rooms</option>';
      });
  }

  // ── Day pills ──

  var pills = $$(".pill");
  for (var pi = 0; pi < pills.length; pi++) {
    pills[pi].addEventListener("click", function () {
      this.classList.toggle("active");
    });
  }

  // ── Range sliders ──

  $("#f-volume").addEventListener("input", function () { $("#f-volume-val").textContent = this.value; });
  $("#f-hue-offset").addEventListener("input", function () { $("#f-offset-val").textContent = this.value; });
  $("#f-snooze").addEventListener("input", function () { $("#f-snooze-val").textContent = this.value; });
  $("#f-autostop").addEventListener("input", function () { $("#f-autostop-val").textContent = this.value; });

  // ── Refresh rooms in edit view ──

  $("#btn-refresh-rooms").addEventListener("click", function () {
    loadHueRoomsForEdit(null);
  });

  // ── Stations loader (reusable) ──

  function loadStations(selectEl, selectedId) {
    fetch("/api/stations")
      .then(function (r) { return r.json(); })
      .then(function (stations) {
        var html = "";
        for (var i = 0; i < stations.length; i++) {
          var s = stations[i];
          html += '<option value="' + s.id + '"' + (s.id === selectedId ? " selected" : "") + '>' + s.name + '</option>';
        }
        selectEl.innerHTML = html;
      });
  }

  // ── Save alarm ──

  $("#alarm-form").addEventListener("submit", function (e) {
    e.preventDefault();

    var days = [];
    var activePills = $$(".pill.active");
    for (var i = 0; i < activePills.length; i++) {
      days.push(parseInt(activePills[i].getAttribute("data-day")));
    }

    var roomSel = $("#f-hue-room");
    var roomOption = roomSel.options[roomSel.selectedIndex];

    var body = {
      time: $("#f-time").value,
      label: $("#f-label").value,
      days: days,
      hue: {
        room_id: roomSel.value,
        room_name: roomOption ? roomOption.textContent : "",
        offset_minutes: parseInt($("#f-hue-offset").value),
        enabled: $("#f-hue-enabled").checked
      },
      audio: {
        station: $("#f-station").value,
        volume: parseInt($("#f-volume").value),
        ramp_seconds: 30,
        enabled: true
      },
      snooze_minutes: parseInt($("#f-snooze").value),
      auto_stop_minutes: parseInt($("#f-autostop").value)
    };

    var method = currentAlarmId ? "PUT" : "POST";
    var url = currentAlarmId ? "/api/alarms/" + currentAlarmId : "/api/alarms";

    json(method, url, body).then(function () {
      loadAlarmList();
      showView("settings");
    });
  });

  // ── Delete alarm ──

  $("#btn-delete-alarm").addEventListener("click", function () {
    if (!currentAlarmId) return;
    if (!confirm("Delete this alarm?")) return;
    fetch("/api/alarms/" + currentAlarmId, { method: "DELETE" }).then(function () {
      loadAlarmList();
      showView("settings");
    });
  });

  // ═══════════════════════════════════════
  // ── Configure View ──
  // ═══════════════════════════════════════

  function loadConfigureView() {
    // Load stations into configure dropdown
    loadStations($("#cfg-station"), null);

    // Load saved Hue config
    fetch("/api/config")
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        $("#cfg-hue-ip").value = cfg.hue.bridge_ip || "";
        $("#cfg-hue-user").value = cfg.hue.username || "";
      });

    $("#radio-status").textContent = "";
    $("#radio-status").className = "status-msg";
    $("#hue-status").textContent = "";
    $("#hue-status").className = "status-msg";
    $("#light-status").textContent = "";
    $("#light-status").className = "status-msg";
  }

  // Radio volume slider
  $("#cfg-volume").addEventListener("input", function () {
    $("#cfg-volume-val").textContent = this.value;
  });

  // Test radio
  $("#btn-test-radio").addEventListener("click", function () {
    var station = $("#cfg-station").value;
    var volume = parseInt($("#cfg-volume").value);
    var el = $("#radio-status");
    el.textContent = "Starting...";
    el.className = "status-msg";
    json("POST", "/api/config/test-radio", { station: station, volume: volume }).then(function (data) {
      if (data.ok) {
        el.textContent = "Playing " + data.station;
        el.className = "status-msg ok";
      } else {
        el.textContent = data.error || "Failed to play";
        el.className = "status-msg err";
      }
    });
  });

  // Stop radio
  $("#btn-stop-radio").addEventListener("click", function () {
    json("POST", "/api/config/test-radio/stop", {}).then(function () {
      var el = $("#radio-status");
      el.textContent = "Stopped";
      el.className = "status-msg";
    });
  });

  // Generate Hue API key
  $("#btn-generate-key").addEventListener("click", function () {
    var ip = $("#cfg-hue-ip").value.trim();
    if (!ip) {
      var el = $("#hue-status");
      el.textContent = "Enter bridge IP first";
      el.className = "status-msg err";
      return;
    }
    var el = $("#hue-status");
    el.textContent = "Registering... (press bridge button now if you haven't)";
    el.className = "status-msg";
    json("POST", "/api/hue/register", { bridge_ip: ip }).then(function (data) {
      if (data.ok) {
        $("#cfg-hue-user").value = data.username;
        el.textContent = "API key generated and saved!";
        el.className = "status-msg ok";
        loadCfgRooms(null);
      } else {
        el.textContent = data.error || "Registration failed";
        el.className = "status-msg err";
      }
    });
  });

  // Save Hue config
  $("#btn-save-hue").addEventListener("click", function () {
    var body = {
      hue: {
        bridge_ip: $("#cfg-hue-ip").value.trim(),
        username: $("#cfg-hue-user").value.trim()
      }
    };
    json("PUT", "/api/config", body).then(function () {
      var el = $("#hue-status");
      el.textContent = "Saved!";
      el.className = "status-msg ok";
    });
  });

  // Test Hue connection
  $("#btn-test-hue").addEventListener("click", function () {
    // Save first, then test
    var body = {
      hue: {
        bridge_ip: $("#cfg-hue-ip").value.trim(),
        username: $("#cfg-hue-user").value.trim()
      }
    };
    json("PUT", "/api/config", body).then(function () {
      return fetch("/api/hue/status").then(function (r) { return r.json(); });
    }).then(function (data) {
      var el = $("#hue-status");
      if (data.connected) {
        el.textContent = "Connected to " + data.name;
        el.className = "status-msg ok";
        // Also load rooms
        loadCfgRooms(null);
      } else {
        el.textContent = "Failed: " + (data.error || "Unknown error");
        el.className = "status-msg err";
      }
    });
  });

  // Load rooms in configure view
  function loadCfgRooms(selectedId) {
    var sel = $("#cfg-hue-room");
    sel.innerHTML = '<option value="">Loading...</option>';
    fetch("/api/hue/rooms")
      .then(function (r) { return r.json(); })
      .then(function (rooms) {
        if (rooms.length === 0) {
          sel.innerHTML = '<option value="">No rooms found</option>';
          return;
        }
        var html = "";
        for (var i = 0; i < rooms.length; i++) {
          var r = rooms[i];
          html += '<option value="' + r.id + '"' + (r.id === selectedId ? " selected" : "") + '>' + r.name + '</option>';
        }
        sel.innerHTML = html;
      });
  }

  $("#btn-cfg-refresh-rooms").addEventListener("click", function () {
    loadCfgRooms(null);
  });

  // Test light
  $("#btn-test-light").addEventListener("click", function () {
    var roomId = $("#cfg-hue-room").value;
    if (!roomId) {
      var el = $("#light-status");
      el.textContent = "Select a room first";
      el.className = "status-msg err";
      return;
    }
    var el = $("#light-status");
    el.textContent = "Testing...";
    el.className = "status-msg";
    json("POST", "/api/hue/test", { room_id: roomId }).then(function (data) {
      if (data.ok) {
        el.textContent = "Light flashed!";
        el.className = "status-msg ok";
      } else {
        el.textContent = "Failed: " + (data.error || "Unknown error");
        el.className = "status-msg err";
      }
    });
  });

})();
