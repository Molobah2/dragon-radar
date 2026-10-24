"""Database models.

Post text and author details are kept only while a post can appear in the feed.
X's developer policy asks that deleted posts disappear, so the collector re-checks
recent posts once a day and clears text older than the feed window.
"""
from datetime import datetime, timezone

from sqlalchemy import (Boolean, Date, DateTime, Float, Integer, LargeBinary, String, Text, create_engine, func, select)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def utcnow() -> datetime:
    """Naive UTC timestamp, the format every column in this app uses."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # X post id
    author_id: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)  # naive UTC
    is_quote: Mapped[bool] = mapped_column(Boolean, default=False)
    is_team: Mapped[bool] = mapped_column(Boolean, default=False)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    author_username: Mapped[str | None] = mapped_column(String(32), nullable=True)
    author_avatar: Mapped[str | None] = mapped_column(String(400), nullable=True)
    has_media: Mapped[bool] = mapped_column(Boolean, default=False)
    opens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # anonymous, how many visitors opened it


class Keeper(Base):
    """A verified account with the dragon tag in its display name, for the follow directory."""
    __tablename__ = "keepers"
    key: Mapped[str] = mapped_column(String(32), primary_key=True)          # lower-case handle
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    username: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(100), default="")
    avatar: Mapped[str | None] = mapped_column(String(400), nullable=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    tagged: Mapped[bool] = mapped_column(Boolean, default=False)            # dragon emoji in name right now
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_checked: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_post_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # last post about the dragons
    source: Mapped[str] = mapped_column(String(16), default="radar")


class AuthorCheck(Base):
    """One time profile checks for authors found through the Discord share channel (blue tick rule)."""
    __tablename__ = "author_checks"
    key: Mapped[str] = mapped_column(String(32), primary_key=True)          # lower-case handle
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    username: Mapped[str] = mapped_column(String(32), default="")
    name: Mapped[str] = mapped_column(String(100), default="")
    avatar: Mapped[str | None] = mapped_column(String(400), nullable=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PostLink(Base):
    """Who a post answers or quotes, read once for free from FxTwitter. Lets the Dragon Circle count replies and
    quote posts between Keepers without any paid X call."""
    __tablename__ = "post_links"
    post_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    reply_to: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)   # lower-case handle
    quote_of: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)   # lower-case handle
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    tries: Mapped[int] = mapped_column(Integer, default=0)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class KeeperSave(Base):
    """The merged progress of a Keeper who signed the Book of Friends, so a cleared browser or a new phone loses nothing.
    Only post ids, dates and small numbers (see cloudsave.py)."""
    __tablename__ = "keeper_saves"
    key: Mapped[str] = mapped_column(String(32), primary_key=True)          # lower-case handle
    data: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Cheer(Base):
    """A thank you lantern one signed Keeper sends another inside pdtools (v2.1). One per pair per week,
    with one of the kind preset lines only (no free text, nothing to moderate). Nothing is posted to X."""
    __tablename__ = "cheers"
    week: Mapped[datetime] = mapped_column(Date, primary_key=True)          # Monday of the week (UTC)
    from_key: Mapped[str] = mapped_column(String(32), primary_key=True)     # lower-case handle of a signed Keeper
    to_key: Mapped[str] = mapped_column(String(32), primary_key=True, index=True)
    to_user: Mapped[str] = mapped_column(String(32), default="")
    preset: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class DlePlay(Base):
    """One finished Dragondle per browser per day (score 0 to 5), so the page can say how the hatchery did today.
    Keyed by the browser's own random number, like the other anonymous counts."""
    __tablename__ = "dle_plays"
    day: Mapped[datetime] = mapped_column(Date, primary_key=True)
    vid: Mapped[str] = mapped_column(String(32), primary_key=True)
    score: Mapped[int] = mapped_column(Integer, default=0)


class BlockedAuthor(Base):
    __tablename__ = "blocked_authors"
    author_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    blocked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# Run rows that are not scheduled collections (card lookups, directory checks)
