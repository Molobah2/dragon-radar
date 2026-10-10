"""Flask web app: the public feed and a small password protected admin page.

Run locally:  flask --app "radar.web:create_app()" run
Production:   gunicorn "radar.web:create_app()"
"""
import hmac
import secrets
import threading
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Flask, abort, jsonify, redirect, render_template, request, session, url_for
from sqlalchemy import func, select

from .collector import run_collection
from .config import Config
from .db import (BlockedAuthor, CollectorRun, Post, get_setting, make_session_factory, month_spend,
                 set_setting, utcnow)

FEED_LIMIT = 1000  # IDs only, a few KB; the browser renders them in small batches


def local_day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """Start and end of a local calendar day, as naive UTC datetimes."""
    start = datetime(day.year, day.month, day.day, tzinfo=tz)
    end = start + timedelta(days=1)
    to_utc = lambda d: d.astimezone(timezone.utc).replace(tzinfo=None)  # noqa: E731
    return to_utc(start), to_utc(end)


def resolve_range(args, tz: ZoneInfo, now_utc: datetime, max_days: int) -> tuple[str, datetime, datetime]:
    """Turn ?range=today|yesterday|7d|custom (&from=&to=) into a UTC window."""
    today = now_utc.replace(tzinfo=timezone.utc).astimezone(tz).date()
    key = args.get("range", "24h")
    if key == "24h":
        return key, now_utc - timedelta(hours=24), now_utc + timedelta(minutes=5)
    if key == "yesterday":
        start, end = local_day_bounds(today - timedelta(days=1), tz)
    elif key == "7d":
        start, _ = local_day_bounds(today - timedelta(days=6), tz)
        _, end = local_day_bounds(today, tz)
    elif key == "custom":
        try:
            d_from = date.fromisoformat(args.get("from", ""))
            d_to = date.fromisoformat(args.get("to", "")) if args.get("to") else d_from
        except ValueError:
            return resolve_range({"range": "24h"}, tz, now_utc, max_days)
        if d_to < d_from:
            d_from, d_to = d_to, d_from
        # Recent search only reaches 7 days back, older custom ranges would just be empty
        oldest = today - timedelta(days=max_days * 4)
        d_from = max(d_from, oldest)
        start, _ = local_day_bounds(d_from, tz)
        _, end = local_day_bounds(d_to, tz)
    else:
        key = "today"
        start, end = local_day_bounds(today, tz)
    return key, start, end


