"""Keepers Trail: a Keeper signs in with X, and their card is built from their own posts about Pocket Dragons.

How it works
  1. /trail/x/connect sends the Keeper to X to sign in (OAuth 2.0 with PKCE, read only: tweet.read users.read).
  2. /trail/x/callback trades the code for a token, reads who they are (one paid profile read), then hands the
     token straight back to X. pdtools never keeps a Keeper's X token: only their id, name and picture, in a
     signed cookie on their own browser.
  3. /api/trail/me finds their posts about Pocket Dragons (app search, billed per post returned), works out
     the card and keeps it for a day, so opening the card again costs nothing.

Money
  Every paid read is counted (DailyCount "trail_spend_m", in tenths of a cent). Once the day's spend reaches
  TRAIL_DAILY_CAP_USD, new lookups wait for tomorrow; cards already made still open.

Hidden until launch
  The page and its API answer only on devices with the pdtools preview turned on, until TRAIL_PUBLIC=1.

One day only
  With TRAIL_OPENS_AT set, the Trail is a one day event: before it opens the page counts down, for 24 hours
  (or until TRAIL_CLOSES_AT) Keepers open their cards, and after that it is closed for everyone. Each card is
  stamped with the day it was opened.
"""
import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

import requests
from flask import Response, abort, g, jsonify, redirect, request, send_from_directory, session
from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, DailyCount, utcnow

TRAIL_DIR = Path(__file__).parent / "static" / "trail"
AUTH_URL = "https://x.com/i/oauth2/authorize"
TOKEN_URL = "https://api.x.com/2/oauth2/token"
REVOKE_URL = "https://api.x.com/2/oauth2/revoke"
API = "https://api.x.com/2"
# Everything comes from X itself. A Keeper's dragon posts do not always name the project ("Night 9 in the Ember
# Chamber", "I just hatched a Tiger dragon", a welcome to a new Keeper), so the search takes the words Keepers
# really use. Only their own posts are searched (from:), so these words can not pull in anyone else.
TERMS = ('(@Pocket_Dragons_ OR "pocket dragons" OR "pocket dragon" OR "ancient hatchery" OR hatchery OR blinky OR pinky '
         'OR dragon OR dragons OR keeper OR keepers OR pdtools OR "ember chamber" OR PD OR #PocketDragons OR 🐉)')
TRAIL_START = datetime(2026, 9, 8)          # the Hatchery opened on 8 September; nothing before counts
CARD_V = 2                                  # bump when the way a card is worked out changes: saved cards are made again
MAX_POSTS = 1000                            # the most posts read for one Keeper (about $5 at worst)
SPEND_KEY = "trail_spend_m"
WALK_COLOURS = ["#6d5313", "#e0784f", "#7fa38f"]


class TrailCard(Base):
    """One Keeper's card, worked out from their posts. Kept a day, then worked out again when they come back."""
    __tablename__ = "trail_cards"
    user_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    username: Mapped[str] = mapped_column(String(32), default="")
    card: Mapped[str] = mapped_column(Text, default="{}")
    posts: Mapped[int] = mapped_column(Integer, default=0)
    views: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(12), default="")      # "all": X's full archive search
    partial: Mapped[bool] = mapped_column(Boolean, default=False)    # the day's money ran out part way
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    no: Mapped[int | None] = mapped_column(Integer, nullable=True)   # the order Keepers first walked the trail: card No. 1, 2, 3...
    opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)   # when they first opened it: the date stamped on the card


# ---------- the one day the Trail is open ----------
def _at(v: str) -> datetime | None:
    """A UTC time from the settings, as the naive UTC every column here uses."""
    if not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d


def event_window(cfg) -> tuple[datetime | None, datetime | None]:
    opens, closes = _at(cfg.trail_opens), _at(cfg.trail_closes)
    if opens and not closes:
        closes = opens + timedelta(hours=24)
    return opens, closes


def event_phase(cfg, now: datetime) -> str | None:
    """"soon", "open" or "closed"; None when no window is set (always open)."""
    opens, closes = event_window(cfg)
    if not opens and not closes:
        return None
    if opens and now < opens:
        return "soon"
    if closes and now >= closes:
        return "closed"
    return "open"


