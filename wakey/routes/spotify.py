"""Spotify integration routes via go-librespot."""

from __future__ import annotations

from fastapi import APIRouter

from .. import spotify
from ..config import load_spotify_presets, save_spotify_presets

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
    # Try multiple field names for track info
    track = data.get("track") or data.get("item") or data.get("current_track") or {}
    result = {
        "available": True,
        "username": data.get("username", ""),
        "playing": data.get("stopped") is not True and data.get("paused") is not True,
        "paused": data.get("paused", False),
        "stopped": data.get("stopped", True),
        "shuffle": data.get("shuffle_context", False),
        "repeat": data.get("repeat_context", False),
        "_debug": data,
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
    from .. import audio
    # Stop radio before playing Spotify (mutual exclusion)
    audio.stop_playback()

    uri = body.get("uri")
    ok = await spotify.play(uri=uri)
    if not ok:
        return {"ok": False, "error": "Failed to start Spotify playback. Is go-librespot running?"}
    return {"ok": True}


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


# ── Saved presets ──

@router.get("/presets")
async def get_presets() -> list[dict]:
    """Get saved Spotify playlists/albums."""
    return load_spotify_presets()


@router.post("/presets")
async def add_preset(body: dict) -> dict:
    """Add a Spotify preset. Accepts name + uri or link."""
    name = body.get("name", "").strip()
    raw = body.get("uri", "").strip()
    if not raw:
        return {"ok": False, "error": "URI or link required"}

    uri = spotify.parse_spotify_input(raw)
    if not uri:
        return {"ok": False, "error": "Invalid Spotify link or URI"}

    if not name:
        name = uri.split(":")[-1][:12]

    presets = load_spotify_presets()
    # Avoid duplicates
    for p in presets:
        if p.get("uri") == uri:
            return {"ok": True, "duplicate": True}

    import uuid
    presets.append({"id": uuid.uuid4().hex[:8], "name": name, "uri": uri})
    save_spotify_presets(presets)
    return {"ok": True}


@router.delete("/presets/{preset_id}")
async def delete_preset(preset_id: str) -> dict:
    """Remove a saved preset."""
    presets = load_spotify_presets()
    presets = [p for p in presets if p.get("id") != preset_id]
    save_spotify_presets(presets)
    return {"ok": True}
