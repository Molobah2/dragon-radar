"""Free profile details for authors who arrive through the Discord share channel.

X's oEmbed gives no picture or blue tick, so we ask the public FxTwitter API (no key, not
billed by X) once per author, cache the answer in AuthorCheck for 30 days, and use it to
  1. give every post a profile picture, and
  2. fill the Keepers directory automatically: blue tick plus the dragon in the name.
"""
from datetime import datetime, timedelta

import requests
from sqlalchemy import func, select

from .db import AuthorCheck, Post

PROFILE = "https://api.fxtwitter.com/{user}"
RECHECK_DAYS = 30
UA = {"User-Agent": "pdtools.xyz (community feed)"}


def profile(username: str, http, timeout: int = 8) -> dict | None:
    """X style user dict, {} when the account is gone, None on a temporary error."""
    try:
        r = http.get(PROFILE.format(user=username), timeout=timeout, headers=UA)
    except requests.RequestException:
        return None
    if r.status_code == 404:
        return {}
    if r.status_code != 200:
        return None
    try:
        u = (r.json() or {}).get("user") or {}
    except ValueError:
        return None
    if not u.get("screen_name"):
        return {}
    v = u.get("verification") or {}
    kind = v.get("type")
    return {
        "id": str(u.get("id") or ""),
        "username": u["screen_name"],
        "name": u.get("name") or u["screen_name"],
        "profile_image_url": (u.get("avatar_url") or "").replace("_normal.", "_bigger.")[:400],
        "verified": bool(v.get("verified")),
        # FxTwitter calls the blue tick "individual"; gold and grey checks do not count
        "verified_type": "blue" if v.get("verified") and kind in (None, "individual", "blue") else (kind or ""),
    }


def known_avatar(s, username: str) -> str | None:
    """A picture we already have for this handle."""
    if not username:
        return None
    c = s.get(AuthorCheck, username.lower())
    if c and c.avatar:
        return c.avatar
    return s.scalar(select(Post.author_avatar).where(func.lower(Post.author_username) == username.lower(),
                                                     Post.author_avatar.is_not(None))
                    .order_by(Post.collected_at.desc()).limit(1))


def refresh_authors(s, cfg, now: datetime, http=None, limit: int = 40) -> dict:
    """One pass per collection: look up authors of recent posts we have not checked lately,
    fill missing pictures, and add blue tick dragon wearers to the Keepers directory."""
    from .directory import has_dragon_tag, note_user

    since = now - timedelta(days=cfg.feed_days)
    rows = s.execute(select(Post.author_username, func.max(Post.created_at), func.max(Post.author_name),
                            func.count(Post.id).filter(Post.author_avatar.is_(None)))
                     .where(Post.author_username.is_not(None), Post.hidden.is_(False), Post.created_at >= since)
                     .group_by(Post.author_username)).all()
    # who needs a look: no picture yet first, then anyone wearing the dragon, newest first
    todo = []
    for handle, last, name, missing in rows:
        c = s.get(AuthorCheck, handle.lower())
        fresh = c is not None and now - c.checked_at < timedelta(days=RECHECK_DAYS)
        if fresh and has_dragon_tag(name) and not (c.verified and has_dragon_tag(c.name)):
            # they wear the dragon in their posts now: look again if they put it on after our last look,
            # or after a day if the blue tick was what was missing (people get Premium to join)
            if not has_dragon_tag(c.name) or now - c.checked_at >= timedelta(days=1):
                fresh = False
        if missing and c and c.avatar:
            todo.append((0, last, handle, c, False))        # picture known, no call needed
        elif not fresh and (missing or has_dragon_tag(name)):
            todo.append((1 if missing else 2, last, handle, c, True))
    todo.sort(key=lambda t: (t[0], -(t[1].timestamp() if t[1] else 0)))

    own = http is None
    http = http or requests.Session()
    out = {"looked": 0, "pictures": 0, "keepers": 0}
    try:
        for _, last, handle, c, need_call in todo:
            if need_call:
                if out["looked"] >= limit:
                    continue
                out["looked"] += 1
                u = profile(handle, http)
                if u is None:
                    break                                    # service busy: try again next run
                c = c or AuthorCheck(key=handle.lower())
                c.username = (u.get("username") or handle)[:32]
                c.user_id = u.get("id") or c.user_id
                c.name = (u.get("name") or "")[:100]
                c.avatar = u.get("profile_image_url") or None
                c.verified = bool(u.get("verified")) and u.get("verified_type") == "blue"
                c.checked_at = now
                c = s.merge(c)
                if u and note_user(s, u, "discord", post_time=last, about_dragons=True, now=now):
                    out["keepers"] += 1
            pic = (c.avatar if c else None) or known_avatar(s, handle)
            if pic:
                for p in s.scalars(select(Post).where(func.lower(Post.author_username) == handle.lower(),
                                                      Post.author_avatar.is_(None))):
                    p.author_avatar = pic
                    out["pictures"] += 1
    finally:
        if own:
            http.close()
    return out


def backfill_avatars(s, cfg, now: datetime, http=None, limit: int = 40) -> int:
    """Kept for older callers: the picture part of refresh_authors."""
    return refresh_authors(s, cfg, now, http=http, limit=limit)["pictures"]
