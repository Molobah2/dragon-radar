"""Keeper directory: verified accounts that wear the dragon in their display name.

Filled for free from data we already read (authors of collected posts, Keeper card
lookups). The only paid parts are the weekly refresh of the team profiles (5 user
reads) and the capped "add me" check (1 user read each).
"""
from datetime import datetime

from sqlalchemy.orm import Session

from .db import Keeper, utcnow

DRAGON_TAGS = ("\U0001F409",)  # the community's dragon tag, as the team asked


def has_dragon_tag(name: str | None) -> bool:
    return any(t in (name or "") for t in DRAGON_TAGS)


def big_avatar(url: str | None) -> str | None:
    return (url or "").replace("_normal.", "_bigger.") or None


def note_user(s: Session, user: dict, source: str, post_time: datetime | None = None,
              about_dragons: bool = False, now: datetime | None = None) -> Keeper | None:
    """Record what we just learned about an account. Only tagged, verified accounts are added;
    an account already listed is updated (and drops off if the tag was removed)."""
    if not user or not user.get("username"):
        return None
    now = now or utcnow()
    key = user["username"].lower()
    k = s.get(Keeper, key)
    tagged = has_dragon_tag(user.get("name"))
    # Blue tick only (X Premium). Gold business and grey government checks do not count.
    verified = bool(user.get("verified")) and user.get("verified_type") == "blue"
    if k is None:
        if not (tagged and verified):
            return None
        k = Keeper(key=key, username=user["username"], first_seen=now, source=source)
        s.add(k)
    k.user_id = user.get("id") or k.user_id
    k.username = user["username"]
    k.name = (user.get("name") or user["username"])[:100]
    k.avatar = big_avatar(user.get("profile_image_url")) or k.avatar
    k.verified, k.tagged, k.last_checked = verified, tagged, now
    if about_dragons and post_time and (k.last_post_at is None or post_time > k.last_post_at):
        k.last_post_at = post_time
    return k
