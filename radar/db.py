"""Database models. Only post IDs and light metadata are stored, never post text.

X's developer policy requires displayed posts to match the live version on X.
The site shows every post through X's official embed, so nothing stored here
can go stale.
"""
from datetime import datetime, timezone

from sqlalchemy import (Boolean, DateTime, Float, Integer, String, Text, create_engine, func, select)
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


class BlockedAuthor(Base):
    __tablename__ = "blocked_authors"
    author_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    blocked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


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
