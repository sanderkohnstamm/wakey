"""Bluetooth device scanning, pairing, and connection via bluetoothctl + PulseAudio."""

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


def _pactl(args: list[str], timeout: int = 5) -> str:
    """Run a pactl command and return stdout."""
    try:
        result = subprocess.run(
            ["pactl"] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            logger.warning("pactl %s failed (rc=%d): %s",
                           " ".join(args), result.returncode, result.stderr.strip())
        return result.stdout
    except FileNotFoundError:
        logger.error("pactl not found")
        return ""
    except subprocess.TimeoutExpired:
        logger.warning("pactl %s timed out", " ".join(args))
        return ""
    except Exception as e:
        logger.error("pactl %s error: %s", " ".join(args), e)
        return ""


async def scan(duration: int = 8) -> list[dict]:
    """Scan for nearby Bluetooth devices. Blocks for `duration` seconds."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: subprocess.run(
        ["bluetoothctl", "--timeout", str(duration), "scan", "on"],
        capture_output=True,
        text=True,
        timeout=duration + 5,
    ))
    return list_devices()


def list_devices() -> list[dict]:
    """List all known Bluetooth devices, sorted: connected > paired > rest."""
    output = _run(["devices"])
    devices = []
    for line in output.strip().splitlines():
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
                    "icon": info.get("icon", ""),
                })
    # Sort: connected first, then paired, then the rest
    devices.sort(key=lambda d: (not d["connected"], not d["paired"], d["name"]))
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
        elif line.startswith("Icon:"):
            info["icon"] = line.split(":", 1)[1].strip()
    return info


async def connect_device(mac: str) -> dict:
    """Pair, trust, and connect to a Bluetooth device."""
    loop = asyncio.get_event_loop()

    # Check if already connected
    info = _get_device_info(mac)
    if info.get("connected"):
        return {"ok": True, "already": True}

    # Pair (skip if already paired)
    if not info.get("paired"):
        logger.info("Pairing with %s", mac)
        pair_out = await loop.run_in_executor(None, lambda: _run(["pair", mac], timeout=15))
        if "Failed" in pair_out and "Already Exists" not in pair_out:
            return {"ok": False, "error": "Pairing failed: " + _extract_error(pair_out)}

    # Trust (so it auto-reconnects)
    if not info.get("trusted"):
        logger.info("Trusting %s", mac)
        await loop.run_in_executor(None, lambda: _run(["trust", mac], timeout=5))

    # Connect
    logger.info("Connecting to %s", mac)
    conn_out = await loop.run_in_executor(None, lambda: _run(["connect", mac], timeout=15))
    if "Failed" in conn_out:
        return {"ok": False, "error": "Connection failed: " + _extract_error(conn_out)}

    # Wait for PulseAudio to pick up the new sink
    await asyncio.sleep(2)

    # If multiple devices connected, set up combined sink
    connected = get_connected_devices()
    if len(connected) > 1:
        await loop.run_in_executor(None, setup_combined_sink)

    logger.info("Connected to %s", mac)
    return {"ok": True}


async def disconnect_device(mac: str) -> dict:
    """Disconnect a Bluetooth device."""
    loop = asyncio.get_event_loop()
    output = await loop.run_in_executor(None, lambda: _run(["disconnect", mac], timeout=10))
    if "Failed" in output:
        return {"ok": False, "error": _extract_error(output)}

    # Wait for PulseAudio to update
    await asyncio.sleep(1)

    # Update combined sink if there are still multiple connected
    connected = get_connected_devices()
    if len(connected) > 1:
        await loop.run_in_executor(None, setup_combined_sink)
    elif len(connected) == 1:
        # Single device left, remove combined sink and use it directly
        await loop.run_in_executor(None, remove_combined_sink)
    return {"ok": True}


def get_connected_devices() -> list[dict]:
    """Return all currently connected Bluetooth devices."""
    devices = list_devices()
    return [d for d in devices if d["connected"]]


def get_connected_device() -> dict | None:
    """Return the first connected audio device, if any."""
    connected = get_connected_devices()
    return connected[0] if connected else None


def get_bt_sinks() -> list[str]:
    """Get PulseAudio sink names for connected Bluetooth devices."""
    output = _pactl(["list", "sinks", "short"])
    sinks = []
    for line in output.strip().splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and "bluez" in parts[1].lower():
            sinks.append(parts[1])
    return sinks


def setup_combined_sink() -> bool:
    """Create a PulseAudio combined sink for all connected BT devices."""
    sinks = get_bt_sinks()
    logger.info("setup_combined_sink: found %d bluez sinks: %s", len(sinks), sinks)
    if len(sinks) < 2:
        return False

    # Remove existing combined sink first
    remove_combined_sink()

    slaves = ",".join(sinks)
    logger.info("Creating combined sink with slaves: %s", slaves)
    output = _pactl([
        "load-module", "module-combine-sink",
        "sink_name=wakey_combined",
        "sink_properties=device.description=Wakey_Combined",
        "slaves=" + slaves,
    ])
    logger.info("load-module result: %s", output.strip())

    # Set as default
    _pactl(["set-default-sink", "wakey_combined"])
    return True


def remove_combined_sink() -> None:
    """Remove the combined sink if it exists."""
    output = _pactl(["list", "modules", "short"])
    for line in output.strip().splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and "module-combine-sink" in line and "wakey_combined" in line:
            module_id = parts[0]
            _pactl(["unload-module", module_id])
            logger.info("Removed combined sink module %s", module_id)


def _mac_to_sink(mac: str) -> str:
    """Convert MAC address to PulseAudio bluez sink name."""
    return "bluez_sink." + mac.replace(":", "_") + ".a2dp_sink"


def get_sink_volumes() -> list[dict]:
    """Get volume for each connected BT sink. Returns [{mac, name, volume}]."""
    connected = get_connected_devices()
    result = []
    for dev in connected:
        sink = _mac_to_sink(dev["mac"])
        vol = _get_sink_volume(sink)
        result.append({
            "mac": dev["mac"],
            "name": dev["name"],
            "volume": vol,
        })
    return result


def _get_sink_volume(sink_name: str) -> int:
    """Get volume percentage for a specific sink."""
    output = _pactl(["get-sink-volume", sink_name])
    # Output like: Volume: front-left: 28835 /  44% / -7.13 dB, ...
    for part in output.split("/"):
        part = part.strip()
        if part.endswith("%"):
            try:
                return int(part[:-1].strip())
            except ValueError:
                pass
    return 50  # fallback


def set_sink_volume(mac: str, volume: int) -> bool:
    """Set volume for a specific BT device by MAC address."""
    sink = _mac_to_sink(mac)
    volume = max(0, min(100, volume))
    _pactl(["set-sink-volume", sink, str(volume) + "%"])
    return True


def _extract_error(output: str) -> str:
    """Pull a readable error from bluetoothctl output."""
    for line in output.splitlines():
        if "Failed" in line or "Error" in line or "error" in line:
            return line.strip()
    return output.strip()[-100:] if output.strip() else "Unknown error"
