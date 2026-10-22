"""Dragon Circle: the Keepers someone is closest to, worked out only from the Pocket Dragons posts shared on pdtools.

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


def build(s, cfg, handle: str) -> dict:
    h = clean(handle)
    if not h:
        return {"ok": False, "message": "That does not look like an X handle."}
    key = h.lower()
    blocked_ids = select(BlockedAuthor.author_id)
    rows = s.execute(select(Post.author_username, Post.text, Post.author_name, Post.author_avatar)
                     .where(Post.hidden.is_(False), Post.text.is_not(None), Post.author_username.is_not(None),
                            Post.author_id.not_in(blocked_ids), Post.text.not_like("%Book of Friends PD%"))
                     .where(or_(func.lower(Post.author_username) == key, Post.text.ilike(f"%@{h}%")))).all()
    team = team_handles(s, cfg)
    blocked_names = {u.lower() for u in s.scalars(select(Post.author_username).where(Post.author_id.in_(blocked_ids)).distinct()) if u}
    out_c, in_c = Counter(), Counter()
    own_posts, me_name, me_avatar, shown = 0, None, None, {}
    for user, text, name, avatar in rows:
        u = user.lower()
        if u == key:
            own_posts += 1; h = user
            me_name = me_name or name; me_avatar = me_avatar or avatar
            seen = set()
            for m in MENTION.findall(text):
                ml = m.lower()
                if ml != key and ml not in seen:
                    seen.add(ml); out_c[ml] += 1; shown.setdefault(ml, m)
        else:
            if any(m.lower() == key for m in MENTION.findall(text)):
                in_c[u] += 1; shown.setdefault(u, user)
    people = []
    for u in set(out_c) | set(in_c):
        if u in team or u in blocked_names:
            continue
        o, i = out_c[u], in_c[u]
        people.append({"user": shown[u], "out": o, "in": i, "score": o + i + (MUTUAL_BONUS if o and i else 0)})
    people.sort(key=lambda p: (-p["score"], -(p["out"] and p["in"]), p["user"].lower()))
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
            "tagged_by": sum(in_c.values()), "people": people}


# ---------- the share picture (also the X preview card), 1200 x 675 ----------
def render(data: dict, avatars: dict, font_dir: str) -> bytes:
    import io
    import math
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    W, H = 1200, 675
    f7 = lambda n: ImageFont.truetype(f"{font_dir}/fredoka-700.ttf", n)
    f6 = lambda n: ImageFont.truetype(f"{font_dir}/fredoka-600.ttf", n)
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
        out = Image.new("RGBA", (size + 16, size + 16), (0, 0, 0, 0)); od = ImageDraw.Draw(out)
        od.ellipse((0, 0, size + 15, size + 15), fill=ring + (255,)); out.alpha_composite(tile, (8, 8))
        return out

    def shadow_paste(img, x, y):
        sh = Image.new("RGBA", bg.size, (0, 0, 0, 0)); m = Image.new("L", img.size, 0)
        ImageDraw.Draw(m).ellipse((0, 0, img.width - 1, img.height - 1), fill=120)
        sh.paste((0, 0, 0, 255), (int(x), int(y + 8)), m); bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
        bg.alpha_composite(img, (int(x), int(y)))

    ppl = data.get("people", [])
    inner, outer = ppl[:INNER], ppl[INNER:INNER + OUTER]
    for ring_people, r, size, col, off in ((outer, 268, 64, (196, 170, 255), .26), (inner, 175, 88, (255, 196, 92), 0)):
        n = max(1, len(ring_people))
        for i, p in enumerate(ring_people):
            ang = -math.pi / 2 + (i / n) * 2 * math.pi + off
            x, y = cx + r * math.cos(ang), cy + r * math.sin(ang)
            t = disc(p["user"], size, col, p.get("name")); shadow_paste(t, x - t.width / 2, y - t.height / 2)
            rank = ppl.index(p) + 1
            if rank <= 3:
                bx, by = x + size * .34, y - size * .5
                d.ellipse((bx - 17, by - 17, bx + 17, by + 17), fill=(255, 214, 92, 255), outline=(60, 30, 80, 255), width=3)
                d.text((bx, by + 1), str(rank), font=f7(22), fill=(50, 26, 60), anchor="mm")
    me = disc(data.get("handle"), 170, (255, 160, 110), data.get("name")); shadow_paste(me, cx - me.width / 2, cy - me.height / 2)
    # words on the left
    d.rounded_rectangle((60, 120, 312, 166), 23, fill=(255, 196, 92, 255))
    d.text((186, 144), "DRAGON CIRCLE", font=f7(24), fill=(40, 22, 54), anchor="mm")
    hd = "@" + (data.get("handle") or "")
    size = 64
    while size > 34 and d.textlength(hd, font=f7(size)) > 470: size -= 2
    d.text((60, 236), hd, font=f7(size), fill=(255, 246, 228), anchor="lm")
    d.text((60, 300), "The Keepers I tag and who", font=f6(30), fill=(226, 214, 250), anchor="lm")
    d.text((60, 340), "tag me most in dragon posts", font=f6(30), fill=(226, 214, 250), anchor="lm")
    d.text((60, 410), f"{len(ppl)} Keepers in my circle", font=f7(30), fill=(255, 214, 150), anchor="lm")
    d.text((60, 560), "pdtools.xyz/circle", font=f7(30), fill=(255, 160, 116), anchor="lm")
    d.text((60, 600), "free, unofficial community tool", font=f6(22), fill=(196, 182, 228), anchor="lm")
    d.text((W - 36, H - 30), "Jon Wynn", font=f7(26), fill=(255, 246, 228, 220), anchor="rm")
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
