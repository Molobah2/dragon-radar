"""Free profile pictures for posts that arrive without one (the Discord share channel).

X's oEmbed gives no picture, so we ask the public FxTwitter API (no key, not billed by X)
once per author and reuse the answer for all of their posts.
"""
from datetime import datetime, timedelta

import requests
from sqlalchemy import select

from .db import Post

URL = "https://api.fxtwitter.com/{user}/status/{id}"


def avatar_for(username: str, post_id: str, http, timeout: int = 8) -> str | None:
    """The author's picture URL, '' when there is none, None on a temporary error."""
    try:
        r = http.get(URL.format(user=username or "i", id=post_id), timeout=timeout,
                     headers={"User-Agent": "pdtools.xyz (community feed)"})
    except requests.RequestException:
        return None
    if r.status_code == 404:
        return ""
    if r.status_code != 200:
        return None
    try:
        author = ((r.json() or {}).get("tweet") or {}).get("author") or {}
    except ValueError:
        return None
    url = author.get("avatar_url") or ""
    return url.replace("_normal.", "_bigger.")[:400]


def known_avatar(s, username: str) -> str | None:
    """A picture we already have for this handle from another post."""
    if not username:
        return None
    return s.scalar(select(Post.author_avatar).where(Post.author_username.ilike(username), Post.author_avatar.is_not(None))
                    .order_by(Post.collected_at.desc()).limit(1))


def backfill_avatars(s, cfg, now: datetime, http=None, limit: int = 40) -> int:
    """Give recent posts without a picture one: reuse a known picture, else one lookup per author."""
    since = now - timedelta(days=cfg.feed_days)
    rows = s.scalars(select(Post).where(Post.author_avatar.is_(None), Post.author_username.is_not(None),
                                        Post.hidden.is_(False), Post.created_at >= since)
                     .order_by(Post.created_at.desc()).limit(400)).all()
    by_user: dict[str, list[Post]] = {}
    for p in rows:
        by_user.setdefault(p.author_username.lower(), []).append(p)
    own = http is None
    http = http or requests.Session()
    filled = looked = 0
    try:
        for handle, posts in by_user.items():
            pic = known_avatar(s, handle)
            if not pic:
                if looked >= limit:
                    continue
                looked += 1
                pic = avatar_for(posts[0].author_username, posts[0].id, http)
                if pic is None:
                    break          # service busy, try again next run
            if pic:
                for p in posts:
                    p.author_avatar = pic
                    filled += 1
    finally:
        if own:
            http.close()
    return filled
