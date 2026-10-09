"""Runs the collector inside the web process every N minutes, for hosts that run one always-on process (set RUN_SCHEDULER=1). Not used on Render, where GitHub Actions collects.

Safe with more than one worker: before each run it checks the last run time in the
database and skips if another process collected recently.
"""
import logging
import threading
import time
from datetime import timedelta

from sqlalchemy import select

from .collector import run_collection
from .db import CollectorRun, utcnow
from .xapi import XClient

log = logging.getLogger("radar.scheduler")
_started = False


def due(Session, every_minutes: int) -> bool:
    with Session() as s:
        last = s.scalar(select(CollectorRun.started_at).order_by(CollectorRun.started_at.desc()).limit(1))
    return last is None or utcnow() - last >= timedelta(minutes=every_minutes) - timedelta(seconds=30)


def start(cfg, Session) -> bool:
    global _started
    if _started or not cfg.run_scheduler:
        return False
    if not cfg.x_bearer_token:
        log.warning("Scheduler not started: X_BEARER_TOKEN is not set")
        return False
    _started = True

    def loop():
        time.sleep(15)  # let the app finish booting
        while True:
            try:
                if due(Session, cfg.collect_every_minutes):
                    with Session() as s:
                        run_collection(s, XClient(cfg.x_bearer_token), cfg)
            except Exception:  # noqa: BLE001  never let the thread die
                log.exception("Scheduled collection failed")
            time.sleep(60)

    threading.Thread(target=loop, name="radar-collector", daemon=True).start()
    log.info("Collector scheduled every %s minutes", cfg.collect_every_minutes)
    return True