def event_json(cfg) -> dict | None:
    opens, closes = event_window(cfg)
    if not opens and not closes:
        return None
    z = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ") if d else None
    return {"opens": z(opens), "closes": z(closes)}


class XError(Exception):
    def __init__(self, status: int, body: str = ""):
        super().__init__(f"X returned {status}: {body[:200]}")
        self.status, self.body = status, body


# ---------- money ----------
def spent_today(s, day: date) -> float:
    row = s.get(DailyCount, (day, SPEND_KEY))
    return (row.count if row else 0) / 1000.0


def add_spend(s, day: date, usd: float) -> None:
    m = int(round(usd * 1000))
    if m <= 0:
        return
    row = s.get(DailyCount, (day, SPEND_KEY))
    if row:
        row.count += m
    else:
        s.add(DailyCount(day=day, key=SPEND_KEY, count=m))
    s.commit()


# ---------- numbers as the card shows them ----------
def short(n: int) -> str:
    if n >= 1_000_000:
        v = f"{n / 1_000_000:.1f}".rstrip("0").rstrip(".")
        return v + "M"
    if n >= 10_000:
        v = f"{n / 1_000:.1f}".rstrip("0").rstrip(".")
        return v + "K"
    return f"{n:,}"


def long_date(d: date) -> str:
    return f"{d.day} {d:%b %Y}"


def short_date(d: date) -> str:
    return f"{d:%b} {d.day}"


def initials(name: str) -> str:
    return "".join(w[0] for w in name.split() if w)[:2].upper()


