/* Wakey frontend */

(function () {
  "use strict";

  var DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var currentAlarmId = null;
  var radioPlaying = false;
  var selectedStation = null;
  var stationsCache = null;

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

  function daysText(days) {
    if (days.length === 7) return "Every day";
    if (days.length === 5 && days.indexOf(0) !== -1 && days.indexOf(1) !== -1 &&
        days.indexOf(2) !== -1 && days.indexOf(3) !== -1 && days.indexOf(4) !== -1) {
      return "Weekdays";
    }
    if (days.length === 2 && days.indexOf(5) !== -1 && days.indexOf(6) !== -1) {
      return "Weekends";
    }
    return days.map(function (d) { return DAY_NAMES[d]; }).join(", ");
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
      el.innerHTML = '<div class="home-alarms-empty">No alarms yet</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < alarms.length; i++) {
      var a = alarms[i];
      var label = a.label ? a.label + " \u00b7 " : "";
      html += '<div class="home-alarm ' + (a.enabled ? "" : "disabled") + '" data-id="' + a.id + '">' +
        '<div class="ha-time">' + a.time + '</div>' +
        '<div class="ha-info">' + label + daysText(a.days) + '</div>' +
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

    var cards = el.querySelectorAll(".home-alarm");
    for (var k = 0; k < cards.length; k++) {
      cards[k].addEventListener("click", function () {
        openEditView(this.getAttribute("data-id"));
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

  $("#btn-go-radio").addEventListener("click", function () {
    loadRadioView();
    showView("radio");
  });

  $("#btn-go-hue").addEventListener("click", function () {
    loadLightsView();
    showView("hue");
  });

  $("#btn-go-settings").addEventListener("click", function () {
    loadSettingsView();
    showView("settings");
  });

  $("#btn-back-main").addEventListener("click", function () { loadHomeAlarms(); showView("main"); });
  $("#btn-back-main-radio").addEventListener("click", function () { loadHomeAlarms(); showView("main"); });
  $("#btn-back-main-hue").addEventListener("click", function () { loadHomeAlarms(); showView("main"); });
  $("#btn-back-main-settings").addEventListener("click", function () { loadHomeAlarms(); showView("main"); });

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

  $("#btn-refresh-rooms").addEventListener("click", function () {
    loadHueRoomsForEdit(null);
  });

  // ── Stations loader (reusable) ──

  function loadStations(selectEl, selectedId) {
    fetch("/api/stations")
      .then(function (r) { return r.json(); })
      .then(function (stations) {
        stationsCache = stations;
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
      loadHomeAlarms();
      showView("main");
    });
  });

  // ── Delete alarm ──

  $("#btn-delete-alarm").addEventListener("click", function () {
    if (!currentAlarmId) return;
    if (!confirm("Delete this alarm?")) return;
    fetch("/api/alarms/" + currentAlarmId, { method: "DELETE" }).then(function () {
      loadHomeAlarms();
      showView("main");
    });
  });

  // ═══════════════════════════════════════
  // ── Radio View ──
  // ═══════════════════════════════════════

  function loadRadioView() {
    var el = $("#radio-status");
    el.textContent = "";
    el.className = "status-msg";

    // Check if already playing
    fetch("/api/config/test-radio/status")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.playing) {
          radioPlaying = true;
          $("#radio-indicator").className = "radio-indicator live";
          if (selectedStation) {
            $("#radio-now-playing").textContent = selectedStation;
            $("#radio-now-playing").className = "radio-now-playing active";
          }
        }
      })
      .catch(function () {});

    // Load station buttons
    fetch("/api/stations")
      .then(function (r) { return r.json(); })
      .then(function (stations) {
        stationsCache = stations;
        renderStationButtons(stations);
      });
  }

  function renderStationButtons(stations) {
    var el = $("#radio-station-list");
    var html = "";
    for (var i = 0; i < stations.length; i++) {
      var s = stations[i];
      var active = selectedStation === s.name ? " active" : "";
      html += '<button class="radio-station-btn' + active + '" data-id="' + s.id + '" data-name="' + s.name + '">' + s.name + '</button>';
    }
    el.innerHTML = html;

    var btns = el.querySelectorAll(".radio-station-btn");
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        var name = this.getAttribute("data-name");
        selectStation(id, name);
      });
    }
  }

  function selectStation(id, name) {
    selectedStation = name;
    // Update active state
    var btns = $$("#radio-station-list .radio-station-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-id") === id);
    }

    // If playing, switch station immediately
    if (radioPlaying) {
      playStation(id, name);
    } else {
      $("#radio-now-playing").textContent = name;
      $("#radio-now-playing").className = "radio-now-playing";
    }
  }

  function playStation(id, name) {
    var volume = parseInt($("#radio-volume").value);
    var np = $("#radio-now-playing");
    var indicator = $("#radio-indicator");
    np.textContent = "Connecting...";
    np.className = "radio-now-playing";
    indicator.className = "radio-indicator";

    json("POST", "/api/config/test-radio", { station: id, volume: volume }).then(function (data) {
      if (data.ok) {
        radioPlaying = true;
        selectedStation = data.station || name;
        np.textContent = selectedStation;
        np.className = "radio-now-playing active";
        indicator.className = "radio-indicator live";
        $("#radio-status").textContent = "";
        $("#radio-status").className = "status-msg";
      } else {
        radioPlaying = false;
        np.textContent = "Failed to play";
        np.className = "radio-now-playing";
        indicator.className = "radio-indicator";
        $("#radio-status").textContent = data.error || "Playback failed";
        $("#radio-status").className = "status-msg err";
      }
    });
  }

  $("#radio-volume").addEventListener("input", function () {
    $("#radio-volume-val").textContent = this.value;
    // Live volume update while playing
    if (radioPlaying) {
      json("POST", "/api/config/test-radio/volume", { volume: parseInt(this.value) });
    }
  });

  $("#btn-radio-play").addEventListener("click", function () {
    // Find selected station
    var activeBtn = $("#radio-station-list .radio-station-btn.active");
    var id, name;
    if (activeBtn) {
      id = activeBtn.getAttribute("data-id");
      name = activeBtn.getAttribute("data-name");
    } else if (stationsCache && stationsCache.length > 0) {
      id = stationsCache[0].id;
      name = stationsCache[0].name;
      selectStation(id, name);
    } else {
      return;
    }
    playStation(id, name);
  });

  $("#btn-radio-stop").addEventListener("click", function () {
    json("POST", "/api/config/test-radio/stop", {}).then(function () {
      radioPlaying = false;
      selectedStation = null;
      $("#radio-now-playing").textContent = "Select a station";
      $("#radio-now-playing").className = "radio-now-playing";
      $("#radio-indicator").className = "radio-indicator";
      $("#radio-status").textContent = "";
      $("#radio-status").className = "status-msg";
      // Deselect station buttons
      var btns = $$("#radio-station-list .radio-station-btn");
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.remove("active");
      }
    });
  });

  // ═══════════════════════════════════════
  // ── Lights View ──
  // ═══════════════════════════════════════

  var lightsRoomData = [];

  function loadLightsView() {
    $("#lights-status").textContent = "";
    $("#lights-status").className = "status-msg";
    $("#hue-scenes-panel").style.display = "none";

    // Check if configured
    fetch("/api/hue/status")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.connected) {
          $("#hue-not-configured").style.display = "none";
          $("#hue-rooms-container").style.display = "";
          loadHueRooms();
        } else {
          $("#hue-not-configured").style.display = "";
          $("#hue-rooms-container").style.display = "none";
        }
      })
      .catch(function () {
        $("#hue-not-configured").style.display = "";
        $("#hue-rooms-container").style.display = "none";
      });
  }

  $("#btn-goto-hue-settings").addEventListener("click", function () {
    loadSettingsView();
    showView("settings");
  });

  function loadHueRooms() {
    fetch("/api/hue/rooms?state=true")
      .then(function (r) { return r.json(); })
      .then(function (rooms) {
        lightsRoomData = rooms;
        renderHueRooms(rooms);
      });
  }

  function renderHueRooms(rooms) {
    var el = $("#hue-rooms");
    if (rooms.length === 0) {
      el.innerHTML = '<div class="home-alarms-empty">No rooms found on bridge</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      var briPct = Math.round(r.bri / 254 * 100);
      // Color temp: 153 (cool/6500K) to 500 (warm/2000K)
      html += '<div class="hue-room-card" data-room-id="' + r.id + '">' +
        '<div class="hue-room-header">' +
          '<span class="hue-room-name">' + r.name + '</span>' +
          '<label class="toggle">' +
            '<input type="checkbox" ' + (r.on ? "checked" : "") + ' data-room-id="' + r.id + '" class="hue-room-toggle">' +
            '<span class="slider"></span>' +
          '</label>' +
        '</div>' +
        '<div class="hue-room-controls">' +
          '<div class="form-group">' +
            '<label>Brightness <span class="hue-bri-val" data-room="' + r.id + '">' + briPct + '</span>%</label>' +
            '<input type="range" min="1" max="100" value="' + briPct + '" class="hue-bri-slider" data-room-id="' + r.id + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Warmth</label>' +
            '<input type="range" min="153" max="500" value="' + r.ct + '" class="hue-ct-slider" data-room-id="' + r.id + '">' +
          '</div>' +
          '<div class="hue-room-actions">' +
            '<button class="btn btn-small hue-scenes-btn" data-room-id="' + r.id + '" data-room-name="' + r.name + '">Scenes</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    el.innerHTML = html;

    // Room toggles
    var toggles = el.querySelectorAll(".hue-room-toggle");
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].addEventListener("change", function () {
        var rid = this.getAttribute("data-room-id");
        json("PUT", "/api/hue/rooms/" + rid + "/state", { on: this.checked });
      });
    }

    // Brightness sliders
    var briSliders = el.querySelectorAll(".hue-bri-slider");
    for (var k = 0; k < briSliders.length; k++) {
      briSliders[k].addEventListener("input", function () {
        var rid = this.getAttribute("data-room-id");
        var valEl = el.querySelector('.hue-bri-val[data-room="' + rid + '"]');
        if (valEl) valEl.textContent = this.value;
      });
      briSliders[k].addEventListener("change", function () {
        var rid = this.getAttribute("data-room-id");
        var bri = Math.round(parseInt(this.value) / 100 * 254);
        json("PUT", "/api/hue/rooms/" + rid + "/state", { on: true, bri: bri });
        // Also check the toggle
        var toggle = el.querySelector('.hue-room-toggle[data-room-id="' + rid + '"]');
        if (toggle) toggle.checked = true;
      });
    }

    // Color temp sliders
    var ctSliders = el.querySelectorAll(".hue-ct-slider");
    for (var m = 0; m < ctSliders.length; m++) {
      ctSliders[m].addEventListener("change", function () {
        var rid = this.getAttribute("data-room-id");
        var ct = parseInt(this.value);
        json("PUT", "/api/hue/rooms/" + rid + "/state", { on: true, ct: ct });
        var toggle = el.querySelector('.hue-room-toggle[data-room-id="' + rid + '"]');
        if (toggle) toggle.checked = true;
      });
    }

    // Scene buttons
    var sceneBtns = el.querySelectorAll(".hue-scenes-btn");
    for (var n = 0; n < sceneBtns.length; n++) {
      sceneBtns[n].addEventListener("click", function () {
        var rid = this.getAttribute("data-room-id");
        var rname = this.getAttribute("data-room-name");
        openScenes(rid, rname);
      });
    }
  }

  function openScenes(roomId, roomName) {
    var panel = $("#hue-scenes-panel");
    var title = $("#hue-scenes-title");
    var list = $("#hue-scenes-list");
    title.textContent = roomName + " Scenes";
    list.innerHTML = "Loading...";
    panel.style.display = "";

    fetch("/api/hue/rooms/" + roomId + "/scenes")
      .then(function (r) { return r.json(); })
      .then(function (scenes) {
        if (scenes.length === 0) {
          list.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem">No scenes available</span>';
          return;
        }
        var html = "";
        for (var i = 0; i < scenes.length; i++) {
          var s = scenes[i];
          html += '<button class="hue-scene-btn" data-scene-id="' + s.id + '" data-room-id="' + roomId + '">' + s.name + '</button>';
        }
        list.innerHTML = html;

        var btns = list.querySelectorAll(".hue-scene-btn");
        for (var j = 0; j < btns.length; j++) {
          btns[j].addEventListener("click", function () {
            var sid = this.getAttribute("data-scene-id");
            var rid = this.getAttribute("data-room-id");
            json("POST", "/api/hue/rooms/" + rid + "/scene", { scene_id: sid }).then(function (data) {
              if (data.ok) {
                // Refresh room state after scene activation
                setTimeout(loadHueRooms, 500);
              }
            });
          });
        }
      });
  }

  $("#btn-close-scenes").addEventListener("click", function () {
    $("#hue-scenes-panel").style.display = "none";
  });

  // ═══════════════════════════════════════
  // ── Settings View ──
  // ═══════════════════════════════════════

  function loadSettingsView() {
    // Load BT status
    loadBtStatus();
    $("#bt-status").textContent = "";
    $("#bt-status").className = "status-msg";

    // Load Hue config
    fetch("/api/config")
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        $("#cfg-hue-ip").value = cfg.hue.bridge_ip || "";
        $("#cfg-hue-user").value = cfg.hue.username || "";
      });
    $("#hue-status").textContent = "";
    $("#hue-status").className = "status-msg";
  }

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
      } else {
        el.textContent = "Failed: " + (data.error || "Unknown error");
        el.className = "status-msg err";
      }
    });
  });

  // ═══════════════════════════════════════
  // ── Bluetooth ──
  // ═══════════════════════════════════════

  function loadBtStatus() {
    fetch("/api/bluetooth/status")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var el = $("#bt-current");
        if (data.connected && data.device) {
          el.innerHTML = '<span class="bt-connected">Connected: ' + data.device.name + '</span>';
        } else {
          el.innerHTML = '<span class="bt-none">No speaker connected</span>';
        }
      })
      .catch(function () {
        $("#bt-current").innerHTML = '<span class="bt-none">Bluetooth unavailable</span>';
      });
  }

  $("#btn-bt-scan").addEventListener("click", function () {
    var statusEl = $("#bt-status");
    statusEl.textContent = "Scanning... (~8 seconds)";
    statusEl.className = "status-msg";
    $("#btn-bt-scan").disabled = true;
    $("#bt-devices").innerHTML = "";

    json("POST", "/api/bluetooth/scan", {}).then(function (devices) {
      $("#btn-bt-scan").disabled = false;
      statusEl.textContent = devices.length + " device(s) found";
      statusEl.className = "status-msg";
      renderBtDevices(devices);
    }).catch(function () {
      $("#btn-bt-scan").disabled = false;
      statusEl.textContent = "Scan failed";
      statusEl.className = "status-msg err";
    });
  });

  function renderBtDevices(devices) {
    var el = $("#bt-devices");
    if (devices.length === 0) {
      el.innerHTML = "";
      return;
    }
    var html = "";
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      var btnText, btnClass;
      if (d.connected) {
        btnText = "Disconnect";
        btnClass = "btn btn-stop";
      } else {
        btnText = "Connect";
        btnClass = "btn btn-test";
      }
      html += '<div class="bt-device">' +
        '<div class="bt-info">' +
          '<div class="bt-name">' + d.name + '</div>' +
          '<div class="bt-mac">' + d.mac +
            (d.connected ? ' <span class="bt-badge">Connected</span>' : '') +
            (d.paired && !d.connected ? ' <span class="bt-badge" style="color:var(--text-secondary)">Paired</span>' : '') +
          '</div>' +
        '</div>' +
        '<button class="' + btnClass + '" data-mac="' + d.mac + '" data-action="' + (d.connected ? 'disconnect' : 'connect') + '">' + btnText + '</button>' +
      '</div>';
    }
    el.innerHTML = html;

    var buttons = el.querySelectorAll("button");
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].addEventListener("click", function () {
        var mac = this.getAttribute("data-mac");
        var action = this.getAttribute("data-action");
        btAction(mac, action);
      });
    }
  }

  function btAction(mac, action) {
    var statusEl = $("#bt-status");
    statusEl.textContent = (action === "connect" ? "Connecting..." : "Disconnecting...");
    statusEl.className = "status-msg";

    json("POST", "/api/bluetooth/" + action, { mac: mac }).then(function (data) {
      if (data.ok) {
        statusEl.textContent = (action === "connect" ? "Connected!" : "Disconnected");
        statusEl.className = "status-msg ok";
      } else {
        statusEl.textContent = data.error || "Failed";
        statusEl.className = "status-msg err";
      }
      loadBtStatus();
      fetch("/api/bluetooth/devices")
        .then(function (r) { return r.json(); })
        .then(function (devices) { renderBtDevices(devices); });
    });
  }

})();
