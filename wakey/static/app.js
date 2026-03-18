/* Wakey frontend */

(function () {
  "use strict";

  var stationsCache = null;
  var radioPlaying = false;

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
      .then(function (r) {
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      })
      .then(function (data) {
        $("#connection-banner").classList.add("hidden");
        updateStatusUI(data);
      })
      .catch(function () {
        $("#connection-banner").classList.remove("hidden");
      });
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
          nextAlarm.textContent = "Alarm in " + hours + "h " + mins + "m";
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

  // ── Inline alarm widget ──

  function loadAlarm() {
    fetch("/api/alarm")
      .then(function (r) { return r.json(); })
      .then(function (a) {
        var parts = a.time.split(":");
        $("#aw-hour").value = parts[0];
        $("#aw-min").value = parts[1];
        $("#aw-enabled").checked = a.enabled;

        var pills = $$("#aw-days .aw-day");
        for (var i = 0; i < pills.length; i++) {
          var day = parseInt(pills[i].getAttribute("data-day"));
          pills[i].classList.toggle("active", a.days.indexOf(day) !== -1);
        }

        $("#aw-snooze").value = a.snooze_minutes;
        $("#aw-snooze-val").textContent = a.snooze_minutes;
        $("#aw-autostop").value = a.auto_stop_minutes;
        $("#aw-autostop-val").textContent = a.auto_stop_minutes;
      });
  }

  function saveAlarm() {
    var days = [];
    var activePills = $$("#aw-days .aw-day.active");
    for (var i = 0; i < activePills.length; i++) {
      days.push(parseInt(activePills[i].getAttribute("data-day")));
    }

    var body = {
      time: String(Math.min(23, Math.max(0, parseInt($("#aw-hour").value) || 0))).padStart(2, "0") + ":" + String(Math.min(59, Math.max(0, parseInt($("#aw-min").value) || 0))).padStart(2, "0"),
      enabled: $("#aw-enabled").checked,
      days: days,
      snooze_minutes: parseInt($("#aw-snooze").value),
      auto_stop_minutes: parseInt($("#aw-autostop").value)
    };

    json("PUT", "/api/alarm", body).then(function () {
      pollStatus();
    });
  }

  loadAlarm();

  // Time fields - clamp and save on blur
  $("#aw-hour").addEventListener("blur", function () {
    var v = Math.min(23, Math.max(0, parseInt(this.value) || 0));
    this.value = String(v).padStart(2, "0");
    saveAlarm();
  });
  $("#aw-min").addEventListener("blur", function () {
    var v = Math.min(59, Math.max(0, parseInt(this.value) || 0));
    this.value = String(v).padStart(2, "0");
    saveAlarm();
  });
  // Auto-advance from hour to minute field
  $("#aw-hour").addEventListener("input", function () {
    if (this.value.length >= 2) { $("#aw-min").focus(); $("#aw-min").select(); }
  });

  // Enable toggle
  $("#aw-enabled").addEventListener("change", function () { saveAlarm(); });

  // Day pills
  var awPills = $$("#aw-days .aw-day");
  for (var pi = 0; pi < awPills.length; pi++) {
    awPills[pi].addEventListener("click", function () {
      this.classList.toggle("active");
      saveAlarm();
    });
  }

  // Snooze / auto-stop sliders
  $("#aw-snooze").addEventListener("input", function () { $("#aw-snooze-val").textContent = this.value; });
  $("#aw-snooze").addEventListener("change", function () { saveAlarm(); });
  $("#aw-autostop").addEventListener("input", function () { $("#aw-autostop-val").textContent = this.value; });
  $("#aw-autostop").addEventListener("change", function () { saveAlarm(); });

  // ── Dismiss / Snooze ──

  $("#btn-dismiss").addEventListener("click", function () {
    fetch("/api/dismiss", { method: "POST" }).then(pollStatus);
  });

  $("#btn-snooze").addEventListener("click", function () {
    fetch("/api/snooze", { method: "POST" }).then(pollStatus);
  });

  // ── Navigation ──

  $("#btn-go-settings").addEventListener("click", function () {
    loadSettingsView();
    showView("settings");
  });

  $("#btn-back-main-settings").addEventListener("click", function () { showView("main"); });

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

  // ═══════════════════════════════════════
  // ── Foldout sections ──
  // ═══════════════════════════════════════

  function setupFoldout(toggleId, bodyId) {
    var toggle = document.getElementById(toggleId);
    var body = document.getElementById(bodyId);
    toggle.addEventListener("click", function () {
      var foldout = toggle.closest(".foldout");
      var open = body.style.display !== "none";
      if (open) {
        body.style.display = "none";
        foldout.classList.remove("open");
      } else {
        body.style.display = "";
        foldout.classList.add("open");
      }
    });
  }

  setupFoldout("foldout-music-toggle", "foldout-music");
  setupFoldout("foldout-lights-toggle", "foldout-lights");
  setupFoldout("foldout-advanced-toggle", "foldout-advanced");

  // ═══════════════════════════════════════
  // ── Audio output toggle (AUX / Bluetooth) ──
  // ═══════════════════════════════════════

  var currentAudioOutput = "aux";

  function setOutputToggle(output) {
    currentAudioOutput = output;
    var btns = $$("#g-output-toggle .source-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-output") === output);
    }
    var btSection = $("#g-bt-speakers");
    if (btSection) {
      btSection.style.display = output === "bluetooth" ? "" : "none";
    }
  }

  function saveAudioOutput(output) {
    json("PUT", "/api/config", { audio_output: output });
  }

  var outBtns = $$("#g-output-toggle .source-btn");
  for (var oi = 0; oi < outBtns.length; oi++) {
    outBtns[oi].addEventListener("click", function () {
      var output = this.getAttribute("data-output");
      setOutputToggle(output);
      saveAudioOutput(output);
    });
  }

  // Load initial output setting
  fetch("/api/config")
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      setOutputToggle(cfg.audio_output || "aux");
    });

  // ═══════════════════════════════════════
  // ── Music foldout (global config) ──
  // ═══════════════════════════════════════

  function loadGlobalAudioConfig() {
    fetch("/api/config/audio")
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        setGlobalSourceToggle(cfg.source || "radio");
        loadStations($("#g-station"), cfg.station);
        loadSpotifyPresetsForGlobal(cfg.spotify_uri);
        $("#g-volume").value = cfg.volume;
        $("#g-volume-val").textContent = cfg.volume;
        $("#g-ramp").value = cfg.ramp_seconds;
        $("#g-ramp-val").textContent = cfg.ramp_seconds;
      });
  }

  function saveGlobalAudioConfig() {
    var source = getGlobalSelectedSource();
    var spotifySel = $("#g-spotify-preset");
    var spotifyOption = spotifySel.options[spotifySel.selectedIndex];
    var spotifyUri = spotifySel.value || "";
    var spotifyName = (spotifyOption && spotifyUri) ? spotifyOption.textContent : "";

    var body = {
      source: source,
      station: $("#g-station").value,
      spotify_uri: spotifyUri,
      spotify_name: spotifyName,
      volume: parseInt($("#g-volume").value),
      ramp_seconds: parseInt($("#g-ramp").value),
      enabled: true
    };
    json("PUT", "/api/config/audio", body);
  }

  // Source toggle
  function setGlobalSourceToggle(source) {
    var btns = $$("#g-source-toggle .source-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-source") === source);
    }
    $("#g-source-radio").style.display = source === "radio" ? "" : "none";
    $("#g-source-spotify").style.display = source === "spotify" ? "" : "none";
    $("#g-controls-radio").style.display = source === "radio" ? "" : "none";
    $("#g-controls-spotify").style.display = source === "spotify" ? "" : "none";
  }

  function getGlobalSelectedSource() {
    var active = $("#g-source-toggle .source-btn.active");
    return active ? active.getAttribute("data-source") : "radio";
  }

  var gSrcBtns = $$("#g-source-toggle .source-btn");
  for (var gsi = 0; gsi < gSrcBtns.length; gsi++) {
    gSrcBtns[gsi].addEventListener("click", function () {
      setGlobalSourceToggle(this.getAttribute("data-source"));
      saveGlobalAudioConfig();
    });
  }

  function loadSpotifyPresetsForGlobal(selectedUri) {
    var sel = $("#g-spotify-preset");
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

  // Auto-save on change
  $("#g-volume").addEventListener("input", function () { $("#g-volume-val").textContent = this.value; });
  $("#g-volume").addEventListener("change", function () { saveGlobalAudioConfig(); });
  $("#g-ramp").addEventListener("input", function () { $("#g-ramp-val").textContent = this.value; });
  $("#g-ramp").addEventListener("change", function () { saveGlobalAudioConfig(); });
  $("#g-station").addEventListener("change", function () { saveGlobalAudioConfig(); });
  $("#g-spotify-preset").addEventListener("change", function () { saveGlobalAudioConfig(); });

  // ── Radio controls ──

  $("#btn-radio-play").addEventListener("click", function () {
    var statusEl = $("#g-music-status");
    var station = $("#g-station").value;
    var volume = parseInt($("#g-volume").value);
    statusEl.textContent = "Starting...";
    statusEl.className = "status-msg";
    json("POST", "/api/config/test-radio", { station: station, volume: volume }).then(function (data) {
      if (data.ok) {
        radioPlaying = true;
        statusEl.textContent = "Playing " + (data.station || "radio");
        statusEl.className = "status-msg ok";
      } else {
        statusEl.textContent = data.error || "Playback failed";
        statusEl.className = "status-msg err";
      }
    });
  });

  $("#btn-radio-stop").addEventListener("click", function () {
    var statusEl = $("#g-music-status");
    json("POST", "/api/config/test-radio/stop", {});
    radioPlaying = false;
    statusEl.textContent = "Stopped";
    statusEl.className = "status-msg";
  });

  // ── Spotify controls ──

  var spotifyPlaying = false;

  $("#btn-sp-playpause").addEventListener("click", function () {
    var statusEl = $("#g-music-status");
    if (!spotifyPlaying) {
      var uri = $("#g-spotify-preset").value;
      if (!uri) {
        statusEl.textContent = "Select a playlist first";
        statusEl.className = "status-msg err";
        return;
      }
      statusEl.textContent = "Starting...";
      statusEl.className = "status-msg";
      json("POST", "/api/spotify/play", { uri: uri }).then(function (data) {
        if (data.ok) {
          spotifyPlaying = true;
          $("#btn-sp-playpause").textContent = "Pause";
          statusEl.textContent = "";
          pollSpotifyStatus();
        } else {
          statusEl.textContent = data.error || "Playback failed";
          statusEl.className = "status-msg err";
        }
      });
    } else {
      json("POST", "/api/spotify/playpause", {}).then(function (data) {
        if (data.ok) {
          spotifyPlaying = !spotifyPlaying;
          $("#btn-sp-playpause").textContent = spotifyPlaying ? "Pause" : "Play";
          if (!spotifyPlaying) {
            $("#g-now-playing").style.display = "none";
          }
        }
      });
    }
  });

  $("#btn-sp-next").addEventListener("click", function () {
    json("POST", "/api/spotify/next", {}).then(function () {
      setTimeout(pollSpotifyStatus, 500);
    });
  });

  $("#btn-sp-prev").addEventListener("click", function () {
    json("POST", "/api/spotify/previous", {}).then(function () {
      setTimeout(pollSpotifyStatus, 500);
    });
  });

  function pollSpotifyStatus() {
    fetch("/api/spotify/status")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.track) {
          var text = data.track;
          if (data.artist) text = data.artist + " - " + text;
          $("#g-np-text").textContent = text;
          $("#g-now-playing").style.display = "";
          spotifyPlaying = data.playing !== false;
          $("#btn-sp-playpause").textContent = spotifyPlaying ? "Pause" : "Play";
        } else {
          $("#g-now-playing").style.display = "none";
        }
      })
      .catch(function () {});
  }

  // ── Add Spotify preset ──

  $("#btn-add-spotify").addEventListener("click", function () {
    var input = $("#g-spotify-link");
    var link = input.value.trim();
    var statusEl = $("#g-spotify-add-status");
    if (!link) {
      statusEl.textContent = "Paste a Spotify link first";
      statusEl.className = "status-msg err";
      return;
    }
    statusEl.textContent = "Adding...";
    statusEl.className = "status-msg";
    json("POST", "/api/spotify/presets", { uri: link }).then(function (data) {
      if (data.ok) {
        input.value = "";
        statusEl.textContent = "Added: " + (data.preset ? data.preset.name : "playlist");
        statusEl.className = "status-msg ok";
        loadSpotifyPresetsForGlobal(data.preset ? data.preset.uri : "");
      } else {
        statusEl.textContent = data.error || "Failed to add";
        statusEl.className = "status-msg err";
      }
    }).catch(function () {
      statusEl.textContent = "Failed to add";
      statusEl.className = "status-msg err";
    });
  });

  // ── BT speakers in music foldout ──

  function loadMusicBtSpeakers() {
    var el = $("#g-bt-speakers");
    fetch("/api/bluetooth/nearby")
      .then(function (r) { return r.json(); })
      .then(function (devices) {
        renderMusicBtSpeakers(el, devices);
      })
      .catch(function () {
        el.innerHTML = "";
      });
  }

  function renderMusicBtSpeakers(el, devices) {
    if (!devices || devices.length === 0) {
      el.innerHTML = '<div class="section-header" style="margin-bottom:4px">Speakers</div>' +
        '<span class="hint">Scanning for speakers...</span>';
      return;
    }

    var html = '<div class="section-header" style="margin-bottom:6px">Speakers</div>';
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      var dotClass = d.connected ? "connected" : "nearby";
      var action = d.connected ? "disconnect" : "connect";
      var label = d.connected ? "Disconnect" : "Connect";
      html += '<div class="g-bt-speaker-row">' +
        '<div class="g-bt-dot ' + dotClass + '"></div>' +
        '<span class="g-bt-speaker-name">' + d.name + '</span>' +
        '<button class="btn btn-small g-bt-action" data-mac="' + d.mac + '" data-action="' + action + '">' + label + '</button>' +
      '</div>';
    }
    html += '<div id="g-bt-status" class="status-msg"></div>';
    el.innerHTML = html;

    // Attach button handlers
    var btns = el.querySelectorAll(".g-bt-action");
    for (var n = 0; n < btns.length; n++) {
      btns[n].addEventListener("click", function () {
        var mac = this.getAttribute("data-mac");
        var action = this.getAttribute("data-action");
        var btn = this;
        var statusEl = $("#g-bt-status");
        btn.disabled = true;
        btn.textContent = action === "connect" ? "Connecting..." : "...";
        statusEl.textContent = action === "connect" ? "Connecting..." : "Disconnecting...";
        statusEl.className = "status-msg";

        json("POST", "/api/bluetooth/" + action, { mac: mac }).then(function (data) {
          if (data.ok) {
            statusEl.textContent = action === "connect" ? "Connected!" : "Disconnected";
            statusEl.className = "status-msg ok";
          } else {
            statusEl.textContent = data.error || "Failed";
            statusEl.className = "status-msg err";
          }
          loadMusicBtSpeakers();
        });
      });
    }
  }

  // Load on page load and auto-refresh every 15s
  loadGlobalAudioConfig();
  loadMusicBtSpeakers();
  setInterval(loadMusicBtSpeakers, 15000);

  // ═══════════════════════════════════════
  // ── Lights foldout (global config) ──
  // ═══════════════════════════════════════

  function loadGlobalHueConfig() {
    fetch("/api/config/hue-alarm")
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        $("#g-hue-enabled").checked = cfg.enabled;
        var rooms = cfg.rooms || [];
        if (rooms.length === 0 && cfg.room_id) {
          rooms = [{ id: cfg.room_id, name: cfg.room_name || "" }];
        }
        loadGlobalHueRooms(rooms);
        loadGlobalHueScenes(rooms, cfg.scene_id);
        $("#g-hue-warmth").value = (cfg.warmth !== undefined) ? cfg.warmth : 326;
        $("#g-hue-offset").value = cfg.offset_minutes;
        $("#g-offset-val").textContent = cfg.offset_minutes;
      });
  }

  function saveGlobalHueConfig() {
    var rooms = getGlobalSelectedRooms();
    var firstRoom = rooms.length > 0 ? rooms[0] : { id: "", name: "" };
    var sceneSel = $("#g-hue-scene");
    var sceneOption = sceneSel.options[sceneSel.selectedIndex];
    var sceneId = sceneSel.value;
    var sceneName = (sceneOption && sceneId) ? sceneOption.textContent : "";

    var body = {
      room_id: firstRoom.id,
      room_name: firstRoom.name,
      rooms: rooms,
      scene_id: sceneId,
      scene_name: sceneName,
      warmth: parseInt($("#g-hue-warmth").value),
      offset_minutes: parseInt($("#g-hue-offset").value),
      enabled: $("#g-hue-enabled").checked
    };
    json("PUT", "/api/config/hue-alarm", body);
  }

  function loadGlobalHueRooms(selectedRooms) {
    if (!selectedRooms) selectedRooms = [];
    var container = $("#g-hue-rooms");
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
        var boxes = container.querySelectorAll("input");
        for (var j = 0; j < boxes.length; j++) {
          boxes[j].addEventListener("change", function () {
            var sel = getGlobalSelectedRooms();
            loadGlobalHueScenes(sel, "");
            saveGlobalHueConfig();
          });
        }
      })
      .catch(function () {
        container.innerHTML = '<span class="hint">Error loading rooms</span>';
      });
  }

  function getGlobalSelectedRooms() {
    var boxes = $$("#g-hue-rooms input:checked");
    var rooms = [];
    for (var i = 0; i < boxes.length; i++) {
      rooms.push({
        id: boxes[i].getAttribute("data-room-id"),
        name: boxes[i].getAttribute("data-room-name")
      });
    }
    return rooms;
  }

  function loadGlobalHueScenes(rooms, selectedSceneId) {
    var sel = $("#g-hue-scene");
    if (!rooms || rooms.length === 0) {
      sel.innerHTML = '<option value="">None</option>';
      return;
    }
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

  // Auto-save on change
  $("#g-hue-enabled").addEventListener("change", function () { saveGlobalHueConfig(); });
  $("#g-hue-warmth").addEventListener("change", function () { saveGlobalHueConfig(); });
  $("#g-hue-offset").addEventListener("input", function () { $("#g-offset-val").textContent = this.value; });
  $("#g-hue-offset").addEventListener("change", function () { saveGlobalHueConfig(); });
  $("#g-hue-scene").addEventListener("change", function () { saveGlobalHueConfig(); });

  $("#btn-g-refresh-rooms").addEventListener("click", function () {
    loadGlobalHueRooms([]);
  });

  // Set scene on all configured rooms
  $("#btn-set-scene").addEventListener("click", function () {
    var statusEl = $("#g-lights-status");
    var sceneId = $("#g-hue-scene").value;
    if (!sceneId) {
      statusEl.textContent = "Select a scene first";
      statusEl.className = "status-msg err";
      return;
    }
    var rooms = getGlobalSelectedRooms();
    if (rooms.length === 0) {
      statusEl.textContent = "Select at least one room";
      statusEl.className = "status-msg err";
      return;
    }
    statusEl.textContent = "Setting scene...";
    statusEl.className = "status-msg";
    var pending = rooms.length;
    var anyOk = false;
    for (var i = 0; i < rooms.length; i++) {
      json("POST", "/api/hue/rooms/" + rooms[i].id + "/scene", { scene_id: sceneId }).then(function (data) {
        if (data.ok) anyOk = true;
        pending--;
        if (pending === 0) {
          statusEl.textContent = anyOk ? "Scene activated" : "Failed to set scene";
          statusEl.className = anyOk ? "status-msg ok" : "status-msg err";
        }
      });
    }
  });

  // Test lights
  $("#btn-test-lights").addEventListener("click", function () {
    var statusEl = $("#g-lights-status");
    statusEl.textContent = "Flashing...";
    statusEl.className = "status-msg";
    json("POST", "/api/config/test-lights", {}).then(function (data) {
      if (data.ok) {
        statusEl.textContent = "Done";
        statusEl.className = "status-msg ok";
      } else {
        statusEl.textContent = data.error || "Test failed";
        statusEl.className = "status-msg err";
      }
    });
  });

  // Lights on/off
  function setLightsState(on) {
    var rooms = getGlobalSelectedRooms();
    var statusEl = $("#g-lights-status");
    if (rooms.length === 0) {
      statusEl.textContent = "Select at least one room";
      statusEl.className = "status-msg err";
      return;
    }
    var brightness = on ? parseInt($("#g-brightness").value) : 0;
    var bri254 = Math.round(brightness * 254 / 100);
    var pending = rooms.length;
    var anyOk = false;
    for (var i = 0; i < rooms.length; i++) {
      var body = on ? { on: true, bri: bri254 } : { on: false };
      json("PUT", "/api/hue/rooms/" + rooms[i].id + "/state", body).then(function (data) {
        if (data.ok) anyOk = true;
        pending--;
        if (pending === 0) {
          statusEl.textContent = anyOk ? (on ? "Lights on" : "Lights off") : "Failed";
          statusEl.className = anyOk ? "status-msg ok" : "status-msg err";
        }
      });
    }
  }

  $("#btn-lights-on").addEventListener("click", function () { setLightsState(true); });
  $("#btn-lights-off").addEventListener("click", function () { setLightsState(false); });

  // Brightness slider
  $("#g-brightness").addEventListener("input", function () {
    $("#g-brightness-val").textContent = this.value;
  });
  $("#g-brightness").addEventListener("change", function () {
    var rooms = getGlobalSelectedRooms();
    if (rooms.length === 0) return;
    var bri254 = Math.round(parseInt(this.value) * 254 / 100);
    for (var i = 0; i < rooms.length; i++) {
      json("PUT", "/api/hue/rooms/" + rooms[i].id + "/state", { on: true, bri: bri254 });
    }
  });

  // Load on page load
  loadGlobalHueConfig();

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
