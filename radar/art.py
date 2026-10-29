"""Keeper Art (v2.1): hand made Pocket Dragons art by signed Keepers, and a weekend vote for the favourite.

How a week works (all times UTC):
- Monday to Sunday: a signed Keeper can send in one artwork, with a link to a video of it being made.
- Jon checks every entry by hand (the picture and the making-of video). Nothing shows until he approves it.
- Friday to Sunday: signed Keepers vote for one approved artwork of the week (not their own). They can change their vote.
- From Monday: the artwork with the most votes is last week's winner. Ties go to the one approved first.
No AI art: the making-of video is the proof, and Jon decides.
"""
import io
import re
from datetime import date, datetime, timedelta

from sqlalchemy import func, select

from .db import ArtEntry, ArtVote, utcnow

MAX_UPLOAD = 1_800_000           # the page shrinks the picture before sending, so a real upload is far below this
TITLE_MAX = 60
PROOF = re.compile(r"^https://[^\s<>\"']{6,290}$")
VOTE_DAYS = (4, 5, 6)            # Friday, Saturday, Sunday


def week_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def voting_open(now: datetime) -> bool:
    return now.weekday() in VOTE_DAYS


def week_label(week: date) -> str:
    return f"Week of {week.strftime('%b')} {week.day}"


def shrink(raw: bytes) -> tuple[bytes, bytes] | None:
    """The picture as webp (at most 1600 px) and a 640 px thumbnail, or None when it is not a real picture."""
    from PIL import Image, ImageOps
    try:
        im = Image.open(io.BytesIO(raw))
        if im.format not in ("JPEG", "PNG", "WEBP"):
            return None
        if im.width < 200 or im.height < 200 or im.width * im.height > 40_000_000:   # checked before decoding, so a
            return None                                                               # tiny file can not unpack into a huge one
        im.load()
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB")
    except Exception:            # anything Pillow can not read is not a picture
        return None
    out = []
    for side, q in ((1600, 86), (640, 80)):
        c = im.copy()
        c.thumbnail((side, side))
        b = io.BytesIO()
        c.save(b, "WEBP", quality=q, method=5)
        out.append(b.getvalue())
    return out[0], out[1]


def mine(s, key: str, week: date) -> ArtEntry | None:
    """This Keeper's entry that still counts for the week: pending or approved this week, or still waiting from last
    week (Jon checks it on Monday and it joins this week's wall)."""
    return s.scalar(select(ArtEntry).where(ArtEntry.key == key, ArtEntry.status != "rejected",
                                           (ArtEntry.week == week) | ((ArtEntry.week < week) & (ArtEntry.status == "pending")))
                    .order_by(ArtEntry.id.desc()))


def submit(s, dev, title: str, proof: str, raw: bytes, pledge: bool, now: datetime) -> dict:
    title = " ".join((title or "").split())[:TITLE_MAX]
    proof = (proof or "").strip()
    if not dev:
        return {"ok": False, "why": "unsigned"}
    if not pledge:
        return {"ok": False, "why": "pledge"}
    if not title:
        return {"ok": False, "why": "title"}
    if not PROOF.match(proof):
        return {"ok": False, "why": "proof"}
    if not raw or len(raw) > MAX_UPLOAD:
        return {"ok": False, "why": "image"}
    week = week_of(now.date())
    if mine(s, dev.key, week):
        return {"ok": False, "why": "already"}
    pics = shrink(raw)
    if not pics:
        return {"ok": False, "why": "image"}
    e = ArtEntry(week=week, key=dev.key, username=dev.username, title=title, proof=proof, image=pics[0], thumb=pics[1],
                 status="pending", created_at=now)
    s.add(e)
    s.flush()
    return {"ok": True, "id": e.id}


def gallery(s, week: date) -> list[dict]:
    rows = s.scalars(select(ArtEntry).where(ArtEntry.week == week, ArtEntry.status == "approved")
                     .order_by(ArtEntry.reviewed_at, ArtEntry.id)).all()
    return [card(e) for e in rows]


def card(e: ArtEntry) -> dict:
    return {"id": e.id, "user": e.username, "title": e.title, "proof": e.proof, "week": e.week.isoformat()}


def tally(s, week: date) -> dict[int, int]:
    return dict(s.execute(select(ArtVote.entry_id, func.count()).where(ArtVote.week == week).group_by(ArtVote.entry_id)).all())


