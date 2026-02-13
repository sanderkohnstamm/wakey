"""CRUD routes for alarms."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config import load_alarms, save_alarms
from ..models import Alarm, AlarmUpdate, RADIO_STATIONS
from ..scheduler import sync_alarms

router = APIRouter(prefix="/api")


@router.get("/alarms")
async def list_alarms() -> list[dict]:
    return [a.model_dump() for a in load_alarms()]


@router.post("/alarms", status_code=201)
async def create_alarm(alarm: Alarm) -> dict:
    alarms = load_alarms()
    alarm.id = Alarm().id
    alarms.append(alarm)
    save_alarms(alarms)
    sync_alarms(alarms)
    return alarm.model_dump()


@router.get("/alarms/{alarm_id}")
async def get_alarm(alarm_id: str) -> dict:
    for a in load_alarms():
        if a.id == alarm_id:
            return a.model_dump()
    raise HTTPException(404, "Alarm not found")


@router.put("/alarms/{alarm_id}")
async def update_alarm(alarm_id: str, update: AlarmUpdate) -> dict:
    alarms = load_alarms()
    for i, a in enumerate(alarms):
        if a.id == alarm_id:
            data = a.model_dump()
            updates = update.model_dump(exclude_none=True)
            data.update(updates)
            alarms[i] = Alarm.model_validate(data)
            save_alarms(alarms)
            sync_alarms(alarms)
            return alarms[i].model_dump()
    raise HTTPException(404, "Alarm not found")


@router.delete("/alarms/{alarm_id}")
async def delete_alarm(alarm_id: str) -> dict:
    alarms = load_alarms()
    alarms = [a for a in alarms if a.id != alarm_id]
    save_alarms(alarms)
    sync_alarms(alarms)
    return {"ok": True}


@router.get("/stations")
async def list_stations() -> list[dict]:
    return [{"id": k, "name": v["name"]} for k, v in RADIO_STATIONS.items()]
