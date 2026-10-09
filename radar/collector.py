"""Collects new posts that tag the project account and stores their IDs.

Run on a schedule (GitHub Actions, every 20 minutes):  python -m radar.collect
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Config
from .db import BlockedAuthor, CollectorRun, Post, get_setting, month_spend, set_setting, utcnow
from .xapi import RateLimited, XApiError, XClient

log = logging.getLogger("radar.collector")


def parse_x_time(value: str) -> datetime:
    # "2026-10-09T12:34:56.000Z" -> naive UTC
    return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")


def blocklist(s: Session, cfg: Config) -> list[str]:
    raw = get_setting(s, "block_keywords", cfg.default_blocklist)
    return [w.strip().lower() for w in raw.split(",") if w.strip()]


def is_blocked_text(text: str, words: list[str]) -> bool:
    lowered = (text or "").lower()
    return any(w in lowered for w in words)


def resolve_team_id(s: Session, client: XClient, cfg: Config, run: CollectorRun) -> str:
    if cfg.team_user_id:
        return cfg.team_user_id
    cached = get_setting(s, "team_user_id")
    if cached:
        return cached
    team_id = client.user_id_for(cfg.team_handle)
    run.users_returned += 1
    run.est_cost_usd += cfg.cost_per_user_usd
    set_setting(s, "team_user_id", team_id)
    return team_id


def run_collection(s: Session, client: XClient, cfg: Config, now: datetime | None = None) -> CollectorRun:
    now = now or utcnow()
    run = CollectorRun(started_at=now)
    s.add(run)

    spent = month_spend(s, now)
    page_cost = 100 * cfg.cost_per_post_usd  # worst case for one page
    if spent + page_cost > cfg.monthly_spend_limit_usd:
        run.status = "skipped_budget"
        run.finished_at = utcnow()
        s.commit()
        log.warning("Monthly spend limit reached (%.2f of %.2f USD). Skipping.", spent, cfg.monthly_spend_limit_usd)
        return run

    # A previous run may have stopped mid-way (page limit, budget, rate limit). Resume
    # from its page token so already-paid pages are not read again.
    next_token = get_setting(s, "resume_token") or None
    newest_id = (get_setting(s, "resume_newest_id") or None) if next_token else None

    try:
        team_id = resolve_team_id(s, client, cfg, run)
        since_id = get_setting(s, "newest_id") or None
        start_time = None
        if not since_id:
            start = now - timedelta(hours=cfg.first_run_backfill_hours)
            start_time = start.strftime("%Y-%m-%dT%H:%M:%SZ")

        blocked_authors = set(s.scalars(select(BlockedAuthor.author_id)))
        words = blocklist(s, cfg)
        status = "ok"

        for _ in range(cfg.max_pages_per_run):
            if spent + run.est_cost_usd + page_cost > cfg.monthly_spend_limit_usd:
                status = "stopped_budget"
                break
            data = client.search_recent(cfg.search_query, since_id=since_id, start_time=start_time,
                                        next_token=next_token)
            run.pages += 1
            meta = data.get("meta", {})
            if newest_id is None and meta.get("newest_id"):
                newest_id = meta["newest_id"]

            posts = data.get("data", []) or []
            run.posts_returned += len(posts)
            run.est_cost_usd += len(posts) * cfg.cost_per_post_usd

            for p in posts:
                if p["author_id"] in blocked_authors or is_blocked_text(p.get("text", ""), words):
                    run.posts_skipped += 1
                    continue
                if s.get(Post, p["id"]) is not None:
                    continue
                refs = p.get("referenced_tweets") or []
                s.add(Post(
                    id=p["id"],
                    author_id=p["author_id"],
                    created_at=parse_x_time(p["created_at"]),
                    is_quote=any(r.get("type") == "quoted" for r in refs),
                    is_team=(p["author_id"] == team_id),
                    collected_at=now,
                ))
                run.posts_new += 1

            next_token = meta.get("next_token")
            if not next_token:
                break
        else:
            if next_token:
                status = "page_limit"

        # Only move the bookmark forward when we read everything since it.
        # Otherwise posts between the last page and the old bookmark would be skipped forever.
        if status == "ok":
            if newest_id:
                set_setting(s, "newest_id", newest_id)
            set_setting(s, "resume_token", "")
            set_setting(s, "resume_newest_id", "")
        else:
            set_setting(s, "resume_token", next_token or "")
            set_setting(s, "resume_newest_id", newest_id or "")
        run.status = status
    except RateLimited as e:
        # Keep our place; the next scheduled run picks up from here.
        set_setting(s, "resume_token", next_token or "")
        set_setting(s, "resume_newest_id", newest_id or "")
        run.status = "rate_limited"
        run.error = str(e)
    except XApiError as e:
        # An expired resume token would block every future run. Drop it and start
        # fresh from the bookmark next time.
        if get_setting(s, "resume_token"):
            set_setting(s, "resume_token", "")
            set_setting(s, "resume_newest_id", "")
        run.status = "error"
        run.error = str(e)[:2000]
    except Exception as e:  # noqa: BLE001  keep the run record, surface the error in admin
        log.exception("Collector failed")
        run.status = "error"
        run.error = str(e)[:2000]

    run.finished_at = utcnow()
    s.commit()
    log.info("Run %s: %s, %d returned, %d new, %d skipped, est $%.3f", run.id, run.status,
             run.posts_returned, run.posts_new, run.posts_skipped, run.est_cost_usd)
    return run
