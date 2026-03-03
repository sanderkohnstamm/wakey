"""Bluetooth device management routes."""

from __future__ import annotations

from fastapi import APIRouter

from .. import bluetooth
from ..config import load_config, save_config

router = APIRouter(prefix="/api/bluetooth")


def _save_bt_mac(mac: str) -> None:
    """Add MAC to saved bluetooth_devices if not already present."""
    cfg = load_config()
    if mac not in cfg.bluetooth_devices:
        cfg.bluetooth_devices.append(mac)
        save_config(cfg)


def _remove_bt_mac(mac: str) -> None:
    """Remove MAC from saved bluetooth_devices."""
    cfg = load_config()
    if mac in cfg.bluetooth_devices:
        cfg.bluetooth_devices.remove(mac)
        save_config(cfg)


@router.post("/scan")
async def scan_devices() -> list[dict]:
    """Scan for nearby Bluetooth devices (~8 seconds)."""
    return await bluetooth.scan(duration=8)


@router.get("/devices")
async def get_devices() -> list[dict]:
    """List known Bluetooth devices (no scan)."""
    return bluetooth.list_devices()


@router.get("/status")
async def get_status() -> dict:
    """Get all connected Bluetooth audio devices."""
    connected = bluetooth.get_connected_devices()
    return {
        "connected": len(connected) > 0,
        "devices": connected,
        # Keep backward compat
        "device": connected[0] if connected else None,
    }


@router.post("/connect")
async def connect(body: dict) -> dict:
    """Pair, trust, and connect to a device."""
    mac = body.get("mac", "")
    if not mac:
        return {"ok": False, "error": "MAC address required"}
    result = await bluetooth.connect_device(mac)
    if result.get("ok"):
        _save_bt_mac(mac)
    return result


@router.post("/disconnect")
async def disconnect(body: dict) -> dict:
    """Disconnect a device."""
    mac = body.get("mac", "")
    if not mac:
        return {"ok": False, "error": "MAC address required"}
    result = await bluetooth.disconnect_device(mac)
    if result.get("ok"):
        _remove_bt_mac(mac)
    return result


@router.get("/volumes")
async def get_volumes() -> list[dict]:
    """Get volume for each connected BT speaker."""
    return bluetooth.get_sink_volumes()


@router.post("/volume")
async def set_volume(body: dict) -> dict:
    """Set volume for a specific BT speaker."""
    mac = body.get("mac", "")
    volume = body.get("volume", 50)
    if not mac:
        return {"ok": False, "error": "MAC address required"}
    bluetooth.set_sink_volume(mac, volume)
    return {"ok": True}


@router.post("/setup-combined")
async def setup_combined() -> dict:
    """Manually trigger combined sink setup."""
    import asyncio
    loop = asyncio.get_event_loop()
    ok = await loop.run_in_executor(None, bluetooth.setup_combined_sink)
    return {"ok": ok}
