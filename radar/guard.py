"""Dragon Guard: a daily safety course for the Pocket Dragons community (pdtools.xyz/guard).

What it is
  One short lesson a day, then a six question quiz the Keeper takes on their honour. The course itself is a static
  app in radar/static/guard/ (index.html, guard.js, guard.css, content/, art/, i18n/). This module only serves it,
  hands it a little config, and keeps anonymous counts.

Safety by design
  pdtools never asks for a wallet, a seed phrase or a signature. There is no wallet code here or in the app, no mint
  link and no contract address. Progress stays in the Keeper's own browser.

Hidden until launch
  The page answers only on devices with the pdtools preview turned on, until GUARD_PUBLIC=1.

Settings (Render)
  GUARD_PUBLIC=1          open it to everyone
  GUARD_DATES             optional JSON {"1": "2026-11-08", ...}: the UTC day each lesson opens
  GUARD_OFFICIAL          optional "Name|https://url;Name|https://url": official Pocket Dragons links, only once the team
                          has confirmed them. Empty: the page tells Keepers to trust only the official accounts.
"""
import json
import re
import time
from pathlib import Path

from flask import Response, abort, jsonify, redirect, request, send_from_directory

from .visits import bump

GUARD_DIR = Path(__file__).parent / "static" / "guard"
EVENTS = {"start", "quiz", "done", "check", "seen", "share", "card"}
DATES = {1: "2026-11-08", 2: "2026-11-08", 3: "2026-11-09", 4: "2026-11-10", 5: "2026-11-11", 6: "2026-11-12",
         7: "2026-11-14", 8: "2026-11-15", 9: "2026-11-17", 10: "2026-11-18", 11: "2026-11-19", 12: "2026-11-20",
         13: "2026-11-21", 14: "2026-11-22"}
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Mint month safety news (8 Nov 2026): one tip a day on the feed and the community pages until the month is over.
# Each tip is a line Dragon Guard teaches. The language packs carry every tip in all ten languages.
SAFETY_UNTIL = "2026-11-30"
SAFETY_TIPS = [
    "Your seed phrase goes only into your own wallet. Nobody real will ever ask for it.",
    "A DM about the mint is a red flag. Nobody from the team will DM you first with a link.",
    "Mint from a fresh wallet with only what you need, and keep your dragons in a vault that never connects to new sites.",
    "Type the address yourself or use your own bookmark. Never trust a mint link from replies or DMs.",
    "Official accounts can get hacked. Check any mint news on two official channels before you click.",
    "Read every wallet popup. If you do not understand what you are signing, do not sign it.",
    "A permit or an approval can hand over your tokens without a transfer. Approve only what you understand.",
    "Check your wallet approvals on Check Day and revoke the ones you no longer use.",
    "A rushed presale or auction link is a lure. Urgency is the red flag.",
    "One signature can carry many actions. Slow down whenever a site asks you to sign.",
    "Fake jobs, fake calls and deepfakes target Keepers. Never run a file or app someone sends you.",
    "An address that looks almost right is a trap. Check the whole address, not just the start and the end.",
]


def safety_news(cfg, today: str) -> bool:
    """The safety news shows while Dragon Guard is public, through the mint month."""
    return bool(cfg.guard_public) and today <= SAFETY_UNTIL


def dates(raw: str) -> dict:
    """The day each lesson opens. A bad GUARD_DATES value never breaks the page: it falls back to the plan."""
    out = dict(DATES)
    if raw:
        try:
            for k, v in json.loads(raw).items():
                if int(k) in out and DAY.match(str(v)):
                    out[int(k)] = str(v)
        except (ValueError, TypeError, AttributeError):
            pass
    return out


def official(raw: str) -> list:
    """Official links, https only, so a typo can never put a strange link on a safety page."""
    out = []
    for part in (raw or "").split(";"):
        if "|" not in part:
            continue
        name, url = (x.strip() for x in part.split("|", 1))
        if name and re.match(r"^https://[A-Za-z0-9.-]+(/[^\s\"'<>]*)?$", url):
            out.append([name[:60], url[:200]])
    return out[:8]


def register(app, cfg, Session, tz, has_preview=None) -> None:
    def allowed() -> bool:
        return bool(getattr(cfg, "guard_public", False)) or bool(has_preview and has_preview())

    @app.get("/security")
    def guard_security():
        return redirect("/guard/", code=302)

    @app.get("/guard")
    def guard_slash():
        if not allowed():
            abort(404)
        return redirect("/guard/")

    @app.get("/guard/")
    def guard_page():
        if not allowed():
            abort(404)
        index = GUARD_DIR / "index.html"
        if not index.exists():
            abort(404)
        page = index.read_text(encoding="utf-8")
        conf = {"dates": {str(k): v for k, v in dates(getattr(cfg, "guard_dates", "")).items()},
                "official": official(getattr(cfg, "guard_official", "")),
                "serverNow": int(time.time() * 1000), "ver": _ver()}
        # a test clock for Jon's preview only (?now=2026-11-16T12:00:00Z), never for the public
        now = request.args.get("now", "")
        if now and has_preview and has_preview() and re.match(r"^\d{4}-\d{2}-\d{2}T[\d:.]+Z$", now):
            conf["now"] = now
        page = page.replace("/*GUARD_CFG*/{}", json.dumps(conf).replace("</", "<\\/")).replace("/*VER*/", conf["ver"])
        resp = Response(page, mimetype="text/html")
        resp.headers["Cache-Control"] = "private, no-cache"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Content-Security-Policy"] = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                                                   "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
                                                   "base-uri 'none'; form-action 'none'")
        if not getattr(cfg, "guard_public", False):
            resp.headers["X-Robots-Tag"] = "noindex, nofollow"
        return resp

    @app.get("/guard/<path:name>")
    def guard_file(name):
        if not allowed() or name == "index.html":
            abort(404)
        resp = send_from_directory(GUARD_DIR, name, max_age=86400 if name.startswith(("art/", "fonts/")) else 600)
        return resp

    @app.post("/api/guard/tally")
    def guard_tally():
        """Anonymous counts only: which lesson, which moment, and the score. No id, no name, no address."""
        if not allowed():
            abort(404)
        try:
            body = json.loads(request.get_data(cache=False, as_text=True)[:200] or "{}")
            m = int(body.get("m", -1)); ev = str(body.get("ev", ""))
        except (ValueError, TypeError, AttributeError):
            return ("", 204)
        if not (0 <= m <= 14) or ev not in EVENTS:
            return ("", 204)
        from datetime import datetime
        day = datetime.now(tz).date()
        with Session() as s:
            bump(s, day, f"guard_{m}_{ev}")
            if ev == "done":
                try:
                    sc = int(body.get("s", -1))
                except (ValueError, TypeError):
                    sc = -1
                if 0 <= sc <= 6:
                    bump(s, day, f"guard_{m}_s{sc}")
            s.commit()
        return ("", 204)


def _ver() -> str:
    try:
        return str(int((GUARD_DIR / "guard.js").stat().st_mtime))
    except OSError:
        return "1"
