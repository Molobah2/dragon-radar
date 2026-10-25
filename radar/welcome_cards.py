"""Welcome cards for a Keeper who just joined, in five looks. Laid out at 1200 x 675 and drawn at twice that
(2400 x 1350, 16:9) so they stay crisp on X; `small` gives the 1200 x 675 link preview.

  dusk      a deep dusk sky, the Keeper glowing in a gold ring on the left, the words on the right (the default)
  gate      the Hatchery gate opens and the Keeper stands in the light of the doorway
  map       a hand painted map of the hatchery lands, a red pin with the Keeper's picture marks their arrival
  feast     a welcome cake: Blinky cuts it, Pinky pours tea, the Keeper's picture sits on the top tier
  sky       Blinky and Pinky loop a ribbon of cloud around the Keeper's picture high above the castle

Every look has art of its own (welcome-*.jpg); none borrows from another tool.

Lean on memory on purpose (the server is small): soft light is painted at a quarter of the size and scaled up,
and blurs only ever touch the small area around what they soften."""
import io
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FONTS = Path(__file__).parent / "fonts"
ART = Path(__file__).parent / "static" / "v21"
W, H, S = 1200, 675, 2                      # laid out at 1200 x 675, drawn at twice that
STYLES = ("dusk", "gate", "map", "feast", "sky")
INK, SOFT, GOLD, GLOW = (255, 246, 232), (255, 232, 210), (255, 210, 122), (255, 196, 120)
RING = ((255, 241, 184), (217, 154, 30), (255, 232, 154), (154, 100, 16))
LINE = "Just joined the Ancient Hatchery. Say hello and make them feel at home."


def _font(n, bold=True):
    return ImageFont.truetype(str(FONTS / ("fredoka-700.ttf" if bold else "fredoka-600.ttf")), round(n * S))


def _p(v):
    return round(v * S)


def _art(name):
    return Image.open(ART / name)


def _cover(name, ox=0.5, oy=0.5):
    im = _art(name).convert("RGB")
    k = max(_p(W) / im.width, _p(H) / im.height)
    im = im.resize((math.ceil(im.width * k), math.ceil(im.height * k)), Image.BICUBIC)
    x0, y0 = int((im.width - _p(W)) * ox), int((im.height - _p(H)) * oy)
    return im.crop((x0, y0, x0 + _p(W), y0 + _p(H))).convert("RGBA")


class Soft:
    """Soft light and shade painted at a quarter of the size, then scaled up over the card (blurry by nature,
    so nobody can tell, and about a sixteenth of the memory and time)."""
    Q = 4

    def __init__(self):
        self.w, self.h = _p(W) // self.Q, _p(H) // self.Q
        self.rgb = Image.new("RGB", (self.w, self.h), (0, 0, 0))
        self.a = Image.new("L", (self.w, self.h), 0)

    def q(self, v):
        return v * S / self.Q

    def blob(self, cx, cy, rx, ry, color, alpha, blur):
        m = Image.new("L", (self.w, self.h), 0)
        ImageDraw.Draw(m).ellipse((self.q(cx - rx), self.q(cy - ry), self.q(cx + rx), self.q(cy + ry)), fill=alpha)
        m = m.filter(ImageFilter.GaussianBlur(max(1, self.q(blur))))
        self.rgb = Image.composite(Image.new("RGB", self.rgb.size, color), self.rgb, m)
        self.a = Image.composite(Image.new("L", self.a.size, 255), self.a, m) if alpha >= 250 else Image.fromarray(
            __import__("numpy").maximum(__import__("numpy").asarray(self.a), __import__("numpy").asarray(m)))

    def onto(self, img):
        lay = self.rgb.resize(img.size, Image.BICUBIC).convert("RGBA")
        lay.putalpha(self.a.resize(img.size, Image.BICUBIC))
        img.alpha_composite(lay)


def _sky(img, glows):
    """glows: (cx, cy, rx, ry, color, alpha, blur) soft light on the card"""
    s = Soft()
    for g in glows:
        s.blob(*g)
    s.onto(img)


