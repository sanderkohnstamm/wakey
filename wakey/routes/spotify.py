"""Spotify integration routes."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from .. import spotify

router = APIRouter(prefix="/api/spotify")


@router.get("/auth-url")
async def auth_url() -> dict:
    """Get the Spotify authorization URL (uses localhost redirect)."""
    url = spotify.get_auth_url()
    if not url:
        return {"ok": False, "error": "Configure Spotify client ID first"}
    return {"ok": True, "url": url}


@router.get("/callback", response_class=HTMLResponse)
async def callback(request: Request, code: str = "", error: str = "") -> str:
    """OAuth callback from Spotify (only works when accessed from localhost)."""
    if error:
        return _callback_page("Spotify authorization failed: " + error, False)

    if not code:
        return _callback_page("No authorization code received", False)

    result = await spotify.exchange_code(code)

    if result.get("ok"):
        return _callback_page("Spotify connected! You can close this tab.", True)
    return _callback_page(result.get("error", "Unknown error"), False)


@router.post("/exchange-code")
async def exchange_code(body: dict) -> dict:
    """Manually exchange an authorization code (for when redirect doesn't reach server)."""
    code = body.get("code", "").strip()
    if not code:
        return {"ok": False, "error": "No code provided"}
    return await spotify.exchange_code(code)


def _callback_page(message: str, success: bool) -> str:
    color = "#5ab583" if success else "#c44"
    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<style>body{background:#111113;color:#f0f0f0;font-family:-apple-system,sans-serif;'
        'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}'
        'div{text-align:center}p{color:' + color + ';font-size:1.2rem;margin-bottom:16px}'
        'a{color:#6e9fff;text-decoration:none}</style></head><body><div>'
        '<p>' + message + '</p>'
        '<a href="/">Back to Wakey</a></div></body></html>'
    )


@router.get("/status")
async def status() -> dict:
    """Check if Spotify is connected."""
    return {"connected": spotify.is_connected()}


@router.get("/playlists")
async def playlists() -> list[dict]:
    """Get user's playlists."""
    return await spotify.get_playlists()


@router.get("/devices")
async def devices() -> list[dict]:
    """Get available Spotify Connect devices."""
    return await spotify.get_devices()


@router.get("/playback")
async def playback() -> dict:
    """Get current playback state."""
    data = await spotify.get_playback()
    if data is None:
        return {"is_playing": False}
    return data


@router.post("/play")
async def play(body: dict) -> dict:
    """Start playback. Optional: uri, device_id."""
    uri = body.get("uri")
    device_id = body.get("device_id")
    ok = await spotify.play(uri=uri, device_id=device_id)
    return {"ok": ok}


@router.post("/pause")
async def pause() -> dict:
    """Pause playback."""
    ok = await spotify.pause()
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


@router.post("/disconnect")
async def disconnect() -> dict:
    """Remove Spotify tokens."""
    from ..config import load_config, save_config
    cfg = load_config()
    cfg.spotify.access_token = ""
    cfg.spotify.refresh_token = ""
    cfg.spotify.token_expiry = 0
    save_config(cfg)
    return {"ok": True}
