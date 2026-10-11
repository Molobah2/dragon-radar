"""Visitor counting for pdtools, kept private and simple.

Each browser makes up a random id once and keeps it in its own storage. The site stores only that
random id, the days it visited, how many pages it opened, phone or computer, and where the first
visit came from (X, Discord, a search engine or direct). No names, X accounts or IP addresses.
"""
import re
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

from sqlalchemy import func, select

from .db import DailyCount, Visitor, VisitDay, utcnow

VID = re.compile(r"^[a-f0-9]{16,32}$")
BOTS = re.compile(r"bot|crawl|spider|slurp|preview|facebookexternalhit|embed|headless|lighthouse|monitor|curl|python",
                  re.I)
PAGES = {"/": "home", "/friends": "friends", "/friends/keepers": "keepers"}


def device_of(ua: str) -> str:
    return "phone" if re.search(r"iphone|android|mobile|ipad|ipod", ua or "", re.I) else "computer"


def source_of(ref: str, own_host: str) -> str:
    host = (urlparse(ref or "").hostname or "").lower().removeprefix("www.")
    if not host or host == own_host or host.endswith(".onrender.com"):
        return "direct"
    if host in ("x.com", "t.co", "twitter.com", "mobile.twitter.com", "pro.x.com"):
        return "x"
    if "discord" in host:
        return "discord"
    if any(k in host for k in ("google.", "bing.", "duckduckgo.", "yahoo.", "brave.")):
        return "search"
    if host in ("t.me", "web.telegram.org"):
        return "telegram"
    return host[:40]


def bump(s, day: date, key: str) -> None:
    row = s.get(DailyCount, (day, key))
    if row is None:
        s.add(DailyCount(day=day, key=key, count=1))
    else:
        row.count += 1


def record(s, vid: str, path: str, ref: str, ua: str, today: date, own_host: str) -> bool:
    """Count one page view. Returns False when the hit is ignored (bad id, bot, unknown page)."""
    if not VID.match(vid or "") or BOTS.search(ua or "") or path not in PAGES:
        return False
    now = utcnow()
    v = s.get(Visitor, vid)
    first_today = s.get(VisitDay, (today, vid)) is None
    if v is None:
        v = Visitor(vid=vid, first_seen=now, last_seen=now, days=1, views=0, device=device_of(ua),
                    source=source_of(ref, own_host))
        s.add(v)
        bump(s, today, "new")
    elif first_today:
        v.days = (v.days or 0) + 1
    v.last_seen, v.views = now, (v.views or 0) + 1
    if first_today:
        s.add(VisitDay(day=today, vid=vid, views=1))
        bump(s, today, "src:" + source_of(ref, own_host))
        bump(s, today, "dev:" + device_of(ua))
    else:
        s.get(VisitDay, (today, vid)).views += 1
    bump(s, today, "views")
    bump(s, today, "page:" + PAGES[path])
    return True


def summary(s, today: date) -> dict:
    """Numbers for the admin page."""
    def uniques(since: date) -> int:
        return s.scalar(select(func.count(func.distinct(VisitDay.vid))).where(VisitDay.day >= since)) or 0

    def counts(since: date, prefix: str) -> dict:
        rows = s.execute(select(DailyCount.key, func.sum(DailyCount.count)).where(
            DailyCount.day >= since, DailyCount.key.like(prefix + "%")).group_by(DailyCount.key)).all()
        return {k[len(prefix):]: int(n) for k, n in rows}

    week, month = today - timedelta(days=6), today - timedelta(days=29)
    total = s.scalar(select(func.count()).select_from(Visitor)) or 0
    returning = s.scalar(select(func.count()).select_from(Visitor).where(Visitor.days > 1)) or 0
    devices = dict(s.execute(select(Visitor.device, func.count()).group_by(Visitor.device)).all())
    days = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        n = s.scalar(select(func.count()).select_from(VisitDay).where(VisitDay.day == d)) or 0
        views = (s.get(DailyCount, (d, "views")).count if s.get(DailyCount, (d, "views")) else 0)
        days.append({"day": d, "people": n, "views": views})
    peak = max([d["people"] for d in days] + [1])
    return {
        "total": total, "today": uniques(today), "week": uniques(week), "month": uniques(month),
        "new_today": counts(today, "new").get("", 0), "returning": returning,
        "returning_pct": round(100 * returning / total) if total else 0,
        "views_today": counts(today, "views").get("", 0), "views_week": counts(week, "views").get("", 0),
        "phone_pct": round(100 * devices.get("phone", 0) / total) if total else 0,
        "sources": sorted(counts(week, "src:").items(), key=lambda kv: -kv[1])[:8],
        "pages": sorted(counts(week, "page:").items(), key=lambda kv: -kv[1]),
        "days": days, "peak": peak,
    }


def public_summary(s, today: date) -> dict:
    """The friendly numbers everyone can see on the home page (v2). No sources, devices or anything per person."""
    def uniques(since: date) -> int:
        return s.scalar(select(func.count(func.distinct(VisitDay.vid))).where(VisitDay.day >= since)) or 0

    total = s.scalar(select(func.count()).select_from(Visitor)) or 0
    first = s.scalar(select(func.min(Visitor.first_seen)))
    since = first.date() if first else today
    start = max(since, today - timedelta(days=13))      # the chart starts on the first counted day and fills up
    rows = dict(s.execute(select(VisitDay.day, func.count()).where(VisitDay.day >= start).group_by(VisitDay.day)).all())
    days = [{"day": start + timedelta(days=i), "people": rows.get(start + timedelta(days=i), 0)}
            for i in range((today - start).days + 1)]
    return {
        "total": total,
        "week": uniques(today - timedelta(days=6)),
        "today": uniques(today),
        "returning": s.scalar(select(func.count()).select_from(Visitor).where(Visitor.days > 1)) or 0,
        "views": int(s.scalar(select(func.coalesce(func.sum(Visitor.views), 0))) or 0),
        "since": since, "empty": 14 - len(days),
        "days": days, "peak": max([d["people"] for d in days] + [1]),
    }
