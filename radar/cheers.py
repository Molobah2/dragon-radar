"""Cheers: signed Keepers send each other a thank you lantern inside pdtools, with one kind preset line.

Only Keepers who signed Blinky's Book of Friends can send, so every Cheer carries a real name and nobody can spam.
One Cheer per sender per Keeper per week, at most DAILY a day, never to yourself, and only to a Keeper who has
shared a dragon post on pdtools. Nothing touches X: no likes, no follows, no posts are made for anyone.
Every Monday the week starts fresh, and each Keeper gets a "cheered you" card for the week.
"""
from collections import Counter
from datetime import date, datetime, timedelta

from sqlalchemy import func, select

from .circle import clean, team_handles
from .db import BlockedAuthor, Cheer, FriendDevice, Post

PRESETS = [
    "Thank you for the support",
    "Your art made my day",
    "Welcome to the hatchery",
    "Thanks for always showing up",
    "Your posts keep me going",
    "Great guide, thank you",
    "Glad we are friends",
    "You make the hatchery brighter",
]
DAILY = 10


def week_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def sender(s, vid: str):
    """The signed Keeper behind this browser, or None."""
    return s.scalar(select(FriendDevice).where(FriendDevice.vid == vid, FriendDevice.confirmed.is_(True)))


def known_author(s, cfg, handle: str) -> str | None:
    """The right spelling of a Keeper who has shared a dragon post on pdtools (never the team or a blocked author)."""
    h = clean(handle).lower()
    if not h or h in team_handles(s, cfg):
        return None
    rows = s.execute(select(Post.author_username, Post.author_id).where(func.lower(Post.author_username) == h, Post.hidden.is_(False))
                     .order_by(Post.created_at.desc())).all()
    if not rows:
        return None
    ids = {r.author_id for r in rows}
    if s.scalar(select(func.count()).select_from(BlockedAuthor).where(BlockedAuthor.author_id.in_(ids))):
        return None                         # any blocked post under this name keeps it out, like the search does
    return rows[0].author_username


def send(s, cfg, vid: str, to: str, preset: int, now: datetime) -> dict:
    dev = sender(s, vid)
    if not dev:
        return {"ok": False, "why": "unsigned"}
    blocked_ids = select(BlockedAuthor.author_id)
    if s.scalar(select(func.count()).select_from(Post).where(func.lower(Post.author_username) == dev.key, Post.author_id.in_(blocked_ids))):
        return {"ok": False, "why": "unsigned"}          # a blocked author cannot send lanterns either
    if not 0 <= preset < len(PRESETS):
        return {"ok": False, "why": "preset"}
    user = known_author(s, cfg, to)
    if not user:
        return {"ok": False, "why": "unknown"}
    key = user.lower()
    if key == dev.key:
        return {"ok": False, "why": "self"}
    week = week_of(now.date())
    if s.get(Cheer, (week, dev.key, key)):
        return {"ok": False, "why": "already"}
    start = datetime(now.year, now.month, now.day)
    today = s.scalar(select(func.count()).select_from(Cheer).where(Cheer.from_key == dev.key, Cheer.created_at >= start)) or 0
    if today >= DAILY:
        return {"ok": False, "why": "daily"}
    s.add(Cheer(week=week, from_key=dev.key, to_key=key, to_user=user, preset=preset, created_at=now))
    return {"ok": True, "to": user, "left": DAILY - today - 1}


def names(s, keys) -> dict:
    """Display handles for signed Keepers (their own spelling from the book)."""
    keys = list(keys)
    if not keys:
        return {}
    return {d.key: d.username for d in s.scalars(select(FriendDevice).where(FriendDevice.key.in_(keys), FriendDevice.confirmed.is_(True)))}


