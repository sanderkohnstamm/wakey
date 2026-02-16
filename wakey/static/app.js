/* Wakey frontend */

(function () {
  "use strict";

  var DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var currentAlarmId = null;
  var radioPlaying = false;
  var selectedStation = null;
  var stationsCache = null;
  var spotifyPollingTimer = null;

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
          var hh = String(next.getHours()).padStart(2, "0");
          var mm = String(next.getMinutes()).padStart(2, "0");
          nextAlarm.textContent = hh + ":" + mm + " \u00b7 in " + hours + "h " + mins + "m";
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
    alarms.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    if (alarms.length === 0) {
      el.innerHTML = '<div class="home-alarms-empty">No alarms yet</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < alarms.length; i++) {
      var a = alarms[i];
      var label = a.label ? a.label + " \u00b7 " : "";
      var source = (a.audio && a.audio.source) || "radio";
      var sourceLabel = source === "spotify" ? "Spotify" : "Radio";
      html += '<div class="home-alarm ' + (a.enabled ? "" : "disabled") + '" data-id="' + a.id + '">' +
        '<div class="ha-time">' + a.time + '</div>' +
        '<div class="ha-info">' + label + daysText(a.days) + '</div>' +
        '<span class="ha-source ' + source + '">' + sourceLabel + '</span>' +
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

  $("#btn-go-music").addEventListener("click", function () {
    loadMusicView();
    showView("music");
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
  $("#btn-back-main-music").addEventListener("click", function () {
    stopSpotifyPolling();
    loadHomeAlarms();
    showView("main");
  });
  $("#btn-back-main-hue").addEventListener("click", function () { loadHomeAlarms(); showView("main"); });
  $("#btn-back-main-settings").addEventListener("click", function () { loadHomeAlarms(); showView("main"); });

  // ── Add alarm ──

  $("#btn-add-alarm").addEventListener("click", function () {
    currentAlarmId = null;
    $("#edit-title").textContent = "New Alarm";
    $("#btn-delete-alarm").style.display = "none";
    resetForm();
    loadStations($("#f-station"), null);
    loadSpotifyPresetsForEdit("");
    loadHueRoomsForEdit([]);
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

        // Source toggle
        var source = a.audio.source || "radio";
        setSourceToggle(source);

        loadStations($("#f-station"), a.audio.station);
        loadSpotifyPresetsForEdit(a.audio.spotify_uri);
        $("#f-volume").value = a.audio.volume;
        $("#f-volume-val").textContent = a.audio.volume;

        $("#f-hue-enabled").checked = a.hue.enabled;
        // Multi-room: pass rooms list and fall back to single room
        var rooms = a.hue.rooms || [];
        if (rooms.length === 0 && a.hue.room_id) {
          rooms = [{ id: a.hue.room_id, name: a.hue.room_name || "" }];
        }
        loadHueRoomsForEdit(rooms);
        loadHueScenesForEdit(rooms, a.hue.scene_id);
        $("#f-hue-warmth").value = (a.hue.warmth !== undefined) ? a.hue.warmth : 326;
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
    setSourceToggle("radio");
    $("#f-volume").value = 70;
    $("#f-volume-val").textContent = "70";
    $("#f-hue-enabled").checked = true;
    $("#f-hue-rooms").innerHTML = "";
    $("#f-hue-scene").innerHTML = '<option value="">None</option>';
    $("#f-hue-warmth").value = 326;
    $("#f-hue-offset").value = 20;
    $("#f-offset-val").textContent = "20";
    $("#f-snooze").value = 9;
    $("#f-snooze-val").textContent = "9";
    $("#f-autostop").value = 30;
    $("#f-autostop-val").textContent = "30";
  }

  function loadHueRoomsForEdit(selectedRooms) {
    // selectedRooms: array of {id, name} that should be checked
    if (!selectedRooms) selectedRooms = [];
    var container = $("#f-hue-rooms");
    container.innerHTML = '<span class="loading-placeholder">Loading rooms...</span>';
    fetch("/api/hue/rooms")
      .then(function (r) { return r.json(); })
      .then(function (rooms) {
        if (rooms.length === 0) {
          container.innerHTML = '<span class="hint">No rooms (configure Hue first)</span>';
          return;
        }
        var selectedIds = {};
        for (var s = 0; s < selectedRooms.length; s++) {
          selectedIds[selectedRooms[s].id] = true;
        }
        var html = "";
        for (var i = 0; i < rooms.length; i++) {
          var r = rooms[i];
          var checked = selectedIds[r.id] ? " checked" : "";
          html += '<label class="room-checkbox">' +
            '<input type="checkbox" data-room-id="' + r.id + '" data-room-name="' + r.name + '"' + checked + '> ' +
            r.name +
          '</label>';
        }
        container.innerHTML = html;
        // When rooms change, reload scenes
        var boxes = container.querySelectorAll("input");
        for (var j = 0; j < boxes.length; j++) {
          boxes[j].addEventListener("change", function () {
            var sel = getSelectedRooms();
            loadHueScenesForEdit(sel, "");
          });
        }
      })
      .catch(function () {
        container.innerHTML = '<span class="hint">Error loading rooms</span>';
      });
  }

  function getSelectedRooms() {
    var boxes = $$("#f-hue-rooms input:checked");
    var rooms = [];
    for (var i = 0; i < boxes.length; i++) {
      rooms.push({
        id: boxes[i].getAttribute("data-room-id"),
        name: boxes[i].getAttribute("data-room-name")
      });
    }
    return rooms;
  }

  function loadHueScenesForEdit(rooms, selectedSceneId) {
    var sel = $("#f-hue-scene");
    if (!rooms || rooms.length === 0) {
      sel.innerHTML = '<option value="">None</option>';
      return;
    }
    // Load scenes for the first selected room
    var roomId = rooms[0].id;
    sel.innerHTML = '<option value="">Loading...</option>';
    fetch("/api/hue/rooms/" + roomId + "/scenes")
      .then(function (r) { return r.json(); })
      .then(function (scenes) {
        var html = '<option value="">None</option>';
        for (var i = 0; i < scenes.length; i++) {
          var s = scenes[i];
          var selected = (s.id === selectedSceneId) ? " selected" : "";
          html += '<option value="' + s.id + '" data-name="' + s.name + '"' + selected + '>' + s.name + '</option>';
        }
        sel.innerHTML = html;
      })
      .catch(function () {
        sel.innerHTML = '<option value="">None</option>';
      });
  }

  // ── Source toggle ──

  function setSourceToggle(source) {
    var btns = $$("#f-source-toggle .source-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-source") === source);
    }
    $("#f-source-radio").style.display = source === "radio" ? "" : "none";
    $("#f-source-spotify").style.display = source === "spotify" ? "" : "none";
  }

  function getSelectedSource() {
    var active = $("#f-source-toggle .source-btn.active");
    return active ? active.getAttribute("data-source") : "radio";
  }

  // Source toggle click handlers
  var srcBtns = $$("#f-source-toggle .source-btn");
  for (var si = 0; si < srcBtns.length; si++) {
    srcBtns[si].addEventListener("click", function () {
      setSourceToggle(this.getAttribute("data-source"));
    });
  }

  function loadSpotifyPresetsForEdit(selectedUri) {
    var sel = $("#f-spotify-preset");
    sel.innerHTML = '<option value="">Loading...</option>';
    fetch("/api/spotify/presets")
      .then(function (r) { return r.json(); })
      .then(function (presets) {
        var html = '<option value="">-- Select --</option>';
        for (var i = 0; i < presets.length; i++) {
          var p = presets[i];
          var selected = (p.uri === selectedUri) ? " selected" : "";
          html += '<option value="' + p.uri + '" data-name="' + p.name + '"' + selected + '>' + p.name + '</option>';
        }
        sel.innerHTML = html;
      })
      .catch(function () {
        sel.innerHTML = '<option value="">-- No presets --</option>';
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
    loadHueRoomsForEdit([]);
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

    var selectedRooms = getSelectedRooms();
    var firstRoom = selectedRooms.length > 0 ? selectedRooms[0] : { id: "", name: "" };

    var sceneSel = $("#f-hue-scene");
    var sceneOption = sceneSel.options[sceneSel.selectedIndex];
    var sceneId = sceneSel.value;
    var sceneName = (sceneOption && sceneId) ? sceneOption.textContent : "";

    var source = getSelectedSource();
    var spotifySel = $("#f-spotify-preset");
    var spotifyOption = spotifySel.options[spotifySel.selectedIndex];
    var spotifyUri = spotifySel.value || "";
    var spotifyName = (spotifyOption && spotifyUri) ? spotifyOption.textContent : "";

    var body = {
      time: $("#f-time").value,
      label: $("#f-label").value,
      days: days,
      hue: {
        room_id: firstRoom.id,
        room_name: firstRoom.name,
        rooms: selectedRooms,
        scene_id: sceneId,
        scene_name: sceneName,
        warmth: parseInt($("#f-hue-warmth").value),
        offset_minutes: parseInt($("#f-hue-offset").value),
        enabled: $("#f-hue-enabled").checked
      },
      audio: {
        source: source,
        station: $("#f-station").value,
        spotify_uri: spotifyUri,
        spotify_name: spotifyName,
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
  // ── Music View ──
  // ═══════════════════════════════════════

  // Music sub-tabs
  var musicTabs = $$(".music-tab");
  for (var mt = 0; mt < musicTabs.length; mt++) {
    musicTabs[mt].addEventListener("click", function () {
      var tab = this.getAttribute("data-tab");
      var allTabs = $$(".music-tab");
      for (var i = 0; i < allTabs.length; i++) {
        allTabs[i].classList.toggle("active", allTabs[i] === this);
      }
      var allPanels = $$(".music-panel");
      for (var j = 0; j < allPanels.length; j++) {
        allPanels[j].classList.toggle("active", allPanels[j].id === "music-" + tab);
      }
      if (tab === "spotify") {
        loadSpotifyPanel();
      }
    });
  }

  function loadMusicView() {
    // Load radio
    loadRadioView();
    // Load BT volumes
    loadMusicBtVolumes();
    // Check active tab
    var activeTab = $(".music-tab.active");
    if (activeTab && activeTab.getAttribute("data-tab") === "spotify") {
      loadSpotifyPanel();
    }
  }

  // ── Radio ──

  function loadRadioView() {
    var el = $("#radio-status");
    el.textContent = "";
    el.className = "status-msg";

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
    var btns = $$("#radio-station-list .radio-station-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-id") === id);
    }
    if (radioPlaying) {
      playStation(id, name);
    } else {
      $("#radio-now-playing").textContent = name;
      $("#radio-now-playing").className = "radio-now-playing";
    }
  }

  function playStation(id, name) {
    var volume = 50; // default, BT volume is per-device now
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
        // Mutual exclusion: Spotify was stopped by backend, update UI
        $("#spotify-active").style.display = "none";
        $("#spotify-idle").style.display = "";
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

  $("#btn-radio-play").addEventListener("click", function () {
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
      var btns = $$("#radio-station-list .radio-station-btn");
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.remove("active");
      }
    });
  });

  // ── Music BT Volume Sliders ──

  function loadMusicBtVolumes() {
    var el = $("#music-bt-volumes");
    fetch("/api/bluetooth/status")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var devices = data.devices || [];
        if (devices.length === 0) {
          el.innerHTML = "";
          return;
        }
        var html = '<div class="music-vol-header section-header">Speaker Volume</div>';
        for (var i = 0; i < devices.length; i++) {
          var d = devices[i];
          html += '<div class="music-vol-row">' +
            '<span class="music-vol-name">' + d.name + '</span>' +
            '<span class="music-vol-val" data-mac="' + d.mac + '">--</span>%' +
            '<input type="range" min="0" max="100" value="50" class="music-vol-slider" data-mac="' + d.mac + '">' +
          '</div>';
        }
        el.innerHTML = html;

        // Load actual volumes
        fetch("/api/bluetooth/volumes")
          .then(function (r) { return r.json(); })
          .then(function (vols) {
            for (var i = 0; i < vols.length; i++) {
              var v = vols[i];
              var slider = el.querySelector('.music-vol-slider[data-mac="' + v.mac + '"]');
              var valEl = el.querySelector('.music-vol-val[data-mac="' + v.mac + '"]');
              if (slider) slider.value = v.volume;
              if (valEl) valEl.textContent = v.volume;
            }
            // Attach events
            var sliders = el.querySelectorAll(".music-vol-slider");
            for (var j = 0; j < sliders.length; j++) {
              sliders[j].addEventListener("input", function () {
                var mac = this.getAttribute("data-mac");
                var valEl = el.querySelector('.music-vol-val[data-mac="' + mac + '"]');
                if (valEl) valEl.textContent = this.value;
              });
              sliders[j].addEventListener("change", function () {
                var mac = this.getAttribute("data-mac");
                json("POST", "/api/bluetooth/volume", { mac: mac, volume: parseInt(this.value) });
              });
            }
          });
      })
      .catch(function () {
        el.innerHTML = "";
      });
  }

  // ═══════════════════════════════════════
  // ── Spotify (via go-librespot) ──
  // ═══════════════════════════════════════

  function loadSpotifyPanel() {
    $("#spotify-unavailable").style.display = "none";
    $("#spotify-idle").style.display = "none";
    $("#spotify-active").style.display = "none";

    pollSpotifyStatus();
    startSpotifyPolling();
  }

  function startSpotifyPolling() {
    stopSpotifyPolling();
    spotifyPollingTimer = setInterval(pollSpotifyStatus, 3000);
  }

  function stopSpotifyPolling() {
    if (spotifyPollingTimer) {
      clearInterval(spotifyPollingTimer);
      spotifyPollingTimer = null;
    }
  }

  function pollSpotifyStatus() {
    fetch("/api/spotify/status")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.available) {
          $("#spotify-unavailable").style.display = "";
          $("#spotify-idle").style.display = "none";
          $("#spotify-active").style.display = "none";
          $("#spotify-presets-section").style.display = "none";
          return;
        }

        $("#spotify-unavailable").style.display = "none";
        if ($("#spotify-presets-section").style.display === "none") {
          $("#spotify-presets-section").style.display = "";
          loadSpotifyPresets();
        }

        if (data.stopped && !data.track && !data.playing) {
          // Connected but nothing playing, no session
          $("#spotify-idle").style.display = "";
          $("#spotify-active").style.display = "none";
          return;
        }

        // Has a session (playing, paused, or has track info)
        $("#spotify-idle").style.display = "none";
        $("#spotify-active").style.display = "";

        var trackEl = $("#sp-track");
        var artistEl = $("#sp-artist");
        var playBtn = $("#btn-sp-play");

        if (data.track) {
          trackEl.textContent = data.track;
          artistEl.textContent = data.artist || "";
        } else if (data.playing) {
          trackEl.textContent = "Playing...";
          artistEl.textContent = "";
        } else {
          trackEl.textContent = "Not playing";
          artistEl.textContent = "";
        }
        playBtn.textContent = data.playing ? "Pause" : "Play";

        // Update toggle states
        var shuffleBtn = $("#btn-sp-shuffle");
        var repeatBtn = $("#btn-sp-repeat");
        shuffleBtn.classList.toggle("active", !!data.shuffle);
        repeatBtn.classList.toggle("active", !!data.repeat);
      })
      .catch(function () {
        $("#spotify-unavailable").style.display = "";
        $("#spotify-idle").style.display = "none";
        $("#spotify-active").style.display = "none";
      });
  }

  // Play/Pause
  $("#btn-sp-play").addEventListener("click", function () {
    json("POST", "/api/spotify/playpause", {}).then(function () {
      setTimeout(pollSpotifyStatus, 300);
    });
  });

  // Skip
  $("#btn-sp-prev").addEventListener("click", function () {
    json("POST", "/api/spotify/previous", {}).then(function () {
      setTimeout(pollSpotifyStatus, 500);
    });
  });

  $("#btn-sp-next").addEventListener("click", function () {
    json("POST", "/api/spotify/next", {}).then(function () {
      setTimeout(pollSpotifyStatus, 500);
    });
  });

  // Shuffle / Repeat
  $("#btn-sp-shuffle").addEventListener("click", function () {
    var isActive = this.classList.contains("active");
    json("POST", "/api/spotify/shuffle", { enabled: !isActive }).then(function () {
      setTimeout(pollSpotifyStatus, 300);
    });
  });

  $("#btn-sp-repeat").addEventListener("click", function () {
    var isActive = this.classList.contains("active");
    json("POST", "/api/spotify/repeat", { enabled: !isActive }).then(function () {
      setTimeout(pollSpotifyStatus, 300);
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

    var toggles = el.querySelectorAll(".hue-room-toggle");
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].addEventListener("change", function () {
        var rid = this.getAttribute("data-room-id");
        json("PUT", "/api/hue/rooms/" + rid + "/state", { on: this.checked });
      });
    }

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
        var toggle = el.querySelector('.hue-room-toggle[data-room-id="' + rid + '"]');
        if (toggle) toggle.checked = true;
      });
    }

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
    list.innerHTML = '<span class="loading-placeholder">Loading...</span>';
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
    loadBtStatus();
    $("#bt-status").textContent = "";
    $("#bt-status").className = "status-msg";

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
  // ── Bluetooth (Settings) ──
  // ═══════════════════════════════════════

  function loadBtStatus() {
    fetch("/api/bluetooth/status")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        renderConnectedDevices(data.devices || []);
      })
      .catch(function () {
        var el = $("#bt-connected-list");
        el.innerHTML = '<div class="bt-no-devices">Bluetooth unavailable</div>';
      });
  }

  function renderConnectedDevices(devices) {
    var el = $("#bt-connected-list");
    if (!devices || devices.length === 0) {
      el.innerHTML = '<div class="bt-no-devices">No speakers connected</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      html += '<div class="bt-connected-card">' +
        '<div class="bt-connected-info">' +
          '<div class="bt-connected-dot"></div>' +
          '<span class="bt-connected-name">' + d.name + '</span>' +
          '<button class="btn btn-stop" data-mac="' + d.mac + '" data-action="disconnect">Disconnect</button>' +
        '</div>' +
        '<div class="bt-volume-row">' +
          '<span class="bt-vol-label">Vol <span class="bt-vol-val" data-mac="' + d.mac + '">--</span>%</span>' +
          '<input type="range" min="0" max="100" value="50" class="bt-vol-slider" data-mac="' + d.mac + '">' +
        '</div>' +
      '</div>';
    }
    if (devices.length > 1) {
      html += '<button class="btn btn-small" id="btn-setup-combined" style="margin-top:6px">Setup Multi-Speaker</button>';
      html += '<div class="hint" style="margin-top:4px">Audio plays on all ' + devices.length + ' speakers simultaneously</div>';
    }
    el.innerHTML = html;

    var disconnectBtns = el.querySelectorAll('[data-action="disconnect"]');
    for (var j = 0; j < disconnectBtns.length; j++) {
      disconnectBtns[j].addEventListener("click", function () {
        btAction(this.getAttribute("data-mac"), "disconnect");
      });
    }

    var combBtn = document.getElementById("btn-setup-combined");
    if (combBtn) {
      combBtn.addEventListener("click", function () {
        this.disabled = true;
        this.textContent = "Setting up...";
        json("POST", "/api/bluetooth/setup-combined", {}).then(function (data) {
          var s = $("#bt-status");
          if (data.ok) {
            s.textContent = "Multi-speaker enabled!";
            s.className = "status-msg ok";
          } else {
            s.textContent = "Could not set up combined sink";
            s.className = "status-msg err";
          }
          loadBtStatus();
        });
      });
    }

    loadBtVolumes();
  }

  function loadBtVolumes() {
    fetch("/api/bluetooth/volumes")
      .then(function (r) { return r.json(); })
      .then(function (vols) {
        for (var i = 0; i < vols.length; i++) {
          var v = vols[i];
          var slider = document.querySelector('.bt-vol-slider[data-mac="' + v.mac + '"]');
          var valEl = document.querySelector('.bt-vol-val[data-mac="' + v.mac + '"]');
          if (slider) slider.value = v.volume;
          if (valEl) valEl.textContent = v.volume;
        }
        var sliders = document.querySelectorAll(".bt-vol-slider");
        for (var j = 0; j < sliders.length; j++) {
          sliders[j].addEventListener("input", function () {
            var mac = this.getAttribute("data-mac");
            var valEl = document.querySelector('.bt-vol-val[data-mac="' + mac + '"]');
            if (valEl) valEl.textContent = this.value;
          });
          sliders[j].addEventListener("change", function () {
            var mac = this.getAttribute("data-mac");
            json("POST", "/api/bluetooth/volume", { mac: mac, volume: parseInt(this.value) });
          });
        }
      })
      .catch(function () {});
  }

  $("#btn-bt-scan").addEventListener("click", function () {
    var statusEl = $("#bt-status");
    var btn = $("#btn-bt-scan");
    statusEl.textContent = "Scanning... (~8 seconds)";
    statusEl.className = "status-msg";
    btn.disabled = true;
    btn.textContent = "Scanning...";
    $("#bt-devices").innerHTML = "";

    json("POST", "/api/bluetooth/scan", {}).then(function (devices) {
      btn.disabled = false;
      btn.textContent = "Scan for Devices";
      var available = [];
      for (var i = 0; i < devices.length; i++) {
        if (!devices[i].connected) {
          available.push(devices[i]);
        }
      }
      statusEl.textContent = available.length + " available device(s)";
      statusEl.className = "status-msg";
      renderBtDevices(available);
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = "Scan for Devices";
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
      var badge = "";
      if (d.paired) {
        badge = ' <span class="bt-badge" style="color:var(--text-secondary)">Paired</span>';
      }
      html += '<div class="bt-device">' +
        '<div class="bt-info">' +
          '<div class="bt-name">' + d.name + '</div>' +
          '<div class="bt-mac">' + d.mac + badge + '</div>' +
        '</div>' +
        '<button class="btn btn-test" data-mac="' + d.mac + '" data-action="connect">Connect</button>' +
      '</div>';
    }
    el.innerHTML = html;

    var buttons = el.querySelectorAll("button");
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].addEventListener("click", function () {
        btAction(this.getAttribute("data-mac"), "connect");
      });
    }
  }

  // ═══════════════════════════════════════
  // ── Spotify Presets ──
  // ═══════════════════════════════════════

  var presetsLoaded = false;

  function loadSpotifyPresets() {
    if (presetsLoaded) return;
    presetsLoaded = true;
    fetch("/api/spotify/presets")
      .then(function (r) { return r.json(); })
      .then(function (presets) {
        presetsLoaded = false;
        renderSpotifyPresets(presets);
      })
      .catch(function () { presetsLoaded = false; });
  }

  function renderSpotifyPresets(presets) {
    var el = $("#spotify-presets");
    if (!presets || presets.length === 0) {
      el.innerHTML = '<div class="preset-empty">No saved playlists yet</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < presets.length; i++) {
      var p = presets[i];
      html += '<div class="preset-card" data-uri="' + p.uri + '">' +
        '<span class="preset-name">' + p.name + '</span>' +
        '<button class="btn preset-delete" data-id="' + p.id + '">&times;</button>' +
      '</div>';
    }
    el.innerHTML = html;

    // Play on tap
    var cards = el.querySelectorAll(".preset-card");
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener("click", function (e) {
        if (e.target.classList.contains("preset-delete")) return;
        var uri = this.getAttribute("data-uri");
        var nameEl = this.querySelector(".preset-name");
        var origName = nameEl.textContent;
        nameEl.textContent = "Playing...";
        this.style.pointerEvents = "none";
        var self = this;
        json("POST", "/api/spotify/play", { uri: uri }).then(function (data) {
          nameEl.textContent = origName;
          self.style.pointerEvents = "";
          if (data.ok) {
            // Mutual exclusion: radio was stopped by backend, update UI
            radioPlaying = false;
            $("#radio-indicator").className = "radio-indicator";
            $("#radio-now-playing").textContent = "Select a station";
            $("#radio-now-playing").className = "radio-now-playing";
          }
          setTimeout(pollSpotifyStatus, 500);
        });
      });
    }

    // Delete buttons
    var delBtns = el.querySelectorAll(".preset-delete");
    for (var k = 0; k < delBtns.length; k++) {
      delBtns[k].addEventListener("click", function (e) {
        e.stopPropagation();
        var id = this.getAttribute("data-id");
        this.disabled = true;
        this.textContent = "...";
        fetch("/api/spotify/presets/" + id, { method: "DELETE" })
          .then(function (r) { return r.json(); })
          .then(function () {
            presetsLoaded = false;
            loadSpotifyPresets();
          });
      });
    }
  }

  // Add preset form
  $("#btn-add-preset").addEventListener("click", function () {
    var form = $("#preset-form");
    form.style.display = form.style.display === "none" ? "" : "none";
    if (form.style.display !== "none") {
      $("#preset-name").value = "";
      $("#preset-uri").value = "";
      $("#preset-name").focus();
    }
  });

  $("#btn-cancel-preset").addEventListener("click", function () {
    $("#preset-form").style.display = "none";
  });

  $("#btn-save-preset").addEventListener("click", function () {
    var name = $("#preset-name").value.trim();
    var uri = $("#preset-uri").value.trim();
    if (!uri) return;
    var btn = this;
    btn.disabled = true;
    btn.textContent = "Saving...";
    json("POST", "/api/spotify/presets", { name: name, uri: uri }).then(function (data) {
      btn.disabled = false;
      btn.textContent = "Save";
      if (data.ok) {
        $("#preset-form").style.display = "none";
        presetsLoaded = false;
        loadSpotifyPresets();
      } else {
        alert(data.error || "Failed to save");
      }
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = "Save";
    });
  });

  function btAction(mac, action) {
    var statusEl = $("#bt-status");
    statusEl.textContent = (action === "connect" ? "Connecting..." : "Disconnecting...");
    statusEl.className = "status-msg";

    var btn = document.querySelector('[data-mac="' + mac + '"][data-action="' + action + '"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = (action === "connect" ? "Connecting..." : "...");
    }

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
        .then(function (devices) {
          var available = [];
          for (var i = 0; i < devices.length; i++) {
            if (!devices[i].connected) {
              available.push(devices[i]);
            }
          }
          renderBtDevices(available);
        });
    });
  }

})();
