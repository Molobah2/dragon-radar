"""pdtools v2.1, wave 1: the New Keeper welcome lane and Creator of the week.

Welcome lane: Keepers who shared their official "Keeper of the Ancient Hatchery" join card for the first time in the last three days, with how long
it has waited and how many people opened it, so the community can be the first to say hello.

Creator of the week: pdtools suggests, Jon approves. The suggestion only looks at public posts shared on pdtools in
the last seven days (opens, replies and quote posts from other Keepers, posts with art, how often they posted).
Nothing is ever chosen on its own: a pick is saved only when Jon approves it on his own device.
"""
import io
import json
import re
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


GAME_SQUARES = re.compile("[\U0001F7E8\U0001F7E7\U0001F7E5\u2B1B]{3,}")     # the coloured strip of an Ember Chamber share
NIGHT = re.compile(r"\bnight\s*\d")
VETERAN = re.compile(r"\branked\s*#?\s*\d|\bbadges?\s+collected\b|\b\d+\s*(?:/|out of|of)\s*16\s+eggs\b")
NEW_GRACE = timedelta(days=3)     # a newcomer may post about Pocket Dragons a day or two before they onboard
WELCOME_ADD_KEY = "v21:welcome_add"   # post ids Jon added by hand: real newcomers who wrote their join post in their own words


def welcome_added(s) -> list[str]:
    try:
        got = json.loads(get_setting(s, WELCOME_ADD_KEY, "[]") or "[]")
    except ValueError:
        return []
    return [str(x) for x in got if str(x).isdigit()]


TOPIC = re.compile(r"pocket[_ ]?dragons|keeper|hatchery|dragon", re.I)


def welcome_suggest(s, cfg, link: str, now: datetime, fetch=None) -> dict:
    """A Keeper points pdtools at a newcomer it missed: a link to their join post, or their X name when that post is
    already in the feed. The post is read for free (oEmbed) if pdtools never saw it. It must be recent, about Pocket
    Dragons and from someone pdtools does not already know as a Keeper, then it joins the lane like any join card."""
    from .discord_share import x_time
    text = (link or "").strip()
    m = re.search(r"status(?:es)?/(\d{6,25})", text)
    if m:
        pid = m.group(1)
    else:
        h = clean(text).lower()
        if not h:
            return {"ok": False, "why": "link"}
        since = now - timedelta(hours=WELCOME_HOURS)
        p = s.scalars(select(Post).where(func.lower(Post.author_username) == h, Post.created_at >= since, Post.is_team.is_(False))
                      .order_by(Post.created_at)).first()
        if not p:
            return {"ok": False, "why": "nopost"}
        pid = p.id
    if pid in welcome_added(s):
        return {"ok": True, "why": "already"}
    made = x_time(pid)
    if not made or made < now - timedelta(hours=WELCOME_HOURS) or made > now + timedelta(hours=1):
        return {"ok": False, "why": "old"}
    post = s.get(Post, pid)
    if post is None:
        from . import oembed
        from .collector import blocklist, is_blocked_text
        got = (fetch or oembed.fetch)(pid)
        if got is None:
            return {"ok": False, "why": "busy"}
        if not got or not got.get("username"):
            return {"ok": False, "why": "gone"}
        if is_blocked_text(got.get("text") or "", blocklist(s, cfg)):
            return {"ok": False, "why": "no"}
        post = Post(id=pid, author_id=f"u:{got['username'].lower()}", created_at=made, is_quote=False, is_team=False,
                    collected_at=now, text=(got.get("text") or "")[:1200], author_name=(got.get("name") or "")[:100] or None,
                    author_username=got["username"][:32], has_media=bool(got.get("media")))
        s.add(post); s.flush()
    user = (post.author_username or "").lower()
    if post.is_team or post.hidden or user in team_handles(s, cfg):
        return {"ok": False, "why": "no"}
    blocked = set(s.scalars(select(BlockedAuthor.author_id)))
    if post.author_id in blocked or f"u:{user}" in blocked:
        return {"ok": False, "why": "no"}
    if not TOPIC.search(post.text or "") or game_share(post.text):
        return {"ok": False, "why": "topic"}
    before = s.scalars(select(Post).where(or_(Post.author_id == post.author_id, func.lower(Post.author_username) == user),
                                          Post.created_at < post.created_at)).all()
    if any(game_share(p.text) or VETERAN.search((p.text or "").lower()) or p.created_at < post.created_at - NEW_GRACE for p in before):
        return {"ok": False, "why": "known"}
    ids = [x for x in welcome_added(s) if x != pid] + [pid]
    set_setting(s, WELCOME_ADD_KEY, json.dumps(ids[-50:]))
    s.commit()
    return {"ok": True, "user": post.author_username}


def add_to_welcome(s, post_id: str) -> bool:
    """Jon adds a newcomer's post to the welcome lane. Kept to the last 50, they age out of the lane on their own."""
    post_id = str(post_id or "").strip()
    if not post_id.isdigit() or not s.get(Post, post_id):
        return False
    ids = [x for x in welcome_added(s) if x != post_id] + [post_id]
    set_setting(s, WELCOME_ADD_KEY, json.dumps(ids[-50:]))
    s.commit()
    return True


