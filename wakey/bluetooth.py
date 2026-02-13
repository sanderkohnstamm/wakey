"""Bluetooth device scanning, pairing, and connection via bluetoothctl."""

from __future__ import annotations

import asyncio
import logging
import subprocess

logger = logging.getLogger(__name__)


def _run(args: list[str], timeout: int = 10) -> str:
    """Run a bluetoothctl command and return stdout."""
    try:
        result = subprocess.run(
            ["bluetoothctl"] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout + result.stderr
    except FileNotFoundError:
        return "ERROR: bluetoothctl not found"
    except subprocess.TimeoutExpired:
        return ""
    except Exception as e:
        return "ERROR: " + str(e)


async def scan(duration: int = 8) -> list[dict]:
    """Scan for nearby Bluetooth devices. Blocks for `duration` seconds."""
    # Start scan in background
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: subprocess.run(
        ["bluetoothctl", "--timeout", str(duration), "scan", "on"],
        capture_output=True,
        text=True,
        timeout=duration + 5,
    ))
    return list_devices()


def list_devices() -> list[dict]:
    """List all known Bluetooth devices."""
    output = _run(["devices"])
    devices = []
    for line in output.strip().splitlines():
        # Format: "Device XX:XX:XX:XX:XX:XX Name"
        if line.startswith("Device "):
            parts = line.split(" ", 2)
            if len(parts) >= 3:
                mac = parts[1]
                name = parts[2]
                info = _get_device_info(mac)
                devices.append({
                    "mac": mac,
                    "name": name,
                    "paired": info.get("paired", False),
                    "connected": info.get("connected", False),
                    "trusted": info.get("trusted", False),
                })
    return devices


def _get_device_info(mac: str) -> dict:
    """Parse bluetoothctl info for a device."""
    output = _run(["info", mac], timeout=5)
    info = {}
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("Paired:"):
            info["paired"] = "yes" in line.lower()
        elif line.startswith("Connected:"):
            info["connected"] = "yes" in line.lower()
        elif line.startswith("Trusted:"):
            info["trusted"] = "yes" in line.lower()
    return info


async def connect_device(mac: str) -> dict:
    """Pair, trust, and connect to a Bluetooth device."""
    loop = asyncio.get_event_loop()

    # Pair
    logger.info("Pairing with %s", mac)
    pair_out = await loop.run_in_executor(None, lambda: _run(["pair", mac], timeout=15))
    if "Failed" in pair_out and "Already Exists" not in pair_out:
        return {"ok": False, "error": "Pairing failed: " + _extract_error(pair_out)}

    # Trust (so it auto-reconnects)
    logger.info("Trusting %s", mac)
    await loop.run_in_executor(None, lambda: _run(["trust", mac], timeout=5))

    # Connect
    logger.info("Connecting to %s", mac)
    conn_out = await loop.run_in_executor(None, lambda: _run(["connect", mac], timeout=15))
    if "Failed" in conn_out:
        return {"ok": False, "error": "Connection failed: " + _extract_error(conn_out)}

    logger.info("Connected to %s", mac)
    return {"ok": True}


async def disconnect_device(mac: str) -> dict:
    """Disconnect a Bluetooth device."""
    loop = asyncio.get_event_loop()
    output = await loop.run_in_executor(None, lambda: _run(["disconnect", mac], timeout=10))
    if "Failed" in output:
        return {"ok": False, "error": _extract_error(output)}
    return {"ok": True}


def get_connected_device() -> dict | None:
    """Return the currently connected audio device, if any."""
    devices = list_devices()
    for d in devices:
        if d["connected"]:
            return d
    return None


def _extract_error(output: str) -> str:
    """Pull a readable error from bluetoothctl output."""
    for line in output.splitlines():
        if "Failed" in line or "Error" in line or "error" in line:
            return line.strip()
    return output.strip()[-100:] if output.strip() else "Unknown error"
