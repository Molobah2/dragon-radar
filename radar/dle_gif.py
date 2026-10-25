"""The animated Dragondle card: five eggs on the straw ledge at sunrise wobble and hatch one by one (only the right
answers hatch), the score counts up, and confetti falls at the end. 800 x 450, about 5 seconds, then it rests on the
finished picture. No spoilers: it only knows which answers were right."""
import io
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ART = Path(__file__).parent / "static" / "v21"
FONTS = Path(__file__).parent / "fonts"
W, H = 800, 450
_cache: dict[str, Image.Image] = {}


def _art(name, height=None):
    key = f"{name}:{height}"
    if key not in _cache:
        im = Image.open(ART / name).convert("RGBA")
        if height:
            im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
        _cache[key] = im
    return _cache[key]


def _font(size, bold=True):
    return ImageFont.truetype(str(FONTS / ("fredoka-700.ttf" if bold else "fredoka-600.ttf")), size)


def _ease(t):
    return 1 - (1 - t) ** 3


def _spring(t):
    if t <= 0:
        return 0.0
    if t >= 1:
        return 1.0
    return 1 - math.exp(-6 * t) * math.cos(10 * t)


def _mood(s):
    return ("A perfect hatch!" if s == 5 else "So close to perfect!" if s == 4 else "Well read, Keeper!" if s == 3
            else "Every egg hatches in time." if s >= 1 else "Tomorrow's eggs are waiting.")


def _star(d, x, y, r, fill):
    pts = []
    for i in range(8):
        a = i * math.pi / 4 - math.pi / 2
        rad = r * 0.32 if i % 2 else r
        pts.append((x + math.cos(a) * rad, y + math.sin(a) * rad))
    d.polygon(pts, fill=fill)