def compute(posts: list[dict], user: dict, today: date, others: list[int], mine: int | None = None) -> dict:
    """The card from a Keeper's posts. posts: [{id, at (datetime), m (public_metrics), mentions: [handles]}]."""
    posts = sorted(posts, key=lambda p: p["at"])
    n = len(posts)
    mt = lambda p, k: int((p.get("m") or {}).get(k) or 0)
    views = sum(mt(p, "impression_count") for p in posts)
    replies = sum(mt(p, "reply_count") for p in posts)
    reposts = sum(mt(p, "retweet_count") + mt(p, "quote_count") for p in posts)
    likes = sum(mt(p, "like_count") for p in posts)
    days = sorted({p["at"].date() for p in posts})
    first, last = (days[0], days[-1]) if days else (today, today)
    best_v = max(posts, key=lambda p: mt(p, "impression_count")) if posts else None
    best_l = max(posts, key=lambda p: mt(p, "like_count")) if posts else None
    # longest run of days in a row with a post
    streak = run = 0
    prev = None
    for d in days:
        run = run + 1 if prev and (d - prev).days == 1 else 1
        streak, prev = max(streak, run), d
    # weeks walked: weeks (Monday first) with at least one post, out of the weeks since the first post
    monday = lambda d: d - timedelta(days=d.weekday())
    total_weeks = ((monday(today) - monday(first)).days // 7 + 1) if days else 0
    weeks = len({monday(d) for d in days})
    # posting rhythm: the last 8 weeks, Monday to Sunday, today outlined
    per_day = Counter(p["at"].date() for p in posts)
    start = monday(today) - timedelta(weeks=7)
    rhythm = []
    for i in range(56):
        d = start + timedelta(days=i)
        if d == today:
            rhythm.append("t")
        elif d > today:
            rhythm.append(0)
        else:
            c = per_day.get(d, 0)
            rhythm.append(0 if c == 0 else 1 if c == 1 else 2 if c <= 3 else 3)
    # walks with most: the Keepers they bring along most (named in their posts), never themselves or the team
    me = (user.get("username") or "").lower()
    names = Counter()
    shown = {}
    for p in posts:
        for h in p.get("mentions") or []:
            k = h.lower()
            if k in (me, "pocket_dragons_"):
                continue
            names[k] += 1
            shown.setdefault(k, h)
    walks = [[shown[k], str(c), WALK_COLOURS[i % 3]] for i, (k, c) in enumerate(names.most_common(3))]
    # ahead of: share of the other Keepers on the trail (their counts also straight from X) with fewer dragon posts.
    # Until five others have walked it there is nobody fair to compare with, and the tile shows a dash.
    me_n = n if mine is None else mine
    if len(others) >= 5 and me_n > 0:
        ahead = round(100 * sum(1 for o in others if o < me_n) / len(others))
        ahead = str(max(1, min(99, ahead)))
    else:
        ahead = "—"
    bv = mt(best_v, "impression_count") if best_v else 0
    markers = [
        ["star", "First Spark", short_date(first) if days else "Not yet", 1 if days else 0],
        ["lantern", "Lantern Lit", "10K view post" if bv >= 10_000 else f"{short(bv)} best so far", 1 if bv >= 10_000 else 0],
        ["flame", "Seven Day Flame", f"{streak} days running" if streak >= 7 else f"{streak} of 7 days", 1 if streak >= 7 else 0],
        ["gate", "Gate Watcher", "Still locked", 0],
    ]
    name = user.get("name") or user.get("username") or ""
    return {
        "name": name, "handle": "@" + (user.get("username") or ""), "initials": initials(name),
        "avatar": "/api/trail/avatar" if user.get("avatar") else "",
        "posts": f"{n:,}", "views": short(views), "replies": f"{replies:,}", "reposts": f"{reposts:,}", "likes": f"{likes:,}",
        "followers": f"{int(user.get('followers') or 0):,}",
        "first": long_date(first), "last": long_date(last), "day": str((last - first).days + 1 if days else 0),
        "bestViews": f"{bv:,}", "bestViewsDate": short_date(best_v["at"].date()) if best_v else "",
        "bestLikes": f"{mt(best_l, 'like_count'):,}" if best_l else "0", "bestLikesDate": short_date(best_l["at"].date()) if best_l else "",
        "streak": str(streak), "weeks": str(weeks), "weeksTotal": str(total_weeks), "ahead": ahead,
        "rhythm": rhythm, "walks": walks, "markers": markers, "n": n, "viewsN": views, "v": CARD_V,
    }


# ---------- reading X ----------
def _post(p: dict) -> dict:
    at = datetime.strptime(p["created_at"][:19], "%Y-%m-%dT%H:%M:%S")
    ments = [m.get("username") for m in ((p.get("entities") or {}).get("mentions") or []) if m.get("username")]
    return {"id": p["id"], "at": at, "m": p.get("public_metrics") or {}, "mentions": ments}


def search_posts(http: requests.Session, bearer: str, username: str, budget: float, cost_post: float,
                 sleep=time.sleep) -> tuple[list[dict], float, str, bool]:
    """Every post the Keeper wrote about the dragons since the Hatchery opened, straight from X's full archive
    search. Nothing comes from pdtools' own collection."""
    h = {"Authorization": f"Bearer {bearer}", "User-Agent": "pdtools-trail/1.0"}
    q = f"from:{username} {TERMS} -is:retweet -is:reply"
    fields = {"tweet.fields": "created_at,public_metrics,entities", "max_results": 100}
    out, cost, partial = {}, 0.0, False

    def pages(path: str, start: datetime) -> None:
        nonlocal cost, partial
        token = None
        while len(out) < MAX_POSTS:
            if cost + 100 * cost_post > budget:
                partial = True
                return
            params = {"query": q, "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"), **fields}
            if token:
                params["next_token"] = token
            r = http.get(f"{API}{path}", params=params, headers=h, timeout=20)
            if r.status_code >= 400:
                raise XError(r.status_code, r.text)
            j = r.json()
            data = j.get("data") or []
            cost += len(data) * cost_post
            for p in data:
                out[p["id"]] = _post(p)
            token = (j.get("meta") or {}).get("next_token")
            if not token:
                return
            sleep(1.1)        # full archive search allows one request a second

    pages("/tweets/search/all", TRAIL_START)
    return list(out.values()), cost, "all", partial


