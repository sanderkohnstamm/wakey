"""Status, dismiss, and snooze routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import alarm as alarm_manager
from ..config import load_alarms
from ..models import AlarmState
from ..scheduler import get_next_fire_time

router = APIRouter(prefix="/api")


@router.get("/status")
async def get_status() -> dict:
    st = alarm_manager.get_state()
    active_alarm = None
    if st.active_alarm_id:
        for a in load_alarms():
            if a.id == st.active_alarm_id:
                active_alarm = a.model_dump()
                break

    return {
        "state": st.state.value,
        "active_alarm_id": st.active_alarm_id,
        "active_alarm": active_alarm,
        "sunrise_start": st.sunrise_start,
        "audio_start": st.audio_start,
        "next_fire_time": get_next_fire_time(),
    }


@router.post("/dismiss")
async def dismiss_alarm() -> dict:
    st = alarm_manager.get_state()
    if st.state == AlarmState.IDLE:
        raise HTTPException(400, "No active alarm")
    await alarm_manager.dismiss()
    return {"ok": True}


@router.post("/snooze")
async def snooze_alarm() -> dict:
    st = alarm_manager.get_state()
    if st.state not in (AlarmState.ACTIVE, AlarmState.SUNRISE):
        raise HTTPException(400, "No active alarm to snooze")

    alarm = None
    for a in load_alarms():
        if a.id == st.active_alarm_id:
            alarm = a
            break
    if not alarm:
        raise HTTPException(404, "Active alarm not found")

    await alarm_manager.snooze(alarm)
    return {"ok": True, "snooze_minutes": alarm.snooze_minutes}
