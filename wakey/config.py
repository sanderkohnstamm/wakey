"""JSON file persistence for alarms and global config."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from .models import Alarm, AppConfig

logger = logging.getLogger(__name__)

DATA_FILE = Path(os.environ.get("WAKEY_DATA", Path(__file__).parent / "alarms.json"))


def _load_raw() -> dict:
    if not DATA_FILE.exists():
        return {}
    try:
        return json.loads(DATA_FILE.read_text())
    except Exception:
        logger.exception("Failed to load alarms.json")
        return {}


def _save_raw(data: dict) -> None:
    DATA_FILE.write_text(json.dumps(data, indent=2) + "\n")


def load_alarms() -> list[Alarm]:
    data = _load_raw()
    raw_alarms = data.get("alarms", [])
    return [Alarm.model_validate(a) for a in raw_alarms]


def save_alarms(alarms: list[Alarm]) -> None:
    data = _load_raw()
    data["alarms"] = [a.model_dump() for a in alarms]
    _save_raw(data)


def load_config() -> AppConfig:
    data = _load_raw()
    raw_config = data.get("config", {})
    return AppConfig.model_validate(raw_config)


def save_config(config: AppConfig) -> None:
    data = _load_raw()
    data["config"] = config.model_dump()
    _save_raw(data)


def load_spotify_presets() -> list[dict]:
    data = _load_raw()
    return data.get("spotify_presets", [])


def save_spotify_presets(presets: list[dict]) -> None:
    data = _load_raw()
    data["spotify_presets"] = presets
    _save_raw(data)
