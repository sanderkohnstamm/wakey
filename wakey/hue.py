"""Philips Hue Bridge REST API integration."""

from __future__ import annotations

import asyncio
import logging

import httpx

from .models import GlobalHueConfig, HueConfig

logger = logging.getLogger(__name__)


def _bridge_url(cfg: GlobalHueConfig) -> str:
    return f"http://{cfg.bridge_ip}/api/{cfg.username}"


async def register_user(bridge_ip: str) -> dict:
    """Register a new API user. The bridge link button must be pressed first."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"http://{bridge_ip}/api",
                json={"devicetype": "wakey#alarm"},
            )
            resp.raise_for_status()
            data = resp.json()
        if isinstance(data, list) and len(data) > 0:
            if "success" in data[0]:
                username = data[0]["success"]["username"]
                return {"ok": True, "username": username}
            if "error" in data[0]:
                desc = data[0]["error"].get("description", "Unknown error")
                return {"ok": False, "error": desc}
        return {"ok": False, "error": "Unexpected response from bridge"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def get_rooms(cfg: GlobalHueConfig) -> list[dict]:
    """Fetch groups/rooms from the Hue bridge."""
    if not cfg.bridge_ip or not cfg.username:
        return []
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{_bridge_url(cfg)}/groups")
            resp.raise_for_status()
            data = resp.json()
        rooms = []
        for gid, group in data.items():
            if group.get("type") in ("Room", "Zone"):
                rooms.append({"id": gid, "name": group["name"], "type": group["type"]})
        return rooms
    except Exception:
        logger.exception("Failed to fetch Hue rooms")
        return []


async def check_bridge(cfg: GlobalHueConfig) -> dict:
    """Check bridge connectivity and return status."""
    if not cfg.bridge_ip or not cfg.username:
        return {"connected": False, "error": "Bridge IP or username not configured"}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"http://{cfg.bridge_ip}/api/{cfg.username}/config")
            resp.raise_for_status()
            data = resp.json()
        if isinstance(data, list) and data[0].get("error"):
            return {"connected": False, "error": data[0]["error"]["description"]}
        return {"connected": True, "name": data.get("name", ""), "bridge_id": data.get("bridgeid", "")}
    except Exception as e:
        return {"connected": False, "error": str(e)}


async def test_light(cfg: GlobalHueConfig, room_id: str) -> dict:
    """Briefly flash a room to confirm connection works."""
    if not cfg.bridge_ip or not cfg.username or not room_id:
        return {"ok": False, "error": "Hue not fully configured"}
    url = f"{_bridge_url(cfg)}/groups/{room_id}/action"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            # Turn on warm and dim
            await client.put(url, json={"on": True, "bri": 80, "ct": 400, "transitiontime": 5})
            await asyncio.sleep(2)
            # Turn off
            await client.put(url, json={"on": False, "transitiontime": 10})
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def sunrise_ramp(gcfg: GlobalHueConfig, alarm_hue: HueConfig, duration_minutes: int) -> None:
    """Gradually ramp lights from warm dim to bright daylight.

    Steps every 30 seconds. transitiontime=300 (30s in deciseconds).
    Brightness: 1 -> 254, Color temp: 500 -> 153 mired.
    """
    if not gcfg.bridge_ip or not gcfg.username or not alarm_hue.room_id:
        logger.warning("Hue not configured, skipping sunrise ramp")
        return

    total_steps = max(1, (duration_minutes * 60) // 30)
    url = f"{_bridge_url(gcfg)}/groups/{alarm_hue.room_id}/action"

    logger.info("Starting sunrise ramp: %d steps over %d min for room %s",
                total_steps, duration_minutes, alarm_hue.room_name or alarm_hue.room_id)

    async with httpx.AsyncClient(timeout=5) as client:
        for step in range(total_steps + 1):
            t = step / total_steps  # 0.0 -> 1.0
            bri = int(1 + t * 253)
            ct = int(500 - t * 347)  # 500 -> 153 mired

            body = {
                "on": True,
                "bri": bri,
                "ct": ct,
                "transitiontime": 300,  # 30s
            }
            try:
                await client.put(url, json=body)
                logger.debug("Sunrise step %d/%d: bri=%d ct=%d", step, total_steps, bri, ct)
            except Exception:
                logger.warning("Sunrise step %d failed, continuing", step)

            if step < total_steps:
                await asyncio.sleep(30)

    logger.info("Sunrise ramp complete")


async def lights_off(gcfg: GlobalHueConfig, room_id: str) -> None:
    """Turn off lights in the configured room."""
    if not gcfg.bridge_ip or not gcfg.username or not room_id:
        return
    url = f"{_bridge_url(gcfg)}/groups/{room_id}/action"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.put(url, json={"on": False})
    except Exception:
        logger.warning("Failed to turn off lights")
