"""Database models.

Post text and author details are kept only while a post can appear in the feed.
X's developer policy asks that deleted posts disappear, so the collector re-checks
recent posts once a day and clears text older than the feed window.
"""
from datetime import datetime, timezone

from sqlalchemy import (Boolean, Date, DateTime, Float, Integer, String, Text, create_engine, func, select)
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


class ReportStatus(Base):
    """What happened to a reported post: open (waiting for Jon), auto (hidden by the community until Jon looks),
    hidden (Jon hid it) or kept (Jon looked and kept it, new reports no longer hide it)."""
    __tablename__ = "report_status"
    post_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(8), default="open")
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
        kwargs.update(pool_size=3, max_overflow=2, pool_recycle=300)
    engine = create_engine(database_url, **kwargs)
    Base.metadata.create_all(engine)
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
