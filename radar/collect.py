"""Entry point for the scheduled collector:  python -m radar.collect"""
import logging
import sys

from .collector import run_collection
from .config import Config
from .db import make_session_factory
from .xapi import XClient


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = Config()
    Session = make_session_factory(cfg.database_url)
    with Session() as s:
        run = run_collection(s, XClient(cfg.x_bearer_token), cfg)
    # Non-zero exit makes failed runs visible in the GitHub Actions run history.
    return 0 if run.status in {"ok", "page_limit", "skipped_budget", "stopped_budget"} else 1


if __name__ == "__main__":
    sys.exit(main())
