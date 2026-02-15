"""Spotify Web API integration via OAuth2 Authorization Code flow."""

from __future__ import annotations

import base64
import logging
import time
import urllib.parse

import httpx

from .config import load_config, save_config

logger = logging.getLogger(__name__)

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"

SCOPES = " ".join([
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-read-collaborative",
])


REDIRECT_URI = "http://localhost:8000/api/spotify/callback"


def get_auth_url() -> str | None:
    """Build Spotify authorization URL using localhost redirect."""
    cfg = load_config().spotify
    if not cfg.client_id:
        return None
    params = {
        "client_id": cfg.client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "show_dialog": "false",
    }
    return AUTH_URL + "?" + urllib.parse.urlencode(params)


async def exchange_code(code: str) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    cfg = load_config()
    sp = cfg.spotify
    if not sp.client_id or not sp.client_secret:
        return {"ok": False, "error": "Spotify not configured"}

    auth_header = base64.b64encode(
        (sp.client_id + ":" + sp.client_secret).encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        resp = await client.post(TOKEN_URL, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
        }, headers={
            "Authorization": "Basic " + auth_header,
            "Content-Type": "application/x-www-form-urlencoded",
        })

    if resp.status_code != 200:
        logger.error("Spotify token exchange failed: %s", resp.text)
        return {"ok": False, "error": "Token exchange failed"}

    data = resp.json()
    sp.access_token = data["access_token"]
    sp.refresh_token = data.get("refresh_token", sp.refresh_token)
    sp.token_expiry = time.time() + data.get("expires_in", 3600)
    cfg.spotify = sp
    save_config(cfg)
    return {"ok": True}


async def _refresh_token() -> bool:
    """Refresh the access token if expired."""
    cfg = load_config()
    sp = cfg.spotify
    if not sp.refresh_token or not sp.client_id or not sp.client_secret:
        return False

    if time.time() < sp.token_expiry - 60:
        return True  # not expired yet

    auth_header = base64.b64encode(
        (sp.client_id + ":" + sp.client_secret).encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        resp = await client.post(TOKEN_URL, data={
            "grant_type": "refresh_token",
            "refresh_token": sp.refresh_token,
        }, headers={
            "Authorization": "Basic " + auth_header,
            "Content-Type": "application/x-www-form-urlencoded",
        })

    if resp.status_code != 200:
        logger.error("Spotify token refresh failed: %s", resp.text)
        return False

    data = resp.json()
    sp.access_token = data["access_token"]
    if "refresh_token" in data:
        sp.refresh_token = data["refresh_token"]
    sp.token_expiry = time.time() + data.get("expires_in", 3600)
    cfg.spotify = sp
    save_config(cfg)
    return True


async def _api(method: str, path: str, json_body: dict | None = None) -> dict | None:
    """Make an authenticated Spotify API call."""
    if not await _refresh_token():
        return None

    cfg = load_config().spotify
    headers = {"Authorization": "Bearer " + cfg.access_token}

    async with httpx.AsyncClient() as client:
        if method == "GET":
            resp = await client.get(API_BASE + path, headers=headers)
        elif method == "PUT":
            resp = await client.put(API_BASE + path, headers=headers, json=json_body)
        elif method == "POST":
            resp = await client.post(API_BASE + path, headers=headers, json=json_body)
        else:
            return None

    if resp.status_code == 204:
        return {"ok": True}
    if resp.status_code >= 400:
        logger.warning("Spotify API %s %s → %d: %s", method, path, resp.status_code, resp.text[:200])
        return None
    try:
        return resp.json()
    except Exception:
        return {"ok": True}


def is_connected() -> bool:
    """Check if we have Spotify tokens."""
    sp = load_config().spotify
    return bool(sp.access_token and sp.refresh_token)


async def get_playlists(limit: int = 30) -> list[dict]:
    """Get user's playlists."""
    data = await _api("GET", "/me/playlists?limit=" + str(limit))
    if not data or "items" not in data:
        return []
    result = []
    for p in data["items"]:
        if not p:
            continue
        img = ""
        if p.get("images") and len(p["images"]) > 0:
            img = p["images"][-1].get("url", "")
        result.append({
            "id": p["id"],
            "name": p["name"],
            "tracks": p.get("tracks", {}).get("total", 0),
            "image": img,
            "uri": p["uri"],
        })
    return result


async def get_devices() -> list[dict]:
    """Get available Spotify Connect devices."""
    data = await _api("GET", "/me/player/devices")
    if not data or "devices" not in data:
        return []
    return [{
        "id": d["id"],
        "name": d["name"],
        "type": d["type"],
        "active": d["is_active"],
        "volume": d.get("volume_percent", 0),
    } for d in data["devices"]]


async def get_playback() -> dict | None:
    """Get current playback state."""
    data = await _api("GET", "/me/player")
    if not data:
        return None
    item = data.get("item")
    result = {
        "is_playing": data.get("is_playing", False),
        "device": data.get("device", {}).get("name", ""),
        "progress_ms": data.get("progress_ms", 0),
    }
    if item:
        artists = ", ".join(a["name"] for a in item.get("artists", []))
        result["track"] = item.get("name", "")
        result["artist"] = artists
        result["album"] = item.get("album", {}).get("name", "")
        result["duration_ms"] = item.get("duration_ms", 0)
        images = item.get("album", {}).get("images", [])
        if images:
            result["image"] = images[-1].get("url", "")
    return result


async def play(uri: str | None = None, device_id: str | None = None) -> bool:
    """Start or resume playback. uri can be a playlist/album/track URI."""
    path = "/me/player/play"
    if device_id:
        path += "?device_id=" + device_id
    body = {}
    if uri:
        if ":playlist:" in uri or ":album:" in uri:
            body["context_uri"] = uri
        elif ":track:" in uri:
            body["uris"] = [uri]
    data = await _api("PUT", path, body if body else None)
    return data is not None


async def pause() -> bool:
    """Pause playback."""
    data = await _api("PUT", "/me/player/pause")
    return data is not None


async def skip_next() -> bool:
    """Skip to next track."""
    data = await _api("POST", "/me/player/next")
    return data is not None


async def skip_prev() -> bool:
    """Skip to previous track."""
    data = await _api("POST", "/me/player/previous")
    return data is not None
