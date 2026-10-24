"""The welcome card for a Keeper who just joined: a deep dusk sky, a soft halo, the Keeper as the hero on the left
and the words on the right. No border, so it never looks like one of the official relic cards. Drawn at twice the size (2400 x 1350, 16:9) so it stays crisp on X. Used for the share picture of
/welcome/<handle> and for the card a Keeper saves and posts with their hello."""
import io
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FONTS = Path(__file__).parent / "fonts"
W, H, S = 1200, 675, 2                      # laid out at 1200 x 675, drawn at twice that
LOOK = {
    "bg": ((64, 36, 63), (11, 6, 20)),       # dusk rose fading to night, the hatchery at first light
    "glow": (255, 196, 120),
    "ink": (255, 246, 232),
    "soft": (255, 232, 210),
    "accent": (255, 210, 122),
    "frame": ((255, 241, 184), (217, 154, 30), (255, 232, 154), (154, 100, 16)),
}
HX, HY = 340, 337                            # where the hero sits


def _font(n, bold=True):
    return ImageFont.truetype(str(FONTS / ("fredoka-700.ttf" if bold else "fredoka-600.ttf")), round(n * S))


def _p(v):
    return round(v * S)


def _spaced(d, xy, text, font, fill, gap):
    """Letters set a little apart, like the relic kicker."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill, anchor="ls")
        x += d.textlength(ch, font=font) + gap


def _glow_text(img, xy, text, font, fill, glow, blur, alpha=150):
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(lay).text(xy, text, font=font, fill=glow + (alpha,), anchor="ls")
    img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(blur)))
    ImageDraw.Draw(img).text(xy, text, font=font, fill=fill, anchor="ls")


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
    m = Image.new("L", (size * 3, size * 3), 0); ImageDraw.Draw(m).ellipse((0, 0, size * 3 - 1, size * 3 - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0)); out.paste(pic, (0, 0), m.resize((size, size), Image.LANCZOS))
    return out


def _gold(size, colors):
    """A diagonal gold gradient, used for the ring around the picture."""
    w, h = size
    g = Image.new("RGB", (w, h))
    px = g.load()
    stops = len(colors) - 1
    # a small strip is enough: the gradient only runs corner to corner
    strip = Image.new("RGB", (512, 1))
    for i in range(512):
        t = i / 511 * stops; k = min(int(t), stops - 1); f = t - k
        a, b = colors[k], colors[k + 1]
        strip.putpixel((i, 0), tuple(int(a[j] + (b[j] - a[j]) * f) for j in range(3)))
    diag = strip.resize((w + h, 1))
    for y in range(0, h, 2):
        row = diag.crop((y, 0, y + w, 1))
        g.paste(row.resize((w, 2)), (0, y))
    del px
    return g


def card(avatar, user, name, joined, by=None, small=False):
    """avatar: a PIL image or None. joined: like "Oct 24, 2026". by: the welcoming Keeper's handle, or None.
    small: 1200x675 for link previews; the saved card is 2400x1350."""
    img = Image.new("RGBA", (_p(W), _p(H)), LOOK["bg"][1] + (255,))
    rnd = random.Random("welcome:" + user.lower())
    # the sky: night at the edges, a rose dusk glowing around the hero
    for rad, col, blur in ((380, (78, 30, 88, 235), 150), (230, (160, 72, 60, 165), 100)):
        lay = Image.new("RGBA", img.size, col[:3] + (0,)); m = Image.new("L", img.size, 0)
        ImageDraw.Draw(m).ellipse((_p(HX - rad), _p(HY - rad), _p(HX + rad), _p(HY + rad)), fill=col[3])
        lay.putalpha(m.filter(ImageFilter.GaussianBlur(_p(blur)))); img.alpha_composite(lay)
    # a faint warm cloud low on the right, so the words sit on something
    for cx, cy, rad, col in ((930, 600, 380, (255, 140, 80, 46)), (1000, 90, 340, (140, 80, 210, 52)), (150, 610, 260, (255, 180, 110, 30))):
        cl = Image.new("RGBA", img.size, col[:3] + (0,)); m = Image.new("L", img.size, 0)
        ImageDraw.Draw(m).ellipse((_p(cx - rad), _p(cy - rad), _p(cx + rad), _p(cy + rad)), fill=col[3])
        cl.putalpha(m.filter(ImageFilter.GaussianBlur(_p(rad * .45)))); img.alpha_composite(cl)
    # golden motes drifting up from the hatchery floor
    motes = Image.new("RGBA", img.size, (0, 0, 0, 0)); dm = ImageDraw.Draw(motes)
    for _ in range(170):
        px, py = rnd.random() * W, H - (rnd.random() ** .8) * H
        r = .5 + rnd.random() * 2.2; a = int(60 + rnd.random() * 190)
        col = (255, 214, 140, a) if rnd.random() < .7 else (255, 246, 230, a)
        dm.ellipse((_p(px - r), _p(py - r), _p(px + r), _p(py + r)), fill=col)
    img.alpha_composite(motes.filter(ImageFilter.GaussianBlur(_p(.6))))
    # soft rays and two thin halo rings behind the hero, like the moon relic
    rays = Image.new("RGBA", img.size, (0, 0, 0, 0)); dr = ImageDraw.Draw(rays)
    for i in range(16):
        a = i * math.tau / 16 + .1
        dr.polygon([(_p(HX), _p(HY)), (_p(HX + math.cos(a - .06) * 700), _p(HY + math.sin(a - .06) * 700)),
                    (_p(HX + math.cos(a + .06) * 700), _p(HY + math.sin(a + .06) * 700))], fill=(255, 215, 140, 9))
    img.alpha_composite(rays.filter(ImageFilter.GaussianBlur(_p(4))))
    halo = Image.new("RGBA", img.size, LOOK["glow"] + (0,)); m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).ellipse((_p(HX - 300), _p(HY - 300), _p(HX + 300), _p(HY + 300)), fill=150)
    halo.putalpha(m.filter(ImageFilter.GaussianBlur(_p(110)))); img.alpha_composite(halo)
    rings = Image.new("RGBA", img.size, (0, 0, 0, 0)); drg = ImageDraw.Draw(rings)
    drg.ellipse((_p(HX - 250), _p(HY - 250), _p(HX + 250), _p(HY + 250)), outline=(255, 226, 170, 120), width=_p(1.5))
    drg.ellipse((_p(HX - 268), _p(HY - 268), _p(HX + 268), _p(HY + 268)), outline=(255, 226, 170, 60), width=_p(1.2))
    ringglow = rings.filter(ImageFilter.GaussianBlur(_p(6)))
    img.alpha_composite(ringglow); img.alpha_composite(rings)
    # the Keeper: their picture in a gold ring with a soft shadow and a little shine
    D = 380
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((_p(HX - D / 2 - 6), _p(HY - D / 2 + 14), _p(HX + D / 2 + 6), _p(HY + D / 2 + 26)), fill=(0, 0, 0, 150))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(_p(16))))
    goldring = _gold((_p(D + 14), _p(D + 14)), LOOK["frame"]).convert("RGBA")
    cm = Image.new("L", goldring.size, 0); ImageDraw.Draw(cm).ellipse((0, 0, goldring.width - 1, goldring.height - 1), fill=255)
    img.paste(goldring, (_p(HX - (D + 14) / 2), _p(HY - (D + 14) / 2)), cm.resize(goldring.size))
    pic = _portrait(avatar, _p(D), name or user)
    img.alpha_composite(pic, (_p(HX - D / 2), _p(HY - D / 2)))
    shine = Image.new("RGBA", (_p(D), _p(D)), (0, 0, 0, 0))
    ImageDraw.Draw(shine).ellipse((_p(-D * .25), _p(-D * .62), _p(D * 1.05), _p(D * .42)), fill=(255, 255, 255, 34))
    sm = Image.new("L", shine.size, 0); ImageDraw.Draw(sm).ellipse((0, 0, shine.width - 1, shine.height - 1), fill=255)
    lay = Image.new("RGBA", shine.size, (0, 0, 0, 0)); lay.paste(shine, (0, 0), sm)
    img.alpha_composite(lay, (_p(HX - D / 2), _p(HY - D / 2)))
    # a vignette so the edges fall back into the night
    vg = Image.radial_gradient("L").resize(img.size, Image.BILINEAR)      # 0 in the middle, about 180 at the sides
    dark = Image.new("RGBA", img.size, (6, 3, 14, 255)); dark.putalpha(vg.point(lambda v: int(max(0, min(1, (v - 95) / 120)) * 225)))
    img.alpha_composite(dark)
    # a soft shade behind the words so they always read
    strip = Image.new("L", (_p(W), 1), 0)
    for x in range(_p(600), _p(W)):
        t = (x / S - 600) / 600
        strip.putpixel((x, 0), int(255 * (.22 * min(1, t / .25) + .08 * max(0, (t - .25) / .75))))
    sl = Image.new("RGBA", img.size, (0, 0, 0, 255)); sl.putalpha(strip.resize(img.size))
    img.alpha_composite(sl)
    # words
    d = ImageDraw.Draw(img)
    X = _p(660)
    _spaced(d, (X, _p(178)), "NEW KEEPER", _font(22), LOOK["accent"], _p(5))
    _glow_text(img, (X, _p(268)), "Welcome,", _font(76), LOOK["ink"], LOOK["glow"], _p(14), 120)
    handle = "@" + user
    _glow_text(img, (X, _p(346)), handle, _fit(d, handle, 66, 34, 470), LOOK["ink"], LOOK["glow"], _p(14), 130)
    line = "Just joined the Ancient Hatchery. Say hello and make them feel at home."
    f = _font(24, False)
    y = 402
    for row in _wrap(d, line, f, 470):
        d.text((X, _p(y)), row, font=f, fill=LOOK["soft"] + (220,), anchor="ls"); y += 34
    if by:
        _spaced(d, (X, _p(512)), "WELCOMED BY", _font(18, False), LOOK["soft"] + (210,), _p(4))
        who = "@" + by
        _glow_text(img, (X, _p(558)), who, _fit(d, who, 40, 24, 470), LOOK["ink"], LOOK["glow"], _p(10), 110)
        d.text((X, _p(598)), f"Joined {joined}", font=_font(19), fill=LOOK["accent"], anchor="ls")
    else:
        d.text((X, _p(548)), f"Joined {joined}", font=_font(21), fill=LOOK["accent"], anchor="ls")
    d.text((_p(W - 60), _p(H - 58)), "pdtools.xyz", font=_font(21), fill=LOOK["ink"], anchor="rs")
    out = img.convert("RGB")
    if small:
        out = out.resize((W, H), Image.LANCZOS)
    buf = io.BytesIO(); out.save(buf, "JPEG", quality=90, optimize=True, progressive=True)
    return buf.getvalue()
