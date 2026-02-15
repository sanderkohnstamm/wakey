"""Spotify integration via go-librespot local API.

go-librespot runs as a Spotify Connect device on the Pi.
Users connect from their Spotify app, then Wakey controls playback
via the local REST API (no OAuth needed).
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

API_BASE = "http://127.0.0.1:3678"


async def _api(method: str, path: str, json_body: dict | None = None) -> dict | None:
    """Make a request to the go-librespot local API."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            if method == "GET":
                resp = await client.get(API_BASE + path)
            elif method == "POST":
                resp = await client.post(API_BASE + path, json=json_body or {})
            else:
                return None

        if resp.status_code == 204:
            return {"ok": True}
        if resp.status_code >= 400:
            logger.warning("go-librespot %s %s → %d: %s",
                           method, path, resp.status_code, resp.text[:200])
            return None
        try:
            return resp.json()
        except Exception:
            return {"ok": True}
    except httpx.ConnectError:
        return None
    except Exception as e:
        logger.warning("go-librespot request failed: %s", e)
        return None


async def is_available() -> bool:
    """Check if go-librespot is running."""
    data = await _api("GET", "/")
    return data is not None


async def get_status() -> dict | None:
    """Get full player status including track info."""
    return await _api("GET", "/status")


async def play(uri: str | None = None) -> bool:
    """Start playing a Spotify URI (playlist, album, track)."""
    if uri:
        data = await _api("POST", "/player/play", {"uri": uri})
    else:
        data = await _api("POST", "/player/resume")
    return data is not None


async def pause() -> bool:
    """Pause playback."""
    data = await _api("POST", "/player/pause")
    return data is not None


async def play_pause() -> bool:
    """Toggle play/pause."""
    data = await _api("POST", "/player/playpause")
    return data is not None


async def skip_next() -> bool:
    """Skip to next track."""
    data = await _api("POST", "/player/next")
    return data is not None


async def skip_prev() -> bool:
    """Skip to previous track."""
    data = await _api("POST", "/player/prev")
    return data is not None


async def set_volume(volume: int) -> bool:
    """Set volume (0 to max, typically 65535)."""
    data = await _api("POST", "/player/volume", {"volume": volume})
    return data is not None


async def get_volume() -> dict | None:
    """Get current volume {value, max}."""
    return await _api("GET", "/player/volume")


async def set_shuffle(enabled: bool) -> bool:
    """Toggle shuffle."""
    data = await _api("POST", "/player/shuffle_context", {"shuffle_context": enabled})
    return data is not None


async def set_repeat(enabled: bool) -> bool:
    """Toggle repeat."""
    data = await _api("POST", "/player/repeat_context", {"repeat_context": enabled})
    return data is not None