def _vignette(img, strength=225, inner=95):
    vg = Image.radial_gradient("L").resize((img.width // 4, img.height // 4), Image.BILINEAR)
    vg = vg.point(lambda v: int(max(0, min(1, (v - inner) / 120)) * strength)).resize(img.size, Image.BICUBIC)
    dark = Image.new("RGBA", img.size, (6, 3, 14, 255)); dark.putalpha(vg)
    img.alpha_composite(dark)


def _shade(img, box, color, alpha_fn):
    """a soft directional shade, painted as a tiny strip and stretched (words always read on it)"""
    x0, y0, x1, y1 = [_p(v) for v in box]
    w, h = x1 - x0, y1 - y0
    vertical = alpha_fn.__defaults__[0] if alpha_fn.__defaults__ else False
    if vertical:
        strip = Image.new("L", (1, 256)); [strip.putpixel((0, i), int(255 * alpha_fn(i / 255))) for i in range(256)]
    else:
        strip = Image.new("L", (256, 1)); [strip.putpixel((i, 0), int(255 * alpha_fn(i / 255))) for i in range(256)]
    m = strip.resize((w, h), Image.BILINEAR)
    lay = Image.new("RGBA", (w, h), color + (255,)); lay.putalpha(m)
    img.alpha_composite(lay, (x0, y0))


def _motes(img, rnd, n, area=(0, 0, W, H), colors=((255, 214, 140), (255, 246, 230))):
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = area
    for _ in range(n):
        px, py = x0 + rnd.random() * (x1 - x0), y1 - (rnd.random() ** .8) * (y1 - y0)
        r = .5 + rnd.random() * 2.2; a = int(60 + rnd.random() * 190)
        col = colors[0] if rnd.random() < .7 else colors[1]
        d.ellipse((_p(px - r), _p(py - r), _p(px + r), _p(py + r)), fill=col + (a,))


def _glow_text(img, xy, text, font, fill, glow, blur, alpha=150, anchor="ls"):
    """text with a soft glow; the blur only touches the text's own box"""
    d = ImageDraw.Draw(img)
    l, t, r, b = d.textbbox(xy, text, font=font, anchor=anchor)
    pad = int(blur * 3)
    box = (max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad))
    lay = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
    ImageDraw.Draw(lay).text((xy[0] - box[0], xy[1] - box[1]), text, font=font, fill=glow + (alpha,), anchor=anchor)
    img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(blur)), box[:2])
    d.text(xy, text, font=font, fill=fill, anchor=anchor)


def _spaced(d, xy, text, font, fill, gap, center=False):
    x, y = xy
    if center:
        x -= (sum(d.textlength(ch, font=font) for ch in text) + gap * (len(text) - 1)) / 2
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill, anchor="ls")
        x += d.textlength(ch, font=font) + gap


def _fit(d, text, start, floor, width, bold=True):
    n = start
    while n > floor and d.textlength(text, font=_font(n, bold)) > _p(width):
        n -= 2
    return _font(n, bold)


def _wrap(d, text, font, width):
    rows, row = [], ""
    for w in text.split():
        t = f"{row} {w}".strip()
        if d.textlength(t, font=font) > _p(width) and row:
            rows.append(row); row = w
        else:
            row = t
    return rows + ([row] if row else [])


