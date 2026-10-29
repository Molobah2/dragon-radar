"""The numbers that tell us whether pdtools is becoming a habit, plus visitor reports.

Everything is keyed by the random number each browser makes for itself (see visits.py).
No name, X account or IP address is ever stored.
"""
import re
from datetime import date, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from .db import Event, Keeper, Post, Report, ReportConn, ReportStatus, VisitDay, Visitor, utcnow

VID = re.compile(r"^[a-f0-9]{32}$")
REF = re.compile(r"^[a-z0-9_-]{0,32}$")
KINDS = {"open", "popen", "goal", "share", "save", "install", "hatch", "arrive", "ama", "swap"}   # popen: an open on a preview device
# hatch: an egg hatched (ref is the tier). arrive: someone landed from a shared link (ref says which kind)
REASONS = {"spam": "Spam or scam", "offtopic": "Not about Pocket Dragons", "harm": "Rude or harmful"}
KEEP_DAYS = 70          # events older than this are deleted, ten weeks is plenty for trends
HABIT_OPENS = 5         # the north star: Keepers who open this many posts in a week
AUTO_HIDE_AT = 3        # distinct returning visitors before a post steps aside until Jon looks
REPORTS_PER_DAY = 10    # per browser


def record(s, day: date, vid: str, kind: str, ref: str = "") -> bool:
    """Store one moment. Returns False when ignored (bad input) or already counted today."""
    if not VID.match(vid or "") or kind not in KINDS or not REF.match(ref or ""):
        return False
    if s.get(Event, (day, vid, kind, ref or "")) is not None:
        return False
    try:
        with s.begin_nested():   # a savepoint: a clash undoes only this row, never the caller's other changes
            s.add(Event(day=day, vid=vid, kind=kind, ref=ref or ""))
    except IntegrityError:       # two tabs at the same moment
        return False
    return True


def prune(s, today: date) -> int:
    res = s.execute(delete(Event).where(Event.day < today - timedelta(days=KEEP_DAYS)))
    return res.rowcount or 0


def habit_keepers(s, end: date) -> int:
    """Browsers that opened at least HABIT_OPENS different posts in the 7 days ending on `end`."""
    start = end - timedelta(days=6)
    inner = (select(Event.vid).where(Event.kind == "open", Event.day >= start, Event.day <= end)
             .group_by(Event.vid).having(func.count(func.distinct(Event.ref)) >= HABIT_OPENS).subquery())
    return s.scalar(select(func.count()).select_from(inner)) or 0


def funnel(s, today: date) -> dict:
    """The week as steps: who visited, who opened a post, who finished the goal, who hatched, who came back,
    and how many arrived from a shared dragon book. Each number is people (browsers), not clicks."""
    week = today - timedelta(days=6)

    def people(kind: str, ref: str | None = None) -> int:
        q = select(func.count(func.distinct(Event.vid))).where(Event.kind == kind, Event.day >= week)
        if ref is not None:
            q = q.where(Event.ref == ref)
        return s.scalar(q) or 0

    visitors = s.scalar(select(func.count(func.distinct(VisitDay.vid))).where(VisitDay.day >= week)) or 0
    back_q = (select(VisitDay.vid).where(VisitDay.day >= week).group_by(VisitDay.vid)
              .having(func.count(func.distinct(VisitDay.day)) >= 2).subquery())
    came_back = s.scalar(select(func.count()).select_from(back_q)) or 0
    start = datetime.combine(week, datetime.min.time())
    new = s.scalar(select(func.count()).select_from(Visitor).where(Visitor.first_seen >= start)) or 0
    steps = [
        ("Visited", visitors), ("Opened a post", people("open")), ("Finished the daily goal", people("goal")),
        ("Hatched an egg", people("hatch")), ("Came back on another day", came_back),
    ]
    top = max([n for _, n in steps] + [1])
    return {"steps": [{"label": k, "n": n, "pct": round(100 * n / top)} for k, n in steps],
            "new": new, "from_book": people("arrive", "book"), "from_card": people("arrive", "card")}


