"""Flask web app: the public feed and a small password protected admin page.

Run locally:  flask --app "radar.web:create_app()" run
Production:   gunicorn "radar.web:create_app()"
"""
import json
import mimetypes
import hmac
import os
import re
import secrets
import time
import threading
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import hashlib
from pathlib import Path
from functools import wraps

from flask import Flask, Response, abort, g, has_request_context, jsonify, make_response, redirect, render_template, request, session, url_for
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from .collector import run_collection
from .config import Config
from .directory import has_dragon_tag, note_user
from .db import (SIDE_RUNS, AuthorCheck, BlockedAuthor, CollectorRun, Keeper, Post, get_setting, make_session_factory, month_spend,
                 set_setting, utcnow)

FEED_LIMIT = 1000
FEED_CACHE_S = 30  # seconds the shared feed result is reused
EXTRAS_CACHE_S = 60  # pinned posts, welcome row and team spotlight, shared by every filter
DAYS_CACHE_S = 60  # the 7 day strip
DAY_STRIP = 7      # days the "catch up by day" strip keeps (X's recent search reaches 7 days back)
OPENS_PER_CONNECTION = 3   # different browsers on one connection that can add to a post's public count
HABIT_GAP_S = 4            # seconds between two counted opens from one browser
HABIT_PER_CONNECTION = 200 # counted opens per connection per day, all browsers together
OPENS_PER_DAY = 50  # per browser, counted for habits, tiers and relics; never shown on the site
NEWCOMERS = 12  # first time posters shown in the welcome row
PINNED = 4  # newest team posts kept at the top  # IDs only, a few KB; the browser renders them in small batches

mimetypes.add_type("application/manifest+json", ".webmanifest")


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
        d_to = min(d_to, today + timedelta(days=1))          # nothing exists in the future (and year 9999 would overflow)
        d_from = min(d_from, d_to)
        # Recent search only reaches 7 days back, older custom ranges would just be empty
        oldest = today - timedelta(days=max_days * 4)
        d_from = max(d_from, oldest)
        start, _ = local_day_bounds(d_from, tz)
        _, end = local_day_bounds(d_to, tz)
    else:
        key = "today"
        start, end = local_day_bounds(today, tz)
    return key, start, end


DRAGON_WORDS = ("pocket dragons", "pocketdragons", "pocket_dragons", "dragon", "blinky", "hatchery", "hatchling",
                "keeper", "ember chamber", "\U0001F409", "\U0001F432", "\U0001F95A")


def about_dragons(text: str, team_handle: str = "Pocket_Dragons_") -> bool:
    """A post counts as being about Pocket Dragons if it tags the team or uses the project's words."""
    t = (text or "").lower()
    return (f"@{team_handle.lower()}" in t or f"/{team_handle.lower()}/status/" in t
            or any(w in t for w in DRAGON_WORDS))


