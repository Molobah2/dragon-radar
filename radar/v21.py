"""pdtools v2.1, wave 1: the New Keeper welcome lane and Creator of the week.

Welcome lane: Keepers who shared their official "Keeper of the Ancient Hatchery" join card for the first time in the last three days, with how long
it has waited and how many people opened it, so the community can be the first to say hello.

Creator of the week: pdtools suggests, Jon approves. The suggestion only looks at public posts shared on pdtools in
the last seven days (opens, replies and quote posts from other Keepers, posts with art, how often they posted).
Nothing is ever chosen on its own: a pick is saved only when Jon approves it on his own device.
"""
import io
import json
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func, or_, select

from .circle import clean, team_handles
from .db import BlockedAuthor, Post, PostLink, get_setting, set_setting

ART = Path(__file__).parent / "static" / "v21"
FONTS = Path(__file__).parent / "fonts"
WELCOME_HOURS = 72
CREATOR_DAYS = 7
PICKS_KEY = "v21:creators"


# ---------- welcome lane ----------
JOIN_CARD = "keeper of the ancient hatchery"     # the line on the official egg card every new Keeper shares when they join


def welcome_lane(s, cfg, now: datetime, hours: int = WELCOME_HOURS) -> list[dict]:
    """Keepers who just joined: each one's first post of the official join card ("Keeper of the Ancient Hatchery")
    from the last few days, the ones nobody opened yet first. A first post on pdtools alone is not enough, since many
    long time fans only get their first post shared here much later."""
    since = now - timedelta(hours=hours)
    blocked = set(s.scalars(select(BlockedAuthor.author_id)))
    firsts = (select(Post.author_id, func.min(Post.created_at).label("first"))
              .where(Post.is_team.is_(False), Post.text.ilike(f"%{JOIN_CARD}%"),
                     # the same line ends every Ember Chamber score share too, so game nights are left out
                     ~Post.text.ilike("%chamber%"), ~Post.text.ilike("% night.%"))
              .group_by(Post.author_id).subquery())
    rows = s.execute(select(Post).join(firsts, (Post.author_id == firsts.c.author_id) & (Post.created_at == firsts.c.first))
                     .where(firsts.c.first >= since, Post.hidden.is_(False), Post.is_team.is_(False))).scalars().all()
    team = team_handles(s, cfg)
    out, seen = [], set()
    for p in rows:
        user = (p.author_username or "").strip()
        if not user or p.author_id in blocked or user.lower() in team or p.author_id in seen:
            continue
        seen.add(p.author_id)
        out.append({"id": p.id, "user": user, "name": (p.author_name or user)[:60], "text": (p.text or "")[:280],
                    "at": p.created_at.isoformat() + "Z", "waited_h": max(0, int((now - p.created_at).total_seconds() // 3600)),
                    "opens": int(p.opens or 0), "media": bool(p.has_media)})
    out.sort(key=lambda x: (x["opens"] > 0, x["opens"], x["at"]))
    return out


def welcome_person(s, cfg, handle: str, now: datetime) -> dict | None:
    """One Keeper's join card post (for their welcome card), if it is recent enough to still welcome."""
    h = clean(handle).lower()
    if not h:
        return None
    for x in welcome_lane(s, cfg, now, hours=24 * 7):
        if x["user"].lower() == h:
            return x
    return None


# ---------- creator of the week ----------
def week_start(now: datetime) -> datetime:
    d = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return d - timedelta(days=d.weekday())


def picks(s) -> list[dict]:
    try:
        got = json.loads(get_setting(s, PICKS_KEY, "[]") or "[]")
    except ValueError:
        return []
    return [p for p in got if isinstance(p, dict) and p.get("user") and p.get("week")]


def current_pick(s, now: datetime) -> dict | None:
    """The approved creator for this week, or last week's while Jon has not picked yet."""
    ps = sorted(picks(s), key=lambda p: p["week"], reverse=True)
    this = week_start(now).date().isoformat()
    for p in ps:
        if p["week"] <= this:
            return {**p, "current": p["week"] == this}
    return None


def save_pick(s, now: datetime, user: str, name: str, note: str) -> dict:
    week = week_start(now).date().isoformat()
    ps = [p for p in picks(s) if p["week"] != week]
    pick = {"week": week, "user": user, "name": (name or user)[:60], "note": (note or "").strip()[:160], "at": now.isoformat()}
    ps.append(pick)
    set_setting(s, PICKS_KEY, json.dumps(sorted(ps, key=lambda p: p["week"])[-60:]))
    return pick


def drop_pick(s, now: datetime) -> None:
    week = week_start(now).date().isoformat()
    set_setting(s, PICKS_KEY, json.dumps([p for p in picks(s) if p["week"] != week]))


def creator_stats(s, cfg, now: datetime, days: int = CREATOR_DAYS) -> list[dict]:
    """Everyone who posted about the dragons this week, scored for Jon to look at (he always decides)."""
    since = now - timedelta(days=days)
    team = team_handles(s, cfg) | {(cfg.author_x or "").lower().lstrip("@")}   # Jon never suggests himself
    blocked = set(s.scalars(select(BlockedAuthor.author_id)))
    posts = s.scalars(select(Post).where(Post.created_at >= since, Post.hidden.is_(False), Post.is_team.is_(False))).all()
    people: dict[str, dict] = {}
    by_post = {}
    for p in posts:
        user = (p.author_username or "").strip()
        if not user or p.author_id in blocked or user.lower() in team:
            continue
        k = user.lower()
        me = people.setdefault(k, {"user": user, "name": (p.author_name or user)[:60], "posts": 0, "opens": 0, "art": 0,
                                   "engagers": set(), "top": []})
        me["posts"] += 1; me["opens"] += int(p.opens or 0); me["art"] += 1 if p.has_media else 0
        me["top"].append({"id": p.id, "text": (p.text or "")[:200], "opens": int(p.opens or 0), "media": bool(p.has_media)})
        by_post[p.id] = k
    if by_post:
        links = s.scalars(select(PostLink).where(PostLink.post_id.in_(list(by_post)), PostLink.done.is_(True),
                                                 or_(PostLink.reply_to.is_not(None), PostLink.quote_of.is_not(None)))).all()
        for ln in links:
            giver = by_post.get(ln.post_id)
            for target in {ln.reply_to, ln.quote_of} - {None}:
                t = target.lower()
                if t in people and t != giver:
                    people[t]["engagers"].add(giver)
    out = []
    for me in people.values():
        eng = len(me.pop("engagers"))
        me["engaged"] = eng
        me["top"] = sorted(me["top"], key=lambda x: (-x["opens"], not x["media"]))[:3]
        # a reply or quote from another Keeper counts most; pictures (any image, screenshots too) and posting a lot
        # only help a little and stop at seven
        me["score"] = me["opens"] + 4 * eng + min(me["art"], 7) + 2 * min(me["posts"], 7)
        out.append(me)
    out.sort(key=lambda x: (-x["score"], x["user"].lower()))
    return out


def suggestions(s, cfg, now: datetime, n: int = 10) -> list[dict]:
    """The top of the week, leaving out anyone featured in the last four weeks so the spotlight moves around."""
    recent = {p["user"].lower() for p in picks(s) if p["week"] >= (week_start(now) - timedelta(weeks=4)).date().isoformat()
              and p["week"] != week_start(now).date().isoformat()}
    return [x for x in creator_stats(s, cfg, now) if x["user"].lower() not in recent][:n]


# ---------- share cards ----------
def _font(bold: bool, n: int):
    from PIL import ImageFont
    return ImageFont.truetype(str(FONTS / ("fredoka-700.ttf" if bold else "fredoka-600.ttf")), n)


def _cover(path: Path, w: int, h: int, focus_y: float = .5):
    from PIL import Image
    im = Image.open(path).convert("RGB")
    k = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    x = (im.width - w) // 2; y = int((im.height - h) * focus_y)
    return im.crop((x, y, x + w, y + h)).convert("RGBA")


def _disc(avatar, size: int, letter: str):
    from PIL import Image, ImageDraw
    if avatar is not None:
        pic = avatar.convert("RGB")
        side = min(pic.size); pic = pic.crop(((pic.width - side) // 2, (pic.height - side) // 2,
                                              (pic.width + side) // 2, (pic.height + side) // 2)).resize((size, size), Image.LANCZOS)
    else:
        pic = Image.new("RGB", (size, size), (120, 82, 60))
        ImageDraw.Draw(pic).text((size / 2, size / 2), (letter or "?")[:1].upper(), font=_font(True, int(size * .5)), fill=(255, 238, 210), anchor="mm")
    m = Image.new("L", (size * 4, size * 4), 0); ImageDraw.Draw(m).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0)); out.paste(pic, (0, 0), m.resize((size, size), Image.LANCZOS))
    return out


def _framed(avatar, w: int, h: int, letter: str, edge: int):
    """A picture cut to fill a frame opening, with a soft shadow along the inside edge so it sits behind the glass."""
    from PIL import Image, ImageDraw, ImageFilter
    if avatar is not None:
        pic = avatar.convert("RGB"); side = min(pic.size)
        pic = pic.crop(((pic.width - side) // 2, (pic.height - side) // 2, (pic.width + side) // 2, (pic.height + side) // 2))
        k = max(w / side, h / side); pic = pic.resize((max(w, round(side * k)), max(h, round(side * k))), Image.LANCZOS)
        pic = pic.crop(((pic.width - w) // 2, (pic.height - h) // 2, (pic.width - w) // 2 + w, (pic.height - h) // 2 + h))
    else:
        pic = Image.new("RGB", (w, h), (120, 82, 60))
        ImageDraw.Draw(pic).text((w / 2, h / 2), (letter or "?")[:1].upper(), font=_font(True, int(min(w, h) * .5)), fill=(255, 238, 210), anchor="mm")
    out = pic.convert("RGBA")
    edge_m = Image.new("L", (w, h), 0); ImageDraw.Draw(edge_m).rectangle((0, 0, w - 1, h - 1), outline=150, width=edge)
    shade = Image.new("RGBA", (w, h), (40, 20, 0, 255)); shade.putalpha(edge_m.filter(ImageFilter.GaussianBlur(edge * .7)))
    out.alpha_composite(shade)
    return out


def _glow(size, box, color, blur, alpha=255):
    from PIL import Image, ImageDraw, ImageFilter
    layer = Image.new("RGBA", size, color + (0,)); m = Image.new("L", size, 0)
    ImageDraw.Draw(m).ellipse(box, fill=alpha); layer.putalpha(m.filter(ImageFilter.GaussianBlur(blur)))
    return layer


def _shadow_text(img, xy, text, font, fill, anchor="mm", blur=6, alpha=170, stroke=0):
    from PIL import Image, ImageDraw, ImageFilter
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((xy[0], xy[1] + 3), text, font=font, fill=(20, 8, 4, alpha), anchor=anchor, stroke_width=stroke + 2, stroke_fill=(20, 8, 4, alpha))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))
    ImageDraw.Draw(img).text(xy, text, font=font, fill=fill, anchor=anchor)


def _fit(draw, text, bold, start, smallest, width):
    n = start
    while n > smallest and draw.textlength(text, font=_font(bold, n)) > width:
        n -= 2
    return _font(bold, n)


def _gradient(size, top_y, color=(18, 8, 4), alpha=235):
    from PIL import Image
    w, h = size
    g = Image.new("L", (1, h), 0)
    for y in range(h):
        g.putpixel((0, y), 0 if y < top_y else int(alpha * min(1, (y - top_y) / max(1, h - top_y)) ** 1.25))
    layer = Image.new("RGBA", size, color + (255,)); layer.putalpha(g.resize(size)); return layer


def _png(img) -> bytes:
    """Share cards are painted scenes, so a high quality JPEG is a fifth of the size of a PNG and looks the same."""
    buf = io.BytesIO(); img.convert("RGB").save(buf, "JPEG", quality=90, optimize=True, progressive=True); return buf.getvalue()


def creator_card(pick: dict, avatar, week_label: str) -> bytes:
    """The gallery rotunda: the creator's picture on the spotlit easel, Pinky proudly beside it."""
    from PIL import Image, ImageDraw, ImageFilter
    W, H = 1200, 675
    bg = _cover(ART / "creator-bg.jpg", W, H, .3)
    # the easel canvas, measured on the art for this exact crop (1200 x 675, cover)
    ex0, ey0, ex1, ey1 = 547, 218, 655, 374
    ew, eh = int(ex1 - ex0), int(ey1 - ey0)
    inner = _framed(avatar, ew, eh, pick.get("name") or pick["user"], 10)
    bg.alpha_composite(inner, (int(ex0), int(ey0)))
    bg.alpha_composite(_glow((W, H), (int(ex0) - 60, int(ey0) - 80, int(ex1) + 60, int(ey1) + 40), (255, 220, 150), 70, 70))
    bg.alpha_composite(_gradient((W, H), 380, (14, 6, 4), 240))
    pinky = Image.open(ART / "pinky-frame.webp").convert("RGBA")
    ph = 430; pinky = pinky.resize((round(pinky.width * ph / pinky.height), ph), Image.LANCZOS)
    bg.alpha_composite(_glow((W, H), (W - 380, H - 120, W - 40, H + 60), (0, 0, 0), 30, 150))
    px, py = W - pinky.width - 40, H - ph - 4
    bg.alpha_composite(pinky, (px, py))
    # Pinky's own little frame shows the creator too, as if she is holding up their picture (opening measured on the art)
    fx0, fy0, fx1, fy1 = [round(v * ph / 1000) for v in (264, 588, 450, 790)]
    bg.alpha_composite(_framed(avatar, fx1 - fx0, fy1 - fy0, pick.get("name") or pick["user"], 6), (px + fx0, py + fy0))
    d = ImageDraw.Draw(bg)
    tag = "CREATOR OF THE WEEK"
    tw = d.textlength(tag, font=_font(True, 26))
    d.rounded_rectangle((60, 470, 60 + tw + 44, 516), 23, fill=(255, 205, 110, 255))
    d.text((60 + 22, 494), tag, font=_font(True, 26), fill=(52, 24, 10), anchor="lm")
    handle = "@" + pick["user"]
    _shadow_text(bg, (60, 568), handle, _fit(d, handle, True, 62, 34, 640), (255, 247, 232), anchor="lm")
    _shadow_text(bg, (60, 622), week_label, _font(False, 28), (255, 220, 175), anchor="lm", blur=4)
    _shadow_text(bg, (W - 34, 36), "pdtools.xyz", _font(True, 24), (255, 240, 222), anchor="rm", blur=3)
    return _png(bg)


# the v2.1 tools as the home page and the Blinky's Friends menu show them: path, name, one line, scene, character
TOOLS = [
    ("/welcome", "Welcome lane", "Say hi to Keepers who just joined the Ancient Hatchery.", "v21/welcome-bg-s.jpg", "v21/blinky-lantern.webp"),
    ("/creator", "Creator of the week", "Pinky spotlights one Keeper who made the hatchery brighter.", "v21/creator-bg-s.jpg", "v21/pinky-frame.webp"),
    ("/wrapped", "Hatchery Wrapped", "Your month in the hatchery as a story to share.", "v21/wrapped-b-s.jpg", "v21/blinky-scope.webp"),
    ("/dragondle", "Dragondle", "Five Pocket Dragons questions a day, the same for everyone.", "v21/dragondle-a-s.jpg", "v21/pinky-scroll.webp"),
    ("/cheers", "Cheers", "Send a thank you lantern to a fellow Keeper.", "v21/cheers-a-s.jpg", "v21/blinky-skylantern.webp"),
    ("/stickers", "Sticker shelf", "Blinky and Pinky stickers for your posts and replies.", "v21/stickers-a-s.jpg", "v21/stickers/st-p-heart.webp"),
    ("/canvas", "Hatchery canvas", "Decorate a sky island and save it as a card.", "v21/canvas-a-s.jpg", "v21/stickers/st-b-gm.webp"),
]
