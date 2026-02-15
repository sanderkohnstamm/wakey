"""Alarm lifecycle state machine / orchestrator."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from . import audio, hue, spotify
from .config import load_config
from .models import Alarm, AlarmState, AppState

logger = logging.getLogger(__name__)

state = AppState()

_sunrise_task: asyncio.Task | None = None
_audio_task: asyncio.Task | None = None
_auto_stop_task: asyncio.Task | None = None


def get_state() -> AppState:
    return state


async def trigger_alarm(alarm: Alarm) -> None:
    """Called by scheduler at T - offset_minutes. Starts the full alarm sequence."""
    global _sunrise_task, _audio_task, _auto_stop_task

    if state.state != AlarmState.IDLE:
        logger.warning("Alarm already active, ignoring trigger for %s", alarm.id)
        return

    logger.info("Triggering alarm %s (%s)", alarm.id, alarm.time)
    state.active_alarm_id = alarm.id

    gcfg = load_config().hue

    # Phase 1: Sunrise
    offset = alarm.hue.offset_minutes if alarm.hue.enabled else 0
    if alarm.hue.enabled and offset > 0:
        state.state = AlarmState.SUNRISE
        state.sunrise_start = datetime.now(timezone.utc).isoformat()
        _sunrise_task = asyncio.create_task(_run_sunrise(alarm, gcfg))
    else:
        offset = 0

    # Phase 2: Audio starts after offset delay
    _audio_task = asyncio.create_task(_run_audio(alarm, delay_seconds=offset * 60))

    # Auto-stop
    total_timeout = (offset * 60) + (alarm.auto_stop_minutes * 60)
    _auto_stop_task = asyncio.create_task(_run_auto_stop(total_timeout))


async def _run_sunrise(alarm, gcfg) -> None:
    try:
        await hue.sunrise_ramp(gcfg, alarm.hue, alarm.hue.offset_minutes)
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("Sunrise ramp failed")


async def _run_audio(alarm: Alarm, delay_seconds: int) -> None:
    try:
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

        state.state = AlarmState.ACTIVE
        state.audio_start = datetime.now(timezone.utc).isoformat()

        if alarm.audio.enabled:
            if alarm.audio.source == "spotify" and alarm.audio.spotify_uri:
                ok = await spotify.play(uri=alarm.audio.spotify_uri)
                if ok:
                    await _spotify_volume_ramp(
                        alarm.audio.volume, alarm.audio.ramp_seconds
                    )
                else:
                    logger.warning("Spotify play failed, falling back to radio")
                    await audio.start_playback(alarm.audio)
            else:
                await audio.start_playback(alarm.audio)
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("Audio playback failed")


async def _run_auto_stop(timeout_seconds: int) -> None:
    try:
        await asyncio.sleep(timeout_seconds)
        logger.info("Auto-stop triggered after %d seconds", timeout_seconds)
        await dismiss()
    except asyncio.CancelledError:
        pass


async def dismiss() -> None:
    """Dismiss the current alarm."""
    logger.info("Dismissing alarm")
    _cancel_tasks()
    audio.stop_playback()
    await spotify.stop()
    _reset_state()


async def snooze(alarm: Alarm) -> None:
    """Snooze: stop audio, wait snooze_minutes, restart."""
    global _audio_task, _auto_stop_task

    logger.info("Snoozing alarm for %d minutes", alarm.snooze_minutes)
    audio.stop_playback()
    await spotify.stop()
    if _audio_task:
        _audio_task.cancel()
    if _auto_stop_task:
        _auto_stop_task.cancel()

    state.state = AlarmState.SNOOZED

    _audio_task = asyncio.create_task(_run_snooze_resume(alarm))
    _auto_stop_task = asyncio.create_task(
        _run_auto_stop(alarm.snooze_minutes * 60 + alarm.auto_stop_minutes * 60)
    )


async def _run_snooze_resume(alarm: Alarm) -> None:
    try:
        await asyncio.sleep(alarm.snooze_minutes * 60)
        state.state = AlarmState.ACTIVE
        state.audio_start = datetime.now(timezone.utc).isoformat()
        if alarm.audio.enabled:
            if alarm.audio.source == "spotify" and alarm.audio.spotify_uri:
                ok = await spotify.play(uri=alarm.audio.spotify_uri)
                if ok:
                    await _spotify_volume_ramp(
                        alarm.audio.volume, alarm.audio.ramp_seconds
                    )
                else:
                    logger.warning("Spotify play failed on snooze resume, falling back to radio")
                    await audio.start_playback(alarm.audio)
            else:
                await audio.start_playback(alarm.audio)
    except asyncio.CancelledError:
        pass


async def _spotify_volume_ramp(target_percent: int, ramp_seconds: int) -> None:
    """Gradually ramp Spotify volume from 10% to target over ramp_seconds."""
    if ramp_seconds <= 0:
        vol = int(target_percent / 100 * 65535)
        await spotify.set_volume(vol)
        return

    start_pct = 10
    steps = max(1, ramp_seconds // 3)
    for i in range(steps + 1):
        t = i / steps
        pct = int(start_pct + t * (target_percent - start_pct))
        vol = int(pct / 100 * 65535)
        await spotify.set_volume(vol)
        if i < steps:
            await asyncio.sleep(3)


def _cancel_tasks() -> None:
    global _sunrise_task, _audio_task, _auto_stop_task
    for task in (_sunrise_task, _audio_task, _auto_stop_task):
        if task and not task.done():
            task.cancel()
    _sunrise_task = _audio_task = _auto_stop_task = None


def _reset_state() -> None:
    state.state = AlarmState.IDLE
    state.active_alarm_id = None
    state.sunrise_start = None
    state.audio_start = None
