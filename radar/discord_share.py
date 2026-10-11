"""Free collection from the community's Discord share channel.

A read only bot lists new messages in the share channel(s), pulls out X post links, and
reads each post through X's free oEmbed endpoint. The only paid call is a one time
profile check per new author (to keep the blue tick rule), cached for 30 days.
"""
import json
import logging
import re
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import select

from .db import AuthorCheck, BlockedAuthor, Post, get_setting, month_spend, set_setting

log = logging.getLogger(__name__)
API = "https://discord.com/api/v10"
LINK = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com/"
                  r"(?:[A-Za-z0-9_]{1,15}|i(?:/web)?)/status(?:es)?/(\d{6,25})", re.I)
DISCORD_EPOCH_MS = 1420070400000
X_EPOCH_MS = 1288834974657
RECHECK_DAYS = 30


def post_ids_in(text: str) -> list[str]:
    return list(dict.fromkeys(LINK.findall(text or "")))


def x_time(post_id: str) -> datetime:
    """X post ids carry their creation time."""
    ms = (int(post_id) >> 22) + X_EPOCH_MS
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)


def discord_snowflake(when: datetime) -> str:
    ms = int(when.replace(tzinfo=timezone.utc).timestamp() * 1000)
    return str((ms - DISCORD_EPOCH_MS) << 22)


def read_channel(token: str, channel_id: str, after: str, http, pages: int = 5) -> tuple[list[dict], str]:
    """Messages newer than `after`, oldest first, and the new bookmark."""
    out, newest = [], after
    for _ in range(pages):
        r = http.get(f"{API}/channels/{channel_id}/messages", params={"after": newest, "limit": 100},
                     headers={"Authorization": f"Bot {token}"}, timeout=15)
        if r.status_code == 429:
            break
        r.raise_for_status()
        batch = sorted(r.json(), key=lambda m: int(m["id"]))
        if not batch:
            break
        out.extend(batch)
        newest = batch[-1]["id"]
        if len(batch) < 100:
            break
    return out, newest


def message_text(m: dict) -> str:
    parts = [m.get("content") or ""]
    for e in m.get("embeds") or []:
        parts.append(e.get("url") or "")
    return "\n".join(parts)


def collect_discord(s, cfg, run, now: datetime, client=None, http=None) -> int:
    """Returns how many new posts were added."""
    if not (cfg.discord_bot_token and cfg.discord_channel_ids):
        return 0
    from . import oembed
    from .collector import is_blocked_text, blocklist
    from .directory import note_user

    own = http is None
    http = http or requests.Session()
    try:
        # 1. new links from each channel go into a queue, so nothing is lost if X is busy
        queue = json.loads(get_setting(s, "discord_queue") or "[]")
        for cid in [c.strip() for c in cfg.discord_channel_ids.split(",") if c.strip()]:
            key = f"discord_after:{cid}"
            after = get_setting(s, key) or discord_snowflake(now - timedelta(days=3))
            try:
                msgs, newest = read_channel(cfg.discord_bot_token, cid, after, http)
            except requests.RequestException as e:
                log.warning("Discord channel %s read failed: %s", cid, e)
                continue
            for m in msgs:
                queue.extend(post_ids_in(message_text(m)))
            set_setting(s, key, newest)
        queue = list(dict.fromkeys(queue))
        since = now - timedelta(days=cfg.feed_days)
        queue = [pid for pid in queue if x_time(pid) >= since]
        known = set(s.scalars(select(Post.id).where(Post.id.in_(queue)))) if queue else set()
        queue = [pid for pid in queue if pid not in known]

        # 2. read a batch for free through oEmbed
        batch, rest = queue[:cfg.discord_max_per_run], queue[cfg.discord_max_per_run:]
        found = []
        for i, pid in enumerate(batch):
            got = oembed.fetch(pid, http)
            if got is None:                 # X busy: keep the rest for next run
                rest = batch[i:] + rest
                break
            if got and got.get("username"):
                found.append((pid, got))
        set_setting(s, "discord_queue", json.dumps(rest[:500]))
        if not found:
            return 0

        # 3. one paid profile check per author we have not seen lately (blue tick rule)
        handles = {g["username"].lower(): g["username"] for _, g in found}
        checks = {c.key: c for c in s.scalars(select(AuthorCheck).where(AuthorCheck.key.in_(list(handles))))}
        stale = [h for h in handles if h not in checks or now - checks[h].checked_at > timedelta(days=RECHECK_DAYS)]
        if cfg.discord_require_verified and stale and client is not None:
            cost = len(stale) * cfg.cost_per_user_usd
            if month_spend(s, now) + run.est_cost_usd + cost <= cfg.monthly_spend_limit_usd:
                for i in range(0, len(stale), 100):
                    chunk = stale[i:i + 100]
                    users = client.users_by_usernames([handles[h] for h in chunk])
                    run.users_returned += len(users)
                    run.est_cost_usd += len(users) * cfg.cost_per_user_usd
                    by = {u["username"].lower(): u for u in users}
                    for h in chunk:
                        u = by.get(h)
                        c = checks.get(h) or AuthorCheck(key=h)
                        c.user_id = u.get("id") if u else None
                        c.username = u["username"] if u else handles[h]
                        c.name = ((u or {}).get("name") or "")[:100]
                        c.avatar = ((u or {}).get("profile_image_url") or "").replace("_normal.", "_bigger.")[:400] or None
                        c.verified = bool(u and u.get("verified"))
                        c.checked_at = now
                        checks[h] = s.merge(c)
                        if u:
                            note_user(s, u, "discord", now=now)

        # 4. store the posts (blue tick rule only when switched on; cached profiles still give a picture)
        blocked = set(s.scalars(select(BlockedAuthor.author_id)))
        words = blocklist(s, cfg)
        team = cfg.team_handle.lower()
        added = 0
        for pid, g in found:
            h = g["username"].lower()
            c = checks.get(h)
            is_team = h == team
            if cfg.discord_require_verified and not is_team and not (c and c.verified):
                run.posts_skipped += 1
                continue
            author_id = (c.user_id if c and c.user_id else f"u:{h}")
            if author_id in blocked or is_blocked_text(g["text"], words) or s.get(Post, pid):
                run.posts_skipped += 1
                continue
            s.add(Post(id=pid, author_id=author_id, created_at=x_time(pid), is_quote=False, is_team=is_team,
                       collected_at=now, text=(g["text"] or "")[:1200], author_name=(g["name"] or "")[:100] or None,
                       author_username=g["username"][:32], author_avatar=c.avatar if c else None,
                       has_media=bool(g["media"])))
            added += 1
        run.posts_new += added
        set_setting(s, "discord_last", json.dumps({"at": now.isoformat(), "added": added, "queued": len(rest)}))
        return added
    finally:
        if own:
            http.close()
