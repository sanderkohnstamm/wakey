"""Spotify integration routes via go-librespot."""

from __future__ import annotations

from fastapi import APIRouter

from .. import spotify

router = APIRouter(prefix="/api/spotify")


@router.get("/status")
async def status() -> dict:
    """Check if Spotify Connect is available and get playback state."""
    available = await spotify.is_available()
    if not available:
        return {"available": False}

    data = await spotify.get_status()
    if not data:
        return {"available": True, "playing": False}

    # Parse go-librespot status into a clean response
    track = data.get("track", {})
    result = {
        "available": True,
        "username": data.get("username", ""),
        "playing": data.get("stopped") is not True and data.get("paused") is not True,
        "paused": data.get("paused", False),
        "stopped": data.get("stopped", True),
        "shuffle": data.get("shuffle_context", False),
        "repeat": data.get("repeat_context", False),
    }
    if track:
        result["track"] = track.get("name", "")
        result["artist"] = track.get("artist_names", [""])[0] if track.get("artist_names") else ""
        result["album"] = track.get("album_name", "")
        result["duration_ms"] = track.get("duration", 0)
        result["image"] = track.get("album_cover_url", "")
    return result


@router.post("/play")
async def play(body: dict) -> dict:
    """Start playback. Optional: uri (spotify URI for playlist/album/track)."""
    uri = body.get("uri")
    ok = await spotify.play(uri=uri)
    return {"ok": ok}


@router.post("/pause")
async def pause() -> dict:
    """Pause playback."""
    ok = await spotify.pause()
    return {"ok": ok}


@router.post("/playpause")
async def playpause() -> dict:
    """Toggle play/pause."""
    ok = await spotify.play_pause()
    return {"ok": ok}


@router.post("/next")
async def next_track() -> dict:
    """Skip to next track."""
    ok = await spotify.skip_next()
    return {"ok": ok}


@router.post("/previous")
async def prev_track() -> dict:
    """Skip to previous track."""
    ok = await spotify.skip_prev()
    return {"ok": ok}


@router.post("/volume")
async def set_volume(body: dict) -> dict:
    """Set Spotify volume (0-100, mapped to go-librespot range)."""
    pct = body.get("volume", 50)
    # go-librespot uses 0-65535 range
    vol = int(pct / 100 * 65535)
    ok = await spotify.set_volume(vol)
    return {"ok": ok}


@router.get("/volume")
async def get_volume() -> dict:
    """Get current Spotify volume."""
    data = await spotify.get_volume()
    if not data:
        return {"volume": 0}
    max_vol = data.get("max", 65535) or 65535
    pct = int(data.get("value", 0) / max_vol * 100)
    return {"volume": pct}


@router.post("/shuffle")
async def shuffle(body: dict) -> dict:
    """Set shuffle on/off."""
    ok = await spotify.set_shuffle(body.get("enabled", False))
    return {"ok": ok}


@router.post("/repeat")
async def repeat(body: dict) -> dict:
    """Set repeat on/off."""
    ok = await spotify.set_repeat(body.get("enabled", False))
    return {"ok": ok}
