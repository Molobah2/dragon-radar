"""Blinky's Book of Friends: Keepers sign with their X name and prove it is theirs with one post.

How a name is proven: the site gives a short code (PD7QXK). The Keeper posts it on X, pastes the
link here, and we read that one post through X's free oEmbed endpoint. If the post is by the same
handle and carries the code, the name is confirmed. No X login, no paid API call.

What the book unlocks, all counted on the server from anonymous opens (events.py):
  tiers            Bronze, Silver, Gold for steady support across many different Keepers
  my supporters    which signed Keepers opened your posts this week (only you see it)
  top supporters   the most generous signed Keepers this week
"""
import re
import secrets
from datetime import date, timedelta

from sqlalchemy import func, select

from .db import Event, Friend, FriendDevice, Post, utcnow
from .events import VID

HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
ALPHABET = "ACDEFHJKMNPQRTWXY3479"     # no look alike letters
TIERS = (("gold", 60), ("silver", 30), ("bronze", 10))
GOLD_WEEKS = 3
OPENS = ("open", "popen")
LINK = re.compile(r"(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status(?:es)?/(\d{5,25})", re.I)


def clean_handle(raw: str) -> str:
    h = (raw or "").strip().lstrip("@").strip()
    if "/" in h:                                  # a profile link was pasted
        h = h.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
    return h if HANDLE.match(h) else ""


def new_code() -> str:
    return "PD" + "".join(secrets.choice(ALPHABET) for _ in range(6))


def post_time(post_id: str):
    """When an X post was made, read from its id (X ids carry their own timestamp)."""
    from datetime import datetime, timezone
    try:
        return datetime.fromtimestamp(((int(post_id) >> 22) + 1288834974657) / 1000, tz=timezone.utc).replace(tzinfo=None)
    except (ValueError, OverflowError, OSError):
        return None


MAX_DEVICES = 5          # phones and computers one book name can be carried to


def blocked(s) -> set[str]:
    from .db import get_setting
    return {h.strip().lower() for h in get_setting(s, "book_blocked", "").split(",") if h.strip()}


def remove(s, key: str, block: bool = False) -> None:
    """Jon takes a name out of the book (and its linked browsers). With block, it cannot sign again."""
    from .db import set_setting
    from sqlalchemy import delete
    s.execute(delete(FriendDevice).where(FriendDevice.key == key))
    from .db import BookPage
    s.execute(delete(BookPage).where(BookPage.key == key))        # their public dragon book page goes with them
    f = s.get(Friend, key)
    if f:
        s.delete(f)
    from .db import ArtEntry, ArtVote                             # their Keeper Art comes down and their votes stop counting
    s.execute(delete(ArtVote).where(ArtVote.voter == key))
    for e in s.scalars(select(ArtEntry).where(ArtEntry.key == key, ArtEntry.status != "rejected")).all():
        s.execute(delete(ArtVote).where(ArtVote.entry_id == e.id))
        e.status, e.note = "rejected", "Removed from the Book of Friends."
    if block:
        set_setting(s, "book_blocked", ",".join(sorted(blocked(s) | {key})))


def link_device(s, from_vid: str, to_vid: str) -> bool:
    """A backup code carries the book name to another phone or computer (the code itself is the proof)."""
    src = s.get(FriendDevice, from_vid) if VID.match(from_vid or "") else None
    if not src or not src.confirmed or not VID.match(to_vid or "") or from_vid == to_vid or src.key in blocked(s):
        return False
    dev = s.get(FriendDevice, to_vid)
    if (dev is None or dev.key != src.key) and (s.scalar(select(func.count()).select_from(FriendDevice).where(
            FriendDevice.key == src.key, FriendDevice.confirmed.is_(True))) or 0) >= MAX_DEVICES:
        return False
    if dev is None:
        s.add(FriendDevice(vid=to_vid, key=src.key, username=src.username, code=src.code, confirmed=True))
    else:
        dev.key, dev.username, dev.code, dev.confirmed = src.key, src.username, src.code, True
    return True


def admin_list(s) -> dict:
    friends = s.scalars(select(Friend).order_by(Friend.confirmed_at.desc())).all()
    pending = s.scalar(select(func.count()).select_from(FriendDevice).where(FriendDevice.confirmed.is_(False))) or 0
    return {"friends": friends, "pending": pending, "blocked": sorted(blocked(s))}


