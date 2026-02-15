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


async def get_rooms(cfg: GlobalHueConfig, include_state: bool = False) -> list[dict]:
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
                room = {"id": gid, "name": group["name"], "type": group["type"]}
                if include_state:
                    action = group.get("action", {})
                    state = group.get("state", {})
                    room["on"] = state.get("any_on", False)
                    room["all_on"] = state.get("all_on", False)
                    room["bri"] = action.get("bri", 0)
                    room["ct"] = action.get("ct", 300)
                    room["lights"] = group.get("lights", [])
                rooms.append(room)
        return rooms
    except Exception:
        logger.exception("Failed to fetch Hue rooms")
        return []


async def set_room_state(cfg: GlobalHueConfig, room_id: str, state: dict) -> dict:
    """Set room state (on, bri, ct)."""
    if not cfg.bridge_ip or not cfg.username or not room_id:
        return {"ok": False, "error": "Hue not configured"}
    url = f"{_bridge_url(cfg)}/groups/{room_id}/action"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.put(url, json=state)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def get_scenes(cfg: GlobalHueConfig, room_id: str = "") -> list[dict]:
    """Fetch scenes, optionally filtered by room (group)."""
    if not cfg.bridge_ip or not cfg.username:
        return []
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{_bridge_url(cfg)}/scenes")
            resp.raise_for_status()
            data = resp.json()
        scenes = []
        for sid, scene in data.items():
            if room_id and scene.get("group") != room_id:
                continue
            scenes.append({
                "id": sid,
                "name": scene.get("name", ""),
                "group": scene.get("group", ""),
                "type": scene.get("type", ""),
            })
        scenes.sort(key=lambda s: s["name"])
        return scenes
    except Exception:
        logger.exception("Failed to fetch Hue scenes")
        return []


async def activate_scene(cfg: GlobalHueConfig, room_id: str, scene_id: str) -> dict:
    """Activate a Hue scene."""
    if not cfg.bridge_ip or not cfg.username:
        return {"ok": False, "error": "Hue not configured"}
    url = f"{_bridge_url(cfg)}/groups/{room_id}/action"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.put(url, json={"scene": scene_id})
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


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
    Supports multiple rooms.
    """
    # Build room list: prefer rooms list, fall back to single room_id
    rooms = alarm_hue.rooms or ([{"id": alarm_hue.room_id}] if alarm_hue.room_id else [])
    if not gcfg.bridge_ip or not gcfg.username or not rooms:
        logger.warning("Hue not configured, skipping sunrise ramp")
        return

    total_steps = max(1, (duration_minutes * 60) // 30)
    room_names = ", ".join(r.get("name", r.get("id", "?")) for r in rooms)

    logger.info("Starting sunrise ramp: %d steps over %d min for rooms: %s",
                total_steps, duration_minutes, room_names)

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
            for room in rooms:
                url = f"{_bridge_url(gcfg)}/groups/{room['id']}/action"
                try:
                    await client.put(url, json=body)
                    logger.debug("Sunrise step %d/%d room %s: bri=%d ct=%d",
                                 step, total_steps, room.get("name", room["id"]), bri, ct)
                except Exception:
                    logger.warning("Sunrise step %d failed for room %s, continuing",
                                   step, room.get("id"))

            if step < total_steps:
                await asyncio.sleep(30)

    # Activate scene at end of ramp if configured
    if alarm_hue.scene_id:
        for room in rooms:
            logger.info("Activating scene %s in room %s",
                        alarm_hue.scene_name or alarm_hue.scene_id,
                        room.get("name", room["id"]))
            await activate_scene(gcfg, room["id"], alarm_hue.scene_id)

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
