"""Dragon Circle: the Keepers someone is closest to, worked out only from the Pocket Dragons posts shared on pdtools
(and opens on pdtools by Keepers who signed the Book of Friends), with no paid X call at all.

For a handle we count, in every visible post on the radar:
  out  how often their own posts tag @someone
  in   how often someone else's posts tag them
A pair that tags each other both ways gets a bonus, because that is a real conversation. The team accounts are
left out (almost everyone tags them, so they would fill every circle), and so are blocked authors.
Nothing private is used: only public posts that were shared to the radar.
"""
import re
from collections import Counter

from sqlalchemy import func, or_, select

from .db import BlockedAuthor, Keeper, Post

HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
MENTION = re.compile(r"(?<![A-Za-z0-9_@])@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])")
INNER, OUTER = 8, 12            # people on the two rings
MUTUAL_BONUS = 2


def clean(handle: str) -> str:
    h = (handle or "").strip().lstrip("@")
    return h if HANDLE.match(h) else ""


def team_handles(s, cfg) -> set[str]:
    out = {"pocket_dragons_", (cfg.team_handle or "").lower()}
    for a in (cfg.team_accounts or "").split(","):
        h = a.strip().partition(":")[0].strip().lstrip("@").lower()
        if h:
            out.add(h)
    out |= {u.lower() for u in s.scalars(select(Post.author_username).where(Post.is_team.is_(True), Post.author_username.is_not(None)).distinct())}
    return out


KINDS = ("opens", "replies", "quotes", "tags")
WEIGHT = {"opens": 1, "replies": 2, "quotes": 2, "tags": 1}   # a reply or a quote post takes more effort than a tag
IN_WEIGHT = 2                                                 # what others give you counts more than what you give


def build(s, cfg, handle: str) -> dict:
    h = clean(handle)
    if not h:
        return {"ok": False, "message": "That does not look like an X handle."}
    key = h.lower()
    from .db import Event, Friend, FriendDevice, PostLink
    blocked_ids = select(BlockedAuthor.author_id)
    visible = (Post.hidden.is_(False), Post.author_username.is_not(None), Post.author_id.not_in(blocked_ids),
               or_(Post.text.is_(None), Post.text.not_like("%Book of Friends PD%")))
    team = team_handles(s, cfg)
    blocked_names = {u.lower() for u in s.scalars(select(Post.author_username).where(Post.author_id.in_(blocked_ids)).distinct()) if u}
    got = {"in": {k: Counter() for k in KINDS}, "out": {k: Counter() for k in KINDS}}
    shown: dict[str, str] = {}
    own_posts, me_name, me_avatar = 0, None, None

    # 1. tags in the text of dragon posts
    rows = s.execute(select(Post.author_username, Post.text, Post.author_name, Post.author_avatar)
                     .where(*visible, Post.text.is_not(None))
                     .where(or_(func.lower(Post.author_username) == key, Post.text.ilike(f"%@{h}%")))).all()
    for user, text, name, avatar in rows:
        u = user.lower()
        if u == key:
            own_posts += 1; h = user
            me_name = me_name or name; me_avatar = me_avatar or avatar
            seen = set()
            for m in MENTION.findall(text):
                ml = m.lower()
                if ml != key and ml not in seen:
                    seen.add(ml); got["out"]["tags"][ml] += 1; shown.setdefault(ml, m)
        elif any(m.lower() == key for m in MENTION.findall(text)):
            got["in"]["tags"][u] += 1; shown.setdefault(u, user)

    # 2. replies and quote posts (read for free from FxTwitter, see fxpic.backfill_links)
    for col, kind in ((PostLink.reply_to, "replies"), (PostLink.quote_of, "quotes")):
        for user in s.scalars(select(Post.author_username).join(PostLink, PostLink.post_id == Post.id).where(*visible, col == key)):
            if user.lower() != key:
                got["in"][kind][user.lower()] += 1; shown.setdefault(user.lower(), user)
        for target in s.scalars(select(col).join(Post, PostLink.post_id == Post.id).where(*visible, func.lower(Post.author_username) == key, col.is_not(None))):
            if target != key:
                got["out"][kind][target] += 1; shown.setdefault(target, target)

    # 3. opens on pdtools, only from Keepers who signed Blinky's Book of Friends (proved the X name is theirs)
    signed = (select(FriendDevice.vid, FriendDevice.key).where(FriendDevice.confirmed.is_(True))).subquery()
    opened = (Event.kind.in_(("open", "popen")))
    for who, n in s.execute(select(signed.c.key, func.count(func.distinct(Event.ref)))
                            .join(signed, signed.c.vid == Event.vid).join(Post, Post.id == Event.ref)
                            .where(opened, *visible, func.lower(Post.author_username) == key, signed.c.key != key)
                            .group_by(signed.c.key)):
        got["in"]["opens"][who] += n
    for user, n in s.execute(select(Post.author_username, func.count(func.distinct(Event.ref)))
                             .join(signed, signed.c.vid == Event.vid).join(Post, Post.id == Event.ref)
                             .where(opened, *visible, signed.c.key == key, func.lower(Post.author_username) != key)
                             .group_by(Post.author_username)):
        got["out"]["opens"][user.lower()] += n; shown.setdefault(user.lower(), user)
    for f in s.scalars(select(Friend).where(Friend.key.in_(list(got["in"]["opens"])))):
        shown.setdefault(f.key, f.username)

    everyone = set()
    for side in got.values():
        for c in side.values():
            everyone |= set(c)
    people = []
    for u in everyone:
        if u in team or u in blocked_names or u == key:
            continue
        ins = {k: got["in"][k][u] for k in KINDS}; outs = {k: got["out"][k][u] for k in KINDS}
        pi = sum(WEIGHT[k] * ins[k] for k in KINDS); po = sum(WEIGHT[k] * outs[k] for k in KINDS)
        i, o = sum(ins.values()), sum(outs.values())
        people.append({"user": shown.get(u, u), "out": o, "in": i, "got": ins, "gave": outs,
                       "score": IN_WEIGHT * pi + po + (MUTUAL_BONUS if i and o else 0)})
    total_in = sum(p["in"] for p in people)
    people.sort(key=lambda p: (-p["score"], -p["in"], p["user"].lower()))
    people = people[:INNER + OUTER]
    # names and pictures for everyone shown, from their own posts or the Keepers directory
    keys = [p["user"].lower() for p in people]
    info = {}
    if keys:
        for user, name, avatar in s.execute(select(Post.author_username, Post.author_name, Post.author_avatar)
                                            .where(func.lower(Post.author_username).in_(keys)).order_by(Post.created_at.desc())):
            info.setdefault(user.lower(), {"user": user, "name": name, "avatar": avatar})
        for kp in s.scalars(select(Keeper).where(func.lower(Keeper.username).in_(keys))):
            d = info.setdefault(kp.username.lower(), {"user": kp.username, "name": None, "avatar": None})
            d["name"] = d["name"] or getattr(kp, "name", None); d["avatar"] = d["avatar"] or getattr(kp, "avatar", None)
    for p in people:
        d = info.get(p["user"].lower(), {})
        p["user"] = d.get("user") or p["user"]; p["name"] = d.get("name") or p["user"]; p["has_pic"] = bool(d.get("avatar"))
    if not me_name:
        kp = s.scalar(select(Keeper).where(func.lower(Keeper.username) == key))
        if kp is not None:
            me_name, me_avatar = getattr(kp, "name", None), getattr(kp, "avatar", None)
            h = kp.username
    return {"ok": True, "handle": h, "name": me_name or h, "has_pic": bool(me_avatar), "posts": own_posts,
            "tagged_by": sum(got["in"]["tags"].values()), "engaged": total_in, "people": people}