def winner(s, week: date) -> dict | None:
    """The approved artwork of that week with the most votes (at least one); ties go to the one approved first."""
    votes = tally(s, week)
    best = None
    for e in s.scalars(select(ArtEntry).where(ArtEntry.week == week, ArtEntry.status == "approved")
                       .order_by(ArtEntry.reviewed_at, ArtEntry.id)).all():
        n = votes.get(e.id, 0)
        if n and (best is None or n > best[1]):
            best = (e, n)
    return {**card(best[0]), "votes": best[1]} if best else None


def hall(s, before: date, weeks: int = 8) -> list[dict]:
    out = []
    for i in range(1, weeks + 1):
        w = winner(s, before - timedelta(days=7 * i))
        if w:
            out.append(w)
    return out


def vote(s, dev, entry_id: int, now: datetime) -> dict:
    if not dev:
        return {"ok": False, "why": "unsigned"}
    if not voting_open(now):
        return {"ok": False, "why": "closed"}
    week = week_of(now.date())
    e = s.get(ArtEntry, entry_id)
    if not e or e.week != week or e.status != "approved":
        return {"ok": False, "why": "missing"}
    if e.key == dev.key:
        return {"ok": False, "why": "own"}
    v = s.get(ArtVote, (week, dev.key))
    if v:
        v.entry_id, v.created_at = e.id, now
    else:
        s.add(ArtVote(week=week, voter=dev.key, entry_id=e.id, created_at=now))
    return {"ok": True, "voted": e.id}


def me(s, dev, now: datetime) -> dict:
    if not dev:
        return {"ok": True, "signed": False}
    week = week_of(now.date())
    e = mine(s, dev.key, week)
    last = None if e else s.scalar(select(ArtEntry).where(ArtEntry.key == dev.key, ArtEntry.week == week,
                                                          ArtEntry.status == "rejected").order_by(ArtEntry.id.desc()))
    v = s.get(ArtVote, (week, dev.key))
    out = {"ok": True, "signed": True, "user": dev.username, "voted": v.entry_id if v else None}
    if e:
        out["entry"] = {"id": e.id, "title": e.title, "status": e.status}
    elif last:
        out["entry"] = {"id": last.id, "title": last.title, "status": "rejected", "note": last.note}
    return out


def review(s, entry_id: int, action: str, note: str, now: datetime) -> bool:
    e = s.get(ArtEntry, entry_id)
    if not e or action not in ("approve", "reject", "pending"):
        return False
    e.status = {"approve": "approved", "reject": "rejected", "pending": "pending"}[action]
    if action == "approve" and e.week < week_of(now.date()):
        week = week_of(now.date())           # sent late on a Sunday and checked on Monday: it joins this week's wall,
        other = s.scalar(select(ArtEntry).where(ArtEntry.key == e.key, ArtEntry.week == week, ArtEntry.id != e.id,
                                                ArtEntry.status == "approved"))
        if other is None:                    # unless that Keeper already has art up this week
            e.week = week
    e.note = " ".join((note or "").split())[:160] if action == "reject" else ""
    e.reviewed_at = now if action != "pending" else None
    if action != "approve":                  # votes for an artwork that is taken down go back to their owners
        s.query(ArtVote).filter(ArtVote.entry_id == e.id).delete()
    return True


def queue(s, now: datetime) -> dict:
    """Jon's review list: everything waiting, then the last two weeks of decisions. Pictures of art that was not
    approved are let go after four weeks, so the database only keeps what is on the wall."""
    since = week_of(now.date()) - timedelta(days=7)
    for old in s.scalars(select(ArtEntry).where(ArtEntry.status == "rejected", ArtEntry.week < since - timedelta(days=21))).all():
        s.delete(old)
    pending = s.scalars(select(ArtEntry).where(ArtEntry.status == "pending").order_by(ArtEntry.id)).all()
    done = s.scalars(select(ArtEntry).where(ArtEntry.status != "pending", ArtEntry.week >= since)
                     .order_by(ArtEntry.reviewed_at.desc())).all()
    row = lambda e: {**card(e), "status": e.status, "note": e.note, "sent": e.created_at.strftime("%b %d, %H:%M UTC")}
    return {"pending": [row(e) for e in pending], "done": [row(e) for e in done]}
