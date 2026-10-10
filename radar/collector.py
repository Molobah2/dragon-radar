"""Collects new posts that tag the project account and stores their IDs.

Run on a schedule (GitHub Actions, every 20 minutes):  python -m radar.collect
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import func, select
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


CAP_PAGE = 10  # smallest page X allows


def capped_collection(s: Session, client: XClient, cfg: Config, run: CollectorRun, now: datetime) -> None:
    """Testing mode: read the newest 10 posts a few times a day, never more than the daily cap.

    Posts between snapshots are skipped on purpose; the bookmark is not used.
    """
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    read_today = s.scalar(select(func.coalesce(func.sum(CollectorRun.posts_returned), 0))
                          .where(CollectorRun.started_at >= day_start, CollectorRun.status != "keeper_lookup")) or 0
    if read_today + CAP_PAGE > cfg.daily_post_cap:
        run.status = "skipped_daily_cap"
        return
    gap = timedelta(hours=24 * CAP_PAGE / cfg.daily_post_cap)
    last = s.scalar(select(CollectorRun.started_at).where(CollectorRun.posts_returned > 0, CollectorRun.status != "keeper_lookup")
                    .order_by(CollectorRun.started_at.desc()).limit(1))
    if last and now - last < gap - timedelta(minutes=5) and not cfg.force_collect:
        run.status = "waiting"
        return
    team_id = resolve_team_id(s, client, cfg, run)
    blocked_authors = set(s.scalars(select(BlockedAuthor.author_id)))
    words = blocklist(s, cfg)
    start = now - timedelta(hours=cfg.first_run_backfill_hours)
    data = client.search_recent(cfg.search_query, start_time=start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                max_results=CAP_PAGE)
    run.pages = 1
    store_posts(s, data, run, cfg, team_id, blocked_authors, words, now)
    run.status = "ok"


def collect_team(s: Session, client: XClient, cfg: Config, run: CollectorRun, now: datetime) -> None:
    """Testing mode only reads 10 posts at a time, which can miss team posts. This keeps
    the team's own posts complete so the two newest can always be pinned. Only new
    team posts are returned (and billed) after the first run."""
    team_id = resolve_team_id(s, client, cfg, run)
    since_id = get_setting(s, "team_newest_id") or None
    start = (now - timedelta(days=6, hours=23)).strftime("%Y-%m-%dT%H:%M:%SZ")
    data = client.search_recent(f"from:{cfg.team_handle} -is:reply -is:retweet", since_id=since_id,
                                start_time=None if since_id else start, max_results=10)
    newest = (data.get("meta") or {}).get("newest_id")
    if data.get("data"):
        store_posts(s, data, run, cfg, team_id, set(), [], now)
    if newest:
        set_setting(s, "team_newest_id", newest)


def store_posts(s, data, run, cfg, team_id, blocked_authors, words, now) -> None:
    posts = data.get("data", []) or []
    users = {u["id"]: u for u in (data.get("includes", {}) or {}).get("users", []) or []}
    run.posts_returned += len(posts)
    run.users_returned += len(users)
    # Assume expanded authors are billed as user reads, to stay on the safe side
    run.est_cost_usd += len(posts) * cfg.cost_per_post_usd + len(users) * cfg.cost_per_user_usd
    for p in posts:
        if p["author_id"] in blocked_authors or is_blocked_text(p.get("text", ""), words):
            run.posts_skipped += 1
            continue
        refs = p.get("referenced_tweets") or []
        u = users.get(p["author_id"], {})
        avatar = (u.get("profile_image_url") or "").replace("_normal.", "_bigger.")
        existing = s.get(Post, p["id"])
        if existing is not None:
            if existing.text is None and not existing.hidden:  # stored before cards had text
                existing.text = (p.get("text") or "")[:1200]
                existing.author_name = (u.get("name") or "")[:100] or None
                existing.author_username = (u.get("username") or "")[:32] or None
                existing.author_avatar = avatar[:400] or None
                existing.has_media = bool((p.get("attachments") or {}).get("media_keys"))
            continue
        s.add(Post(
            id=p["id"],
            author_id=p["author_id"],
            created_at=parse_x_time(p["created_at"]),
            is_quote=any(r.get("type") == "quoted" for r in refs),
            is_team=(p["author_id"] == team_id),
            collected_at=now,
            text=(p.get("text") or "")[:1200],
            author_name=(u.get("name") or "")[:100] or None,
            author_username=(u.get("username") or "")[:32] or None,
            author_avatar=avatar[:400] or None,
            has_media=bool((p.get("attachments") or {}).get("media_keys")),
        ))
        run.posts_new += 1


def tidy_up(s: Session, client: XClient, cfg: Config, run: CollectorRun, now: datetime) -> None:
    """Clear stored text once posts leave the feed, and once a day hide recent posts deleted on X."""
    old = now - timedelta(days=cfg.feed_days + 1)
    for post in s.scalars(select(Post).where(Post.created_at < old, Post.text.is_not(None))):
        post.text = post.author_name = post.author_avatar = None
    if not cfg.recheck_deleted:
        return
    last = get_setting(s, "last_recheck")
    if last and now - datetime.fromisoformat(last) < timedelta(hours=23):
        return
    recent = s.scalars(select(Post).where(Post.created_at >= now - timedelta(hours=24), Post.hidden.is_(False),
                                          Post.text.is_not(None))).all()
    if spent_ok := (month_spend(s, now) + len(recent) * cfg.cost_per_post_usd <= cfg.monthly_spend_limit_usd):
        for i in range(0, len(recent), 100):
            chunk = recent[i:i + 100]
            alive = client.existing_ids([p.id for p in chunk])
            run.est_cost_usd += len(alive) * cfg.cost_per_post_usd
            for p in chunk:
                if p.id not in alive:
                    p.hidden = True
                    p.text = p.author_name = p.author_avatar = None
    if spent_ok:
        set_setting(s, "last_recheck", now.isoformat())


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

    if cfg.daily_post_cap > 0:
        try:
            capped_collection(s, client, cfg, run, now)
            collect_team(s, client, cfg, run, now)
            tidy_up(s, client, cfg, run, now)
        except XApiError as e:
            run.status = "rate_limited" if isinstance(e, RateLimited) else "error"
            run.error = str(e)[:2000]
        run.finished_at = utcnow()
        s.commit()
        log.info("Capped run: %s, %d returned, %d new", run.status, run.posts_returned, run.posts_new)
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

            store_posts(s, data, run, cfg, team_id, blocked_authors, words, now)

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
        tidy_up(s, client, cfg, run, now)
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
