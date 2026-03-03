"""Wakey - Raspberry Pi Alarm Clock."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

from . import bluetooth, scheduler
from .config import load_alarms, load_config
from .routes import alarms as alarms_router
from .routes import bluetooth as bluetooth_router
from .routes import config as config_router
from .routes import hue as hue_router
from .routes import spotify as spotify_router
from .routes import status as status_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.start()
    scheduler.sync_alarms(load_alarms())

    # Auto-reconnect saved Bluetooth devices in background
    cfg = load_config()
    if cfg.bluetooth_devices:
        asyncio.create_task(bluetooth.reconnect_saved_devices(cfg.bluetooth_devices))

    # Periodic BT scan so nearby devices appear automatically
    asyncio.create_task(bluetooth.periodic_scan_loop(interval=30))

    yield
    scheduler.shutdown()


app = FastAPI(title="Wakey", lifespan=lifespan)

app.include_router(alarms_router.router)
app.include_router(bluetooth_router.router)
app.include_router(config_router.router)
app.include_router(hue_router.router)
app.include_router(spotify_router.router)
app.include_router(status_router.router)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})