def summary(s, today: date) -> dict:
    """Numbers for the admin page."""
    week = today - timedelta(days=6)

    def per_ref(kind: str) -> list[tuple[str, int]]:
        rows = s.execute(select(Event.ref, func.count()).where(Event.kind == kind, Event.day >= week)
                         .group_by(Event.ref)).all()
        return sorted(((r or "other", n) for r, n in rows), key=lambda kv: -kv[1])

    def count(kind: str, since: date) -> int:
        return s.scalar(select(func.count()).select_from(Event).where(Event.kind == kind, Event.day >= since)) or 0

    trend = [{"end": today - timedelta(days=7 * i), "n": habit_keepers(s, today - timedelta(days=7 * i))}
             for i in range(3, -1, -1)]
    openers = s.scalar(select(func.count(func.distinct(Event.vid))).where(Event.kind == "open", Event.day >= week)) or 0
    goals = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        goals.append({"day": d, "n": s.scalar(select(func.count()).select_from(Event)
                                                .where(Event.kind == "goal", Event.day == d)) or 0})
    return {
        "habit": trend[-1]["n"], "habit_trend": trend, "habit_peak": max([t["n"] for t in trend] + [1]),
        "openers": openers, "habit_opens": HABIT_OPENS,
        "goals_today": goals[-1]["n"], "goals_week": count("goal", week), "goals": goals,
        "goals_peak": max([g["n"] for g in goals] + [1]),
        "shares": per_ref("share"), "saves": per_ref("save"),
        "installs_week": count("install", week), "installs_all": count("install", date(2000, 1, 1)),
        "funnel": funnel(s, today),
    }


# ---------- visitor reports ----------
def protected(s, post: Post) -> bool:
    """Team posts and verified Keepers are never hidden by reports alone; Jon decides."""
    if post.is_team:
        return True
    k = s.get(Keeper, (post.author_username or "").lower())
    return bool(k and k.verified)


TRUSTED_DAYS = 3        # a reporter must have visited on this many different days


def add_report(s, post_id: str, vid: str, reason: str, today: date, conn: str = "") -> str:
    """Returns ok, dup, limit or bad. May hide the post when enough returning visitors agree."""
    if not post_id.isdigit() or len(post_id) > 32 or not VID.match(vid or "") or reason not in REASONS:
        return "bad"
    post = s.get(Post, post_id)
    if post is None:
        return "bad"
    if s.get(Report, (post_id, vid)) is not None:
        return "dup"
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    mine = s.scalar(select(func.count()).select_from(Report).where(Report.vid == vid, Report.created_at >= start)) or 0
    if mine >= REPORTS_PER_DAY:
        return "limit"
    s.add(Report(post_id=post_id, vid=vid, reason=reason))
    if conn:
        s.add(ReportConn(post_id=post_id, vid=vid, conn=conn[:24]))
    st = s.get(ReportStatus, post_id)
    if st is None:
        st = ReportStatus(post_id=post_id, status="open")
        s.add(st)
    s.flush()
    if st.status == "open" and not post.hidden and not protected(s, post):
        # only browsers that came back on several different days count, and only once per connection,
        # so one person with a few browsers or a cleared browser cannot hide a post
        trusted = s.execute(select(func.count(func.distinct(Report.vid)), func.count(func.distinct(ReportConn.conn)))
                            .select_from(Report).join(Visitor, Visitor.vid == Report.vid)
                            .outerjoin(ReportConn, (ReportConn.post_id == Report.post_id) & (ReportConn.vid == Report.vid))
                            .where(Report.post_id == post_id, Visitor.days >= TRUSTED_DAYS)).one()
        if trusted[0] >= AUTO_HIDE_AT and trusted[1] >= AUTO_HIDE_AT:
            post.hidden, st.status, st.updated_at = True, "auto", utcnow()
    return "ok"


def report_queue(s, limit: int = 60) -> list[dict]:
    rows = s.execute(select(Report.post_id, func.count(), func.max(Report.created_at))
                     .group_by(Report.post_id).order_by(func.max(Report.created_at).desc()).limit(limit)).all()
    out = []
    for pid, n, last in rows:
        post, st = s.get(Post, pid), s.get(ReportStatus, pid)
        reasons = dict(s.execute(select(Report.reason, func.count()).where(Report.post_id == pid)
                                 .group_by(Report.reason)).all())
        out.append({"id": pid, "count": n, "last": last, "status": st.status if st else "open",
                    "reasons": [(REASONS.get(r, r), c) for r, c in sorted(reasons.items(), key=lambda kv: -kv[1])],
                    "user": post.author_username if post else "", "text": ((post.text or "") if post else "")[:180],
                    "hidden": bool(post and post.hidden), "team": bool(post and post.is_team)})
    # waiting ones first
    order = {"auto": 0, "open": 1, "hidden": 2, "kept": 3}
    return sorted(out, key=lambda r: order.get(r["status"], 9))


def decide(s, post_id: str, action: str) -> None:
    post, st = s.get(Post, post_id), s.get(ReportStatus, post_id)
    if st is None:
        st = ReportStatus(post_id=post_id)
        s.add(st)
    if action == "hide":
        st.status = "hidden"
        if post:
            post.hidden = True
    elif action == "keep":
        st.status = "kept"
        if post:
            post.hidden = False
    st.updated_at = utcnow()
