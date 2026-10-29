"""Progress kept safe for Keepers who signed Blinky's Book of Friends.

Progress lives in the browser, and a browser can lose it (site data cleared, a phone that tidies storage, a new
phone). A signed Keeper's devices quietly send their progress here, and it is merged, never replaced: opened posts
are joined, dragons keep the higher count, streaks keep the longer run. When the same Keeper signs the book again on
any device, everything comes back. Only post ids, dates and small numbers are kept, under the Keeper's own X name.
"""
import json
from datetime import date

MAX_OPENED = 3000


def _day(v):
    return v if isinstance(v, str) and len(v) == 10 and v[4] == "-" else None


def _gap(a: str, b: str) -> int:
    try:
        return (date.fromisoformat(b) - date.fromisoformat(a)).days
    except ValueError:
        return 99


def _int(v) -> int:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and 0 <= v < 1e7 else 0


def _run(a: dict, b: dict) -> dict:
    """Two streaks {last, count, best, fz}: the later one, or the longer run when they meet on the same or next day."""
    a = {"last": _day(a.get("last")), "count": _int(a.get("count")), "best": _int(a.get("best")), "fz": _day(a.get("fz"))}
    b = {"last": _day(b.get("last")), "count": _int(b.get("count")), "best": _int(b.get("best")), "fz": _day(b.get("fz"))}
    if not a["last"]:
        out = dict(b)
    elif not b["last"]:
        out = dict(a)
    else:
        first, second = (a, b) if a["last"] <= b["last"] else (b, a)
        gap = _gap(first["last"], second["last"])
        out = dict(second)
        if gap == 0:
            out["count"] = max(a["count"], b["count"])
        elif gap == 1:
            out["count"] = max(second["count"], first["count"] + 1)
    out["best"] = max(a["best"], b["best"], out["count"])
    out["fz"] = max([x for x in (a["fz"], b["fz"]) if x], default=None)
    return {k: v for k, v in out.items() if v is not None}


def merge(old: dict, new: dict) -> dict:
    old, new = old or {}, new or {}
    opened = dict(old.get("opened") or {})
    for k, v in (new.get("opened") or {}).items():
        opened[k] = max(opened.get(k, 0), v)
    if len(opened) > MAX_OPENED:
        opened = dict(sorted(opened.items(), key=lambda kv: -kv[1])[:MAX_OPENED])
    out = {"opened": opened, "streak": _run(old.get("streak") or {}, new.get("streak") or {})}
    goals = [x for x in (old.get("goal"), new.get("goal")) if isinstance(x, dict) and _day(x.get("day"))]
    if goals:
        top = max(x["day"] for x in goals)
        same = [x for x in goals if x["day"] == top]
        out["goal"] = {"day": top, "n": max(_int(x.get("n")) for x in same)}
        for k in ("d", "f"):                         # v2.1 goal steps: done on either device is done
            if any(x.get(k) is True for x in same):
                out["goal"][k] = True
    da, db = old.get("dex") or {}, new.get("dex") or {}
    if da or db:
        have = {}
        for src in (da.get("have") or {}, db.get("have") or {}):
            for k, h in src.items():
                cur = have.setdefault(k, {})
                for t in ("c", "r", "l"):
                    v = max(cur.get(t, 0), _int((h or {}).get(t)))
                    if v:
                        cur[t] = v
        lasts = [x for x in (_day(da.get("last")), _day(db.get("last"))) if x]
        secrets = {}
        for src in (da.get("s") or {}, db.get("s") or {}):
            for k, v in src.items():
                if _day(v):
                    secrets[k] = min(secrets.get(k, v), v)
        out["dex"] = {"have": have, "last": max(lasts) if lasts else None, "n": max(_int(da.get("n")), _int(db.get("n"))),
                      "g": _run(da.get("g") or {}, db.get("g") or {}), "e": max(_int(da.get("e")), _int(db.get("e"))), "s": secrets}
        swaps = {}                                   # duplicate swaps: joined by their time, so none is lost or counted twice
        for src in (da.get("sw") or [], db.get("sw") or []):
            for x in src if isinstance(src, list) else []:
                if isinstance(x, dict) and isinstance(x.get("t"), int) and x["t"] not in swaps:
                    swaps[x["t"]] = x
        if swaps:
            out["dex"]["sw"] = [swaps[t] for t in sorted(swaps)][-300:]
    return out


def load(raw: str | None) -> dict:
    try:
        d = json.loads(raw or "{}")
    except ValueError:
        return {}
    return d if isinstance(d, dict) else {}