def register(app, cfg, Session, tz, has_preview=None) -> None:
    http = requests.Session()
    inflight: set[str] = set()
    lock = threading.Lock()
    base = f"https://{cfg.canonical_host or 'pdtools.xyz'}"
    callback = cfg.trail_callback or f"{base}/trail/x/callback"

    def allowed() -> bool:
        return cfg.trail_public or bool(has_preview and has_preview())

    def today() -> date:
        return datetime.now(tz).date()

    @app.get("/trail")
    def trail_slash():
        if not allowed():
            abort(404)
        return redirect("/trail/")

    @app.get("/trail/")
    def trail_page():
        if not allowed():
            abort(404)
        if not (TRAIL_DIR / "index.html").exists():
            abort(404)
        resp = send_from_directory(TRAIL_DIR, "index.html", max_age=0)
        resp.headers["Cache-Control"] = "private, no-cache"
        resp.headers["X-Robots-Tag"] = "noindex, nofollow"
        return resp

    @app.get("/trail/<path:name>")
    def trail_file(name):
        if name.startswith("x/") or name == "index.html":
            abort(404)
        resp = send_from_directory(TRAIL_DIR, name, max_age=86400)
        return resp

    # ---------- sign in with X ----------
    @app.get("/trail/x/connect")
    def trail_connect():
        if not allowed():
            abort(404)
        if event_phase(cfg, utcnow()) in ("soon", "closed"):
            return redirect("/trail/")
        if not (cfg.x_client_id and cfg.x_client_secret):
            return redirect("/trail/?x=off")
        verifier = secrets.token_urlsafe(64)[:96]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        state = secrets.token_urlsafe(24)
        session["trail_oauth"] = {"s": state, "v": verifier, "t": int(time.time())}
        q = {"response_type": "code", "client_id": cfg.x_client_id, "redirect_uri": callback, "scope": "tweet.read users.read",
             "state": state, "code_challenge": challenge, "code_challenge_method": "S256"}
        return redirect(f"{AUTH_URL}?{urlencode(q)}")

    @app.get("/trail/x/callback")
    def trail_callback():
        if not allowed():
            abort(404)
        st = session.pop("trail_oauth", None)
        if request.args.get("error"):
            return redirect("/trail/?x=denied")
        if not st or not request.args.get("code") or not hmac.compare_digest(str(request.args.get("state", "")), str(st.get("s", ""))) \
                or time.time() - st.get("t", 0) > 900:
            return redirect("/trail/?x=err")
        try:
            r = http.post(TOKEN_URL, auth=(cfg.x_client_id, cfg.x_client_secret), timeout=20, data={
                "grant_type": "authorization_code", "code": request.args["code"], "redirect_uri": callback,
                "code_verifier": st["v"], "client_id": cfg.x_client_id})
            if r.status_code >= 400:
                app.logger.warning("trail token exchange failed: %s %s", r.status_code, r.text[:200])
                return redirect("/trail/?x=err")
            token = r.json().get("access_token", "")
            me = http.get(f"{API}/users/me", params={"user.fields": "name,username,profile_image_url,public_metrics"},
                          headers={"Authorization": f"Bearer {token}"}, timeout=20)
            with Session() as s:
                add_spend(s, today(), cfg.cost_per_user_usd)
            try:      # pdtools never keeps the token
                http.post(REVOKE_URL, auth=(cfg.x_client_id, cfg.x_client_secret), data={"token": token, "token_type_hint": "access_token", "client_id": cfg.x_client_id}, timeout=10)
            except requests.RequestException:
                pass
            if me.status_code >= 400:
                return redirect("/trail/?x=err")
            u = me.json().get("data") or {}
        except (requests.RequestException, ValueError):
            return redirect("/trail/?x=err")
        if not u.get("id"):
            return redirect("/trail/?x=err")
        pic = (u.get("profile_image_url") or "").replace("_normal.", "_400x400.")
        session["trail_user"] = {"id": u["id"], "username": u.get("username", ""), "name": u.get("name", ""),
                                 "avatar": pic if pic.startswith("https://pbs.twimg.com/") else "",
                                 "followers": int(((u.get("public_metrics") or {}).get("followers_count")) or 0)}
        session.permanent = True
        return redirect("/trail/?x=ok")

    @app.post("/trail/x/disconnect")
    def trail_disconnect():
        if not allowed():
            abort(404)
        session.pop("trail_user", None)
        return jsonify({"ok": True})

    # ---------- the card ----------
    def number(s, uid: str) -> tuple[int | None, datetime | None]:
        """The Keeper's card number and the day they opened it, given once, the first time their card is made, and never changed."""
        row = s.get(TrailCard, uid)
        if row is None:
            return None, None
        if row.no is None or row.opened_at is None:
            if row.no is None:
                row.no = (s.scalar(select(func.max(TrailCard.no))) or 0) + 1
            if row.opened_at is None:
                row.opened_at = utcnow()
            s.commit()
        return row.no, row.opened_at

    def with_no(card: dict, uid: str) -> dict:
        with Session() as s:
            n, at = number(s, uid)
        out = dict(card)
        if n:
            out["no"] = n
        if at:
            out["opened"] = at.strftime("%Y-%m-%dT%H:%M:%SZ")
        ev = event_json(cfg)
        if ev:
            out["event"] = ev
        return out

    @app.get("/api/trail/me")
    def trail_me():
        if not allowed():
            abort(404)
        now = utcnow()
        ph = event_phase(cfg, now)
        if ph == "soon":
            return jsonify({"why": "soon", "event": event_json(cfg)}), 403
        if ph == "closed":
            return jsonify({"why": "closed", "event": event_json(cfg)}), 410
        u = session.get("trail_user")
        if not u:
            ev = event_json(cfg)
            return jsonify({"connected": False, **({"event": ev} if ev else {})}), 401
        with Session() as s:
            row = s.get(TrailCard, u["id"])
            saved = json.loads(row.card) if row else None
            # one card per X account (9 Nov, Jon: to save X credits): once a card is made it is the Keeper's card for
            # good. It is never read from X again, on any day, even if it was cut short or an older card version.
            fresh = row is not None and saved is not None
            left = cfg.trail_daily_cap_usd - spent_today(s, today())
            # others to compare with: Keepers who walked the trail, their counts also from X
            others = [] if fresh else list(s.scalars(select(TrailCard.posts).where(TrailCard.user_id != u["id"])))
        if fresh:
            return jsonify({"card": with_no(saved, u["id"]), "cached": True})
        if not cfg.x_bearer_token:
            return jsonify({"why": "x", "handle": "@" + u["username"]}), 503
        if left < 0.6:          # not enough left today for even a small trail
            if saved:
                return jsonify({"card": with_no(saved, u["id"]), "cached": True, "stale": True})
            return jsonify({"why": "cap", "handle": "@" + u["username"]}), 429
        with lock:
            if u["id"] in inflight:
                return jsonify({"wait": True}), 202
            inflight.add(u["id"])
        try:
            # no database connection is held while X answers (the pool is small)
            try:
                posts, cost, source, partial = search_posts(http, cfg.x_bearer_token, u["username"], left, cfg.cost_per_post_usd)
            except (XError, requests.RequestException, ValueError) as e:
                app.logger.warning("trail search failed for %s: %s", u["username"], e)
                if saved:
                    return jsonify({"card": with_no(saved, u["id"]), "cached": True, "stale": True})
                return jsonify({"why": "x", "handle": "@" + u["username"]}), 503
            with Session() as s:
                add_spend(s, today(), cost)
                if not posts:
                    return jsonify({"why": "none", "handle": "@" + u["username"]}), 200
                card = compute(posts, u, today(), others)
                blob, views = json.dumps(card), min(card["viewsN"], 2**31 - 1)
                row = s.get(TrailCard, u["id"])
                if row:
                    row.username, row.card, row.posts, row.views, row.source, row.partial, row.cost_usd, row.fetched_at = \
                        u["username"], blob, card["n"], views, source, partial, cost, now
                else:
                    s.add(TrailCard(user_id=u["id"], username=u["username"], card=blob, posts=card["n"], views=views,
                                    source=source, partial=partial, cost_usd=cost, fetched_at=now))
                s.commit()
            return jsonify({"card": with_no(card, u["id"]), "cached": False, "partial": partial})
        finally:
            with lock:
                inflight.discard(u["id"])

    @app.get("/api/trail/avatar")
    def trail_avatar():
        """The Keeper's X picture from pdtools' own address, so the card can paint it onto the medallion."""
        if not allowed():
            abort(404)
        u = session.get("trail_user")
        if not u or not u.get("avatar", "").startswith("https://pbs.twimg.com/"):
            abort(404)
        try:
            r = http.get(u["avatar"], timeout=10)
        except requests.RequestException:
            abort(502)
        if r.status_code != 200 or not r.headers.get("Content-Type", "").startswith("image/"):
            abort(502)
        resp = Response(r.content, mimetype=r.headers["Content-Type"])
        resp.headers["Cache-Control"] = "private, max-age=86400"
        return resp
