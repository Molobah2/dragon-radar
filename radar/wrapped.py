"""Hatchery Wrapped: one Keeper's month on pdtools, told as a short story, plus how the whole hatchery did.

Only what this browser already did on pdtools is used (its own anonymous opens and hatches, keyed by the browser's
random number), and, for a Keeper who signed Blinky's Book of Friends, the opens their own posts received from
other signed Keepers. Dragons hatched come from the browser itself, so secret relics never leave the device.
"""
from collections import Counter
from datetime import date, timedelta

from sqlalchemy import func, select

from .circle import team_handles
from .db import Event, FriendDevice, Post

OPEN_KINDS = ("open", "popen")


def month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + (month == 12), month % 12 + 1, 1)
    return start, end


def best_run(days: list[date]) -> int:
    best = run = 0
    prev = None
    for d in sorted(set(days)):
        run = run + 1 if prev and d - prev == timedelta(days=1) else 1
        best = max(best, run); prev = d
    return best


def story(s, cfg, vid: str, year: int, month: int, today: date) -> dict:
    start, end = month_range(year, month)
    team = team_handles(s, cfg)
    rows = s.execute(select(Event.day, Event.ref).where(Event.vid == vid, Event.kind.in_(OPEN_KINDS),
                                                        Event.day >= start, Event.day < end)).all()
    days = [r.day for r in rows]
    refs = list({r.ref for r in rows if r.ref})
    by_post = {}
    for i in range(0, len(refs), 500):
        for pid, user in s.execute(select(Post.id, Post.author_username).where(Post.id.in_(refs[i:i + 500]), Post.hidden.is_(False))):
            if user and user.lower() not in team:
                by_post[pid] = user
    authors = Counter(by_post[r.ref] for r in rows if r.ref in by_post)     # every open counts, not just each post once
    names = {}
    if authors:
        for user, name in s.execute(select(Post.author_username, func.max(Post.author_name)).where(
                Post.author_username.in_(list(authors))).group_by(Post.author_username)):
            names[user] = name or user
    top = [{"user": u, "name": (names.get(u) or u)[:60], "n": n} for u, n in authors.most_common(3)]
    hatches = s.scalar(select(func.count()).select_from(Event).where(Event.vid == vid, Event.kind == "hatch",
                                                                     Event.day >= start, Event.day < end)) or 0
    me = {"opens": sum(authors.values()), "days": len(set(days)), "streak": best_run(days), "keepers": len(authors), "top": top,
          "hatches": hatches}

    # a signed Keeper also sees who opened their own posts (signed Keepers only, never anonymous browsers)
    dev = s.scalar(select(FriendDevice).where(FriendDevice.vid == vid, FriendDevice.confirmed.is_(True)))
    back = None
    if dev:
        mine = select(Post.id).where(func.lower(Post.author_username) == dev.key)
        signed = {d.vid: d.username for d in s.scalars(select(FriendDevice).where(FriendDevice.confirmed.is_(True)))}
        own = {v for v, u in signed.items() if u.lower() == dev.key} | {vid}
        got = [v for (v,) in s.execute(select(Event.vid).where(Event.kind.in_(OPEN_KINDS), Event.day >= start, Event.day < end,
                                                               Event.ref.in_(mine)))
               if v not in own]
        fans = Counter(signed[v] for v in got if v in signed)
        back = {"user": dev.username, "opens": len(got), "top": [{"user": u, "n": n} for u, n in fans.most_common(3)]}

    month_posts = select(Post.id).where(Post.created_at >= start, Post.created_at < end, Post.hidden.is_(False),
                                        Post.is_team.is_(False))
    firsts = (select(Post.author_id, func.min(Post.created_at).label("first"))
              .where(Post.is_team.is_(False), Post.hidden.is_(False)).group_by(Post.author_id).subquery())
    hatchery = {
        # opens made during the month (each browser once a day per post), not the lifetime count of the month's posts
        "opens": s.scalar(select(func.count()).select_from(Event).where(Event.kind == "open", Event.day >= start, Event.day < end)) or 0,
        "posts": s.scalar(select(func.count()).select_from(month_posts.subquery())) or 0,
        "new": s.scalar(select(func.count()).select_from(firsts).where(firsts.c.first >= start, firsts.c.first < end)) or 0,
        "hatches": s.scalar(select(func.count()).select_from(Event).where(Event.kind == "hatch", Event.day >= start, Event.day < end)) or 0,
        "keepers": s.scalar(select(func.count(func.distinct(Event.vid))).where(Event.kind == "open", Event.day >= start, Event.day < end)) or 0,
    }
    return {"ok": True, "month": start.strftime("%B"), "year": year, "key": f"{year}-{month:02d}",
            "so_far": start <= today < end, "me": me, "back": back, "hatchery": hatchery}
