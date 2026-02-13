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

    scheduler.add_job(fire, trigger, id=f"alarm_{a.id}", replace_existing=True)
    logger.info("Scheduled alarm %s at %02d:%02d (trigger %02d:%02d) on %s",
                a.id, hour, minute, trigger_hour, trigger_minute, days_of_week)


def get_next_fire_time() -> str | None:
    """Return the next alarm fire time as ISO string, or None."""
    jobs = scheduler.get_jobs()
    if not jobs:
        return None
    next_times = [j.next_run_time for j in jobs if j.next_run_time]
    if not next_times:
        return None
    return min(next_times).isoformat()