def game_share(text: str | None) -> bool:
    """An Ember Chamber score share, in any of the ways players write it. The same "Keeper of the Ancient Hatchery"
    line ends these too, but only Keepers who already joined can play, so a share is never a join card."""
    t = (text or "").lower()
    return "chamber" in t or "\U0001F305" in t or bool(NIGHT.search(t) or GAME_SQUARES.search(t))


def welcome_lane(s, cfg, now: datetime, hours: int = WELCOME_HOURS) -> list[dict]:
    """Keepers who just joined: each one's first post of the official join card ("Keeper of the Ancient Hatchery")
    from the last few days, the ones nobody opened yet first. Someone pdtools already knows as a Keeper never shows:
    an Ember Chamber share, a rank or badge count post, or any Pocket Dragons post from more than three days before
    their card means they are not new."""
    since = now - timedelta(hours=hours)
    blocked = set(s.scalars(select(BlockedAuthor.author_id)))
    recent = s.scalars(select(Post).where(Post.is_team.is_(False), Post.created_at >= since,
                                          Post.text.ilike(f"%{JOIN_CARD}%"))).all()
    authors = {p.author_id for p in recent if not game_share(p.text) and p.author_id not in blocked}
    history: dict[str, list] = {}
    for p in (s.scalars(select(Post).where(Post.author_id.in_(authors))) if authors else []):
        history.setdefault(p.author_id, []).append(p)
    team = team_handles(s, cfg)
    out = []
    for aid in authors:
        posts = sorted(history.get(aid, []), key=lambda p: p.created_at)
        cards = [p for p in posts if JOIN_CARD in (p.text or "").lower() and not game_share(p.text)]
        if not cards:
            continue
        first = cards[0]
        if first.created_at < since or first.hidden:
            continue                                   # the card itself is old, shared again now, or hidden
        before = [p for p in posts if p.created_at < first.created_at]
        if any(game_share(p.text) or VETERAN.search((p.text or "").lower()) for p in before):
            continue                                   # already playing or collecting: not new
        if any(p.created_at < first.created_at - NEW_GRACE for p in before):
            continue                                   # posting about Pocket Dragons long before the card
        user = (first.author_username or "").strip()
        if not user or user.lower() in team:
            continue
        out.append({"id": first.id, "user": user, "name": (first.author_name or user)[:60], "text": (first.text or "")[:280],
                    "at": first.created_at.isoformat() + "Z", "waited_h": max(0, int((now - first.created_at).total_seconds() // 3600)),
                    "opens": int(first.opens or 0), "media": bool(first.has_media)})
    # newcomers Jon added by hand (their join post did not use the card's words); his word is enough, so no history check
    seen = {x["user"].lower() for x in out}
    for pid in welcome_added(s):
        p = s.get(Post, pid)
        if not p or p.hidden or p.is_team or p.created_at < since or p.author_id in blocked:
            continue
        user = (p.author_username or "").strip()
        if not user or user.lower() in seen or user.lower() in team_handles(s, cfg):
            continue
        seen.add(user.lower())
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
TOOLS = [   # grouped like the sections: Community, then Learn, then Create
    ("/welcome", "Welcome lane", "Say hi to Keepers who just joined the Ancient Hatchery.", "v21/welcome-bg-s.jpg", "v21/blinky-lantern.webp"),
    ("/creator", "Creator of the week", "Pinky spotlights one Keeper who made the hatchery brighter.", "v21/creator-bg-s.jpg", "v21/pinky-frame.webp"),
    ("/cheers", "Cheers", "Send a thank you lantern to a fellow Keeper.", "v21/cheers-a-s.jpg", "v21/blinky-skylantern.webp"),
    ("/circle", "Dragon Circle", "The Keepers you are closest to in dragon posts.", "", "v21/pinky-heart.webp"),
    ("/quiz", "Dragon Quiz", "Five Pocket Dragons questions a day, three tries each.", "v21/dragondle-a-s.jpg", "v21/pinky-scroll.webp"),
    ("/stickers", "Sticker shelf", "Blinky and Pinky stickers for your posts and replies.", "v21/stickers-a-s.jpg", "v21/stickers/st-p-heart.webp"),
    ("/canvas", "Hatchery canvas", "Decorate a sky island and save it as a card.", "v21/canvas-a-s.jpg", "v21/stickers/st-b-gm.webp"),
    ("/wrapped", "Hatchery Wrapped", "Your month in the hatchery as a story and a video.", "v21/wrapped-b-s.jpg", "v21/blinky-scope.webp"),
    ("/wallpaper", "My Hatchery wallpaper", "Your hatched dragons in a phone wallpaper made for your screen.", "v21/wall/glow-m.jpg", "v21/wall/glow-t.jpg"),
]


# ---------- the four sections (TJ's feedback: fewer places, each with its tools side by side) ----------
# key, name, landing page, one line, then the tabs: key, name, path, who can see it ("" everyone, "v21" open v2.1,
# "circle" the locked Dragon Circle), one line, scene ("cloud:<name>" for a Cloudinary scene, "" for the aurora), character
# Each card uses its own tool's art, never another tool's.
SECTIONS = [
    ("feed", "Feed", "/friends", "Every Pocket Dragons post the community shares, and your daily goal.", [
        ("friends", "Blinky's Friends", "/friends", "", "", "", ""),
        ("progress", "My progress", "/friends#progress", "", "", "", ""),
    ]),
    ("community", "Community", "/community", "Find Keepers, welcome new ones and thank the ones who help.", [
        ("keepers", "Keepers", "/friends/keepers", "", "Find verified Keepers to follow and talk with.", "keeper-bg.jpg", "blinky-avatar.jpg"),
        ("welcome", "Welcome lane", "/welcome", "v21", "Say hi to Keepers who just joined the Ancient Hatchery.", "v21/welcome-bg-s.jpg", "v21/blinky-lantern.webp"),
        ("creator", "Creator of the week", "/creator", "v21", "Pinky spotlights one Keeper who made the hatchery brighter.", "v21/creator-bg-s.jpg", "v21/pinky-frame.webp"),
        ("cheers", "Cheers", "/cheers", "v21", "Send a thank you lantern to a fellow Keeper.", "v21/cheers-a-s.jpg", "v21/blinky-skylantern.webp"),
        ("circle", "Dragon Circle", "/circle", "circle", "The Keepers you are closest to in dragon posts.", "", "v21/pinky-heart.webp"),
    ]),
    ("learn", "Learn", "/learn", "Learn the hatchery: the daily quiz, every AMA and the guides.", [
        ("quiz", "Dragon Quiz", "/quiz", "v21", "Five Pocket Dragons questions a day, three tries each.", "v21/dragondle-a-s.jpg", "v21/pinky-scroll.webp"),
        ("ama", "AMA Library", "/friends/ama", "", "Every AMA in one place: the recordings and what was shared.", "cloud:ama-library", ""),
        ("help", "Help and guides", "/help", "", "How pdtools works and answers to the questions Keepers ask most.", "help/poster.jpg", ""),
    ]),
    ("create", "Create", "/create", "Make something to share: stickers, a sky island, your month, your wallpaper.", [
        ("stickers", "Sticker shelf", "/stickers", "v21", "Blinky and Pinky stickers for your posts and replies.", "v21/stickers-a-s.jpg", "v21/stickers/st-p-heart.webp"),
        ("canvas", "Hatchery canvas", "/canvas", "v21", "Decorate a sky island and save it as a card.", "v21/canvas-a-s.jpg", "v21/stickers/st-b-gm.webp"),
        ("wrapped", "Hatchery Wrapped", "/wrapped", "v21", "Your month in the hatchery as a story and a video.", "v21/wrapped-b-s.jpg", "v21/blinky-scope.webp"),
        ("wallpaper", "My Hatchery wallpaper", "/wallpaper", "v21", "Your hatched dragons in a phone wallpaper made for your screen.", "v21/wall/glow-m.jpg", ""),
    ]),
]


# Made by Keepers: sites friends of pdtools built for Pocket Dragons, shown on a section page beside its tools.
# They open in a new tab. (section key, name, link, line, picture, maker's X handle)
FRIEND_SITES = [
    ("create", "Keeper Studio", "https://anastas36.github.io/keeper-studio/",
     "A cozy studio for making Pocket Dragons greetings and stories with Creator Kit art.",
     "v21/keeper-studio.webp", "BugaenkoNastya"),
]


def friend_sites(key: str) -> list:
    return [{"name": n, "url": u, "line": l, "bg": b, "by": h} for k, n, u, l, b, h in FRIEND_SITES if k == key]


def nav_for(path: str, v21: bool, circle: bool) -> dict:
    """The sections this visitor can see, and which section and tab the page belongs to."""
    ok = {"": True, "v21": v21, "circle": circle}
    secs, cur, tab = [], None, None
    for key, name, home, line, tabs in SECTIONS:
        seen = [{"key": t[0], "name": t[1], "path": t[2], "line": t[4], "bg": t[5], "who": t[6]} for t in tabs if ok[t[3]]]
        if not seen:
            continue
        secs.append({"key": key, "name": name, "home": home, "line": line, "tabs": seen})
    # the longest matching path wins, so /friends/keepers belongs to Keepers and not to Blinky's Friends
    best = -1
    for sec in secs:
        if path == sec["home"] and len(path) > best:
            best, cur, tab = len(path), sec["key"], None
        for t in sec["tabs"]:
            p = t["path"].split("#")[0]
            if (path == p or path.startswith(p.rstrip("/") + "/")) and len(p) >= best and not t["path"].endswith("#progress"):
                best, cur, tab = len(p), sec["key"], t["key"]
    return {"sections": secs, "cur": cur, "tab": tab}