def _portrait(avatar, size, letter):
    if avatar is not None:
        pic = ImageOps.fit(avatar.convert("RGB"), (size, size), Image.LANCZOS)
    else:                                     # no picture: their first letter on a warm glow
        pic = Image.new("RGB", (size, size), (92, 46, 96)); d = ImageDraw.Draw(pic)
        for i in range(size // 2, 0, -3):
            t = i / (size / 2)
            d.ellipse((size / 2 - i, size * .42 - i, size / 2 + i, size * .42 + i), fill=(int(92 + 150 * (1 - t)), int(46 + 120 * (1 - t)), int(96 - 20 * (1 - t))))
        d.text((size / 2, size / 2), (letter or "?")[:1].upper(), font=ImageFont.truetype(str(FONTS / "fredoka-700.ttf"), int(size * .48)), fill=(255, 246, 230), anchor="mm")
    m = Image.new("L", (size * 2, size * 2), 0); ImageDraw.Draw(m).ellipse((0, 0, size * 2 - 1, size * 2 - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0)); out.paste(pic, (0, 0), m.resize((size, size), Image.LANCZOS))
    return out


def _gold(size, colors=RING):
    """a diagonal gold gradient, for the ring around the picture"""
    w, h = size
    strip = Image.new("RGB", (512, 1)); stops = len(colors) - 1
    for i in range(512):
        t = i / 511 * stops; k = min(int(t), stops - 1); f = t - k
        a, b = colors[k], colors[k + 1]
        strip.putpixel((i, 0), tuple(int(a[j] + (b[j] - a[j]) * f) for j in range(3)))
    diag = strip.resize((w + h, 1)); g = Image.new("RGB", (w, h))
    for y in range(0, h, 2):
        g.paste(diag.crop((y, 0, y + w, 1)).resize((w, 2)), (0, y))
    return g


def _hero(img, avatar, name, user, cx, cy, D, ring=7, ring_colors=RING, shadow=150, shine=True):
    """the Keeper's picture in a gold ring, with a soft shadow (blurred only around itself) and a little shine"""
    pad = _p(40)
    sh = Image.new("RGBA", (_p(D) + pad * 2, _p(D) + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((pad - _p(6), pad + _p(14), pad + _p(D + 6), pad + _p(D + 26)), fill=(0, 0, 0, shadow))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(_p(16))), (_p(cx - D / 2) - pad, _p(cy - D / 2) - pad))
    R = D + ring * 2
    goldring = _gold((_p(R), _p(R)), ring_colors)
    cm = Image.new("L", (_p(R) * 2, _p(R) * 2), 0); ImageDraw.Draw(cm).ellipse((0, 0, _p(R) * 2 - 1, _p(R) * 2 - 1), fill=255)
    img.paste(goldring, (_p(cx - R / 2), _p(cy - R / 2)), cm.resize(goldring.size, Image.LANCZOS))
    img.alpha_composite(_portrait(avatar, _p(D), name or user), (_p(cx - D / 2), _p(cy - D / 2)))
    if shine:
        lay = Image.new("RGBA", (_p(D), _p(D)), (0, 0, 0, 0))
        sh2 = Image.new("RGBA", lay.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh2).ellipse((_p(-D * .25), _p(-D * .62), _p(D * 1.05), _p(D * .42)), fill=(255, 255, 255, 34))
        sm = Image.new("L", lay.size, 0); ImageDraw.Draw(sm).ellipse((0, 0, lay.width - 1, lay.height - 1), fill=255)
        lay.paste(sh2, (0, 0), sm)
        img.alpha_composite(lay, (_p(cx - D / 2), _p(cy - D / 2)))


def _rays(img, cx, cy, n, length, color, alpha, spread=.06, turn=.1):
    s = Image.new("L", (img.width // 4, img.height // 4), 0); dr = ImageDraw.Draw(s)
    q = S / 4
    for i in range(n):
        a = i * math.tau / n + turn
        dr.polygon([(cx * q, cy * q), ((cx + math.cos(a - spread) * length) * q, (cy + math.sin(a - spread) * length) * q),
                    ((cx + math.cos(a + spread) * length) * q, (cy + math.sin(a + spread) * length) * q)], fill=alpha)
    m = s.filter(ImageFilter.GaussianBlur(2)).resize(img.size, Image.BICUBIC)
    lay = Image.new("RGBA", img.size, color + (255,)); lay.putalpha(m); img.alpha_composite(lay)


def _rings(img, cx, cy, radii, color):
    pad = _p(20); R = max(r for r, _, _ in radii)
    box = (_p(cx - R) - pad, _p(cy - R) - pad, _p(cx + R) + pad, _p(cy + R) + pad)
    lay = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    for r, a, w in radii:
        c = _p(cx) - box[0], _p(cy) - box[1]
        d.ellipse((c[0] - _p(r), c[1] - _p(r), c[0] + _p(r), c[1] + _p(r)), outline=color + (a,), width=_p(w))
    img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(_p(6))), box[:2]); img.alpha_composite(lay, box[:2])


def _footer(d, color=INK):
    d.text((_p(W - 60), _p(H - 58)), "pdtools.xyz", font=_font(21), fill=color, anchor="rs")


def _side_words(img, X, user, joined, by, y0=178, ink=INK, soft=SOFT, accent=GOLD, glow=GLOW, line=LINE, kicker="NEW KEEPER"):
    """the words block used by the dusk and lantern looks: kicker, Welcome, @handle, the line, who welcomed them"""
    d = ImageDraw.Draw(img); X = _p(X)
    _spaced(d, (X, _p(y0)), kicker, _font(22), accent, _p(5))
    _glow_text(img, (X, _p(y0 + 90)), "Welcome,", _font(76), ink, glow, _p(14), 120)
    handle = "@" + user
    _glow_text(img, (X, _p(y0 + 168)), handle, _fit(d, handle, 66, 34, 470), ink, glow, _p(14), 130)
    f = _font(24, False); y = y0 + 224
    for row in _wrap(d, line, f, 470):
        d.text((X, _p(y)), row, font=f, fill=soft + (220,), anchor="ls"); y += 34
    if by:
        _spaced(d, (X, _p(y0 + 334)), "WELCOMED BY", _font(18, False), soft + (210,), _p(4))
        who = "@" + by
        _glow_text(img, (X, _p(y0 + 380)), who, _fit(d, who, 40, 24, 470), ink, glow, _p(10), 110)
        d.text((X, _p(y0 + 420)), f"Joined {joined}", font=_font(19), fill=accent, anchor="ls")
    else:
        d.text((X, _p(y0 + 370)), f"Joined {joined}", font=_font(21), fill=accent, anchor="ls")


def _center_words(img, user, joined, by, top, title="Welcome,", line=LINE, ink=INK, soft=SOFT, accent=GOLD, glow=GLOW, width=900):
    d = ImageDraw.Draw(img); cx = _p(W / 2)
    handle = "@" + user
    _glow_text(img, (cx, _p(top)), f"{title} {handle}".strip(), _fit(d, f"{title} {handle}", 64, 34, width), ink, glow, _p(14), 140, anchor="ms")
    f = _font(23, False)
    d.text((cx, _p(top + 44)), line, font=_fit(d, line, 23, 16, width + 60, False), fill=soft + (235,), anchor="ms")
    meta = f"Joined {joined}" + (f"  ·  Welcomed by @{by}" if by else "")
    d.text((cx, _p(top + 84)), meta, font=_fit(d, meta, 20, 14, width, True), fill=accent, anchor="ms")


# ---------- the five looks ----------
def _dusk(avatar, user, name, joined, by, rnd):
    HX, HY = 340, 337
    img = Image.new("RGBA", (_p(W), _p(H)), (11, 6, 20, 255))
    _sky(img, [(HX, HY, 380, 380, (78, 30, 88), 235, 150), (HX, HY, 230, 230, (160, 72, 60), 165, 100),
               (930, 600, 380, 380, (255, 140, 80), 46, 170), (1000, 90, 340, 340, (140, 80, 210), 52, 150),
               (150, 610, 260, 260, (255, 180, 110), 30, 120), (HX, HY, 300, 300, GLOW, 150, 110)])
    _motes(img, rnd, 170)
    _rays(img, HX, HY, 16, 700, (255, 215, 140), 14)
    _rings(img, HX, HY, ((250, 120, 1.5), (268, 60, 1.2)), (255, 226, 170))
    _hero(img, avatar, name, user, HX, HY, 380)
    _vignette(img)
    _shade(img, (600, 0, W, H), (0, 0, 0), lambda t, v=False: .22 * min(1, t / .25) + .08 * max(0, (t - .25) / .75))
    _side_words(img, 660, user, joined, by)
    _footer(ImageDraw.Draw(img))
    return img


def _gate(avatar, user, name, joined, by, rnd):
    """the Hatchery gate at dusk: the doors open, the Keeper stands in the warm light of the doorway"""
    img = _cover("welcome-bg.jpg", 0.5, 0.42)
    CX, CY = 600, 262
    _sky(img, [(0, 0, 1400, 900, (20, 10, 6), 70, 10), (CX, CY, 330, 300, (255, 200, 120), 200, 120), (CX, CY, 170, 170, (255, 236, 190), 230, 60)])
    _rays(img, CX, CY, 22, 900, (255, 226, 160), 20, .05, .03)
    _motes(img, rnd, 120, (300, 80, 900, 520))
    _rings(img, CX, CY, ((150, 150, 2), (168, 80, 1.4)), (255, 236, 190))
    _hero(img, avatar, name, user, CX, CY, 260, ring_colors=((255, 250, 220), (230, 170, 60), (255, 240, 190), (170, 110, 30)))
    _shade(img, (0, 380, W, H), (14, 7, 4), lambda t, v=True: .92 * min(1, max(0, t - .05) / .55))
    d = ImageDraw.Draw(img)
    _spaced(d, (_p(W / 2), _p(54)), "THE GATE IS OPEN", _font(20), GOLD, _p(6), center=True)
    _center_words(img, user, joined, by, 532, "Welcome,", "Just joined the Ancient Hatchery. Say hello and make them feel at home.")
    _footer(d, SOFT)
    return img


def _pin(img, avatar, name, user, hx, hy, D, color=(206, 52, 46)):
    """a map pin: a round head holding the Keeper's picture and a point that touches the map"""
    R = D / 2 + 12; tip = hy + R + 70
    pad = _p(30)
    box = (_p(hx - R) - pad, _p(hy - R) - pad, _p(hx + R) + pad, _p(tip) + pad)
    sh = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    ox, oy = box[0], box[1]
    sd.ellipse((_p(hx - 26) - ox, _p(tip - 8) - oy, _p(hx + 26) - ox, _p(tip + 8) - oy), fill=(40, 20, 6, 150))
    sd.polygon([(_p(hx - R * .62) + _p(10) - ox, _p(hy + R * .7) + _p(10) - oy), (_p(hx + R * .62) + _p(10) - ox, _p(hy + R * .7) + _p(10) - oy), (_p(hx) - ox, _p(tip) - oy)], fill=(40, 20, 6, 110))
    sd.ellipse((_p(hx - R) + _p(10) - ox, _p(hy - R) + _p(12) - oy, _p(hx + R) + _p(10) - ox, _p(hy + R) + _p(12) - oy), fill=(40, 20, 6, 120))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(_p(9))), (ox, oy))
    d = ImageDraw.Draw(img)
    dark = tuple(int(c * .62) for c in color)
    d.polygon([(_p(hx - R * .62), _p(hy + R * .7)), (_p(hx + R * .62), _p(hy + R * .7)), (_p(hx), _p(tip))], fill=dark + (255,))
    d.polygon([(_p(hx - R * .62), _p(hy + R * .7)), (_p(hx), _p(hy + R * .7)), (_p(hx), _p(tip))], fill=color + (255,))
    d.ellipse((_p(hx - R), _p(hy - R), _p(hx + R), _p(hy + R)), fill=color + (255,))
    d.ellipse((_p(hx - R + 5), _p(hy - R + 5), _p(hx + R - 5), _p(hy + R - 5)), outline=(255, 150, 130, 200), width=_p(2))
    _hero(img, avatar, name, user, hx, hy, D, ring=4, ring_colors=((255, 246, 226), (240, 220, 190), (255, 250, 236), (220, 196, 160)), shadow=0)


