"""Global configuration routes + radio test."""

from __future__ import annotations

from fastapi import APIRouter

from .. import audio, hue, spotify
from ..config import load_alarms, load_config, save_config
from ..models import AudioConfig, HueConfig, RADIO_STATIONS
from ..scheduler import sync_alarms

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
    save_config(cfg)
    return cfg.model_dump()


# ── Global audio config ──

@router.get("/audio")
async def get_audio_config() -> dict:
    return load_config().audio.model_dump()


@router.put("/audio")
async def update_audio_config(body: dict) -> dict:
    cfg = load_config()
    audio_data = cfg.audio.model_dump()
    audio_data.update(body)
    cfg.audio = AudioConfig.model_validate(audio_data)
    save_config(cfg)
    return cfg.audio.model_dump()


# ── Global hue alarm config ──

@router.get("/hue-alarm")
async def get_hue_alarm_config() -> dict:
    return load_config().hue_alarm.model_dump()


@router.put("/hue-alarm")
async def update_hue_alarm_config(body: dict) -> dict:
    cfg = load_config()
    hue_data = cfg.hue_alarm.model_dump()
    hue_data.update(body)
    cfg.hue_alarm = HueConfig.model_validate(hue_data)
    save_config(cfg)
    # Re-sync alarms since offset may have changed
    sync_alarms(load_alarms())
    return cfg.hue_alarm.model_dump()


# ── Test lights ──

@router.post("/test-lights")
async def test_lights() -> dict:
    """Flash all configured alarm rooms briefly."""
    cfg = load_config()
    gcfg = cfg.hue
    hue_cfg = cfg.hue_alarm
    rooms = hue_cfg.rooms or []
    if not rooms:
        return {"ok": False, "error": "No rooms configured"}
    results = []
    for room in rooms:
        result = await hue.test_light(gcfg, room["id"])
        results.append(result)
    ok = any(r.get("ok") for r in results)
    return {"ok": ok}


# ── Radio test ──

@router.post("/test-radio")
async def test_radio(body: dict) -> dict:
    """Start playing a radio station for testing."""
    station_id = body.get("station", "npo_radio_1")
    volume = body.get("volume", 50)
    if station_id not in RADIO_STATIONS:
        return {"ok": False, "error": "Unknown station"}
    # Stop Spotify before playing radio (mutual exclusion)
    await spotify.stop()
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