SIDE_RUNS = ("keeper_lookup", "directory_add")


class CollectorRun(Base):
    __tablename__ = "collector_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    pages: Mapped[int] = mapped_column(Integer, default=0)
    posts_returned: Mapped[int] = mapped_column(Integer, default=0)
    posts_new: Mapped[int] = mapped_column(Integer, default=0)
    posts_skipped: Mapped[int] = mapped_column(Integer, default=0)
    users_returned: Mapped[int] = mapped_column(Integer, default=0)
    est_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProgressBackup(Base):
    """A visitor's own progress (opened posts, streak) saved under a short code, so they can
    carry it to another device without any login. Nothing personal: just post ids and dates."""
    __tablename__ = "progress_backups"
    code: Mapped[str] = mapped_column(String(12), primary_key=True)
    data: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Feedback(Base):
    """v1 tester ratings: a 1 to 5 score and an optional comment. No names or accounts."""
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    rating: Mapped[int] = mapped_column(default=0)
    comment: Mapped[str] = mapped_column(Text, default="")
    page: Mapped[str] = mapped_column(String(40), default="")
    device: Mapped[str] = mapped_column(String(10), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Visitor(Base):
    """One row per browser that has visited. The id is a random number the browser made up for itself;
    no name, X account, IP address or anything personal is stored."""
    __tablename__ = "visitors"
    vid: Mapped[str] = mapped_column(String(32), primary_key=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    days: Mapped[int] = mapped_column(Integer, default=1)          # how many different days they came
    views: Mapped[int] = mapped_column(Integer, default=0)
    device: Mapped[str] = mapped_column(String(10), default="")
    source: Mapped[str] = mapped_column(String(40), default="")    # where they first came from (x, discord, direct...)


class VisitDay(Base):
    """Who came on which day (for daily unique visitors and returning visitors)."""
    __tablename__ = "visit_days"
    day: Mapped[datetime] = mapped_column(Date, primary_key=True)
    vid: Mapped[str] = mapped_column(String(32), primary_key=True)
    views: Mapped[int] = mapped_column(Integer, default=0)


class DailyCount(Base):
    """Simple daily counters: page views per page and visits per source."""
    __tablename__ = "daily_counts"
    day: Mapped[datetime] = mapped_column(Date, primary_key=True)
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


class Event(Base):
    """Anonymous moments that tell us if the site works: a post opened, the daily goal finished, a card shared,
    the app added to a home screen. Keyed by the browser's own random number, never a name or an address.
    One row per browser, day, kind and item, so repeats never inflate anything."""
    __tablename__ = "events"
    day: Mapped[datetime] = mapped_column(Date, primary_key=True)
    vid: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[str] = mapped_column(String(12), primary_key=True)
    ref: Mapped[str] = mapped_column(String(32), primary_key=True, default="")


class Report(Base):
    """A visitor flagged a post (spam, off topic, harmful). One report per browser per post."""
    __tablename__ = "reports"
    post_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    vid: Mapped[str] = mapped_column(String(32), primary_key=True)
    reason: Mapped[str] = mapped_column(String(12), default="spam")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ReportConn(Base):
    """Which connection a report came from, as a salted hash only (never the address itself), so reports from one
    person with several browsers count once. Kept in the database so a restart never forgets it."""
    __tablename__ = "report_conns"
    post_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    vid: Mapped[str] = mapped_column(String(32), primary_key=True)
    conn: Mapped[str] = mapped_column(String(24), index=True)


class ReportStatus(Base):
    """What happened to a reported post: open (waiting for Jon), auto (hidden by the community until Jon looks),
    hidden (Jon hid it) or kept (Jon looked and kept it, new reports no longer hide it)."""
    __tablename__ = "report_status"
    post_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(8), default="open")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Friend(Base):
    """A Keeper who signed Blinky's Book of Friends and proved the X name is theirs with one post."""
    __tablename__ = "friends"
    key: Mapped[str] = mapped_column(String(32), primary_key=True)          # lower-case handle
    username: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(100), default="")
    proof_post: Mapped[str] = mapped_column(String(32), default="")         # the post that carried the code
    invited_by: Mapped[str] = mapped_column(String(32), default="")         # lower-case handle of the friend who invited them
    confirmed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class FriendDevice(Base):
    """A browser that asked to sign as a handle. Confirmed once the proof post is checked.
    One person can link a phone and a computer; each one proves the name with its own code."""
    __tablename__ = "friend_devices"
    vid: Mapped[str] = mapped_column(String(32), primary_key=True)
    key: Mapped[str] = mapped_column(String(32), index=True)
    username: Mapped[str] = mapped_column(String(32))
    code: Mapped[str] = mapped_column(String(8))
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    invited_by: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class BookPage(Base):
    """A signed Keeper's public dragon book page (pdtools.xyz/k/<name>): the picture they chose to share and the
    counts printed on it. Sent from their own device, only after they share or save their book."""
    __tablename__ = "book_pages"
    key: Mapped[str] = mapped_column(String(32), primary_key=True)          # lower-case handle, same as friends.key
    username: Mapped[str] = mapped_column(String(32))
    found: Mapped[int] = mapped_column(Integer, default=0)
    rare: Mapped[int] = mapped_column(Integer, default=0)
    legend: Mapped[int] = mapped_column(Integer, default=0)
    relics: Mapped[int] = mapped_column(Integer, default=0)
    streak: Mapped[int] = mapped_column(Integer, default=0)
    image: Mapped[bytes] = mapped_column(LargeBinary, default=b"")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