def _map(avatar, user, name, joined, by, rnd):
    """the hatchery map: a red pin with the Keeper's picture marks where they just arrived"""
    img = _cover("welcome-map.jpg", 0.5, 0.5)
    # a calm parchment wash under the words, so the ink reads on the plains
    _sky(img, [(905, 250, 320, 240, (246, 228, 190), 165, 70), (880, 450, 260, 110, (246, 228, 190), 175, 60)])
    d = ImageDraw.Draw(img)
    # a dotted trail from the castle gate to the pin, in red ink
    pts = [(436, 352), (470, 376), (505, 384), (535, 372)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = int(math.hypot(x1 - x0, y1 - y0) / 11)
        for k in range(n):
            if k % 2 == 0:
                t0, t1 = k / n, (k + .6) / n
                d.line((_p(x0 + (x1 - x0) * t0), _p(y0 + (y1 - y0) * t0), _p(x0 + (x1 - x0) * t1), _p(y0 + (y1 - y0) * t1)), fill=(170, 40, 34, 230), width=_p(3))
    _pin(img, avatar, name, user, 548, 222, 140)
    ink, soft, red = (66, 36, 16), (96, 60, 30), (170, 40, 34)
    _side_words(img, 690, user, joined, by, y0=96, ink=ink, soft=soft, accent=red, glow=(255, 244, 214),
                kicker="NEW ON THE MAP", line="A new Keeper just arrived at the Ancient Hatchery. Say hello and show them around.")
    _glow_text(img, (_p(W - 150), _p(H - 38)), "pdtools.xyz", _font(19), ink, (255, 244, 214), _p(7), 255, anchor="rs")
    return img


def _feast(avatar, user, name, joined, by, rnd):
    """a welcome feast: Blinky cuts the cake, Pinky pours the tea, the Keeper's picture sits on the top tier"""
    img = _cover("welcome-cake.jpg", 0.5, 0.5)
    _shade(img, (0, 0, W, 150), (20, 10, 6), lambda t, v=True: .78 * (1 - t) ** 1.4)
    _shade(img, (0, 540, W, H), (20, 10, 6), lambda t, v=True: .9 * min(1, t / .55) ** 1.3)
    _sky(img, [(600, 228, 120, 120, (255, 236, 190), 120, 40)])
    _hero(img, avatar, name, user, 600, 228, 110, ring=3, ring_colors=((255, 236, 170), (214, 150, 40), (255, 228, 150), (170, 110, 20)), shadow=60, shine=True)
    d = ImageDraw.Draw(img)
    title = f"Welcome, @{user}!"
    _glow_text(img, (_p(W / 2), _p(72)), title, _fit(d, title, 52, 28, 840), INK, (255, 170, 80), _p(12), 150, anchor="ms")
    line = "A cake for the newest Keeper. Pull up a chair and say hello."
    d.text((_p(W / 2), _p(628)), line, font=_fit(d, line, 22, 15, 620, False), fill=SOFT + (240,), anchor="ms")
    meta = f"Joined {joined}" + (f"  ·  Welcomed by @{by}" if by else "")
    d.text((_p(W / 2), _p(659)), meta, font=_fit(d, meta, 18, 13, 600), fill=GOLD, anchor="ms")
    d.text((_p(W - 40), _p(659)), "pdtools.xyz", font=_font(17), fill=SOFT, anchor="rs")
    return img


def _skyline(avatar, user, name, joined, by, rnd):
    """up in the sky: Blinky and Pinky loop a ribbon of cloud around the Keeper's picture"""
    img = _cover("welcome-sky.jpg", 0.5, 0.5)
    _sky(img, [(620, 200, 200, 190, (255, 255, 255), 120, 70)])
    _hero(img, avatar, name, user, 620, 196, 196, ring=6, ring_colors=((255, 255, 255), (196, 220, 255), (255, 255, 255), (150, 186, 236)), shadow=70)
    navy, blue = (28, 44, 104), (58, 92, 170)
    d = ImageDraw.Draw(img)
    title = f"Welcome, @{user}!"
    _glow_text(img, (_p(615), _p(366)), title, _fit(d, title, 50, 26, 560), navy, (255, 255, 255), _p(10), 255, anchor="ms")
    line = "Blinky and Pinky wrote it in the sky. Say hello!"
    _glow_text(img, (_p(615), _p(400)), line, _fit(d, line, 21, 14, 540, False), blue, (255, 255, 255), _p(7), 255, anchor="ms")
    meta = f"Joined {joined}" + (f"  ·  Welcomed by @{by}" if by else "")
    _glow_text(img, (_p(615), _p(430)), meta, _fit(d, meta, 18, 13, 520), navy, (255, 255, 255), _p(7), 255, anchor="ms")
    _glow_text(img, (_p(W - 40), _p(H - 24)), "pdtools.xyz", _font(18), navy, (255, 255, 255), _p(7), 255, anchor="rs")
    return img


LOOKS = {"dusk": _dusk, "gate": _gate, "map": _map, "feast": _feast, "sky": _skyline}


def card(avatar, user, name, joined, by=None, small=False, style="dusk"):
    """avatar: a PIL image or None. joined: like "Oct 24, 2026". by: the welcoming Keeper's handle, or None."""
    rnd = random.Random(f"welcome:{style}:" + user.lower())
    img = LOOKS.get(style, _dusk)(avatar, user, name, joined, by, rnd)
    out = img.convert("RGB"); del img
    if small:
        out = out.resize((W, H), Image.LANCZOS)
    buf = io.BytesIO(); out.save(buf, "JPEG", quality=90, optimize=True, progressive=True)
    return buf.getvalue()