def create_app(cfg: Config | None = None) -> Flask:
    cfg = cfg or Config()
    app = Flask(__name__)
    app.config["SECRET_KEY"] = cfg.secret_key or secrets.token_hex(32)
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    Session = make_session_factory(cfg.database_url)
    tz = ZoneInfo(cfg.timezone)
    app.extensions["radar"] = {"cfg": cfg, "Session": Session}
    from . import scheduler
    scheduler.start(cfg, Session)

    def feed_query(args):
        key, start, end = resolve_range(args, tz, utcnow(), cfg.feed_days)
        who = args.get("who", "all")
        # The form sends a hidden "0" then the checkbox "1"; the last value wins
        quote_vals = args.getlist("quotes") if hasattr(args, "getlist") else [args.get("quotes", "1")]
        quotes = (quote_vals[-1] if quote_vals else "1") != "0"
        q = (select(Post).where(Post.hidden.is_(False), Post.created_at >= start, Post.created_at < end,
                                Post.author_username.is_not(None), Post.text.is_not(None))
             .where(Post.author_id.not_in(select(BlockedAuthor.author_id))))
        if who == "team":
            q = q.where(Post.is_team.is_(True))
        elif who == "community":
            q = q.where(Post.is_team.is_(False))
        else:
            who = "all"
        if not quotes:
            q = q.where(Post.is_quote.is_(False))
        q = q.order_by(Post.created_at.desc()).limit(FEED_LIMIT)
        with Session() as s:
            posts = s.scalars(q).all()
        # Team posts from the last 24 hours are pinned on top; everything else is newest first
        pin_after = utcnow() - timedelta(hours=24)
        posts.sort(key=lambda p: not (p.is_team and p.created_at >= pin_after))
        with Session() as s:
            last_run = s.scalar(select(CollectorRun).where(CollectorRun.status.in_(["ok", "page_limit"]))
                                .order_by(CollectorRun.started_at.desc()).limit(1))
        items = [{"id": p.id, "t": p.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "team": p.is_team, "quote": p.is_quote, "text": p.text, "name": p.author_name or p.author_username,
                  "user": p.author_username, "avatar": p.author_avatar, "media": p.has_media} for p in posts]
        filters = {"range": key, "who": who, "quotes": "1" if quotes else "0",
                   "from": args.get("from", ""), "to": args.get("to", "")}
        updated = last_run.finished_at.strftime("%Y-%m-%dT%H:%M:%SZ") if last_run and last_run.finished_at else None
        return items, filters, updated

    @app.get("/")
    def feed():
        items, filters, updated = feed_query(request.args)
        return render_template("feed.html", cfg=cfg, items=items, filters=filters, updated=updated)

    @app.get("/api/posts")
    def api_posts():
        items, filters, updated = feed_query(request.args)
        return jsonify({"posts": items, "filters": filters, "updated": updated})

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    # Called every 20 minutes by a Supabase cron job. No secret needed: the collector
    # already enforces the daily cap, the spacing between grabs and the spend limit,
    # and this route ignores calls that come sooner than 10 minutes after the last run.
    collect_lock = threading.Lock()

    def collect_in_background():
        from .xapi import XClient
        try:
            with Session() as s:
                run_collection(s, XClient(cfg.x_bearer_token), cfg)
        except Exception:  # noqa: BLE001  the run row already records errors
            app.logger.exception("Background collection failed")
        finally:
            collect_lock.release()

    @app.post("/cron/collect")
    def cron_collect():
        if not cfg.x_bearer_token:
            return {"started": False, "reason": "no token"}, 503
        with Session() as s:
            last = s.scalar(select(CollectorRun.started_at).order_by(CollectorRun.started_at.desc()).limit(1))
        if last and utcnow() - last < timedelta(minutes=10):
            return {"started": False, "reason": "too soon"}, 200
        if not collect_lock.acquire(blocking=False):
            return {"started": False, "reason": "already running"}, 200
        threading.Thread(target=collect_in_background, daemon=True).start()
        return {"started": True}, 202

    # ---------- admin ----------

    def require_admin():
        if not cfg.admin_password:
            abort(404)  # admin is switched off until a password is set
        if not session.get("admin"):
            abort(redirect(url_for("admin_login")))

    def check_csrf():
        token = request.form.get("csrf", "")
        if not token or not hmac.compare_digest(token, session.get("csrf", "")):
            abort(400)

    @app.route("/admin/login", methods=["GET", "POST"])
    def admin_login():
        if not cfg.admin_password:
            abort(404)
        error = None
        if request.method == "POST":
            if hmac.compare_digest(request.form.get("password", ""), cfg.admin_password):
                session.clear()
                session["admin"] = True
                session["csrf"] = secrets.token_hex(16)
                return redirect(url_for("admin"))
            error = "Wrong password"
        return render_template("login.html", cfg=cfg, error=error)

    @app.post("/admin/logout")
    def admin_logout():
        session.clear()
        return redirect(url_for("feed"))

    @app.get("/admin")
    def admin():
        require_admin()
        now = utcnow()
        with Session() as s:
            runs = s.scalars(select(CollectorRun).order_by(CollectorRun.started_at.desc()).limit(30)).all()
            spend = month_spend(s, now)
            total_posts = s.scalar(select(func.count()).select_from(Post))
            hidden = s.scalars(select(Post).where(Post.hidden.is_(True))
                               .order_by(Post.created_at.desc()).limit(50)).all()
            blocked = s.scalars(select(BlockedAuthor).order_by(BlockedAuthor.blocked_at.desc())).all()
            keywords = get_setting(s, "block_keywords", cfg.default_blocklist)
            last_ok = s.scalar(select(CollectorRun.finished_at).where(CollectorRun.status.in_(["ok", "page_limit"]))
                               .order_by(CollectorRun.started_at.desc()).limit(1))
        stale_after = cfg.stale_after_minutes
        if cfg.daily_post_cap > 0:  # testing mode only reads every few hours
            stale_after += int(24 * 60 * 10 / cfg.daily_post_cap)
        stale = last_ok is None or (now - last_ok) > timedelta(minutes=stale_after)
        return render_template("admin.html", cfg=cfg, runs=runs, spend=spend, total_posts=total_posts,
                               hidden=hidden, blocked=blocked, keywords=keywords, stale=stale,
                               last_ok=last_ok, csrf=session.get("csrf"))

    def post_id_from(value: str) -> str:
        # Accept a raw id or a full x.com / twitter.com status link
        value = value.strip().rstrip("/")
        if "/status/" in value:
            value = value.split("/status/")[1].split("?")[0].split("/")[0]
        if not value.isdigit():
            abort(400)
        return value

    @app.post("/admin/hide")
    def admin_hide():
        require_admin(); check_csrf()
        pid = post_id_from(request.form.get("post", ""))
        with Session() as s:
            post = s.get(Post, pid)
            if post:
                post.hidden = request.form.get("undo") != "1"
                if request.form.get("block_author") == "1" and not s.get(BlockedAuthor, post.author_id):
                    s.add(BlockedAuthor(author_id=post.author_id))
                s.commit()
        return redirect(url_for("admin"))

    @app.post("/admin/unblock")
    def admin_unblock():
        require_admin(); check_csrf()
        with Session() as s:
            row = s.get(BlockedAuthor, request.form.get("author_id", ""))
            if row:
                s.delete(row)
                s.commit()
        return redirect(url_for("admin"))

    @app.post("/admin/keywords")
    def admin_keywords():
        require_admin(); check_csrf()
        with Session() as s:
            set_setting(s, "block_keywords", request.form.get("keywords", "")[:2000])
            s.commit()
        return redirect(url_for("admin"))

    @app.post("/admin/collect")
    def admin_collect():
        require_admin(); check_csrf()
        from .xapi import XClient
        if not cfg.x_bearer_token:
            abort(400, "X_BEARER_TOKEN is not set")
        with Session() as s:
            run_collection(s, XClient(cfg.x_bearer_token), cfg)
        return redirect(url_for("admin"))

    return app
