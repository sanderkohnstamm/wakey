# Deployment Notes

## Pi Setup (Raspberry Pi OS, aarch64)

### Prerequisites

```bash
sudo apt-get install -y git python3-venv mpv pulseaudio pulseaudio-module-bluetooth
```

### Install

```bash
git clone https://github.com/sanderkohnstamm/wakey.git ~/wakey
cd ~/wakey
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Systemd Service

Create `/etc/systemd/system/wakey.service`:

```ini
[Unit]
Description=Wakey Alarm Clock
After=network.target pulseaudio.service

[Service]
Type=simple
User=wakey
WorkingDirectory=/home/wakey/wakey
Environment=PULSE_SERVER=unix:/run/user/1000/pulse/native
ExecStart=/home/wakey/wakey/venv/bin/uvicorn wakey.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable wakey
sudo systemctl start wakey
```

### Updating

```bash
cd ~/wakey && git pull && sudo systemctl restart wakey
```

---

## Known Deployment Issues

### PulseAudio not running for service user

**Symptom:** Bluetooth connect fails with `br-connection-profile-unavailable`. Radio playback may also be silent.

**Cause:** PulseAudio runs as a user service but doesn't auto-start for users without an interactive login session. The `wakey` user runs as a systemd service, not a desktop session.

**Fix:**

```bash
# Enable user lingering so user services start at boot without login
sudo loginctl enable-linger wakey

# Start PulseAudio for the wakey user
systemctl --user start pulseaudio.socket
systemctl --user start pulseaudio.service
```

Also add the PulseAudio socket path to the systemd service file (see above):

```ini
Environment=PULSE_SERVER=unix:/run/user/1000/pulse/native
```

Without this environment variable, the wakey process can't find the PulseAudio daemon even when it's running.

### Static file paths must be absolute

**Symptom:** Blank page in browser — HTML loads but CSS/JS don't.

**Cause:** The original code used relative paths (`StaticFiles(directory="wakey/static")`) which only works if uvicorn is started from the project root. Systemd starts it from the `WorkingDirectory` but that's not guaranteed to match.

**Fix:** Use `Path(__file__).parent / "static"` for absolute resolution regardless of CWD.

### Safari blank page

**Symptom:** Page loads but nothing visible in Safari (especially older iOS versions).

**Cause:** Multiple CSS/JS compatibility issues:
- `100dvh` not supported in older Safari — use `100vh`
- CSS `inset: 0` shorthand not supported — use explicit `top/left/right/bottom: 0`
- Template literals with backticks in JS can fail — use string concatenation
- Arrow functions may not work — use `function()` syntax
- `??` (nullish coalescing) not supported in older Safari

**Fix:** Wrap JS in an IIFE with `"use strict"`, avoid modern JS syntax, add `-webkit-` prefixes for transforms.

### Audio player not found

**Symptom:** Radio test returns error, logs show `mpv not found`.

**Cause:** mpv (or any audio player) not installed on the system.

**Fix:** The audio module tries players in order: `mpv` → `ffplay` → `vlc`. Install at least one:

```bash
# Pi (recommended)
sudo apt install mpv

# macOS (for local dev)
brew install mpv  # or: brew install ffmpeg (provides ffplay)
```