def make_session_factory(database_url: str) -> sessionmaker:
    kwargs = {"pool_pre_ping": True}
    if database_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    else:
        # Small pool: Supabase's free tier allows a limited number of connections
        kwargs.update(pool_size=5, max_overflow=3, pool_recycle=300)
    engine = create_engine(database_url, **kwargs)
    Base.metadata.create_all(engine)
    ensure_indexes(engine)
    lock_tables(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_setting(s: Session, key: str, default: str = "") -> str:
    row = s.get(Setting, key)
    return row.value if row else default


def set_setting(s: Session, key: str, value: str) -> None:
    row = s.get(Setting, key)
    if row:
        row.value = value
    else:
        s.add(Setting(key=key, value=value))


def month_spend(s: Session, now: datetime) -> float:
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = s.scalar(select(func.coalesce(func.sum(CollectorRun.est_cost_usd), 0.0))
                     .where(CollectorRun.started_at >= start))
    return float(total or 0.0)


# Indexes for the busiest lookups. create_all only makes indexes for brand new tables, so these are added
# here with IF NOT EXISTS: safe to run on every start, on SQLite and on Postgres.
EXTRA_INDEXES = (
    "CREATE INDEX IF NOT EXISTS ix_posts_lower_user ON posts (lower(author_username))",
    "CREATE INDEX IF NOT EXISTS ix_posts_author_time ON posts (author_id, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_backups_created ON progress_backups (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_events_vid_day ON events (vid, day)",
    "CREATE INDEX IF NOT EXISTS ix_events_ref_day ON events (ref, day)",
    "CREATE INDEX IF NOT EXISTS ix_reports_vid_time ON reports (vid, created_at)",
)


def lock_tables(engine) -> None:
    """Supabase also offers every table through its public REST API. The site talks to Postgres directly, so row level
    security is switched on for every table (with no policies, nobody can read or write them through that API).
    The older tables were locked by hand; this keeps any new table locked the moment it is created."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import text
    for table in Base.metadata.sorted_tables:
        try:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE "{table.name}" ENABLE ROW LEVEL SECURITY'))
        except Exception:  # noqa: BLE001  never a reason to fail the start
            pass


def ensure_indexes(engine) -> None:
    from sqlalchemy import text
    for sql in EXTRA_INDEXES:
        try:
            with engine.begin() as conn:
                conn.execute(text(sql))
        except Exception:  # noqa: BLE001  an index is a speed up, never a reason to fail the start
            pass