def create_app(cfg: Config | None = None) -> Flask:
    cfg = cfg or Config()
    app = Flask(__name__)
    app.config["SECRET_KEY"] = cfg.secret_key or secrets.token_hex(32)
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = bool(os.environ.get("RENDER"))   # https only on the live site
    Session = make_session_factory(cfg.database_url)
    tz = ZoneInfo(cfg.timezone)
    app.extensions["radar"] = {"cfg": cfg, "Session": Session}
    from . import scheduler
    scheduler.start(cfg, Session)

    # Every deploy gets its own asset version, so browsers (and the offline cache) can keep
    # static files for a year and still pick up changes the moment a new version ships.
    version = (os.environ.get("RENDER_GIT_COMMIT") or str(int(time.time())))[:8]
    app.extensions["radar"]["version"] = version

    # The community playlist, prepared by audio_prep.py (order, loudness and mix points)
    import json as _json
    _pl = Path(__file__).parent / "static" / "audio" / "playlist.json"
    try:
        raw_pl = _json.loads(_pl.read_text(encoding="utf-8")) if _pl.exists() else []
    except ValueError:
        raw_pl = []
    # one bad entry must never take a page down: only complete songs whose file exists are used
    playlist = [x for x in (raw_pl if isinstance(raw_pl, list) else [])
                if isinstance(x, dict) and all(isinstance(x.get(k), str) and x.get(k) for k in ("src", "title", "by"))
                and (Path(__file__).parent / "static" / x["src"]).exists()
                and isinstance(x.get("mix", 0), (int, float)) and isinstance(x.get("dur", 0), (int, float))]

    def site_songs():
        return [{**s, "src": url_for("static", filename=s["src"], v=version)} for s in playlist]

    from .v21 import TOOLS as V21_TOOLS
    from .dragondle import START as _DLE_START
    DLE_START = _DLE_START.isoformat()

    @app.context_processor
    def _assets():
        return {"asset": lambda filename: url_for("static", filename=filename, v=version), "asset_version": version,
                "site_songs": site_songs,
                "site_credits": [{"track": x["title"], "by": x["by"], "x": x.get("x", "")} for x in playlist],
                "v2": getattr(g, "v2", False), "circle_open": getattr(g, "circle", False), "v2_private": getattr(g, "v2", False) and not cfg.v2_public,
                "v21_open": cfg.v21_public or getattr(g, "circle", False), "v21_tools": V21_TOOLS,
                "dle_start": DLE_START}

    # v2 tools in progress: add {"name", "url", "note"} here as each one is built
    LAB_TOOLS: list[dict] = [
        {"name": "My week card", "url": "/friends#myweek", "note": "Blinky's Friends, side menu or My progress: a card of the Keepers you supported this week, to share on X."},
        {"name": "Collectible dragons", "url": "/friends#dragons", "note": "Blinky's Friends: finish the daily goal to hatch one egg a day into a dragon sticker. Streaks raise the odds of rare and golden ones. Side menu or My progress: My dragons."},
        {"name": "Hatchery numbers", "url": "/#numbers", "note": "Home page, under the tools: how many people have visited pdtools, this week, who came back, and a 14 day chart."},
        {"name": "Weekly top posts designs", "url": "/friends#weekly", "note": "Blinky's Friends, This week's top posts: 7 painted card styles with bigger, easy to read text."},
        {"name": "Secret relics", "url": "/friends#dragons", "note": "My dragons: three sealed relics nobody can see how to earn. They appear on their own when a Keeper earns one."},
        {"name": "Dark mode", "url": "/friends", "note": "Every Blinky's Friends page: the Dark and Light button at the top. Follows the phone's own setting until someone picks."},
    ]

    # ---- v2 preview ------------------------------------------------------------------------------------
    PREVIEW_COOKIE = "pd_v2"

    def preview_token() -> str:
        # tied to the key, so changing PREVIEW_KEY on Render switches every old preview device off
        return hashlib.sha256(f"pdtools-v2:{cfg.preview_key}".encode()).hexdigest()[:40]

    CIRCLE_COOKIE = "pd_circle"

    def circle_token() -> str:
        return hashlib.sha256(f"pdtools-circle:{cfg.preview_key}".encode()).hexdigest()[:40]

    @app.before_request
    def _v2_flag():
        cookie = request.cookies.get(PREVIEW_COOKIE, "")
        g.v2 = cfg.v2_public or bool(cfg.preview_key and cookie and hmac.compare_digest(cookie, preview_token()))
        # Dragon Circle is locked to the devices Jon unlocks one by one from /lab (a preview cookie alone is not enough)
        lock = request.cookies.get(CIRCLE_COOKIE, "")
        g.circle = bool(cfg.preview_key and cookie and hmac.compare_digest(cookie, preview_token())
                        and lock and hmac.compare_digest(lock, circle_token()))

    app.config.setdefault("MAX_CONTENT_LENGTH", 2_000_000)   # no request body on this site is ever near this

    def v2_only(view):
        """Pages and APIs that belong to v2: invisible (404) to anyone without the preview turned on."""
        @wraps(view)
        def inner(*a, **k):
            if not g.get("v2"):
                abort(404)
            return view(*a, **k)
        return inner
    app.extensions["radar"]["v2_only"] = v2_only

    def circle_only(view):
        """Dragon Circle while it is locked: 404 everywhere except the devices Jon unlocked."""
        @wraps(view)
        def inner(*a, **k):
            if not g.get("circle"):
                abort(404)
            return view(*a, **k)
        return inner

    @app.get("/preview/<key>")
    def preview_on(key):
        if key == "off":
            resp = redirect(url_for("hub"))
            resp.delete_cookie(PREVIEW_COOKIE, path="/")
            return resp
        if _too_many("preview:" + client_ip(), limit=20, window=3600) or _too_many("preview:all", limit=200, window=3600):
            abort(429)
        if not cfg.preview_key or not hmac.compare_digest(key.encode(), cfg.preview_key.encode()):
            abort(404)
        resp = redirect(url_for("lab"))
        resp.set_cookie(PREVIEW_COOKIE, preview_token(), max_age=180 * 86400, path="/",
                        secure=request.is_secure or request.headers.get("X-Forwarded-Proto") == "https",
                        httponly=True, samesite="Lax")
        return resp

    # Friendly error pages that match the site (and get translated like every other page).
    # API calls keep plain answers so scripts reading them are not handed a full page.
    def _error_page(code, title, text):
        if request.path.startswith(("/api", "/i18n", "/static")):
            return (title, code)
        try:
            return render_template("error.html", cfg=cfg, err_title=title, err_text=text), code
        except Exception:   # never let the error page itself fail
            return (title, code)

    @app.errorhandler(404)
    def not_found(_e):
        return _error_page(404, "This page wandered off",
                           "The page you were looking for is not here. It may have moved, or the link has a small typo.")

    @app.errorhandler(500)
    def server_error(_e):
        return _error_page(500, "Something went wrong",
                           "Blinky is looking into it. Please try again in a moment.")

    @app.get("/lab")
    @v2_only
    def lab():
        return render_template("lab.html", cfg=cfg, lab_tools=LAB_TOOLS)

    @app.get("/lab/circle/<mode>")
    def circle_lock(mode):
        """Jon turns the locked Dragon Circle on or off for the one device he is holding."""
        if mode not in ("on", "off") or not cfg.preview_key or not hmac.compare_digest(request.cookies.get(PREVIEW_COOKIE, ""), preview_token()):
            abort(404)
        resp = redirect("/welcome" if mode == "on" else url_for("lab"))     # testers start at step 1 of the tester bar
        if mode == "on":
            resp.set_cookie(CIRCLE_COOKIE, circle_token(), max_age=60 * 60 * 24 * 365, secure=request.is_secure, httponly=True, samesite="Lax", path="/")
        else:
            resp.delete_cookie(CIRCLE_COOKIE, path="/")
        return resp

    # ---------- language packs (see i18n_pack.py) ----------
    from .i18n_pack import build as build_packs
    packs = build_packs()

    @app.get("/i18n/<lang>.js")
    def i18n_pack(lang):
        if lang not in packs:
            abort(404)
        resp = Response(packs[lang], mimetype="application/javascript")
        if request.args.get("v") == version:
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp

    @app.after_request
    def _cache_headers(resp):
        # Jon's admin actions, accepted reports and collector runs show on the feed straight away.
        # Only real changes clear it: a stranger posting to these addresses cannot keep emptying the cache.
        if request.method == "POST" and resp.status_code < 400 and (
                (request.path.startswith("/admin") and session.get("admin"))
                or request.path == "/cron/collect" or g.get("feed_changed")):
            clear_feed()
        if request.path.startswith("/static/fonts/") and resp.status_code == 200:   # font files are never changed in place
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif request.path.startswith("/static/") and request.args.get("v") == version and resp.status_code == 200:
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif resp.mimetype == "text/html":
            resp.headers.add("Vary", "Cookie")    # a preview page is never handed to someone else
            if getattr(g, "v2", False) and not cfg.v2_public:
                resp.headers["Cache-Control"] = "private, no-store"
        if cfg.noindex or request.path.startswith(("/preview", "/lab")):
            resp.headers["X-Robots-Tag"] = "noindex, nofollow"
        # Safety headers on every answer: no other site can show pdtools inside a frame (so nobody can trick a
        # click on the admin page), browsers never guess a file type, and links to other sites only share the address
        h = resp.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "SAMEORIGIN")
        h.setdefault("Content-Security-Policy", "frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        if os.environ.get("RENDER"):
            h.setdefault("Strict-Transport-Security", "max-age=31536000")
        if request.path.startswith("/admin"):
            h["Cache-Control"] = "no-store"
        return resp

    # The feed costs several database round trips. Everyone sees the same posts, so the result is kept
    # for FEED_CACHE_S seconds: a busy minute costs the database a couple of reads instead of hundreds.
    feed_cache: dict = {}
    extras_cache: dict = {}
    days_cache: dict = {}

    def clear_feed():
        feed_cache.clear(); extras_cache.clear(); days_cache.clear()

    def feed_query(args):
        # One plain value per filter, used for BOTH the cache key and the query, so a repeated parameter
        # (?after=x&after=) can never store one answer under another request's key.
        quote_vals = args.getlist("quotes") if hasattr(args, "getlist") else [args.get("quotes", "1")]
        args = {k: str(args.get(k) or "")[:40] for k in ("range", "who", "from", "to", "after")}
        args["quotes"] = "0" if quote_vals and quote_vals[-1] == "0" else "1"
        for k in [k for k, v in args.items() if not v]:
            del args[k]
        rkey, rstart, rend = resolve_range(args, tz, utcnow(), cfg.feed_days)
        window = rkey if rkey in ("24h", "today", "yesterday", "7d") else f"{rstart:%Y%m%d%H}-{rend:%Y%m%d%H}"
        try:
            after_key = datetime.strptime(args.get("after", "")[:19], "%Y-%m-%dT%H:%M:%S").isoformat() if args.get("after") else ""
        except ValueError:
            after_key = ""
        ck = f"{window}|{args.get('who', 'all')}|{args['quotes']}|{after_key}|{bool(g.get('v2'))}"
        now_ts = time.time()
        hit = feed_cache.get(ck)
        if hit and now_ts - hit[0] < FEED_CACHE_S:
            items, pinned_items, filters, updated, newcomers = hit[1]
            return [dict(i) for i in items], [dict(i) for i in pinned_items], dict(filters), updated, newcomers
        out = _feed_query(args)
        if len(feed_cache) > 80:                       # room for the 7 day strip's per day answers too
            for k in list(feed_cache)[:40]:            # the oldest half goes, the busy ones stay
                feed_cache.pop(k, None)
        feed_cache[ck] = (now_ts, out)
        items, pinned_items, filters, updated, newcomers = out
        return [dict(i) for i in items], [dict(i) for i in pinned_items], dict(filters), updated, newcomers

    app.feed_cache = feed_cache    # tests and admin actions can empty it

    def feed_where(q, start, end, who, quotes):
        """The feed's filters, shared by the feed itself and the 7 day strip so both always count the same posts."""
        q = (q.where(Post.hidden.is_(False), Post.created_at >= start, Post.created_at < end,
                     Post.author_username.is_not(None), Post.text.is_not(None))
             .where(Post.author_id.not_in(select(BlockedAuthor.author_id)))
             .where(Post.text.not_like("%Book of Friends PD%")))     # signing proof posts stay out of the feed
        if who == "team":
            q = q.where(Post.is_team.is_(True))
        elif who == "community":
            q = q.where(Post.is_team.is_(False))
        elif who == "keepers":
            # Keepers only: the official account and every team member in TEAM_ACCOUNTS left out
            # (for weekly shoutouts that should celebrate the community, not the team)
            crew = [a.split(":", 1)[0].strip().lstrip("@").lower() for a in cfg.team_accounts.split(",") if a.strip()]
            q = q.where(Post.is_team.is_(False), func.lower(Post.author_username).not_in(crew or [""]))
        else:
            who = "all"
        if not quotes:
            q = q.where(Post.is_quote.is_(False))
        return q, who

    def feed_extras():
        """The parts of the feed that are the same for every filter: the pinned team posts, the last collector run,
        the welcome row (a heavy look over every post) and the team spotlight. Worked out once a minute, not per request."""
        hit = extras_cache.get("x")
        if hit and time.time() - hit[0] < EXTRAS_CACHE_S:
            return hit[1]
        with Session() as s:
            pinned = s.scalars(select(Post).where(Post.is_team.is_(True), Post.hidden.is_(False),
                                                  Post.text.is_not(None), Post.author_username.is_not(None))
                               .order_by(Post.created_at.desc()).limit(PINNED)).all()
            last_run = s.scalar(select(CollectorRun).where(CollectorRun.status.in_(["ok", "page_limit"]))
                                .order_by(CollectorRun.started_at.desc()).limit(1))
            # Welcome row: people whose very first post on the radar landed in the last 7 days
            first = (select(Post.author_id, func.min(Post.created_at).label("first"))
                     .where(Post.hidden.is_(False)).group_by(Post.author_id).subquery())
            fresh = s.scalars(select(Post).join(first, (Post.author_id == first.c.author_id) & (Post.created_at == first.c.first))
                              .where(first.c.first >= utcnow() - timedelta(days=7), Post.is_team.is_(False),
                                     Post.text.is_not(None), Post.author_username.is_not(None),
                                     Post.author_id.not_in(select(BlockedAuthor.author_id)))
                              .order_by(Post.created_at.desc()).limit(NEWCOMERS)).all()
            # Team spotlight: the newest dragon post from each team member, newest first. A new post replaces
            # the old one in that member's slot; a slot older than crew_hours steps aside.
            crew_posts = []
            crew = cfg.crew
            if crew:
                roles = {h.lower(): r for h, r in crew}
                rows = s.scalars(select(Post).where(func.lower(Post.author_username).in_(list(roles)),
                                                    Post.hidden.is_(False), Post.text.is_not(None),
                                                    Post.created_at >= utcnow() - timedelta(hours=cfg.crew_hours))
                                 .order_by(Post.created_at.desc())).all()
                seen = set()
                for p in rows:
                    k = p.author_username.lower()
                    if k not in seen:
                        seen.add(k)
                        crew_posts.append((p, roles[k]))
            s.expunge_all()
        out = (pinned, last_run, fresh, crew_posts)
        extras_cache["x"] = (time.time(), out)
        return out

    app.extras_cache = extras_cache

    def _feed_query(args):
        key, start, end = resolve_range(args, tz, utcnow(), cfg.feed_days)
        who = args.get("who", "all")
        # The form sends a hidden "0" then the checkbox "1"; the last value wins
        quote_vals = args.getlist("quotes") if hasattr(args, "getlist") else [args.get("quotes", "1")]
        quotes = (quote_vals[-1] if quote_vals else "1") != "0"
        q, who = feed_where(select(Post), start, end, who, quotes)
        after = args.get("after")
        if after:   # the "new posts" check only asks for what arrived since the newest post on screen
            try:
                q = q.where(Post.created_at > datetime.strptime(after[:19], "%Y-%m-%dT%H:%M:%S"))
            except ValueError:
                pass
        q = q.order_by(Post.created_at.desc()).limit(FEED_LIMIT)
        with Session() as s:
            posts = s.scalars(q).all()
        pinned, last_run, fresh, crew_posts = feed_extras()
        if after:
            fresh = []
        def item(p):
            return {"id": p.id, "t": p.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "team": p.is_team, "quote": p.is_quote, "text": p.text, "name": p.author_name or p.author_username,
                  "user": p.author_username, "avatar": p.author_avatar, "media": p.has_media,
                    "opens": p.opens or 0}
        items = [item(p) for p in posts]
        pinned_items = [item(p) for p in pinned]
        if g.get("v2"):
            tags = book_tags()
            for it in items + pinned_items:
                t = tags.get((it.get("user") or "").lower())
                if t:
                    it["tier"] = t
        pinned_ids = {p["id"] for p in pinned_items}
        pinned_items += [{**item(p), "crew": role} for p, role in crew_posts if p.id not in pinned_ids]
        newcomers = [{"id": p.id, "t": p.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"), "name": p.author_name or p.author_username,
                      "user": p.author_username, "avatar": p.author_avatar,
                      "hatchery": "ancient hatchery" in (p.text or "").lower()} for p in fresh]
        filters = {"range": key, "who": who, "quotes": "1" if quotes else "0",
                   "from": args.get("from", ""), "to": args.get("to", "")}
        updated = last_run.finished_at.strftime("%Y-%m-%dT%H:%M:%SZ") if last_run and last_run.finished_at else None
        return items, pinned_items, filters, updated, newcomers

    # Old addresses (the onrender.com host, the pre-pdtools paths) land on the new ones.
    # Cron, API and health checks are left alone so schedulers keep working on any host.
    @app.before_request
    def canonical():
        host = (request.host or "").split(":")[0].lower()
        p = request.path
        if not cfg.canonical_host or host == cfg.canonical_host or host in ("localhost", "127.0.0.1"):
            return None
        if p.startswith("/api") and request.method == "POST":
            abort(403)                              # visitors only ever post through the real address
        if p.startswith(("/cron", "/api", "/healthz", "/admin", "/static")):
            return None
        target = {"/": "/friends", "/keepers": "/friends/keepers"}.get(p, p)
        qs = request.query_string.decode()
        return redirect(f"https://{cfg.canonical_host}{target}" + (f"?{qs}" if qs else ""), code=301)

    # v2: the community numbers on the home page, worked out at most every 5 minutes
    stats_cache: dict = {"at": 0.0, "data": None}

    def public_stats():
        if time.time() - stats_cache["at"] > 300 or stats_cache["data"] is None:
            from .visits import public_summary
            try:
                with Session() as s:
                    stats_cache["data"] = public_summary(s, datetime.now(tz).date())
            except Exception:  # the home page never breaks over the numbers
                app.logger.exception("public stats failed")
                return stats_cache["data"]
            stats_cache["at"] = time.time()
        return stats_cache["data"]

    @app.get("/")
    def hub():
        from .config import COMMUNITY_MUSIC
        on_site = {x["title"] for x in playlist}
        makers = [{**m, "playing": any(t in on_site for t in m["songs"]), "on_site": [t for t in m["songs"] if t in on_site]}
                  for m in COMMUNITY_MUSIC]
        from .ama import AMAS
        return render_template("hub.html", cfg=cfg, stats=public_stats() if g.get("v2") else None, music_makers=makers,
                               ama_count=len(AMAS), news=[n for n in NEWS if g.get("circle") or n.get("href") != "/circle"][:3])

    @app.get("/keepers")
    def keepers_old():
        return redirect(url_for("keepers_page"), code=301)

    def week_card_open(now: "datetime | None" = None) -> bool:
        """My week card is a Friday treat: open from Friday 00:00 UTC until Saturday 00:00 UTC."""
        now = now or datetime.now(timezone.utc)
        return cfg.myweek_always or now.astimezone(timezone.utc).weekday() == 4
    app.week_card_open = week_card_open

    @app.get("/friends")
    def feed():
        items, pinned_items, filters, updated, newcomers = feed_query(request.args)
        return render_template("feed.html", cfg=cfg, items=items, pinned=pinned_items, filters=filters, updated=updated,
                               newcomers=newcomers, wk_open=week_card_open(),
                               now_ms=int(datetime.now(timezone.utc).timestamp() * 1000))

    @app.get("/api/posts")
    def api_posts():
        items, pinned_items, filters, updated, newcomers = feed_query(request.args)
        return jsonify({"posts": items, "pinned": pinned_items, "filters": filters, "updated": updated, "newcomers": newcomers})

    app.days_cache = days_cache

    @app.get("/api/days")
    def api_days():
        """The post ids of each of the last 7 days (site time zone), newest day first, for the "catch up by day"
        strip. The page compares them with the posts this browser already opened, so nothing about the
        visitor is sent here. One light query covers the week, and each day keeps its own cap, so one busy day can never hide another."""
        who = request.args.get("who", "all")
        who = who if who in ("all", "team", "community", "keepers") else "all"
        quotes = "0" if request.args.get("quotes") == "0" else "1"
        today = datetime.now(timezone.utc).astimezone(tz).date()
        ck = f"{today}|{who}|{quotes}|{bool(g.get('v2'))}"
        hit = days_cache.get(ck)
        if hit and time.time() - hit[0] < DAYS_CACHE_S:
            return jsonify(hit[1])
        # one light query for the whole week (ids and times only), split into days here
        start, _ = local_day_bounds(today - timedelta(days=DAY_STRIP - 1), tz)
        _, end = local_day_bounds(today, tz)
        q, _ = feed_where(select(Post.id, Post.created_at), start, end, who, quotes == "1")
        with Session() as s:
            rows = s.execute(q.order_by(Post.created_at.desc())).all()
        by_day: dict[str, list[str]] = {}
        for pid, at in rows:
            d = at.replace(tzinfo=timezone.utc).astimezone(tz).date().isoformat()
            ids = by_day.setdefault(d, [])
            if len(ids) < FEED_LIMIT:              # the same cap the feed uses for one day
                ids.append(pid)
        days = [{"day": (today - timedelta(days=k)).isoformat(), "ids": by_day.get((today - timedelta(days=k)).isoformat(), [])}
                for k in range(DAY_STRIP)]
        out = {"today": today.isoformat(), "days": days}
        if len(days_cache) > 20:
            days_cache.clear()
        days_cache[ck] = (time.time(), out)
        return jsonify(out)

    # ---------- request helpers ----------
    def client_ip() -> str:
        """The visitor's address. Cloudflare (in front of Render) sets CF-Connecting-IP itself and overwrites any
        value a browser sends, so it cannot be faked. X-Forwarded-For is only a fallback for other hosts."""
        h = request.headers
        v = (h.get("CF-Connecting-IP") or "").strip()
        if v:
            return v[:64]
        return ((h.get("X-Forwarded-For") or request.remote_addr or "?").split(",")[0]).strip()[:64]

    def conn_hash() -> str:
        """A salted hash of the connection, for counting different connections without storing an address."""
        return hashlib.sha256((app.config["SECRET_KEY"] + "|" + client_ip()).encode()).hexdigest()[:24]

    def _no_const(_):
        raise ValueError("not a number")

    def _body(limit: int = 1000) -> dict:
        """A small JSON object from the request. Bad JSON raises ValueError; anything that is not an object
        (a list, a number) or holds NaN or Infinity comes back as an empty dict, so .get never crashes."""
        import json
        try:
            data = json.loads(request.get_data(as_text=True)[:limit] or "{}", parse_constant=_no_const)
        except ValueError:
            raise
        return data if isinstance(data, dict) else {}

    # Visitor counter: one beacon per page view from the browser (bots that do not run scripts never send it).
    # Jon's own preview devices are left out so his testing does not inflate the numbers.
    last_hit: dict[str, float] = {}

    @app.post("/api/hit")
    def api_hit():
        import json
        from .visits import record
        if g.get("v2") and not cfg.v2_public:
            return {"counted": False}
        try:
            data = _body(2000)
        except ValueError:
            return {"counted": False}, 400
        vid, path = str(data.get("vid", ""))[:32], str(data.get("path", ""))[:60]
        now_ts = time.time()
        if now_ts - last_hit.get(vid + path, 0) < 3:
            return {"counted": False}
        if len(last_hit) > 50000:
            last_hit.clear()
        last_hit[vid + path] = now_ts
        today = datetime.now(tz).date()
        with Session() as s:
            ok = record(s, vid, path, str(data.get("ref", ""))[:300], request.headers.get("User-Agent", ""), today,
                        cfg.canonical_host or (request.host or "").split(":")[0])
            if ok:
                try:
                    s.commit()
                except IntegrityError:              # two tabs at the same moment: the other one counted it
                    s.rollback()
                    ok = False
        return {"counted": ok}

    # Anonymous open counter. Nothing about the visitor is stored. The browser only
    # sends this the first time it opens a post, and the same address can bump
    # a post once a day, so refreshing or scripting the button barely moves it.
    seen_opens: dict[tuple[str, str], tuple[float, set]] = {}

    @app.post("/api/open/<post_id>")
    def api_open(post_id):
        """The public open count on a post. Each browser counts once a day; people sharing one connection
        (home Wi-Fi, a phone network) each count, up to 5 per connection per post, so a script cannot pump it."""
        import json
        if not post_id.isdigit() or len(post_id) > 32:
            abort(400)
        ip = client_ip()
        try:
            vid = str(_body(500).get("vid", ""))[:32]
        except (ValueError, AttributeError):
            vid = ""
        now_ts = datetime.now().timestamp()
        from .events import VID as _VID
        who = vid if _VID.match(vid or "") else "no-storage"   # private mode: one count per connection
        key = (ip, post_id)
        with Session() as s:
            post = s.get(Post, post_id)
            if post is None or post.hidden:
                return {"counted": False}            # unknown posts never take room in the memory below
            seen = seen_opens.get(key)
            if seen is None or now_ts - seen[0] > 86400:
                seen = (now_ts, set())
            bump = who not in seen[1] and len(seen[1]) < OPENS_PER_CONNECTION
            if bump:
                seen[1].add(who)
            if len(seen_opens) > 50000:
                for k in list(seen_opens)[:10000]:     # forget the oldest, never everything at once
                    seen_opens.pop(k, None)
            seen_opens[key] = seen
            if bump:
                s.execute(update(Post).where(Post.id == post_id).values(opens=func.coalesce(Post.opens, 0) + 1))
            full = habit(s, post_id) == "full"      # the weekly numbers count each browser, whatever the connection
            s.commit()
            out = {"counted": bump}
            if bump:
                out["opens"] = s.scalar(select(Post.opens).where(Post.id == post_id))
            if full:
                out["full"] = True                  # today's counted opens are used up: the page says so kindly
            return out

    habit_last: dict[str, float] = {}
    habit_conn: dict[tuple, int] = {}

    def habit(s, post_id: str) -> str:
        """Remember that this browser opened this post today (for the weekly habit number).
        Returns "full" when this browser has used up today's counted opens, otherwise ""."""
        import json
        from .events import record
        preview = bool(g.get("v2") and not cfg.v2_public)   # preview devices: counted for the book only, never in the admin numbers
        try:
            vid = str(_body(500).get("vid", ""))[:32]
        except (ValueError, AttributeError):
            return ""
        today = datetime.now(tz).date()
        from .db import Event
        from .events import VID as VID_RE
        now_ts = time.time()
        if not VID_RE.match(vid) or now_ts - habit_last.get(vid, 0) < HABIT_GAP_S:
            return ""                               # faster than a person can open a post and read it
        if len(habit_last) > 50000:
            for k in list(habit_last)[:10000]:
                habit_last.pop(k, None)
        habit_last[vid] = now_ts
        day_key = (client_ip(), str(today))
        if habit_conn.get(day_key, 0) >= HABIT_PER_CONNECTION:
            return ""
        if len(habit_conn) > 50000:
            habit_conn.clear()
        habit_conn[day_key] = habit_conn.get(day_key, 0) + 1
        if VID_RE.match(vid) and (s.scalar(select(func.count()).select_from(Event).where(
                Event.day == today, Event.vid == vid, Event.kind.in_(("open", "popen")))) or 0) >= OPENS_PER_DAY:
            # an open already counted today is not news; a new one past the limit gets a friendly note
            return "" if s.get(Event, (today, vid, "popen" if preview else "open", post_id)) else "full"
        record(s, today, vid, "popen" if preview else "open", post_id)
        return ""

    # ---------- Blinky's Book of Friends (v2) ----------
    book_cache: dict = {"at": 0.0, "data": None, "tags": {}}

    def book_data():
        from .book import public_book
        if time.time() - book_cache["at"] > 300 or book_cache["data"] is None:
            with Session() as s:
                data = public_book(s, datetime.now(tz).date())
            book_cache.update(at=time.time(), data=data,
                              tags={f["handle"].lower(): f["tier"] for f in data["friends"] if f["tier"]})
        return book_cache["data"]

    def book_tags() -> dict:
        try:
            book_data()
        except Exception:                           # the feed must never fail because of the book
            return {}
        return book_cache["tags"]

    book_hits: dict[str, list[float]] = {}

    def book_limit() -> bool:
        ip = client_ip()
        now_ts = time.time()
        recent = [t for t in book_hits.get(ip, []) if now_ts - t < 3600]
        if len(book_hits) > 50000:
            book_hits.clear()
        book_hits[ip] = recent + [now_ts]
        return len(recent) >= 30

    def json_body() -> dict:
        import json
        try:
            data = _body(1000)
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    @app.get("/api/book")
    @v2_only
    def api_book():
        return jsonify(book_data())

    @app.get("/api/book/me")
    @v2_only
    def api_book_me():
        from .book import me
        vid = request.args.get("vid", "")[:32]
        with Session() as s:
            today = datetime.now(tz).date()
            data = me(s, vid, today)
            if data.get("status") == "confirmed":
                from .db import Event
                used = s.scalar(select(func.count()).select_from(Event).where(
                    Event.day == today, Event.vid == vid, Event.kind.in_(("open", "popen")))) or 0
                data["full"] = used >= OPENS_PER_DAY      # today's counted opens used up on this device
            return jsonify(data)

    @app.post("/api/book/sign")
    @v2_only
    def api_book_sign():
        from .book import sign
        if book_limit():
            return {"ok": False, "why": "limit"}, 429
        data = json_body()
        with Session() as s:
            out = sign(s, str(data.get("vid", ""))[:32], str(data.get("handle", ""))[:60])
            s.commit()
        return out

    @app.post("/api/book/check")
    @v2_only
    def api_book_check():
        from .book import check
        from .oembed import fetch
        if book_limit():
            return {"ok": False, "why": "limit"}, 429
        data = json_body()
        vid, link = str(data.get("vid", ""))[:32], str(data.get("link", ""))[:300]
        from .book import LINK
        from .db import FriendDevice
        with Session() as s:
            dev = s.get(FriendDevice, vid) if vid else None
            ready = dev is not None and not dev.confirmed
        found: dict = {}
        m = LINK.search(link)
        if ready and m:                             # X is asked only for a real waiting signature, outside the database
            found[m.group(2)] = fetch(m.group(2))
        with Session() as s:
            out = check(s, vid, link, lambda pid: found[pid] if pid in found else fetch(pid))
            s.commit()
        if out.get("ok"):
            book_cache["at"] = 0                    # show the new name right away
        return out

    # ---------- a signed Keeper's own dragon book page: pdtools.xyz/k/<name> ----------
    # The book lives on the Keeper's device. When they save or share it, the picture and its counts are sent here,
    # so the link they post shows their book to anyone who taps it, with a button to start their own.
    page_writes: dict[str, float] = {}
    BOOK_IMG_MAX = 450_000

    def _count(v, top: int) -> int:
        try:
            n = int(v)
        except (TypeError, ValueError):
            return 0
        return max(0, min(top, n))

    def _jpeg_size(b: bytes) -> tuple[int, int]:
        """Width and height from a JPEG's frame header, or (0, 0) when it is not a readable JPEG."""
        i = 2
        while i + 9 < len(b):
            if b[i] != 0xFF:
                return 0, 0
            m = b[i + 1]
            if m in (0xC0, 0xC1, 0xC2):
                return int.from_bytes(b[i + 7:i + 9], "big"), int.from_bytes(b[i + 5:i + 7], "big")
            i += 2 + int.from_bytes(b[i + 2:i + 4], "big")
        return 0, 0

    page_ips: dict[str, list[float]] = {}

    @app.post("/api/book/page")
    @v2_only
    def api_book_page():
        import base64
        from .db import BookPage, Friend, FriendDevice
        if (request.content_length or 0) > BOOK_IMG_MAX * 4 // 3 + 2000:
            return {"ok": False, "why": "big"}, 413
        ip, now_ip = client_ip(), time.time()
        recent = [t for t in page_ips.get(ip, []) if now_ip - t < 3600]
        if len(page_ips) > 20000:
            page_ips.clear()
        page_ips[ip] = recent + [now_ip]
        if len(recent) >= 40:
            return {"ok": False, "why": "limit"}, 429
        try:
            data = _body(BOOK_IMG_MAX * 4 // 3 + 2000)
        except ValueError:
            return {"ok": False, "why": "bad"}, 400
        vid = str(data.get("vid", ""))[:32]
        with Session() as s:
            dev = s.get(FriendDevice, vid) if vid else None
            friend = s.get(Friend, dev.key) if dev is not None and dev.confirmed else None
            if friend is None:
                return {"ok": False, "why": "unsigned"}, 403
            now_ts = time.time()
            if now_ts - page_writes.get(friend.key, 0) < 20:          # one picture every 20 seconds is plenty
                return {"ok": True, "url": f"https://pdtools.xyz/k/{friend.username}", "same": True}
            raw = str(data.get("img", ""))
            if raw.startswith("data:image/jpeg;base64,"):
                raw = raw.split(",", 1)[1]
            try:
                img = base64.b64decode(raw, validate=True) if raw else b""
            except ValueError:
                return {"ok": False, "why": "bad"}, 400
            # only the book picture the site draws (1200 by 675) is kept, never any other image
            if not img.startswith(b"\xff\xd8\xff") or len(img) > BOOK_IMG_MAX or _jpeg_size(img) != (1200, 675):
                return {"ok": False, "why": "bad"}, 400
            if len(page_writes) > 20000:
                page_writes.clear()
            page_writes[friend.key] = now_ts
            row = s.get(BookPage, friend.key) or BookPage(key=friend.key)
            row.username = friend.username
            row.found, row.rare, row.legend = _count(data.get("found"), 35), _count(data.get("rare"), 15), _count(data.get("legend"), 5)
            row.relics, row.streak = _count(data.get("relics"), 3), _count(data.get("streak"), 9999)
            row.image, row.updated_at = img, utcnow()
            s.merge(row)
            s.commit()
            return {"ok": True, "url": f"https://pdtools.xyz/k/{friend.username}"}

    def _book_row(name: str):
        from .db import BookPage, Friend
        key = (name or "").lstrip("@").lower()[:32]
        if not key.replace("_", "").isalnum():
            return None, None
        with Session() as s:
            return s.get(Friend, key), s.get(BookPage, key)

    @app.get("/k/<name>")
    @v2_only
    def keeper_book(name):
        friend, page = _book_row(name)
        if friend is None:
            abort(404)
        stamp = int(page.updated_at.timestamp()) if page is not None and page.image else 0
        img = f"https://pdtools.xyz/k/{friend.username}/book.jpg?v={stamp}" if stamp else None
        return render_template("keeperbook.html", cfg=cfg, friend=friend, page=page,
                               img=f"/k/{friend.username}/book.jpg?v={stamp}" if stamp else None,
                               og_title=f"@{friend.username}'s dragon book on PD Tools",
                               og_desc=(f"{page.found} of 35 dragons found by cheering on fellow Pocket Dragons Keepers. "
                                        "Start your own book, free." if page else
                                        "A Keeper in Blinky's Book of Friends. Start your own dragon book, free."),
                               og_img=img)

    @app.get("/k/<name>/book.jpg")
    @v2_only
    def keeper_book_img(name):
        friend, page = _book_row(name)
        if page is None or not page.image:
            abort(404)
        r = app.response_class(page.image, mimetype="image/jpeg")
        r.headers["Cache-Control"] = "public, max-age=300"
        return r

    # ---------- Discord daily drop (off until DROP_CHANNEL_ID is set on Render) ----------
    @app.post("/cron/discord-drop")
    def cron_discord_drop():
        from .discord_drop import run_drop
        with Session() as s:
            out = run_drop(s, cfg, datetime.now(tz))
            s.commit()
        return out

    # Anonymous moments: daily goal finished, a card shared or saved, the app installed.
    ev_seen: dict[str, list[float]] = {}
    pruned: dict = {"day": None}

    @app.post("/api/ev")
    def api_ev():
        import json
        from .events import prune, record
        if g.get("v2") and not cfg.v2_public:
            return {"counted": False}
        try:
            data = _body(500)
        except ValueError:
            return {"counted": False}, 400
        vid = str(data.get("vid", ""))[:32]
        kind = str(data.get("kind", ""))[:12]
        if kind in ("open", "popen"):               # opens only count through /api/open (with its daily cap)
            return {"counted": False}
        now_ts = time.time()
        recent = [t for t in ev_seen.get(vid, []) if now_ts - t < 3600]
        if len(recent) >= 120:                      # a person never does this many things in an hour
            return {"counted": False}
        if len(ev_seen) > 50000:
            ev_seen.clear()
        ev_seen[vid] = recent + [now_ts]
        today = datetime.now(tz).date()
        with Session() as s:
            ok = record(s, today, vid, kind, str(data.get("ref", ""))[:32])
            if pruned["day"] != today:
                prune(s, today)
                pruned["day"] = today
            s.commit()
        return {"counted": ok}

    # Visitor reports: a quiet flag on each card. Enough returning visitors hide a post until Jon looks.
    report_ips: dict[str, list[float]] = {}

    @app.post("/api/report")
    def api_report():
        import json
        from .events import add_report
        try:
            data = _body(500)
        except ValueError:
            return {"ok": False}, 400
        ip = client_ip()
        now_ts = time.time()
        recent = [t for t in report_ips.get(ip, []) if now_ts - t < 86400]
        if len(recent) >= 20:
            return {"ok": False, "why": "limit"}
        if len(report_ips) > 50000:
            report_ips.clear()
        report_ips[ip] = recent + [now_ts]
        with Session() as s:
            res = add_report(s, str(data.get("post", ""))[:32], str(data.get("vid", ""))[:32],
                             str(data.get("reason", ""))[:12], datetime.now(tz).date(),
                             conn=conn_hash())
            s.commit()
        if res == "ok":
            g.feed_changed = True
        return {"ok": res in ("ok", "dup"), "why": res}

    # Keeper card lookup. Uses only posts already in our database, so it costs nothing on X.
    @app.get("/api/keeper/<handle>")
    def api_keeper(handle):
        """Looks the person up on X: their profile plus their own posts about Pocket Dragons
        from the last 7 days (X's recent search window). Cached per handle and capped per day."""
        import json
        if not cfg.keeper_card_open:
            return {"found": False, "locked": True}, 403
        handle = handle.strip().lstrip("@")
        if not handle or len(handle) > 15 or not all(c.isalnum() or c == "_" for c in handle):
            return {"found": False}
        key, now = f"keeper:{handle.lower()}", utcnow()
        with Session() as s:
            cached = get_setting(s, key)
        if not cached and _too_many("kc:" + client_ip(), limit=20):
            return {"found": False, "handle": handle, "note": "That is a lot of lookups. Try again in a little while."}
        if cached:
            data = json.loads(cached)
            if now - datetime.fromisoformat(data["at"]) < timedelta(hours=cfg.keeper_cache_hours):
                return data["card"]

        def from_radar(note):
            # Fallback when X can't be asked: whatever the radar already saw
            with Session() as s:
                rows = s.scalars(select(Post).where(func.lower(Post.author_username) == handle.lower(),
                                                    Post.hidden.is_(False)).order_by(Post.created_at.desc())).all()
            if not rows:
                return {"found": False, "handle": handle, "note": note}
            p0 = rows[0]
            return {"found": True, "handle": p0.author_username, "name": p0.author_name or p0.author_username,
                    "avatar": f"/api/avatar/{p0.author_username}" if p0.author_avatar else None,
                    "posts_week": str(sum(1 for p in rows if p.created_at >= now - timedelta(days=7))),
                    "love": None, "note": note}

        if not cfg.x_bearer_token:
            return from_radar("Live lookup is off right now.")
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        worst = cfg.cost_per_user_usd + cfg.keeper_max_posts * cfg.cost_per_post_usd
        with Session() as s:
            spent_today = s.scalar(select(func.coalesce(func.sum(CollectorRun.est_cost_usd), 0.0))
                                   .where(CollectorRun.status == "keeper_lookup", CollectorRun.started_at >= day_start)) or 0
            spent_month = month_spend(s, now)
        if spent_today + worst > cfg.keeper_daily_budget_usd or spent_month + worst > cfg.monthly_spend_limit_usd:
            return from_radar("Blinky is resting. Live lookups are full for today, try again tomorrow.")

        from .xapi import XClient, XApiError
        client = XClient(cfg.x_bearer_token)
        run = CollectorRun(started_at=now, status="keeper_lookup")
        try:
            profile = client.user_profile(handle)
            run.users_returned, run.est_cost_usd = 1, cfg.cost_per_user_usd
            if not profile:
                card = {"found": False, "handle": handle, "note": f"@{handle} does not seem to exist on X."}
            else:
                # Read all of their own posts from the last 7 days, then keep the ones about the
                # dragons. Matching here (not in X's search) catches "dragons", Blinky, the Hatchery
                # and so on, not only posts that spell out the project name.
                q = f'from:{profile["username"]} -is:retweet -is:reply'
                data = client.search_recent(q, start_time=(now - timedelta(days=6, hours=23)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                            max_results=max(10, cfg.keeper_max_posts))
                read_posts = (data.get("data") or [])[:cfg.keeper_max_posts]
                run.posts_returned = len(read_posts)
                run.est_cost_usd += len(read_posts) * cfg.cost_per_post_usd
                more = bool((data.get("meta") or {}).get("next_token"))
                def post_text(p):
                    # Include link targets so quote posts of the team's posts count too
                    urls = " ".join(u.get("expanded_url", "") for u in ((p.get("entities") or {}).get("urls") or []))
                    return f'{p.get("text", "")} {urls}'
                posts = [p for p in read_posts if about_dragons(post_text(p), cfg.team_handle)]
                love = sum(sum((p.get("public_metrics") or {}).get(k, 0) for k in
                               ("like_count", "reply_count", "retweet_count", "quote_count")) for p in posts)
                latest = max((p.get("created_at", "") for p in posts), default="")
                with Session() as s2:
                    note_user(s2, profile, "card", about_dragons=bool(posts),
                              post_time=datetime.strptime(latest[:19], "%Y-%m-%dT%H:%M:%S") if latest else None, now=now)
                    s2.commit()
                avatar = (profile.get("profile_image_url") or "").replace("_normal.", "_bigger.")
                card = {"found": True, "handle": profile["username"], "name": profile.get("name") or profile["username"],
                        "avatar": f"/api/avatar/{profile['username']}" if avatar else None,
                        "avatar_url": avatar, "posts_week": f"{len(posts)}{'+' if more else ''}", "love": love,
                        "posts_read": len(read_posts)}
            run.finished_at = utcnow()
            with Session() as s:
                s.add(run)
                set_setting(s, key, json.dumps({"at": now.isoformat(), "card": card}))
                s.commit()
            return card
        except XApiError:
            return from_radar("X did not answer just now, showing what the radar has seen.")

    # Avatars are fetched through the site so the card image can be saved (browsers block
    # saving a canvas that drew an image from another site). Only X's image host is allowed.
    avatar_cache: dict[str, tuple[float, bytes, str]] = {}

    avatar_miss: dict[str, float] = {}       # handles with no working picture right now, so we do not ask again for 15 minutes
    avatar_fx_tried: dict[str, float] = {}   # handles we looked up fresh on FxTwitter in the last 6 hours

    avatar_big: dict[str, tuple[float, bytes, str]] = {}

    def avatar_bytes(handle, big=False):
        """A Keeper's X picture (bytes, type), fetched from X's image host only and kept for a day, or None.
        X gives every new profile picture a new address and the old one stops working, so this tries every
        address we know (newest first) and, when all of them are dead, looks the Keeper up once on FxTwitter
        and saves the new address everywhere, so the feed and the Keepers page heal too."""
        import json
        import requests
        key = handle.lower()
        now_ts = datetime.now().timestamp()
        if big:
            # the sharp 400 by 400 picture for share cards and the canvas; the feed keeps the light small one
            hb = avatar_big.get(key)
            if hb and now_ts - hb[0] < 86400:
                return hb[1], hb[2]
            small = avatar_bytes(handle)
            if not small:
                return None
            src = (avatar_cache.get(key) or (0, b"", "", ""))[3]
            got = None
            if src and src.startswith("https://pbs.twimg.com/"):
                import re
                import requests
                url = re.sub(r"_(normal|bigger|mini)(\.[a-z]+)$", r"_400x400\2", src)
                if url != src:
                    try:
                        r = requests.get(url, timeout=8, allow_redirects=False)
                        ctype = r.headers.get("Content-Type", "image/jpeg").split(";")[0].strip().lower()
                        if r.status_code == 200 and len(r.content) <= 500_000 and ctype in ("image/jpeg", "image/png", "image/webp"):
                            got = (r.content, ctype)
                    except requests.RequestException:
                        got = None
            got = got or small
            if len(avatar_big) > 1000:
                avatar_big.clear()
            avatar_big[key] = (now_ts, got[0], got[1])
            return got
        hit = avatar_cache.get(key)
        if hit and now_ts - hit[0] < 86400:
            return hit[1], hit[2]
        if now_ts - avatar_miss.get(key, 0) < 900:
            return None
        urls = []
        with Session() as s:
            c = s.get(AuthorCheck, key)
            if c and c.avatar:
                urls.append(c.avatar)
            urls += list(s.scalars(select(Post.author_avatar).where(func.lower(Post.author_username) == key, Post.author_avatar.is_not(None))
                                   .group_by(Post.author_avatar).order_by(func.max(Post.collected_at).desc()).limit(4)))
            kp = s.get(Keeper, key)
            if kp and kp.avatar:
                urls.append(kp.avatar)
            team = get_setting(s, "team_profiles")
            cached = get_setting(s, f"keeper:{key}")
        if team:
            urls.append(next((t.get("avatar") for t in json.loads(team) if t["username"].lower() == key), None))
        if cached:
            urls.append((json.loads(cached).get("card") or {}).get("avatar_url"))

        def grab(url):
            if not url or not url.startswith("https://pbs.twimg.com/"):
                return None
            try:
                r = requests.get(url, timeout=8, allow_redirects=False)   # X's image host only, never a hop elsewhere
            except requests.RequestException:
                return None
            if r.status_code != 200 or len(r.content) > 500_000:
                return None
            ctype = r.headers.get("Content-Type", "image/jpeg").split(";")[0].strip().lower()
            return (r.content, ctype, url) if ctype in ("image/jpeg", "image/png", "image/webp", "image/gif") else None

        got, seen = None, set()
        for u in urls:
            if u and u not in seen:
                seen.add(u)
                got = grab(u)
                if got:
                    break
        if not got and now_ts - avatar_fx_tried.get(key, 0) > 6 * 3600 and not (has_request_context() and _too_many("avfx:" + client_ip(), limit=30, window=3600)):
            if len(avatar_fx_tried) > 5000:
                avatar_fx_tried.clear()
            avatar_fx_tried[key] = now_ts
            from .fxpic import profile as fx_profile
            fx = {}
            for attempt in range(3):            # FxTwitter now and then answers "not found" for a real account; ask again
                fx = fx_profile(handle, fx_http) or {}
                if fx.get("profile_image_url"):
                    break
                time.sleep(0.5)
            if not fx.get("profile_image_url"):
                avatar_fx_tried[key] = now_ts - 6 * 3600 + 900    # try the lookup again in 15 minutes
            fresh = fx.get("profile_image_url") or ""
            if fresh and fresh not in seen:
                got = grab(fresh)
                if got:
                    with Session() as s:           # save the new address so every page shows it from now on
                        for p in s.scalars(select(Post).where(func.lower(Post.author_username) == key)):
                            p.author_avatar = fresh
                        kp = s.get(Keeper, key)
                        if kp is not None:
                            kp.avatar = fresh
                        c = s.get(AuthorCheck, key)
                        if c is not None:
                            c.avatar = fresh
                        s.commit()
                    clear_feed()
        if not got:
            avatar_miss[key] = now_ts
            if len(avatar_miss) > 5000:
                avatar_miss.clear()
            return None
        if len(avatar_cache) > 2000:
            avatar_cache.clear()
        avatar_cache[key] = (now_ts, got[0], got[1], got[2])
        return got[0], got[1]

    @app.get("/api/avatar/<handle>")
    def api_avatar(handle):
        if not re.fullmatch(r"[A-Za-z0-9_]{1,15}", handle or ""):   # only real X handles are looked up
            abort(404)
        got = avatar_bytes(handle, big=request.args.get("s") == "big")
        if not got:
            abort(404)
        return got[0], 200, {"Content-Type": got[1], "Cache-Control": "public, max-age=86400"}

    # ---------- Dragon Circle: the Keepers someone tags and is tagged by most, from dragon posts only ----------
    circle_cache: dict[str, tuple[float, dict]] = {}
    circle_png: dict[str, tuple[float, bytes]] = {}
    circle_hits: dict[str, list[float]] = {}
    CIRCLE_CACHE_S, CIRCLE_PNG_S = 600, 6 * 3600

    def circle_data(handle):
        from .circle import build, clean
        h = clean(handle)
        if not h:
            return {"ok": False, "message": "That does not look like an X handle."}
        hit = circle_cache.get(h.lower())
        if hit and time.time() - hit[0] < CIRCLE_CACHE_S:
            return hit[1]
        with Session() as s:
            data = build(s, cfg, h)
        if len(circle_cache) > 500:
            circle_cache.clear()
        circle_cache[h.lower()] = (time.time(), data)
        return data

    def circle_stamp(data):
        import hashlib
        raw = "|".join([data.get("handle", "")] + [f"{p['user']}:{p['score']}" for p in data.get("people", [])])
        return hashlib.sha1(raw.encode()).hexdigest()[:10]

    @app.get("/circle")
    @circle_only
    def circle_home():
        h = (request.args.get("h") or "").strip().lstrip("@")
        if h:
            from .circle import clean
            if clean(h):
                return redirect(url_for("circle_page", handle=clean(h)))
        from .circle import layout
        return render_template("circle.html", cfg=cfg, data=None, demo=layout([{}] * 20), og_title="Dragon Circle · who you are closest to in Pocket Dragons",
                               og_desc="See the Keepers who engage with you most in Pocket Dragons posts. Free, no login.")

    @app.get("/circle/<handle>")
    @circle_only
    def circle_page(handle):
        data = circle_data(handle)
        if not data.get("ok"):
            abort(404)
        if data["handle"] != handle:
            return redirect(url_for("circle_page", handle=data["handle"]))
        from .circle import layout
        img = f"https://pdtools.xyz/circle/{data['handle']}.png?v={circle_stamp(data)}" if data["people"] else None
        return render_template("circle.html", cfg=cfg, data=data, spots=layout(data["people"]), stamp=circle_stamp(data), og_img=img,
                               og_alt=f"@{data['handle']}'s Dragon Circle: the Keepers they are closest to in Pocket Dragons posts",
                               og_title=f"@{data['handle']}'s Dragon Circle on PD Tools",
                               og_desc=f"The {len(data['people'])} Keepers who engage with @{data['handle']} most in Pocket Dragons posts. Draw yours, free.")

    @app.get("/circle/<handle>.png")
    @circle_only
    def circle_image(handle):
        import io
        from concurrent.futures import ThreadPoolExecutor
        from pathlib import Path
        from PIL import Image
        from .circle import render
        data = circle_data(handle)
        if not data.get("ok"):
            abort(404)
        key = data["handle"].lower() + ":" + circle_stamp(data)
        hit = circle_png.get(key)
        if not (hit and time.time() - hit[0] < CIRCLE_PNG_S):
            ip = client_ip(); nowt = time.time()
            recent = [t for t in circle_hits.get(ip, []) if nowt - t < 3600]
            if len(recent) >= 40:
                abort(429)
            if len(circle_hits) > 20000:
                circle_hits.clear()
            circle_hits[ip] = recent + [nowt]
            handles = [data["handle"]] + [p["user"] for p in data["people"]]
            def pic(h):
                got = avatar_bytes(h)
                try:
                    return h.lower(), (Image.open(io.BytesIO(got[0])) if got else None)
                except Exception:  # noqa: BLE001  a broken picture just shows the first letter
                    return h.lower(), None
            with ThreadPoolExecutor(max_workers=6) as ex:
                avatars = dict(ex.map(pic, handles))
            png = render(data, avatars, str(Path(__file__).parent / "fonts"))
            if len(circle_png) > 60:
                circle_png.clear()
            circle_png[key] = (time.time(), png); hit = circle_png[key]
        r = app.response_class(hit[1], mimetype="image/png")
        r.headers["Cache-Control"] = "public, max-age=3600"
        return r

    @app.get("/api/circle/<handle>")
    @circle_only
    def api_circle(handle):
        data = circle_data(handle)
        return jsonify(data), (200 if data.get("ok") else 400)

    # ---------- v2.1 wave 1: welcome lane and Creator of the week (locked like the Circle) ----------
    def v21_only(view):
        """v2.1 tools: locked to the devices Jon unlocked until launch day (V21_PUBLIC=1), then open to everyone."""
        @wraps(view)
        def inner(*a, **k):
            if not (cfg.v21_public or g.get("circle")):
                abort(404)
            resp = make_response(view(*a, **k))
            if not cfg.v21_public:                   # a locked page or answer is never kept by a shared cache
                resp.headers["Cache-Control"] = "private, no-store"
                resp.headers.add("Vary", "Cookie")
            return resp
        return inner
    v21_cache: dict[str, tuple[float, object]] = {}
    v21_png: dict[str, tuple[float, bytes]] = {}

    def v21_cached(key, seconds, make):
        hit = v21_cache.get(key)
        if hit and time.time() - hit[0] < seconds:
            return hit[1]
        val = make()
        if len(v21_cache) > 300:
            v21_cache.clear()
        v21_cache[key] = (time.time(), val)
        return val

    def lane_data():
        from .v21 import welcome_lane
        def make():
            with Session() as s:
                return welcome_lane(s, cfg, utcnow())
        return v21_cached("lane", 180, make)

    def avatar_image(handle):
        import io
        from PIL import Image
        got = avatar_bytes(handle, big=True)
        if not got:
            return None
        try:
            im = Image.open(io.BytesIO(got[0])); im.load()
            return im
        except Exception:  # noqa: BLE001  a broken picture shows the first letter instead
            return None

    render_lock = threading.Lock()

    def card_png(key, make, mime="image/jpeg"):
        hit = v21_png.get(key)
        if not (hit and time.time() - hit[0] < 6 * 3600):
            ip = client_ip(); nowt = time.time()
            recent = [t for t in circle_hits.get(ip, []) if nowt - t < 3600]
            if len(recent) >= 150:                   # five welcome looks and six Dragondle cards add up quickly
                abort(429)
            if len(circle_hits) > 20000:
                circle_hits.clear()
            circle_hits[ip] = recent + [nowt]
            if len(v21_png) > 80 or sum(len(v[1]) for v in v21_png.values()) > 40_000_000:
                v21_png.clear()
            with render_lock:                        # one heavy picture at a time: the server is small
                hit = v21_png.get(key)
                if not (hit and time.time() - hit[0] < 6 * 3600):
                    v21_png[key] = (time.time(), make()); hit = v21_png[key]
        r = app.response_class(hit[1], mimetype=mime)
        if cfg.v21_public:
            r.headers["Cache-Control"] = "public, max-age=1800"     # X and browsers may keep a card for half an hour
        else:
            # locked pages: never let a shared cache hand Jon's copy to someone without the cookie
            r.headers["Cache-Control"] = "private, no-store"
            r.headers["Vary"] = "Cookie"
        return r

    @app.get("/welcome")
    @v21_only
    def welcome_home():
        lane = lane_data()
        return render_template("welcome.html", cfg=cfg, lane=lane, focus=None,
                               og_title="The welcome lane · new Keepers on PD Tools",
                               og_desc="New Keepers who just joined the Ancient Hatchery. Be the first to say hello.")

    def welcome_one(handle):
        """One new Keeper for their welcome page and card, kept for 3 minutes like the lane."""
        from .v21 import welcome_person
        def make():
            with Session() as s:
                return welcome_person(s, cfg, handle, utcnow())
        return v21_cached("wp:" + str(handle).lower()[:40], 180, make)

    @app.get("/welcome/<handle>")
    @v21_only
    def welcome_page(handle):
        from .v21 import welcome_person
        person = welcome_one(handle)
        if not person:
            return redirect(url_for("welcome_home"))
        if person["user"] != handle:
            return redirect(url_for("welcome_page", handle=person["user"]))
        lane = lane_data()
        if not any(x["id"] == person["id"] for x in lane):
            lane = [person] + lane
        return render_template("welcome.html", cfg=cfg, lane=lane, focus=person,
                               og_img=f"https://pdtools.xyz/welcome/{person['user']}.png",
                               og_alt=f"Welcome to the hatchery, @{person['user']}",
                               og_title=f"Welcome to the hatchery, @{person['user']}",
                               og_desc=f"@{person['user']} just joined the Ancient Hatchery. Say hello on PD Tools.")

    def _joined(person):
        at = datetime.fromisoformat(person["at"].rstrip("Z"))
        return f"{at.strftime('%b')} {at.day}, {at.year}"

    @app.get("/quiz/card.gif")
    @app.get("/dragondle/card.gif")
    @v21_only
    def dragondle_gif():
        """The animated Dragon Quiz card. m is one digit per question: from the 3 tries days, the try it was solved
        on (1 to 3, 0 missed); before that 1 right, 0 wrong. It never knows an answer."""
        from .dle_gif import card
        from .dragondle import uses_tries
        n, m, st = request.args.get("n", ""), request.args.get("m", ""), request.args.get("st", "0")
        if not (n.isdigit() and 0 < int(n) < 100000 and st.isdigit() and int(st) < 100000):
            abort(404)
        tries = uses_tries(int(n))
        if not re.fullmatch(r"[0-3]{5}" if tries else r"[01]{5}", m):
            abort(404)
        return card_png(f"dg:{n}:{m}:{st}", lambda: card(int(n), [int(c) for c in m], int(st), tries=tries), mime="image/gif")

    @app.get("/welcome/<handle>.png")
    @v21_only
    def welcome_image(handle):
        from .welcome_cards import card
        person = welcome_one(handle)
        if not person:
            abort(404)
        user = person["user"]
        return card_png("w2:" + user.lower(), lambda: card(avatar_image(user), user, person.get("name") or user, _joined(person), small=True))

    @app.get("/welcome/<handle>/card.jpg")
    @v21_only
    def welcome_keepsake(handle):
        """The welcome card a Keeper saves and posts with their hello, in one of five looks (?style=).
        "Welcomed by" is only ever the signed Keeper behind this browser."""
        from .cheers import sender
        from .welcome_cards import card
        person = welcome_one(handle)
        if not person:
            abort(404)
        user = person["user"]
        by = None
        vid = (request.args.get("vid") or "")[:32]
        if vid:
            with Session() as s:
                dev = sender(s, vid)
                if dev and dev.key != user.lower():
                    by = dev.username
        from .welcome_cards import STYLES
        style = request.args.get("style", "dusk")
        if style not in STYLES:
            abort(404)
        key = f"wk3:{style}:{user.lower()}:{(by or '').lower()}"
        return card_png(key, lambda: card(avatar_image(user), user, person.get("name") or user, _joined(person), by=by, style=style))

    @app.get("/api/welcome")
    @v21_only
    def api_welcome():
        return jsonify({"ok": True, "lane": lane_data()})

    def week_label(week: str) -> str:
        d = datetime.fromisoformat(week)
        return f"Week of {d.strftime('%b')} {d.day}"

    @app.get("/creator")
    @v21_only
    def creator_home():
        from .v21 import creator_stats, current_pick, picks, week_start
        now = utcnow()
        with Session() as s:
            pick = current_pick(s, now)
            past = [p for p in sorted(picks(s), key=lambda p: p["week"], reverse=True) if not pick or p["week"] != pick["week"]][:8]
            stats = None
            if pick:
                start = datetime.fromisoformat(pick["week"])
                end = min(now, start + timedelta(days=7))
                stats = v21_cached(f"cstats:{pick['week']}:{pick['user'].lower()}", 600,
                                   lambda: next((x for x in creator_stats(s, cfg, end) if x["user"].lower() == pick["user"].lower()), None))
        og = {}
        if pick:
            og = {"og_img": f"https://pdtools.xyz/creator/{pick['week']}.png?u={pick['user']}",
                  "og_alt": f"@{pick['user']}, Creator of the week on PD Tools",
                  "og_title": f"@{pick['user']} is the Creator of the week",
                  "og_desc": "Every week Pinky spotlights one Keeper who made the hatchery brighter. See who it is on PD Tools."}
        return render_template("creator.html", cfg=cfg, pick=pick, stats=stats, past=past,
                               week=week_label(pick["week"]) if pick else week_label(week_start(now).date().isoformat()),
                               week_label=week_label, last_week=(week_start(now) - timedelta(days=7)).date().isoformat(), **og)

    @app.get("/creator/<week>.png")
    @v21_only
    def creator_image(week):
        from .v21 import creator_card, picks
        with Session() as s:
            pick = next((p for p in picks(s) if p["week"] == week), None)
        if not pick:
            abort(404)
        return card_png(f"c:{week}:{pick['user'].lower()}", lambda: creator_card(pick, avatar_image(pick["user"]), week_label(week)))

    def lab_csrf():
        if not session.get("csrf"):
            session["csrf"] = secrets.token_hex(16)
        return session["csrf"]

    @app.get("/lab/creator")
    @circle_only   # Jon's tools stay locked even after launch
    def creator_lab():
        from .v21 import current_pick, suggestions, week_start
        now = utcnow()
        with Session() as s:
            sug = suggestions(s, cfg, now)
            pick = current_pick(s, now)
        return render_template("creator_lab.html", cfg=cfg, sug=sug, pick=pick if pick and pick.get("current") else None,
                               week=week_label(week_start(now).date().isoformat()), csrf=lab_csrf())

    @app.post("/lab/creator/pick")
    @circle_only   # Jon's tools stay locked even after launch
    def creator_pick():
        from .circle import clean
        from .v21 import creator_stats, save_pick
        check_csrf()
        user = clean(request.form.get("user", ""))
        if not user:
            abort(400)
        now = utcnow()
        with Session() as s:
            known = next((x for x in creator_stats(s, cfg, now, days=14) if x["user"].lower() == user.lower()), None)
            save_pick(s, now, known["user"] if known else user, known["name"] if known else user, request.form.get("note", ""))
            s.commit()
        v21_png.clear()
        return redirect(url_for("creator_lab"))

    @app.post("/lab/creator/undo")
    @circle_only   # Jon's tools stay locked even after launch
    def creator_undo():
        from .v21 import drop_pick
        check_csrf()
        with Session() as s:
            drop_pick(s, utcnow()); s.commit()
        v21_png.clear()
        return redirect(url_for("creator_lab"))

    # ---------- v2.1 wave 2: Hatchery Wrapped and Dragondle (locked like the rest of v2.1) ----------
    @app.get("/wrapped")
    @v21_only
    def wrapped_home():
        return render_template("wrapped.html", cfg=cfg, og_title="Hatchery Wrapped · your month on PD Tools",
                               og_desc="Your month in the hatchery: the Keepers you cheered on, the dragons you hatched and how the whole community did.")

    @app.get("/api/wrapped")
    @v21_only
    def api_wrapped():
        from .events import VID as _VID
        from .wrapped import story
        vid = (request.args.get("vid") or "")[:32]
        if not _VID.match(vid):
            return jsonify({"ok": False}), 400
        today = utcnow().date()
        try:
            y, m = (int(x) for x in (request.args.get("m") or f"{today.year}-{today.month}")[:7].split("-")[:2])
            date(y, m, 1)
        except (ValueError, TypeError, OverflowError):
            return jsonify({"ok": False}), 400
        if (y, m) > (today.year, today.month) or (y, m) < (2026, 10):
            return jsonify({"ok": False}), 400
        if _too_many("wrapped:" + client_ip(), limit=60, window=3600):
            abort(429)
        with Session() as s:
            return jsonify(story(s, cfg, vid, y, m, today))

    @app.get("/quiz")
    @v21_only
    def dragondle_home():
        from .dragondle import today_set
        return render_template("dragondle.html", cfg=cfg, game=today_set(utcnow().date()),
                               og_title="Dragon Quiz · the daily Pocket Dragons quiz",
                               og_desc="Five questions a day about Pocket Dragons lore, badges and pdtools, three tries each. Same five for everyone. Free.")

    @app.get("/dragondle")
    @v21_only            # still locked like the quiz itself until launch
    def dragondle_old():
        """The quiz was called Dragondle at first; old links keep working."""
        return redirect("/quiz", code=301)

    def dle_stats(s, day, top=5):
        from .db import DlePlay
        rows = s.execute(select(DlePlay.score, func.count()).where(DlePlay.day == day).group_by(DlePlay.score)).all()
        dist = {int(k): int(v) for k, v in rows}
        return {"total": sum(dist.values()), "dist": [dist.get(i, 0) for i in range(top + 1)], "max": top}

    @app.post("/api/dragondle")
    @v21_only
    def api_dragondle():
        from .db import DlePlay
        from .events import VID as _VID
        try:
            body = _body(300)
            vid, score, n = str(body.get("vid", ""))[:32], body.get("score", -1), body.get("n", 0)
            if type(score) is not int or type(n) is not int:      # 1e400, 2.5, true and "3" are all turned away
                raise TypeError
        except (ValueError, TypeError, AttributeError, OverflowError):
            abort(400)
        from .dragondle import day_of, max_score, number
        today_n = number(utcnow().date())
        # a game started just before midnight UTC still counts, under the day it was played
        if not _VID.match(vid) or n not in (today_n, today_n - 1) or n < 1 or not 0 <= score <= max_score(n):
            abort(400)
        day = day_of(n)
        with Session() as s:
            row = s.get(DlePlay, (day, vid))
            if row is None:                                    # only new plays use up the connection's allowance
                if _too_many("dle:" + client_ip(), limit=30, window=3600):
                    abort(429)
                try:
                    with s.begin_nested():
                        s.add(DlePlay(day=day, vid=vid, score=score))
                except IntegrityError:                         # another tab saved first: that score is the one that counts
                    won = s.get(DlePlay, (day, vid))
                    score = won.score if won else score
                s.commit()
            else:
                score = row.score                              # the first finished game of the day is the one that counts
            st = dle_stats(s, day, max_score(n))
        below = sum(st["dist"][:score])
        st["beat"] = round(100 * below / max(1, st["total"] - 1)) if st["total"] > 1 else None
        return jsonify({"ok": True, **st})

    @app.get("/lab/dragondle")
    @circle_only   # Jon's tools stay locked even after launch
    def dragondle_lab():
        from .dragondle import BANK, today_set
        today = utcnow().date()
        week = [today_set(today + timedelta(days=i)) for i in range(7)]
        return render_template("dragondle_lab.html", cfg=cfg, bank=BANK, week=week)

    # ---------- v2.1 wave 3: Cheers, thank you lanterns between signed Keepers (locked like the rest) ----------
    def cheers_week_label(week):
        return f"Week of {week.strftime('%b')} {week.day}"

    @app.get("/cheers")
    @v21_only
    def cheers_home():
        from .cheers import PRESETS
        return render_template("cheers.html", cfg=cfg, presets=PRESETS, person=None,
                               og_title="Cheers · thank a fellow Keeper on PD Tools",
                               og_desc="Send a fellow Keeper a thank you lantern. Signed Keepers only, kind words only, nothing posted for you.")

    @app.get("/api/cheers/me")
    @v21_only
    def api_cheers_me():
        from .cheers import DAILY, known_author, sender, week_for, week_of
        vid = (request.args.get("vid") or "")[:32]
        now = utcnow()
        with Session() as s:
            dev = sender(s, vid)
            if not dev:
                return jsonify({"ok": True, "signed": False})
            info = week_for(s, dev.key, week_of(now.date()))
            from .db import Cheer
            start = datetime(now.year, now.month, now.day)
            used = s.scalar(select(func.count()).select_from(Cheer).where(Cheer.from_key == dev.key, Cheer.created_at >= start)) or 0
            page = known_author(s, cfg, dev.username) is not None       # only Keepers with a dragon post have a public card
        return jsonify({"ok": True, "signed": True, "user": dev.username, "left": max(0, DAILY - used), "card": page, **info})

    @app.get("/api/cheers/find")
    @v21_only
    def api_cheers_find():
        from .circle import team_handles
        q = "".join(ch for ch in (request.args.get("q") or "") if ch.isalnum() or ch == "_")[:15].lower()
        if not q:
            return jsonify({"ok": True, "people": []})
        with Session() as s:
            team = team_handles(s, cfg)
            rows = s.execute(select(Post.author_username, func.max(Post.author_name), func.max(Post.created_at).label("last"))
                             .where(func.lower(Post.author_username).like(q.replace("_", "\\_") + "%", escape="\\"), Post.hidden.is_(False), Post.is_team.is_(False),
                                    Post.author_id.not_in(select(BlockedAuthor.author_id)))
                             .group_by(Post.author_username).order_by(func.max(Post.created_at).desc()).limit(12)).all()
        people, seen = [], set()
        for u, n, _ in rows:                       # newest spelling first, one row per person whatever the capitals
            if u and u.lower() not in team and u.lower() not in seen:
                seen.add(u.lower()); people.append({"user": u, "name": (n or u)[:60]})
        people = people[:8]
        return jsonify({"ok": True, "people": people})

    @app.post("/api/cheers")
    @v21_only
    def api_cheers_send():
        from .cheers import send
        try:
            body = _body(400)
            vid, to, preset = str(body.get("vid", ""))[:32], str(body.get("to", ""))[:20], body.get("preset", -1)
        except (ValueError, TypeError, AttributeError):
            abort(400)
        if not isinstance(preset, int) or isinstance(preset, bool):
            abort(400)
        if _too_many("cheer:" + client_ip(), limit=40, window=3600):
            abort(429)
        with Session() as s:
            out = send(s, cfg, vid, to, preset, utcnow())
            if out.get("ok"):
                try:
                    s.commit()
                except IntegrityError:             # the same lantern sent twice at once (two tabs, a retry)
                    s.rollback()
                    out = {"ok": False, "why": "already"}
        return jsonify(out), (200 if out.get("ok") else 400)

    def cheers_person(handle):
        from .cheers import known_author, week_for, week_of
        with Session() as s:
            user = known_author(s, cfg, handle)
            if not user:
                return None, None
            week = week_of(utcnow().date())
            return user, week_for(s, user.lower(), week)

    @app.get("/cheers/<handle>")
    @v21_only
    def cheers_page(handle):
        from .cheers import PRESETS
        user, info = cheers_person(handle)
        if not user:
            return redirect(url_for("cheers_home"))
        if user != handle:
            return redirect(url_for("cheers_page", handle=user))
        stamp = f"{info['week']}-{info['count']}"
        return render_template("cheers.html", cfg=cfg, presets=PRESETS, person={"user": user, **info, "label": cheers_week_label(date.fromisoformat(info["week"]))},
                               og_img=f"https://pdtools.xyz/cheers/{user}.png?v={stamp}",
                               og_alt=f"@{user} was cheered by {info['count']} Keepers this week on PD Tools",
                               og_title=f"@{user} was cheered by {info['count']} {'Keeper' if info['count'] == 1 else 'Keepers'} this week",
                               og_desc="Thank you lanterns from fellow Keepers on PD Tools. Send one to someone who supports you.")

    @app.get("/cheers/<handle>.png")
    @v21_only
    def cheers_image(handle):
        from .cheers import card
        user, info = cheers_person(handle)
        if not user:
            abort(404)
        key = f"ch:{user.lower()}:{info['week']}:{info['count']}"
        def make():
            senders = []
            for f in info["from"][:6]:
                senders.append((f["user"], avatar_image(f["user"])))
            return card(user, info, avatar_image(user), senders, cheers_week_label(date.fromisoformat(info["week"])))
        return card_png(key, make)

    # ---------- v2.1 wave 4: the Blinky and Pinky sticker shelf (locked like the rest) ----------
    sticker_png: dict[str, bytes] = {}

    @app.get("/stickers")
    @v21_only
    def stickers_home():
        from .stickers import shelf
        return render_template("stickers.html", cfg=cfg, shelf=shelf(),
                               og_title="Blinky and Pinky stickers · PD Tools",
                               og_desc="Free Blinky and Pinky stickers for your Pocket Dragons posts and replies on X.")

    @app.get("/stickers/<name>.png")
    @v21_only
    def sticker_file(name):
        """The shelf shows light WebP files; saving or copying gets a PNG, which every app on X accepts."""
        import io
        from PIL import Image
        from .stickers import KEYS
        base = name[:-2] if name.endswith("-w") else name
        if base not in KEYS:
            abort(404)
        if name not in sticker_png:
            src = Path(__file__).parent / "static" / "v21" / "stickers" / f"st-{name}.webp"
            if not src.exists():
                abort(404)
            buf = io.BytesIO(); Image.open(src).convert("RGBA").save(buf, "PNG", optimize=True)
            sticker_png[name] = buf.getvalue()
        r = app.response_class(sticker_png[name], mimetype="image/png")
        r.headers["Cache-Control"] = "public, max-age=86400" if cfg.v21_public else "private, max-age=86400"
        r.headers["Content-Disposition"] = f'inline; filename="pdtools-{name}.png"'
        return r

    # ---------- v2.1 wave 4: the Hatchery canvas, a sky island to decorate (locked like the rest) ----------
    @app.get("/canvas")
    @v21_only
    def canvas_home():
        from .stickers import PROPS, shelf
        return render_template("canvas.html", cfg=cfg, shelf=shelf(), props=PROPS,
                               og_title="Hatchery canvas · PD Tools",
                               og_desc="Decorate a sky island with Blinky, Pinky, your dragons and more, then save it as a card.")

    # ---------- follow directory ----------
    @app.get("/friends/ama")
    def ama_page():
        from .ama import AMAS, PEAK, PEAK_SHOWN
        return render_template("ama.html", cfg=cfg, amas=AMAS, peak=PEAK, peak_shown=PEAK_SHOWN,
                               og_title="AMA Library · every Pocket Dragons AMA in one place",
                               og_desc="Catch up on every Pocket Dragons AMA: the recordings, what was shared and how the room grew week by week.")

    # the What's new card on the home page: newest first, the top three are shown
    NEWS = [
        {"title": "Your Dragon Circle", "text": "See the Keepers who engage with you most in dragon posts.", "href": "/circle"},
        {"title": "Your dragons in one place", "text": "Inside the X app, a note now helps you move your progress in one tap.", "href": "/help#move"},
        {"title": "Catch up by day", "text": "Posts you missed wait under their own day.", "href": "/friends"},
        {"title": "The AMA Library", "text": "Every Pocket Dragons AMA in one place.", "href": "/friends/ama"},
        {"title": "Pick a song", "text": "Choose any song from the community playlist.", "href": "/friends"},
    ]

    @app.get("/help")
    def help_page():
        return render_template("help.html", cfg=cfg, og_title="Help · pdtools",
                               og_desc="How to open pdtools, keep your dragons in one place, and answers to the questions Keepers ask most.")

    @app.get("/friends/keepers")
    def keepers_page():
        return render_template("keepers.html", cfg=cfg)

    @app.get("/api/keepers")
    def api_keepers():
        import json
        now = utcnow()
        with Session() as s:
            team = json.loads(get_setting(s, "team_profiles") or "[]")
            rows = s.scalars(select(Keeper).where(Keeper.tagged.is_(True), Keeper.verified.is_(True),
                                                  Keeper.last_checked >= now - timedelta(days=45))).all()
        team_keys = {t["username"].lower() for t in team}
        if not team:  # before the first refresh, still pin the accounts by handle
            team = [{"username": h.strip(), "name": h.strip(), "avatar": None, "role": r.strip()}
                    for h, r in (a.split(":", 1) for a in cfg.team_accounts.split(",") if a.strip())]
            team_keys = {t["username"].lower() for t in team}
        for t in team:
            t["avatar"] = f"/api/avatar/{t['username']}" if t.get("avatar") else None
        fmt = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ") if d else None  # noqa: E731
        # "Posted about the dragons" uses the newest of: what the directory noted, and every post in the feed
        # (posts arrive by search and by Discord shares, so the feed itself is the full record)
        with Session() as s:
            handle = func.lower(Post.author_username)
            newest = dict(s.execute(select(handle, func.max(Post.created_at))
                                    .where(Post.hidden.is_(False), Post.created_at >= now - timedelta(days=45),
                                           handle.in_([k.key for k in rows] or [""]))
                                    .group_by(handle)).all())
        latest = lambda k: max((d for d in (k.last_post_at, newest.get(k.key)) if d), default=None)  # noqa: E731
        keepers = [{"username": k.username, "name": k.name, "avatar": f"/api/avatar/{k.username}" if k.avatar else None,
                    "last_post": fmt(latest(k)), "since": fmt(k.first_seen)}
                   for k in rows if k.key not in team_keys]
        return jsonify({"team": team, "keepers": keepers})

    add_seen: dict[str, list[float]] = {}
    add_inflight: set[str] = set()
    import requests as _requests
    fx_http = _requests.Session()   # FxTwitter: free public profile lookups for "add me"

    @app.post("/api/keepers/add")
    def api_keepers_add():
        import json
        body = request.get_json(silent=True)
        handle = str((body.get("handle") if isinstance(body, dict) else "") or "").strip().lstrip("@")
        if not handle or len(handle) > 15 or not all(c.isalnum() or c == "_" for c in handle):
            return {"ok": False, "message": "That does not look like an X handle."}
        ip = client_ip()
        now_ts = datetime.now().timestamp()
        recent = [t for t in add_seen.get(ip, []) if now_ts - t < 86400]
        if len(recent) >= 10:
            return {"ok": False, "message": "You can add up to 10 handles a day. Come back tomorrow."}
        now, key = utcnow(), handle.lower()
        with Session() as s:
            k = s.get(Keeper, key)
            # Already listed: answer for free. Only re-check X once the listing is a month old.
            if k and k.tagged and k.verified and now - k.last_checked < timedelta(days=30):
                return {"ok": True, "message": f"@{k.username} is already in the directory."}
            # A recent "not yet" is remembered only briefly: people fix their name or get the tick and try again.
            last_no = get_setting(s, f"dirno:{key}")
            if last_no:
                no_at, _, why = last_no.partition("|")
                if now - datetime.fromisoformat(no_at) < timedelta(minutes=10):
                    if why:
                        return {"ok": False, "message": f"@{handle} still needs {why}. Changes on X can take a few "
                                                        "minutes to show, so try again in about 10 minutes."}
                    return {"ok": False, "message": f"@{handle} was just checked. Try again in about 10 minutes."}
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            checks = s.scalar(select(func.count()).select_from(CollectorRun)
                              .where(CollectorRun.status == "directory_add", CollectorRun.started_at >= day_start)) or 0
            if checks >= cfg.directory_adds_per_day or month_spend(s, now) + cfg.cost_per_user_usd > cfg.monthly_spend_limit_usd:
                return {"ok": False, "message": "Blinky has checked enough Keepers for today. Try again tomorrow."}
        if key in add_inflight:  # same handle submitted twice at once: only one check goes out
            return {"ok": False, "message": f"@{handle} is being checked right now. Give it a second."}

        def missing_for(profile):
            need = [] if profile.get("verified") and profile.get("verified_type") == "blue" else ["a blue tick"]
            if not has_dragon_tag(profile.get("name")):
                need.append("the \U0001F409 in the display name")
            return " and ".join(need)

        def answer(profile, paid: bool):
            with Session() as s:
                if paid:
                    s.add(CollectorRun(started_at=now, finished_at=utcnow(), status="directory_add",
                                       users_returned=1, est_cost_usd=cfg.cost_per_user_usd))
                if not profile:
                    set_setting(s, f"dirno:{key}", now.isoformat())  # do not look up a typo again straight away
                    s.commit()
                    return {"ok": False, "message": f"@{handle} does not seem to exist on X."}
                k = note_user(s, profile, "added", now=now)
                if k is None or not (k.tagged and k.verified):
                    why = missing_for(profile)
                    set_setting(s, f"dirno:{key}", f"{now.isoformat()}|{why}")
                    s.commit()
                    return {"ok": False, "message": f"@{profile['username']} needs {why} to join. "
                                                    "Add it on X, then try again here in a few minutes."}
                set_setting(s, f"dirno:{key}", "")
                s.commit()
                return {"ok": True, "message": f"Welcome to the meadow, @{profile['username']}."}

        # 1. a free look through FxTwitter (the same source that fills the directory from Discord shares)
        from .fxpic import profile as fx_profile
        add_seen[ip] = recent + [now_ts]
        add_inflight.add(key)
        try:
            fx = fx_profile(handle, fx_http)
        finally:
            add_inflight.discard(key)
        if fx is not None:
            return answer(fx or None, paid=False)

        # 2. FxTwitter is busy: ask X itself (billed, capped per day)
        if not cfg.x_bearer_token:
            return {"ok": False, "message": "Blinky could not reach X just now. Try again in a few minutes."}
        from .xapi import XClient, XApiError
        if key in add_inflight:  # same handle submitted twice at once: only one check goes to X
            return {"ok": False, "message": f"@{handle} is being checked right now. Give it a second."}
        add_inflight.add(key)
        try:
            profile = XClient(cfg.x_bearer_token).user_profile(handle)
        except XApiError:
            return {"ok": False, "message": "X did not answer just now. Try again in a bit."}
        finally:
            add_inflight.discard(key)
        return answer(profile, paid=True)

    # ---------- progress backup codes: no login, nothing personal, gone after 30 days ----------
    CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    DEX_IDS = {"shadow", "space", "speed", "tiger", "tree", "water", "acid", "ghost", "ice", "jelly", "light", "lightning",
               "lava", "panda", "pink", "ruby", "sapphire", "emerald", "amethyst", "diamond"}
    backup_hits: dict[str, list[float]] = {}

    def _too_many(ip: str, limit: int = 12, window: float = 3600) -> bool:
        nowt = time.time()
        hits = [t for t in backup_hits.get(ip, []) if nowt - t < window]
        if len(backup_hits) > 50000:
            backup_hits.clear()
        backup_hits[ip] = hits + [nowt]
        return len(hits) >= limit

    def clean_progress(body: dict) -> dict:
        """A visitor's progress as sent by the page, with only well formed ids, dates and small numbers kept."""
        import math as _math
        opened = body.get("opened") if isinstance(body.get("opened"), dict) else {}
        # keep only well formed post ids and timestamps
        clean = {str(k)[:25]: int(v) for k, v in list(opened.items())[:3000]
                 if str(k).isdigit() and isinstance(v, (int, float)) and not isinstance(v, bool) and _math.isfinite(v)}
        streak = body.get("streak") if isinstance(body.get("streak"), dict) else {}
        # collectible dragons (v2): only known dragon ids and small whole numbers are kept
        dex_in = body.get("dex") if isinstance(body.get("dex"), dict) else {}
        have_in = dex_in.get("have") if isinstance(dex_in.get("have"), dict) else {}
        have = {}
        for k, h in list(have_in.items())[:40]:
            if k in DEX_IDS and isinstance(h, dict):
                row = {r: min(999, int(h[r])) for r in ("c", "r", "l")
                       if isinstance(h.get(r), (int, float)) and not isinstance(h.get(r), bool) and _math.isfinite(h[r]) and h[r] >= 1}
                if row:
                    have[k] = row
        day = lambda v: v if isinstance(v, str) and len(v) == 10 and v[4] == "-" else None
        num = lambda v, top: min(top, int(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) and _math.isfinite(v) and v > 0 else 0
        g_in = dex_in.get("g") if isinstance(dex_in.get("g"), dict) else {}
        s_in = dex_in.get("s") if isinstance(dex_in.get("s"), dict) else {}
        dex_out = {"have": have, "last": day(dex_in.get("last")), "n": num(dex_in.get("n"), 5000),
                   "g": {"last": day(g_in.get("last")), "count": num(g_in.get("count"), 5000), "best": num(g_in.get("best"), 5000),
                         "fz": day(g_in.get("fz"))},
                   "e": num(dex_in.get("e"), 1_000_000),
                   "s": {k: day(v) for k, v in s_in.items() if k in ("moon", "ember", "star") and day(v)}}
        # today's daily goal count travels too, so a new device shows the same "x/20 Keeper posts today"
        goal_in = body.get("goal") if isinstance(body.get("goal"), dict) else {}
        goal_out = {"day": day(goal_in.get("day")), "n": num(goal_in.get("n"), 200)}
        if goal_in.get("d") is True:                # v2.1 goal: today's Dragondle done
            goal_out["d"] = True
        if goal_in.get("f") is True:                # v2.1 goal: one new Keeper followed today
            goal_out["f"] = True
        streak_out = {"last": day(streak.get("last")), "count": num(streak.get("count"), 5000), "best": num(streak.get("best"), 5000)}
        if day(streak.get("fz")):
            streak_out["fz"] = streak["fz"]
        return {"opened": clean, "streak": streak_out,
                **({"goal": goal_out} if goal_out["day"] and (goal_out["n"] or goal_out.get("d") or goal_out.get("f")) else {}),
                **({"dex": dex_out} if have or dex_out["e"] or dex_out["s"] else {})}

    @app.post("/api/backup")
    def backup_save():
        import json as _json
        import math as _math
        from .db import ProgressBackup
        ip = client_ip()
        if _too_many(ip):
            return jsonify({"ok": False, "message": "Too many saves for now, try again later."}), 429
        if (request.content_length or 0) > 200_000 or len(request.get_data()) > 200_000:
            return jsonify({"ok": False, "message": "That is too much to save at once."}), 413
        try:
            body = _body(200_000)
        except ValueError:
            body = {}
        book_vid = str(body.get("vid", ""))[:32] if g.get("v2") else ""
        data = _json.dumps({**clean_progress(body), **({"book_vid": book_vid} if book_vid else {})})
        if len(data) > 150_000:
            return jsonify({"ok": False, "message": "That is too much to save at once."}), 413
        now = utcnow()
        with Session() as s:
            s.query(ProgressBackup).filter(ProgressBackup.created_at < now - timedelta(days=30)).delete()
            for _ in range(5):
                raw = "".join(secrets.choice(CODE_ABC) for _ in range(8))
                if s.get(ProgressBackup, raw) is None:
                    break
            s.add(ProgressBackup(code=raw, data=data, created_at=now))
            s.commit()
        return jsonify({"ok": True, "code": f"{raw[:4]}-{raw[4:]}", "days": 30})

    @app.get("/api/backup/<code>")
    def backup_load(code: str):
        import json as _json
        from .db import ProgressBackup
        ip = client_ip()
        if _too_many("r:" + ip, limit=30):
            return jsonify({"ok": False, "message": "Too many tries for now, try again later."}), 429
        raw = "".join(ch for ch in code.upper() if ch in CODE_ABC)
        with Session() as s:
            row = s.get(ProgressBackup, raw)
            if row is None or utcnow() - row.created_at > timedelta(days=30):
                return jsonify({"ok": False, "message": "That code was not found. Check it and try again."}), 404
            data = _json.loads(row.data)
            book_vid = data.pop("book_vid", "")
            linked = False
            if book_vid and g.get("v2"):
                from .book import link_device
                linked = link_device(s, book_vid, request.args.get("vid", "")[:32])
                s.commit()
            return jsonify({"ok": True, **data, "book": linked})

    # ---------- progress kept safe for signed Keepers (see cloudsave.py) ----------
    save_seen: dict[str, float] = {}

    def signed_key(vid: str) -> str:
        from .db import FriendDevice
        with Session() as s:
            dev = s.get(FriendDevice, vid) if vid else None
            return dev.key if dev is not None and dev.confirmed else ""

    @app.post("/api/book/progress")
    @v2_only
    def book_progress_save():
        from .cloudsave import load, merge
        from .db import KeeperSave
        if (request.content_length or 0) > 200_000 or len(request.get_data()) > 200_000:
            return jsonify({"ok": False}), 413
        try:
            body = _body(200_000)
        except ValueError:
            return jsonify({"ok": False}), 400
        vid = str(body.get("vid", ""))[:32]
        key = signed_key(vid)
        if not key:
            return jsonify({"ok": False, "why": "unsigned"})
        nowt = time.time()
        if nowt - save_seen.get(vid, 0) < 45:              # a page sends at most about once a minute
            return jsonify({"ok": True, "later": True})
        if len(save_seen) > 20000:
            save_seen.clear()
        save_seen[vid] = nowt
        incoming = clean_progress(body)
        with Session() as s:
            row = s.get(KeeperSave, key)
            merged = merge(load(row.data) if row else {}, incoming)
            raw = json.dumps(merged, separators=(",", ":"))
            if len(raw) > 300_000:
                return jsonify({"ok": False}), 413
            if row is None:
                s.add(KeeperSave(key=key, data=raw, updated_at=utcnow()))
            else:
                row.data, row.updated_at = raw, utcnow()
            s.commit()
        return jsonify({"ok": True})

    @app.get("/api/book/progress")
    @v2_only
    def book_progress_load():
        from .cloudsave import load
        from .db import KeeperSave
        key = signed_key(request.args.get("vid", "")[:32])
        if not key:
            return jsonify({"ok": False, "why": "unsigned"})
        with Session() as s:
            row = s.get(KeeperSave, key)
            data = load(row.data) if row else {}
        return jsonify({"ok": True, **data}), 200, {"Cache-Control": "no-store"}

    @app.post("/api/feedback")
    def feedback():
        from .db import Feedback
        ip = client_ip()
        if _too_many("f:" + ip, limit=6):
            return jsonify({"ok": False, "message": "Thanks, we already got your rating."}), 429
        try:
            body = _body(4000)
        except ValueError:
            body = {}
        try:
            rating = int(body.get("rating") or 0)
        except (TypeError, ValueError, OverflowError):
            rating = 0
        if not 1 <= rating <= 5:
            return jsonify({"ok": False, "message": "Pick from 1 to 5 stars first."}), 400
        comment = str(body.get("comment") or "").strip()[:1000]
        page = str(body.get("page") or "")[:40]
        device = "phone" if str(body.get("device")) == "phone" else "computer"
        with Session() as s:
            s.add(Feedback(rating=rating, comment=comment, page=page, device=device, created_at=utcnow()))
            s.commit()
        return jsonify({"ok": True})

    @app.get("/sw.js")
    def service_worker():
        """The offline helper. It lives at the site root so it can look after every page."""
        body = render_template("sw.js", version=version, enabled=cfg.offline_cache)
        resp = Response(body, mimetype="application/javascript")
        resp.headers["Cache-Control"] = "no-cache"
        resp.headers["Service-Worker-Allowed"] = "/"
        return resp

    @app.get("/healthz")
    def healthz():
        # "via" tells Jon which header carried the visitor address (cf = Cloudflare, so limits cannot be faked)
        return {"ok": True, "via": "cf" if request.headers.get("CF-Connecting-IP") else
                "xff" if request.headers.get("X-Forwarded-For") else "direct"}

    # Called every 20 minutes by a Supabase cron job. No secret needed: the collector
    # already enforces the daily cap, the spacing between grabs and the spend limit,
    # and this route ignores calls that come sooner than 10 minutes after the last run.
    collect_lock = threading.Lock()

    def collect_in_background():
        from .xapi import XClient
        try:
            with Session() as s:
                run_collection(s, XClient(cfg.x_bearer_token), cfg)
            clear_feed()                            # new posts show straight away
        except Exception:  # noqa: BLE001  the run row already records errors
            app.logger.exception("Background collection failed")
        finally:
            collect_lock.release()

    @app.post("/cron/collect")
    def cron_collect():
        if not cfg.x_bearer_token:
            return {"started": False, "reason": "no token"}, 503
        with Session() as s:
            last = s.scalar(select(CollectorRun.started_at).where(CollectorRun.status.not_in(SIDE_RUNS))
                            .order_by(CollectorRun.started_at.desc()).limit(1))
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

    def jon_device() -> bool:
        """Jon's own preview devices carry a cookie only the preview key can make, so a flood of guesses
        from strangers never locks Jon himself out of the admin page."""
        c = request.cookies.get(PREVIEW_COOKIE, "")
        return bool(cfg.preview_key and c and hmac.compare_digest(c, preview_token()))

    @app.route("/admin/login", methods=["GET", "POST"])
    def admin_login():
        if not cfg.admin_password:
            abort(404)
        error = None
        # per address, and for everyone together: an address header can be faked by calling Render directly,
        # so the shared limit keeps password guessing slow no matter where the tries come from
        if request.method == "POST" and (_too_many("login:" + client_ip(), limit=10, window=900)
                                         or (not jon_device() and _too_many("login:all", limit=40, window=900))):
            return render_template("login.html", cfg=cfg, error="Too many tries. Wait 15 minutes."), 429
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
            from .db import Feedback
            feedback_rows = s.scalars(select(Feedback).order_by(Feedback.created_at.desc()).limit(100)).all()
            fb_avg = s.scalar(select(func.avg(Feedback.rating)))
            fb_count = s.scalar(select(func.count()).select_from(Feedback))
            from .visits import summary
            visits = summary(s, datetime.now(tz).date())
            from .events import report_queue, summary as habit_summary
            habits = habit_summary(s, datetime.now(tz).date())
            reports = report_queue(s)
            from .book import admin_list
            book = admin_list(s)
        stale_after = cfg.stale_after_minutes
        if cfg.daily_post_cap > 0:  # testing mode only reads every few hours
            stale_after += int(24 * 60 * 10 / cfg.daily_post_cap)
        stale = last_ok is None or (now - last_ok) > timedelta(minutes=stale_after)
        return render_template("admin.html", cfg=cfg, runs=runs, spend=spend, total_posts=total_posts,
                               hidden=hidden, blocked=blocked, keywords=keywords, stale=stale,
                               last_ok=last_ok, csrf=session.get("csrf"), feedback=feedback_rows,
                               fb_avg=fb_avg, fb_count=fb_count, visits=visits,
                               habits=habits, reports=reports, book=book)

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

    @app.post("/admin/book")
    def admin_book():
        require_admin(); check_csrf()
        from .book import clean_handle, remove
        key = clean_handle(request.form.get("handle", "")).lower()
        if not key:
            abort(400)
        with Session() as s:
            remove(s, key, block=request.form.get("block") == "1")
            s.commit()
        book_cache["at"] = 0
        return redirect(url_for("admin") + "#book")

    @app.post("/admin/report")
    def admin_report():
        require_admin(); check_csrf()
        from .events import decide
        pid = post_id_from(request.form.get("post", ""))
        action = request.form.get("action", "")
        if action not in ("hide", "keep"):
            abort(400)
        with Session() as s:
            decide(s, pid, action)
            if action == "hide" and request.form.get("block_author") == "1":
                post = s.get(Post, pid)
                if post and not s.get(BlockedAuthor, post.author_id):
                    s.add(BlockedAuthor(author_id=post.author_id))
            s.commit()
        return redirect(url_for("admin") + "#reports")

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