def card(n: int, marks: list[int], streak: int) -> bytes:
    marks = [1 if m else 0 for m in marks][:5] + [0] * max(0, 5 - len(marks))
    total = len(marks)
    rnd = random.Random(n * 31 + sum(m << i for i, m in enumerate(marks)))
    bg = Image.open(ART / "dle-nest.jpg").convert("RGB")
    k = max(W / bg.width, H / bg.height)
    bg = bg.resize((round(bg.width * k), round(bg.height * k)), Image.LANCZOS)
    bg = bg.crop(((bg.width - W) // 2, int((bg.height - H) * .6), (bg.width - W) // 2 + W, int((bg.height - H) * .6) + H))
    # a soft light wash at the top so the words read
    wash = Image.new("RGBA", (W, H), (255, 236, 214, 0)); wd = ImageDraw.Draw(wash)
    for y in range(220):
        wd.line([(0, y), (W, y)], fill=(255, 236, 214, int(140 * (1 - y / 220))))
    base = bg.convert("RGBA"); base.alpha_composite(wash)
    egg = _art("dle-egg.webp", 130)
    hatched = [_art("dle-egg-blinky.webp", 174), _art("dle-egg-pinky.webp", 174)]
    xs = [107 + i * 146 for i in range(5)]
    ground = 420
    f_pill, f_big, f_tail, f_line, f_small = _font(15), _font(82), _font(40), _font(22, False), _font(16, False)
    # the timeline: eggs land, then each one wobbles and hatches (or dozes off) in turn, then confetti
    LAND, STEP, CONF = 8, 9, 16
    frames, durations = [], []
    total_frames = LAND + STEP * total + CONF
    confetti = [(rnd.uniform(0, W), rnd.uniform(-H, 0), rnd.uniform(3, 7), rnd.uniform(0, 6.28),
                 rnd.choice([(255, 126, 182), (255, 211, 106), (126, 224, 195), (159, 179, 255), (255, 163, 108)])) for _ in range(70)]
    for f in range(total_frames):
        im = base.copy(); d = ImageDraw.Draw(im)
        score = 0
        for i, m in enumerate(marks):
            start = LAND + i * STEP
            land = _spring(min(1, f / LAND))
            local = f - start
            cx = xs[i]
            # the shadow
            sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).ellipse((cx - 44, ground - 12, cx + 44, ground + 6), fill=(80, 50, 20, 70))
            im.alpha_composite(sh)
            if local >= 5 and m:
                score += 1
                p = _spring((local - 5) / 4) if local < 9 else 1
                sprite = hatched[(sum(marks[:i])) % 2]
                sc = 0.75 + 0.25 * p
                spr = sprite.resize((max(1, int(sprite.width * sc)), max(1, int(sprite.height * sc))), Image.BILINEAR)
                if local < 12:     # a burst of light when it hatches
                    burst = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(burst)
                    rr = 30 + (local - 5) * 22
                    bd.ellipse((cx - rr, ground - 90 - rr, cx + rr, ground - 90 + rr), fill=(255, 240, 190, max(0, 150 - (local - 5) * 22)))
                    im.alpha_composite(burst.filter(ImageFilter.GaussianBlur(10)))
                im.alpha_composite(spr, (int(cx - spr.width / 2), int(ground - spr.height)))
            else:
                ang = 0.0
                if 0 <= local < 5:
                    ang = math.sin(local * 1.9) * (9 if m else 6)
                elif local >= 5 and not m:
                    ang = (-1 if i % 2 else 1) * 3
                drop = (1 - land) * -120
                spr = egg.rotate(ang, resample=Image.BICUBIC, expand=True, center=(egg.width / 2, egg.height)) if ang else egg
                im.alpha_composite(spr, (int(cx - spr.width / 2), int(ground - egg.height + drop - (spr.height - egg.height))))
                if local >= 5 and not m:
                    zz = min(1, (local - 5) / 3)
                    d.text((cx + 34, ground - 138 - zz * 6), "z", font=_font(18), fill=(90, 60, 110, int(200 * zz)))
                    d.text((cx + 48, ground - 154 - zz * 10), "z", font=_font(13), fill=(90, 60, 110, int(170 * zz)))
        # sparkles near hatched eggs
        for i, m in enumerate(marks):
            if m and f - (LAND + i * STEP) >= 5:
                for j in range(3):
                    t = (f * 0.35 + j * 2.1 + i) % 3.0
                    _star(d, xs[i] - 50 + (j * 47 + i * 13) % 100, ground - 120 - t * 30, 3 + (j % 2) * 2, (255, 236, 160, int(255 * (1 - t / 3))))
        # the words
        pill_text = f"DRAGONDLE #{n}"
        pw = d.textlength(pill_text, font=f_pill) + 30
        d.rounded_rectangle((W / 2 - pw / 2, 18, W / 2 + pw / 2, 48), radius=15, fill=(255, 255, 255))
        d.text((W / 2, 33), pill_text, font=f_pill, fill=(106, 47, 92), anchor="mm")
        main, tail = str(score), f" / {total}"
        mw, tw = d.textlength(main, font=f_big), d.textlength(tail, font=f_tail)
        x0 = W / 2 - (mw + tw) / 2
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
        gd.text((x0, 138), main, font=f_big, fill=(255, 255, 255, 255), anchor="ls")
        im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(9)))
        d.text((x0, 138), main, font=f_big, fill=(91, 35, 80), anchor="ls")
        d.text((x0 + mw + 4, 138), tail, font=f_tail, fill=(192, 81, 127), anchor="ls")
        done = f >= LAND + STEP * total
        line = _mood(sum(marks)) if done else "Hatching your answers..."
        d.text((W / 2, 172), line, font=f_line, fill=(106, 47, 92), anchor="mm")
        d.text((W / 2, 198), f"{streak} day streak · pdtools.xyz/dragondle" if streak != 1 else "1 day streak · pdtools.xyz/dragondle",
               font=f_small, fill=(154, 79, 122), anchor="mm")
        if done and sum(marks):
            t = f - (LAND + STEP * total)
            for (cxp, cyp, sp, ph, col) in confetti:
                y = cyp + t * sp * 9
                if 0 < y < H:
                    xx = cxp + math.sin(ph + t * .5) * 14
                    d.rectangle((xx - 5, y - 2, xx + 5, y + 2), fill=col)
        frames.append(im.convert("RGB"))
        durations.append(80)
    durations[-1] = 2600
    pal = frames[-1].quantize(colors=200, method=Image.Quantize.MEDIANCUT)
    q = [fr.quantize(palette=pal, dither=Image.Dither.NONE) for fr in frames]
    buf = io.BytesIO()
    q[0].save(buf, "GIF", save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)
    return buf.getvalue()
