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
from .directory import has_dragon_tag, note_user
from .db import (SIDE_RUNS, BlockedAuthor, CollectorRun, Keeper, Post, get_setting, make_session_factory, month_spend,
                 set_setting, utcnow)

FEED_LIMIT = 1000
PINNED = 2  # newest team posts kept at the top  # IDs only, a few KB; the browser renders them in small batches


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
        # The two newest team posts are always pinned, whatever range or filter is picked
        with Session() as s:
            pinned = s.scalars(select(Post).where(Post.is_team.is_(True), Post.hidden.is_(False),
                                                  Post.text.is_not(None), Post.author_username.is_not(None))
                               .order_by(Post.created_at.desc()).limit(PINNED)).all()
        with Session() as s:
            last_run = s.scalar(select(CollectorRun).where(CollectorRun.status.in_(["ok", "page_limit"]))
                                .order_by(CollectorRun.started_at.desc()).limit(1))
        def item(p):
            return {"id": p.id, "t": p.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "team": p.is_team, "quote": p.is_quote, "text": p.text, "name": p.author_name or p.author_username,
                  "user": p.author_username, "avatar": p.author_avatar, "media": p.has_media,
                    "opens": p.opens or 0}
        items = [item(p) for p in posts]
        pinned_items = [item(p) for p in pinned]
        filters = {"range": key, "who": who, "quotes": "1" if quotes else "0",
                   "from": args.get("from", ""), "to": args.get("to", "")}
        updated = last_run.finished_at.strftime("%Y-%m-%dT%H:%M:%SZ") if last_run and last_run.finished_at else None
        return items, pinned_items, filters, updated

    @app.get("/")
    def feed():
        items, pinned_items, filters, updated = feed_query(request.args)
        return render_template("feed.html", cfg=cfg, items=items, pinned=pinned_items, filters=filters, updated=updated)

    @app.get("/api/posts")
    def api_posts():
        items, pinned_items, filters, updated = feed_query(request.args)
        return jsonify({"posts": items, "pinned": pinned_items, "filters": filters, "updated": updated})

    # Anonymous open counter. Nothing about the visitor is stored. The browser only
    # sends this the first time it opens a post, and the same address can bump
    # a post once a day, so refreshing or scripting the button barely moves it.
    seen_opens: dict[tuple[str, str], float] = {}

    @app.post("/api/open/<post_id>")
    def api_open(post_id):
        if not post_id.isdigit() or len(post_id) > 32:
            abort(400)
        ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0]).strip()
        key, now_ts = (ip, post_id), datetime.now().timestamp()
        if now_ts - seen_opens.get(key, 0) < 86400:
            return {"counted": False}
        if len(seen_opens) > 50000:
            seen_opens.clear()
        seen_opens[key] = now_ts
        with Session() as s:
            post = s.get(Post, post_id)
            if post is None or post.hidden:
                return {"counted": False}
            post.opens = (post.opens or 0) + 1
            s.commit()
            return {"counted": True, "opens": post.opens}

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

    @app.get("/api/avatar/<handle>")
    def api_avatar(handle):
        import requests
        key = handle.lower()
        hit = avatar_cache.get(key)
        if hit and datetime.now().timestamp() - hit[0] < 86400:
            return hit[1], 200, {"Content-Type": hit[2], "Cache-Control": "public, max-age=86400"}
        with Session() as s:
            url = s.scalar(select(Post.author_avatar).where(func.lower(Post.author_username) == key,
                                                            Post.author_avatar.is_not(None)).limit(1))
            cached = get_setting(s, f"keeper:{key}")
            kp = s.get(Keeper, key)
            team = get_setting(s, "team_profiles")
        if not url and kp and kp.avatar:
            url = kp.avatar
        if not url and team:
            import json
            url = next((t.get("avatar") for t in json.loads(team) if t["username"].lower() == key), None)
        if not url and cached:
            import json
            url = (json.loads(cached).get("card") or {}).get("avatar_url")
        if not url or not url.startswith("https://pbs.twimg.com/"):
            abort(404)
        try:
            r = requests.get(url, timeout=8)
        except requests.RequestException:
            abort(404)
        if r.status_code != 200 or len(r.content) > 500_000:
            abort(404)
        ctype = r.headers.get("Content-Type", "image/jpeg")
        if len(avatar_cache) > 2000:
            avatar_cache.clear()
        avatar_cache[key] = (datetime.now().timestamp(), r.content, ctype)
        return r.content, 200, {"Content-Type": ctype, "Cache-Control": "public, max-age=86400"}

    # ---------- follow directory ----------
    @app.get("/keepers")
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
        keepers = [{"username": k.username, "name": k.name, "avatar": f"/api/avatar/{k.username}" if k.avatar else None,
                    "last_post": fmt(k.last_post_at), "since": fmt(k.first_seen)}
                   for k in rows if k.key not in team_keys]
        return jsonify({"team": team, "keepers": keepers})

    add_seen: dict[str, list[float]] = {}
    add_inflight: set[str] = set()

    @app.post("/api/keepers/add")
    def api_keepers_add():
        import json
        handle = (request.get_json(silent=True) or {}).get("handle", "").strip().lstrip("@")
        if not handle or len(handle) > 15 or not all(c.isalnum() or c == "_" for c in handle):
            return {"ok": False, "message": "That does not look like an X handle."}
        ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0]).strip()
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
            if get_setting(s, f"dirno:{key}") and now - datetime.fromisoformat(get_setting(s, f"dirno:{key}")) < timedelta(days=1):
                return {"ok": False, "message": f"@{handle} was checked today and did not qualify. Try again tomorrow."}
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            checks = s.scalar(select(func.count()).select_from(CollectorRun)
                              .where(CollectorRun.status == "directory_add", CollectorRun.started_at >= day_start)) or 0
            if checks >= cfg.directory_adds_per_day or month_spend(s, now) + cfg.cost_per_user_usd > cfg.monthly_spend_limit_usd:
                return {"ok": False, "message": "Blinky has checked enough Keepers for today. Try again tomorrow."}
        if not cfg.x_bearer_token:
            return {"ok": False, "message": "Adding is switched off right now."}
        from .xapi import XClient, XApiError
        if key in add_inflight:  # same handle submitted twice at once: only one check goes to X
            return {"ok": False, "message": f"@{handle} is being checked right now. Give it a second."}
        add_seen[ip] = recent + [now_ts]
        add_inflight.add(key)
        try:
            profile = XClient(cfg.x_bearer_token).user_profile(handle)
        except XApiError:
            return {"ok": False, "message": "X did not answer just now. Try again in a bit."}
        finally:
            add_inflight.discard(key)
        with Session() as s:
            s.add(CollectorRun(started_at=now, finished_at=utcnow(), status="directory_add",
                               users_returned=1, est_cost_usd=cfg.cost_per_user_usd))
            if not profile:
                set_setting(s, f"dirno:{key}", now.isoformat())  # do not pay to look up a typo twice
                s.commit()
                return {"ok": False, "message": f"@{handle} does not seem to exist on X."}
            k = note_user(s, profile, "added", now=now)
            if k is None or not (k.tagged and k.verified):
                set_setting(s, f"dirno:{key}", now.isoformat())
                s.commit()
                need = [] if profile.get("verified") and profile.get("verified_type") == "blue" else ["a blue tick"]
                if not has_dragon_tag(profile.get("name")):
                    need.append("the \U0001F409 in your display name")
                return {"ok": False, "message": f"@{profile['username']} needs {' and '.join(need)} to join."}
            s.commit()
            return {"ok": True, "message": f"Welcome to the meadow, @{profile['username']}."}

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