# ---------- the share picture (also the X preview card), 1200 x 675 ----------
def _scene(data: dict, avatars: dict, font_dir: str):
    """Everything on the Circle card, ready to be put together: the night background, each Keeper's disc (with its
    shadow) and where it sits, and the few words."""
    import math
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    W, H = 1200, 675
    f7 = lambda n: ImageFont.truetype(f"{font_dir}/fredoka-700.ttf", n)
    # background: deep plum night with a warm glow behind the circle
    bg = Image.new("RGB", (W, H), (22, 14, 44)); d = ImageDraw.Draw(bg)
    for i in range(H):
        k = i / H; d.line([(0, i), (W, i)], fill=(int(22 + 30 * k), int(14 + 10 * k), int(44 + 24 * k)))
    glow = Image.new("L", (W, H), 0); ImageDraw.Draw(glow).ellipse((560, 20, 1180, 650), fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(110))
    bg = Image.composite(Image.new("RGB", (W, H), (150, 70, 120)), bg, glow).convert("RGBA")
    d = ImageDraw.Draw(bg)
    cx, cy = 870, 338
    for r, a in ((175, 50), (268, 34)):
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 214, 150, a), width=2)
    for i in range(70):   # a few soft stars
        x, y = (i * 389) % W, (i * 233) % H; d.ellipse((x - 1, y - 1, x + 1, y + 1), fill=(255, 240, 220, 70))

    def disc(handle, size, ring, label=None):
        im = avatars.get((handle or "").lower())
        tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        if im is not None:
            pic = im.convert("RGB").resize((size, size), Image.LANCZOS)
        else:
            pic = Image.new("RGB", (size, size), (92, 64, 140)); pd = ImageDraw.Draw(pic)
            pd.text((size / 2, size / 2 + 2), (label or handle or "?")[:1].upper(), font=f7(int(size * .48)), fill=(255, 236, 210), anchor="mm")
        m = Image.new("L", (size * 4, size * 4), 0); ImageDraw.Draw(m).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
        tile.paste(pic, (0, 0), m.resize((size, size), Image.LANCZOS))
        pad = 24; out = Image.new("RGBA", (size + 16 + pad * 2, size + 16 + pad * 2), (0, 0, 0, 0))
        sm = Image.new("L", out.size, 0); ImageDraw.Draw(sm).ellipse((pad, pad + 8, pad + size + 15, pad + size + 23), fill=120)
        out.paste((0, 0, 0, 255), (0, 0), sm.filter(ImageFilter.GaussianBlur(10)))
        ImageDraw.Draw(out).ellipse((pad, pad, pad + size + 15, pad + size + 15), fill=ring + (255,)); out.alpha_composite(tile, (pad + 8, pad + 8))
        return out

    def badge(rank):
        b = Image.new("RGBA", (40, 40), (0, 0, 0, 0)); bd = ImageDraw.Draw(b)
        bd.ellipse((3, 3, 37, 37), fill=(255, 214, 92, 255), outline=(60, 30, 80, 255), width=3)
        bd.text((20, 21), str(rank), font=f7(22), fill=(50, 26, 60), anchor="mm"); return b

    ppl = data.get("people", [])
    inner, outer = ppl[:INNER], ppl[INNER:INNER + OUTER]
    items = []    # (tile, centre x, centre y, badge or None, badge offset)
    for ring_people, r, size, col, off in ((inner, 175, 88, (255, 196, 92), 0), (outer, 268, 64, (196, 170, 255), .26)):
        n = max(1, len(ring_people))
        for i, p in enumerate(ring_people):
            ang = -math.pi / 2 + (i / n) * 2 * math.pi + off
            x, y = cx + r * math.cos(ang), cy + r * math.sin(ang)
            rank = ppl.index(p) + 1
            items.append((disc(p["user"], size, col, p.get("name")), x, y, badge(rank) if rank <= 3 else None, (size * .34, -size * .5)))
    me = (disc(data.get("handle"), 170, (255, 160, 110), data.get("name")), cx, cy)

    hd = "@" + (data.get("handle") or "")
    size = 70
    while size > 36 and ImageDraw.Draw(bg).textlength(hd, font=f7(size)) > 470: size -= 2
    def words(img, a=1.0, dy=0):
        """just three things on the left, plus the pdtools stamp: what it is, whose it is, how many"""
        if a <= 0: return
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0)); w = ImageDraw.Draw(lay); A = int(255 * a)
        w.rounded_rectangle((60, 214 + dy, 312, 260 + dy), 23, fill=(255, 196, 92, A))
        w.text((186, 238 + dy), "DRAGON CIRCLE", font=f7(24), fill=(40, 22, 54, A), anchor="mm")
        w.text((60, 330 + dy), hd, font=f7(size), fill=(255, 246, 228, A), anchor="lm")
        w.text((60, 410 + dy), f"{len(ppl)} Keepers in my circle", font=f7(32), fill=(255, 214, 150, A), anchor="lm")
        w.text((W - 36, H - 30), "pdtools.xyz", font=f7(26), fill=(255, 246, 228, int(220 * a)), anchor="rm")
        img.alpha_composite(lay)
    return bg, items, me, words


