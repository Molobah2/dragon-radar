"""v2.2 living dragons: a seamless loop made from each posted dragon picture (radar/static/v21/<name>.webp).
Each sheet holds the loop frames, 8 to a row; sx, sy, sw, sh is where the original picture sits inside one frame, so
radar/v22/live.js can lay the loop exactly over the picture. "big" is for the large pictures, "small" for cards."""

BASE = "https://res.cloudinary.com/gosbi0oh/image/upload"

# name: (version big, version small, big frame, small frame); cut out, props restored and colour matched to the picture (Oct 30)
LIVE = {
    "dle-pinky-quill": (1793368811, 1793368812,
        {"n": 48, "fps": 12, "cw": 394, "ch": 360, "cols": 8, "sx": 84.0, "sy": 3.9, "sw": 294.9, "sh": 355.0},
        {"n": 32, "fps": 8, "cw": 186, "ch": 170, "cols": 8, "sx": 39.7, "sy": 1.8, "sw": 139.2, "sh": 167.6}),
    "blinky-lantern": (1793368812, 1793368813,
        {"n": 48, "fps": 12, "cw": 295, "ch": 360, "cols": 8, "sx": 10.7, "sy": 6.5, "sw": 267.0, "sh": 352.3},
        {"n": 32, "fps": 8, "cw": 139, "ch": 170, "cols": 8, "sx": 5.1, "sy": 3.1, "sw": 126.1, "sh": 166.4}),
    "blinky-scope": (1793368814, 1793368815,
        {"n": 48, "fps": 12, "cw": 359, "ch": 360, "cols": 8, "sx": 2.3, "sy": 3.5, "sw": 309.5, "sh": 355.4},
        {"n": 32, "fps": 8, "cw": 169, "ch": 170, "cols": 8, "sx": 1.1, "sy": 1.6, "sw": 146.1, "sh": 167.8}),
    "blinky-skylantern": (1793368816, 1793368817,
        {"n": 48, "fps": 12, "cw": 234, "ch": 360, "cols": 8, "sx": 14.6, "sy": 54.6, "sw": 217.7, "sh": 304.7},
        {"n": 32, "fps": 8, "cw": 111, "ch": 170, "cols": 8, "sx": 6.9, "sy": 25.8, "sw": 102.8, "sh": 143.9}),
    "pinky-scroll": (1793368817, 1793368818,
        {"n": 48, "fps": 12, "cw": 289, "ch": 360, "cols": 8, "sx": 10.0, "sy": 13.7, "sw": 267.4, "sh": 341.1},
        {"n": 32, "fps": 8, "cw": 136, "ch": 170, "cols": 8, "sx": 4.7, "sy": 6.5, "sw": 126.3, "sh": 161.1}),
    "pinky-heart": (1793368819, 1793368820,
        {"n": 48, "fps": 12, "cw": 279, "ch": 360, "cols": 8, "sx": 7.9, "sy": 10.9, "sw": 261.7, "sh": 346.8},
        {"n": 32, "fps": 8, "cw": 132, "ch": 170, "cols": 8, "sx": 3.7, "sy": 5.2, "sw": 123.6, "sh": 163.8}),
    "pinky-frame": (1793368821, 1793368822,
        {"n": 48, "fps": 12, "cw": 252, "ch": 360, "cols": 8, "sx": 10.3, "sy": 52.3, "sw": 231.5, "sh": 306.7},
        {"n": 32, "fps": 8, "cw": 119, "ch": 170, "cols": 8, "sx": 4.9, "sy": 24.7, "sw": 109.3, "sh": 144.8}),
}


def live_clips() -> dict:
    out = {}
    for name, (vb, vs, big, small) in LIVE.items():
        out[name] = {"big": {**big, "src": f"{BASE}/v{vb}/dragon-radar/v22/live-{name}.webp"},
                     "small": {**small, "src": f"{BASE}/v{vs}/dragon-radar/v22/live-{name}-s.webp"}}
    return out