def proof_text(code: str) -> str:
    return f"Signing Blinky's Book of Friends {code} \U0001F409 #PocketDragons pdtools.xyz"


def sign(s, vid: str, raw_handle: str) -> dict:
    """Start or restart signing on this browser. Returns the code to post."""
    handle = clean_handle(raw_handle)
    if not VID.match(vid or "") or not handle:
        return {"ok": False, "why": "bad"}
    key = handle.lower()
    if key in blocked(s):
        return {"ok": False, "why": "blocked"}
    dev = s.get(FriendDevice, vid)
    if dev and dev.confirmed and dev.key == key:
        return {"ok": True, "status": "confirmed", "handle": dev.username}
    if dev is None:
        dev = FriendDevice(vid=vid, key=key, username=handle, code=new_code())
        s.add(dev)
    else:                                         # a new name, or a fresh code for the same one
        dev.key, dev.username, dev.code, dev.confirmed, dev.created_at = key, handle, new_code(), False, utcnow()
    return {"ok": True, "status": "pending", "handle": handle, "code": dev.code, "text": proof_text(dev.code)}


def check(s, vid: str, link: str, lookup) -> dict:
    """Confirm the name with the pasted post link. `lookup(post_id)` is oembed.fetch."""
    dev = s.get(FriendDevice, vid) if VID.match(vid or "") else None
    if dev is None:
        return {"ok": False, "why": "nosign"}
    if dev.confirmed:
        return {"ok": True, "status": "confirmed", "handle": dev.username}
    if dev.key in blocked(s):                          # blocked after this browser started signing
        return {"ok": False, "why": "blocked"}
    m = LINK.search(link or "")
    if not m:
        return {"ok": False, "why": "link"}
    post_id = m.group(2)
    made = post_time(post_id)
    if made is not None and dev.created_at and made < dev.created_at - timedelta(minutes=2):
        return {"ok": False, "why": "old"}             # an older post cannot carry a code made just now
    info = lookup(post_id)
    if info is None:
        return {"ok": False, "why": "busy"}
    if not info:
        return {"ok": False, "why": "gone"}
    if (info.get("username") or "").lower() != dev.key:
        return {"ok": False, "why": "other", "found": info.get("username") or ""}
    if dev.code.upper() not in (info.get("text") or "").upper():
        return {"ok": False, "why": "nocode"}
    dev.confirmed = True
    f = s.get(Friend, dev.key)
    if f is None:
        f = Friend(key=dev.key, username=info.get("username") or dev.username, name=(info.get("name") or "")[:100],
                   proof_post=post_id)
        s.add(f)
    return {"ok": True, "status": "confirmed", "handle": f.username}


# ---------- numbers from anonymous opens ----------
def _devices(s) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for vid, key in s.execute(select(FriendDevice.vid, FriendDevice.key).where(FriendDevice.confirmed.is_(True))).all():
        out.setdefault(key, []).append(vid)
    return out


def breadth(s, end: date, vids: list[str] | None = None) -> dict[str, int]:
    """For each browser: how many different people's posts it opened in the 7 days ending on `end`."""
    start = end - timedelta(days=6)
    q = (select(Event.vid, func.count(func.distinct(Post.author_id)))
         .join(Post, Post.id == Event.ref)
         .where(Event.kind.in_(OPENS), Event.day >= start, Event.day <= end, Post.hidden.is_(False),
                Post.created_at >= _since(start)))
    if vids is not None:
        q = q.where(Event.vid.in_(vids or [""]))
    return dict(s.execute(q.group_by(Event.vid)).all())


def friend_breadth(s, end: date, devices: dict[str, list[str]]) -> dict[str, int]:
    """Per signed Keeper, across all their linked browsers. Counted per browser and summed would double count,
    so the distinct people are taken over the union of their browsers."""
    start = end - timedelta(days=6)
    vid_to_key = {v: k for k, vs in devices.items() for v in vs}
    if not vid_to_key:
        return {}
    rows = s.execute(select(Event.vid, Post.author_id).join(Post, Post.id == Event.ref)
                     .where(Event.kind.in_(OPENS), Event.day >= start, Event.day <= end, Post.hidden.is_(False),
                            Post.created_at >= _since(start), Event.vid.in_(list(vid_to_key)))).all()
    seen: dict[str, set] = {}
    for vid, author in rows:
        seen.setdefault(vid_to_key[vid], set()).add(author)
    return {k: len(v) for k, v in seen.items()}


