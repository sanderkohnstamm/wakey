"""Single-alarm routes."""

from __future__ import annotations

from fastapi import APIRouter

from ..config import load_alarms, save_alarms
from ..models import Alarm, AlarmUpdate, RADIO_STATIONS
from ..scheduler import sync_alarms

router = APIRouter(prefix="/api")


@router.get("/alarm")
async def get_alarm() -> dict:
    alarms = load_alarms()
    if not alarms:
        alarm = Alarm()
        alarms = [alarm]
        save_alarms(alarms)
        sync_alarms(alarms)
    return alarms[0].model_dump()


@router.put("/alarm")
async def update_alarm(update: AlarmUpdate) -> dict:
    alarms = load_alarms()
    if not alarms:
        alarms = [Alarm()]
    data = alarms[0].model_dump()
    updates = update.model_dump(exclude_none=True)
    data.update(updates)
    alarms[0] = Alarm.model_validate(data)
    save_alarms(alarms)
    sync_alarms(alarms)
    return alarms[0].model_dump()


@router.get("/stations")
async def list_stations() -> list[dict]:
    return [{"id": k, "name": v["name"]} for k, v in RADIO_STATIONS.items()]
