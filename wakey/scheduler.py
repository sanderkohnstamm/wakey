"""APScheduler integration: sync alarms to cron jobs."""

from __future__ import annotations

import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from . import alarm as alarm_manager
from .models import Alarm

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# Map day index (0=Mon) to cron day_of_week
_DAY_MAP = {0: "mon", 1: "tue", 2: "wed", 3: "thu", 4: "fri", 5: "sat", 6: "sun"}

# Map job_id -> offset_minutes so we can recover the real alarm time
_job_offsets: dict[str, int] = {}


def start() -> None:
    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started")


def shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def sync_alarms(alarms: list[Alarm]) -> None:
    """Remove all existing jobs and re-add enabled alarms."""
    scheduler.remove_all_jobs()
    _job_offsets.clear()

    for a in alarms:
        if not a.enabled or not a.days:
            continue
        _add_alarm_job(a)

    logger.info("Synced %d alarm jobs", len(scheduler.get_jobs()))


def _add_alarm_job(a: Alarm) -> None:
    """Add a cron job for one alarm. Fires at time - hue offset."""
    hour, minute = map(int, a.time.split(":"))
    offset = a.hue.offset_minutes if a.hue.enabled else 0

    # Subtract offset to get trigger time
    trigger_dt = datetime.now().replace(hour=hour, minute=minute, second=0)
    from datetime import timedelta
    trigger_dt -= timedelta(minutes=offset)
    trigger_hour = trigger_dt.hour
    trigger_minute = trigger_dt.minute

    days_of_week = ",".join(_DAY_MAP[d] for d in sorted(a.days))

    trigger = CronTrigger(
        day_of_week=days_of_week,
        hour=trigger_hour,
        minute=trigger_minute,
        second=0,
    )

    async def fire():
        await alarm_manager.trigger_alarm(a)

    job_id = f"alarm_{a.id}"
    scheduler.add_job(fire, trigger, id=job_id, replace_existing=True)
    _job_offsets[job_id] = offset
    logger.info("Scheduled alarm %s at %02d:%02d (trigger %02d:%02d) on %s",
                a.id, hour, minute, trigger_hour, trigger_minute, days_of_week)


def get_next_fire_time() -> str | None:
    """Return the next alarm audio start time as ISO string, or None.

    Jobs fire at alarm_time - hue_offset. We add the offset back
    so the home screen shows when music actually starts.
    """
    from datetime import timedelta

    jobs = scheduler.get_jobs()
    if not jobs:
        return None

    earliest = None
    for job in jobs:
        if not job.next_run_time:
            continue
        offset = _job_offsets.get(job.id, 0)
        audio_time = job.next_run_time + timedelta(minutes=offset)
        if earliest is None or audio_time < earliest:
            earliest = audio_time

    return earliest.isoformat() if earliest else None