def week_for(s, key: str, week: date) -> dict:
    """Everything one Keeper got this week (for their card), and what they sent."""
    got = s.scalars(select(Cheer).where(Cheer.week == week, Cheer.to_key == key).order_by(Cheer.created_at.desc())).all()
    sent = s.scalars(select(Cheer).where(Cheer.week == week, Cheer.from_key == key).order_by(Cheer.created_at.desc())).all()
    who = names(s, {c.from_key for c in got})
    lines = Counter(c.preset for c in got)
    return {
        "week": week.isoformat(), "count": len(got),
        "from": [{"user": who.get(c.from_key, c.from_key), "line": PRESETS[c.preset] if 0 <= c.preset < len(PRESETS) else PRESETS[0]} for c in got],
        "top_line": PRESETS[lines.most_common(1)[0][0]] if lines else None,
        "sent": [{"user": c.to_user or c.to_key, "line": PRESETS[c.preset] if 0 <= c.preset < len(PRESETS) else PRESETS[0]} for c in sent],
    }


def card(user: str, info: dict, avatar, cheerers: list, week_label: str) -> bytes:
    """The lantern festival card: the Keeper glowing in the middle of rising lanterns, the Keepers who cheered
    them below, Pinky hugging her heart lantern."""
    from PIL import Image, ImageDraw
    from .v21 import ART, _cover, _disc, _fit, _font, _glow, _gradient, _png, _shadow_text
    W, H = 1200, 675
    bg = _cover(ART / "cheers-a.jpg", W, H, .45)
    bg.alpha_composite(_gradient((W, H), 300, (10, 6, 20), 235))
    cx, cy, size = 330, 250, 210
    bg.alpha_composite(_glow((W, H), (cx - 200, cy - 200, cx + 200, cy + 200), (255, 196, 110), 70, 220))
    ring = Image.new("RGBA", (size + 20, size + 20), (0, 0, 0, 0)); d = ImageDraw.Draw(ring)
    d.ellipse((0, 0, size + 19, size + 19), fill=(255, 205, 110, 255)); d.ellipse((5, 5, size + 14, size + 14), fill=(255, 240, 200, 255))
    ring.alpha_composite(_disc(avatar, size, user), (10, 10))
    bg.alpha_composite(ring, (cx - ring.width // 2, cy - ring.height // 2))
    pinky = Image.open(ART / "pinky-heart.webp").convert("RGBA")
    ph = 400; pinky = pinky.resize((round(pinky.width * ph / pinky.height), ph), Image.LANCZOS)
    bg.alpha_composite(_glow((W, H), (W - 360, H - 110, W - 40, H + 60), (0, 0, 0), 30, 150))
    bg.alpha_composite(pinky, (W - pinky.width - 50, H - ph - 6))
    d = ImageDraw.Draw(bg)
    n = info["count"]
    _shadow_text(bg, (cx, 420), "@" + user, _fit(d, "@" + user, True, 50, 30, 520), (255, 205, 110))
    _shadow_text(bg, (cx, 478), f"was cheered by {n} {'Keeper' if n == 1 else 'Keepers'}", _font(True, 36), (255, 247, 232))
    _shadow_text(bg, (cx, 522), week_label, _font(False, 24), (240, 222, 200), blur=4)
    if info.get("top_line"):
        q = f"“{info['top_line']}”"
        _shadow_text(bg, (cx, 572), q, _fit(d, q, False, 28, 18, 560), (255, 232, 205), blur=4)
    # up to six small pictures of the Keepers who cheered
    x0 = 580
    for i, (u, im) in enumerate(cheerers[:6]):
        disc = _disc(im, 74, u)
        ring2 = Image.new("RGBA", (84, 84), (0, 0, 0, 0)); ImageDraw.Draw(ring2).ellipse((0, 0, 83, 83), fill=(255, 220, 160, 255))
        ring2.alpha_composite(disc, (5, 5))
        bg.alpha_composite(ring2, (x0 + (i % 3) * 92, 150 + (i // 3) * 96))
    if cheerers:
        _shadow_text(bg, (x0 + 4, 122), "Cheered by", _font(True, 26), (255, 232, 205), anchor="lm", blur=3)
    d.rounded_rectangle((60, 46, 60 + d.textlength("CHEERS", font=_font(True, 24)) + 40, 88), 21, fill=(255, 205, 110, 255))
    d.text((80, 67), "CHEERS", font=_font(True, 24), fill=(52, 24, 10), anchor="lm")
    _shadow_text(bg, (W - 34, H - 30), "pdtools.xyz", _font(True, 24), (255, 240, 222), anchor="rm", blur=3)
    return _png(bg)
