"""Pydantic models for Wakey alarm clock."""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class AlarmState(str, Enum):
    IDLE = "idle"
    SUNRISE = "sunrise"
    ACTIVE = "active"
    SNOOZED = "snoozed"


class GlobalHueConfig(BaseModel):
    bridge_ip: str = ""
    username: str = ""


class HueConfig(BaseModel):
    room_id: str = ""
    room_name: str = ""
    offset_minutes: int = 20
    enabled: bool = True


class AudioConfig(BaseModel):
    station: str = "npo_radio_1"
    volume: int = 70  # target volume %
    ramp_seconds: int = 30
    enabled: bool = True


class Alarm(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    time: str = "07:00"  # HH:MM
    days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])  # 0=Mon..6=Sun
    enabled: bool = True
    label: str = ""
    hue: HueConfig = Field(default_factory=HueConfig)
    audio: AudioConfig = Field(default_factory=AudioConfig)
    snooze_minutes: int = 9
    auto_stop_minutes: int = 30


class AlarmUpdate(BaseModel):
    time: Optional[str] = None
    days: Optional[list[int]] = None
    enabled: Optional[bool] = None
    label: Optional[str] = None
    hue: Optional[HueConfig] = None
    audio: Optional[AudioConfig] = None
    snooze_minutes: Optional[int] = None
    auto_stop_minutes: Optional[int] = None


class AppConfig(BaseModel):
    """Global app configuration persisted alongside alarms."""
    hue: GlobalHueConfig = Field(default_factory=GlobalHueConfig)


class AppState(BaseModel):
    state: AlarmState = AlarmState.IDLE
    active_alarm_id: Optional[str] = None
    sunrise_start: Optional[str] = None  # ISO timestamp
    audio_start: Optional[str] = None  # ISO timestamp


RADIO_STATIONS = {
    # NPO
    "npo_radio_1": {
        "name": "NPO Radio 1",
        "url": "https://icecast.omroep.nl/radio1-bb-mp3",
    },
    "npo_radio_2": {
        "name": "NPO Radio 2",
        "url": "https://icecast.omroep.nl/radio2-bb-mp3",
    },
    "npo_3fm": {
        "name": "NPO 3FM",
        "url": "https://icecast.omroep.nl/3fm-bb-mp3",
    },
    "npo_radio_4": {
        "name": "NPO Radio 4",
        "url": "https://icecast.omroep.nl/radio4-bb-mp3",
    },
    "npo_radio_5": {
        "name": "NPO Radio 5",
        "url": "https://icecast.omroep.nl/radio5-bb-mp3",
    },
    # Commercial
    "radio_538": {
        "name": "Radio 538",
        "url": "https://25293.live.streamtheworld.com/RADIO538.mp3",
    },
    "radio_10": {
        "name": "Radio 10",
        "url": "https://25293.live.streamtheworld.com/RADIO10.mp3",
    },
    "sky_radio": {
        "name": "Sky Radio",
        "url": "https://25293.live.streamtheworld.com/SKYRADIO.mp3",
    },
    "radio_veronica": {
        "name": "Radio Veronica",
        "url": "https://25293.live.streamtheworld.com/VERONICA.mp3",
    },
    "100p_nl": {
        "name": "100% NL",
        "url": "https://stream.100p.nl/100pctnl.mp3",
    },
    "slam": {
        "name": "SLAM!",
        "url": "https://25293.live.streamtheworld.com/SLAM.mp3",
    },
    "bnr": {
        "name": "BNR Nieuwsradio",
        "url": "https://25293.live.streamtheworld.com/BNR_NIEUWSRADIO.mp3",
    },
    "sublime_fm": {
        "name": "Sublime FM",
        "url": "https://25293.live.streamtheworld.com/SUBLIMEFM.mp3",
    },
    "qmusic": {
        "name": "Qmusic",
        "url": "https://25293.live.streamtheworld.com/QMUSIC.mp3",
    },
}