def _since(start: date):
    """Only fresh posts count for support: opening old posts from a list cannot climb the tiers."""
    from datetime import datetime
    return datetime.combine(start - timedelta(days=2), datetime.min.time())


def tier_of(weeks: list[int]) -> str:
    """weeks[0] is this week. Gold needs the Gold number three weeks running."""
    n = weeks[0] if weeks else 0
    if n >= TIERS[0][1] and len(weeks) >= GOLD_WEEKS and all(w >= TIERS[0][1] for w in weeks[:GOLD_WEEKS]):
        return "gold"
    for name, need in TIERS[1:]:
        if n >= need:
            return name
    if n >= TIERS[0][1]:                          # Gold numbers, not yet three weeks running
        return "silver"
    return ""


def tiers(s, today: date) -> dict[str, dict]:
    """Every signed Keeper: this week's breadth and tier."""
    devices = _devices(s)
    weeks = [friend_breadth(s, today - timedelta(days=7 * i), devices) for i in range(GOLD_WEEKS)]
    out = {}
    for f in s.scalars(select(Friend)).all():
        w = [wk.get(f.key, 0) for wk in weeks]
        out[f.key] = {"handle": f.username, "name": f.name, "week": w[0], "tier": tier_of(w)}
    return out


def one_tier(s, key: str, today: date) -> dict:
    """The same numbers as tiers() for one Keeper only, so opening your own page stays fast."""
    devices = {key: [v for (v,) in s.execute(select(FriendDevice.vid).where(FriendDevice.key == key,
                                                                        FriendDevice.confirmed.is_(True))).all()]}
    w = [friend_breadth(s, today - timedelta(days=7 * i), devices).get(key, 0) for i in range(GOLD_WEEKS)]
    run = 0                                       # weeks in a row at the Gold number, this week first
    for n in w:
        if n < TIERS[0][1]:
            break
        run += 1
    return {"week": w[0], "tier": tier_of(w), "run": run}


def public_book(s, today: date) -> dict:
    t = tiers(s, today)
    order = {"gold": 0, "silver": 1, "bronze": 2, "": 3}
    friends = sorted(t.values(), key=lambda f: (order[f["tier"]], -f["week"], f["handle"].lower()))
    top = [f for f in sorted(t.values(), key=lambda f: -f["week"]) if f["week"] > 0][:10]
    return {"count": len(friends), "friends": friends[:300], "top": top}


def supporters_of(s, key: str, today: date) -> list[dict]:
    """Signed Keepers who opened this Keeper's posts in the last 7 days (most posts first)."""
    start = today - timedelta(days=6)
    devices = _devices(s)
    vid_to_key = {v: k for k, vs in devices.items() for v in vs if k != key}
    if not vid_to_key:
        return []
    post_ids = [pid for (pid,) in s.execute(select(Post.id).where(func.lower(Post.author_username) == key)).all()]
    if not post_ids:
        return []
    rows = s.execute(select(Event.vid, Event.ref).where(Event.kind.in_(OPENS), Event.day >= start,
                                                        Event.ref.in_(post_ids), Event.vid.in_(list(vid_to_key)))).all()
    count: dict[str, set] = {}
    for vid, ref in rows:
        count.setdefault(vid_to_key[vid], set()).add(ref)
    names = {f.key: f.username for f in s.scalars(select(Friend).where(Friend.key.in_(list(count) or [""]))).all()}
    return [{"handle": names.get(k, k), "posts": len(v)} for k, v in sorted(count.items(), key=lambda kv: -len(kv[1]))]


def me(s, vid: str, today: date) -> dict:
    dev = s.get(FriendDevice, vid) if VID.match(vid or "") else None
    if dev is None:
        return {"status": "none"}
    if not dev.confirmed:
        return {"status": "pending", "handle": dev.username, "code": dev.code, "text": proof_text(dev.code)}
    t = one_tier(s, dev.key, today)
    nxt = next(((name, need) for name, need in reversed(TIERS) if t.get("week", 0) < need), None)
    return {"status": "confirmed", "handle": dev.username, "tier": t.get("tier", ""), "week": t.get("week", 0),
            "next": {"tier": nxt[0], "need": nxt[1]} if nxt else None,
            "goldRun": t.get("run", 0), "goldWeeks": GOLD_WEEKS,
            "supporters": supporters_of(s, dev.key, today)}
