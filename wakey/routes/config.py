"""Global configuration routes + radio test."""

from __future__ import annotations

from fastapi import APIRouter

from .. import audio
from ..config import load_config, save_config
from ..models import AudioConfig, RADIO_STATIONS

router = APIRouter(prefix="/api/config")


@router.get("")
async def get_config() -> dict:
    return load_config().model_dump()


@router.put("")
async def update_config(body: dict) -> dict:
    cfg = load_config()
    if "hue" in body:
        hue_data = cfg.hue.model_dump()
        hue_data.update(body["hue"])
        cfg.hue = cfg.hue.model_validate(hue_data)
    if "spotify" in body:
        sp_data = cfg.spotify.model_dump()
        sp_data.update(body["spotify"])
        cfg.spotify = cfg.spotify.model_validate(sp_data)
    save_config(cfg)
    return cfg.model_dump()


@router.post("/test-radio")
async def test_radio(body: dict) -> dict:
    """Start playing a radio station for testing."""
    station_id = body.get("station", "npo_radio_1")
    volume = body.get("volume", 50)
    if station_id not in RADIO_STATIONS:
        return {"ok": False, "error": "Unknown station"}
    cfg = AudioConfig(station=station_id, volume=volume, ramp_seconds=0)
    err = await audio.start_playback(cfg)
    if err:
        return {"ok": False, "error": err}
    return {"ok": True, "station": RADIO_STATIONS[station_id]["name"]}


@router.post("/test-radio/stop")
async def stop_test_radio() -> dict:
    audio.stop_playback()
    return {"ok": True}


@router.get("/test-radio/status")
async def radio_status() -> dict:
    return {"playing": audio.is_playing()}


@router.post("/test-radio/volume")
async def set_radio_volume(body: dict) -> dict:
    volume = body.get("volume", 50)
    audio._set_volume(volume)
    return {"ok": True}
