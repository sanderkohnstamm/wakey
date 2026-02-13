"""Audio playback via subprocess (mpv/ffplay/vlc) + volume control."""

from __future__ import annotations

import asyncio
import logging
import platform
import shutil
import subprocess

from .models import AudioConfig, RADIO_STATIONS

logger = logging.getLogger(__name__)

_process: subprocess.Popen | None = None

# Player commands in priority order: (binary, args_before_url, args_after_url)
_PLAYERS = [
    ("mpv", ["--no-video", "--no-terminal"], []),
    ("ffplay", ["-nodisp", "-loglevel", "quiet"], []),
    ("vlc", ["--intf", "dummy", "--no-video"], []),
]


def _find_player() -> tuple[str, list[str], list[str]] | None:
    for binary, pre, post in _PLAYERS:
        if shutil.which(binary):
            return binary, pre, post
    return None


async def start_playback(cfg: AudioConfig) -> str | None:
    """Start streaming. Returns error string or None on success."""
    global _process
    stop_playback()

    station = RADIO_STATIONS.get(cfg.station)
    if not station:
        return "Unknown station: " + cfg.station

    player = _find_player()
    if not player:
        msg = "No audio player found. Install one: brew install mpv (or ffmpeg)"
        logger.error(msg)
        return msg

    binary, pre_args, post_args = player
    url = station["url"]
    cmd = [binary] + pre_args + [url] + post_args
    logger.info("Starting playback: %s via %s", station["name"], binary)

    try:
        _process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        msg = "Failed to start " + binary + ": " + str(e)
        logger.error(msg)
        return msg

    # Volume ramp
    if cfg.ramp_seconds > 0:
        await _volume_ramp(10, cfg.volume, cfg.ramp_seconds)
    else:
        _set_volume(cfg.volume)

    return None


def stop_playback() -> None:
    global _process
    if _process is not None:
        try:
            _process.terminate()
            _process.wait(timeout=3)
        except Exception:
            try:
                _process.kill()
            except Exception:
                pass
        _process = None
        logger.info("Playback stopped")


def is_playing() -> bool:
    return _process is not None and _process.poll() is None


async def _volume_ramp(start: int, end: int, duration_seconds: int) -> None:
    steps = max(1, duration_seconds // 3)
    for i in range(steps + 1):
        t = i / steps
        vol = int(start + t * (end - start))
        _set_volume(vol)
        if i < steps:
            await asyncio.sleep(3)


def _set_volume(percent: int) -> None:
    system = platform.system()
    try:
        if system == "Darwin":
            # macOS: volume 0-100 maps to osascript 0-100
            subprocess.run(
                ["osascript", "-e", "set volume output volume " + str(percent)],
                capture_output=True,
                timeout=3,
            )
        else:
            # Linux (PulseAudio)
            subprocess.run(
                ["pactl", "set-sink-volume", "@DEFAULT_SINK@", str(percent) + "%"],
                capture_output=True,
                timeout=3,
            )
    except Exception:
        logger.debug("Volume set failed (no pactl/osascript?)")
