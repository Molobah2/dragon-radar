"""Discord daily drop: one tidy message a day in the Pocket Dragons Discord.

  From the team: the newest official post from the last day.
  Most loved by Keepers today: the three community posts opened most in the last 24 hours.
  A link to the rest on Blinky's Friends.

Switched off until DROP_CHANNEL_ID is set on Render, and only after the team says yes and gives the bot
permission to post in that one channel. Posts at most once a day, at or after DROP_HOUR local time,
whoever calls the cron address.
"""
import logging
from datetime import datetime, timedelta

import requests
from sqlalchemy import select

from .db import Post, get_setting, set_setting, utcnow

log = logging.getLogger(__name__)
API = "https://discord.com/api/v10"


def build(s, now_utc: datetime) -> str | None:
    since = now_utc - timedelta(hours=24)
    official = s.scalars(select(Post).where(Post.is_team.is_(True), Post.hidden.is_(False), Post.created_at >= since)
                         .order_by(Post.created_at.desc()).limit(1)).first()
    loved = s.scalars(select(Post).where(Post.is_team.is_(False), Post.hidden.is_(False), Post.created_at >= since,
                                         Post.opens >= 3, Post.author_username.is_not(None))
                      .order_by(Post.opens.desc(), Post.created_at.desc()).limit(3)).all()
    if not official and not loved:
        return None
    lines = ["\U0001F409 **Today in the Hatchery**", ""]
    if official:
        lines += ["**From the team**", f"https://x.com/{official.author_username or 'i'}/status/{official.id}", ""]
    if loved:
        lines.append("**Most loved by Keepers today**")
        for i, p in enumerate(loved, 1):
            # angle brackets keep Discord from unfurling three big previews
            lines.append(f"{i}. @{p.author_username} <https://x.com/{p.author_username}/status/{p.id}>")
        lines.append("")
    lines.append("Show some love to the rest on Blinky's Friends: <https://pdtools.xyz/friends>")
    return "\n".join(lines)


def run_drop(s, cfg, now_local: datetime, post=requests.post) -> dict:
    if not cfg.drop_channel_id or not cfg.discord_bot_token:
        return {"sent": False, "reason": "off"}
    if now_local.hour < cfg.drop_hour:
        return {"sent": False, "reason": "too early"}
    day = now_local.date().isoformat()
    if get_setting(s, "drop_last_day") == day:
        return {"sent": False, "reason": "already sent today"}
    text = build(s, utcnow())
    if not text:
        return {"sent": False, "reason": "nothing today"}
    set_setting(s, "drop_last_day", day)          # mark first, so a slow reply never sends twice
    s.flush()
    try:
        r = post(f"{API}/channels/{cfg.drop_channel_id}/messages", timeout=15,
                 headers={"Authorization": f"Bot {cfg.discord_bot_token}", "Content-Type": "application/json"},
                 json={"content": text, "allowed_mentions": {"parse": []}})
    except requests.RequestException as e:
        log.warning("daily drop failed: %s", e)
        set_setting(s, "drop_last_day", "")
        return {"sent": False, "reason": "network"}
    if r.status_code >= 300:
        log.warning("daily drop refused: %s %s", r.status_code, r.text[:200])
        set_setting(s, "drop_last_day", "")
        return {"sent": False, "reason": f"discord {r.status_code}"}
    return {"sent": True}
