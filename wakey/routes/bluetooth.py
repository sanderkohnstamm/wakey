"""Bluetooth device management routes."""

from __future__ import annotations

from fastapi import APIRouter

from .. import bluetooth

router = APIRouter(prefix="/api/bluetooth")


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
    """Get currently connected Bluetooth audio device."""
    device = bluetooth.get_connected_device()
    if device:
        return {"connected": True, "device": device}
    return {"connected": False, "device": None}


@router.post("/connect")
async def connect(body: dict) -> dict:
    """Pair, trust, and connect to a device."""
    mac = body.get("mac", "")
    if not mac:
        return {"ok": False, "error": "MAC address required"}
    return await bluetooth.connect_device(mac)


@router.post("/disconnect")
async def disconnect(body: dict) -> dict:
    """Disconnect a device."""
    mac = body.get("mac", "")
    if not mac:
        return {"ok": False, "error": "MAC address required"}
    return await bluetooth.disconnect_device(mac)
