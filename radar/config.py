"""Settings, read once from environment variables."""
import os
from dataclasses import dataclass, field

DEFAULT_QUERY = "(@Pocket_Dragons_ OR from:Pocket_Dragons_) -is:reply -is:retweet"
DEFAULT_BLOCKLIST = "claim your airdrop,connect your wallet,free mint now,dm me to claim"


def _db_url(raw: str) -> str:
    # Supabase and Railway hand out postgres:// URLs; SQLAlchemy wants postgresql://
    if raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://"):]
    return raw


def _bool(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Config:
    site_name: str = field(default_factory=lambda: os.environ.get("SITE_NAME", "Dragon Radar"))
    x_bearer_token: str = field(default_factory=lambda: os.environ.get("X_BEARER_TOKEN", ""))
    database_url: str = field(default_factory=lambda: _db_url(os.environ.get("DATABASE_URL", "sqlite:///radar.db")))
    search_query: str = field(default_factory=lambda: os.environ.get("SEARCH_QUERY", DEFAULT_QUERY))
    team_handle: str = field(default_factory=lambda: os.environ.get("TEAM_HANDLE", "Pocket_Dragons_"))
    team_user_id: str = field(default_factory=lambda: os.environ.get("TEAM_USER_ID", ""))
    timezone: str = field(default_factory=lambda: os.environ.get("TIMEZONE", "Africa/Accra"))
    monthly_spend_limit_usd: float = field(default_factory=lambda: float(os.environ.get("MONTHLY_SPEND_LIMIT_USD", "50")))
    cost_per_post_usd: float = field(default_factory=lambda: float(os.environ.get("COST_PER_POST_USD", "0.005")))
    cost_per_user_usd: float = field(default_factory=lambda: float(os.environ.get("COST_PER_USER_USD", "0.010")))
    max_pages_per_run: int = field(default_factory=lambda: int(os.environ.get("MAX_PAGES_PER_RUN", "10")))
    first_run_backfill_hours: int = field(default_factory=lambda: int(os.environ.get("FIRST_RUN_BACKFILL_HOURS", "24")))
    feed_days: int = field(default_factory=lambda: int(os.environ.get("FEED_DAYS", "7")))
    stale_after_minutes: int = field(default_factory=lambda: int(os.environ.get("STALE_AFTER_MINUTES", "60")))
    default_blocklist: str = field(default_factory=lambda: os.environ.get("BLOCK_KEYWORDS", DEFAULT_BLOCKLIST))
    admin_password: str = field(default_factory=lambda: os.environ.get("ADMIN_PASSWORD", ""))
    secret_key: str = field(default_factory=lambda: os.environ.get("SECRET_KEY", ""))
    demo_mode: bool = field(default_factory=lambda: _bool("DEMO_MODE"))
    run_scheduler: bool = field(default_factory=lambda: _bool("RUN_SCHEDULER"))
    collect_every_minutes: int = field(default_factory=lambda: int(os.environ.get("COLLECT_EVERY_MINUTES", "20")))
