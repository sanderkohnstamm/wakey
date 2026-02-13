"""Hue bridge routes."""

from __future__ import annotations

from fastapi import APIRouter

from .. import hue
from ..config import load_config, save_config

router = APIRouter(prefix="/api/hue")


@router.get("/rooms")
async def get_rooms() -> list[dict]:
    cfg = load_config().hue
    return await hue.get_rooms(cfg)


@router.get("/status")
async def get_status() -> dict:
    cfg = load_config().hue
    return await hue.check_bridge(cfg)


@router.post("/register")
async def register(body: dict) -> dict:
    """Register a new API user on the Hue bridge. Bridge button must be pressed first."""
    bridge_ip = body.get("bridge_ip", "").strip()
    if not bridge_ip:
        return {"ok": False, "error": "Bridge IP is required"}
    result = await hue.register_user(bridge_ip)
    if result.get("ok"):
        # Auto-save to config
        cfg = load_config()
        cfg.hue.bridge_ip = bridge_ip
        cfg.hue.username = result["username"]
        save_config(cfg)
    return result


@router.post("/test")
async def test_light(body: dict) -> dict:
    cfg = load_config().hue
    room_id = body.get("room_id", "")
    return await hue.test_light(cfg, room_id)