def _put(img, tile, x, y, k=1.0):
    from PIL import Image
    if k <= 0: return
    if abs(k - 1) > .01:
        w = max(1, int(tile.width * k)); tile = tile.resize((w, w), Image.BILINEAR)
    img.alpha_composite(tile, (int(x - tile.width / 2), int(y - tile.height / 2)))


def render(data: dict, avatars: dict, font_dir: str) -> bytes:
    import io
    bg, items, me, words = _scene(data, avatars, font_dir)
    for tile, x, y, b, (bx, by) in items:
        _put(bg, tile, x, y)
    for tile, x, y, b, (bx, by) in items:
        if b is not None: _put(bg, b, x + bx, y + by)
    _put(bg, *me)
    words(bg)
    buf = io.BytesIO(); bg.convert("RGB").save(buf, "PNG", optimize=True); return buf.getvalue()


def layout(people: list[dict]) -> list[dict]:
    """Where each person sits on the page's circle, in percent of the square (inner ring first)."""
    import math
    out = []
    for ring, (start, count, r, size, off) in enumerate(((0, INNER, 31, 12.5, 0), (INNER, OUTER, 45.5, 9, .26))):
        group = people[start:start + count]; n = max(1, len(group))
        for i, p in enumerate(group):
            ang = -math.pi / 2 + (i / n) * 2 * math.pi + off
            out.append({**p, "rank": start + i + 1, "ring": ring, "size": size,
                        "x": round(50 + r * math.cos(ang), 2), "y": round(50 + r * math.sin(ang), 2)})
    return out
