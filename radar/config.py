"""Settings, read once from environment variables."""
import os
from urllib.parse import quote
from dataclasses import dataclass, field

DEFAULT_QUERY = '((@Pocket_Dragons_ OR "pocket dragons" OR "ancient hatchery") is:verified OR from:Pocket_Dragons_) -is:reply -is:retweet'
DEFAULT_BLOCKLIST = "claim your airdrop,connect your wallet,free mint now,dm me to claim"


def _db_url(raw: str) -> str:
    """Point plain Postgres URLs at the psycopg2 driver we install.

    SQLAlchemy 2.1 maps a bare postgresql:// URL to psycopg 3, which is not installed.
    """
    raw = raw.strip()
    for prefix in ("postgres://", "postgresql://", "postgresql+psycopg2://"):
        if raw.startswith(prefix):
            return "postgresql+psycopg2://" + _encode_password(raw[len(prefix):])
    return raw


def _encode_password(rest: str) -> str:
    """Percent-encode the password so symbols like @ / # ? in it cannot break the URL.

    The host part never contains '@', so the last '@' always separates login from host.
    """
    if "@" not in rest:
        return rest
    login, host = rest.rsplit("@", 1)
    if ":" not in login:
        return rest
    user, password = login.split(":", 1)
    if "%" in password:  # already encoded
        return rest
    return f"{user}:{quote(password, safe='')}@{host}"


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
    # Testing mode: read at most this many posts per UTC day (0 = no cap). Reads are
    # spread out as one page of 10 newest posts every few hours.
    daily_post_cap: int = field(default_factory=lambda: int(os.environ.get("DAILY_POST_CAP", "0")))
    # Re-check posts from the last day for deletions once a day (0 = off)
    recheck_deleted: bool = field(default_factory=lambda: os.environ.get("RECHECK_DELETED", "1") != "0")
    force_collect: bool = field(default_factory=lambda: _bool("FORCE_COLLECT"))
    # Free collection from the Discord share channel: bot token, channel ids (comma separated)
    discord_bot_token: str = field(default_factory=lambda: os.environ.get("DISCORD_BOT_TOKEN", "").strip())
    discord_channel_ids: str = field(default_factory=lambda: os.environ.get("DISCORD_CHANNEL_IDS", "").strip())
    discord_require_verified: bool = field(default_factory=lambda: _bool("DISCORD_REQUIRE_VERIFIED", "1"))
    discord_max_per_run: int = field(default_factory=lambda: int(os.environ.get("DISCORD_MAX_PER_RUN", "60")))
    # Realistic meadow renders on a Cloudinary CDN (empty base = the hand drawn canvas meadow)
    scene_base: str = field(default_factory=lambda: os.environ.get("SCENE_BASE", "https://res.cloudinary.com/gosbi0oh").rstrip("/"))
    scene_folder: str = field(default_factory=lambda: os.environ.get("SCENE_FOLDER", "dragon-radar"))
    scene_version: str = field(default_factory=lambda: os.environ.get("SCENE_VERSION", "2").strip())
    scene_videos: str = field(default_factory=lambda: os.environ.get("SCENE_VIDEOS", ""))  # e.g. "day:meadow-day-loop,night:meadow-night-loop"
    # Keeper card is locked until this is switched on (no lookups, button shows as coming soon)
    keeper_card_open: bool = field(default_factory=lambda: _bool("KEEPER_CARD_OPEN"))
    # Where the mailbox button leads (a Google Doc or Form for suggestions); the mailbox hides when empty
    suggest_url: str = field(default_factory=lambda: os.environ.get("SUGGEST_URL", "").strip())
    # Live Keeper card lookups on X: most posts read per lookup, and a daily spend cap for them
    keeper_max_posts: int = field(default_factory=lambda: int(os.environ.get("KEEPER_MAX_POSTS", "40")))
    keeper_daily_budget_usd: float = field(default_factory=lambda: float(os.environ.get("KEEPER_DAILY_BUDGET_USD", "1.5")))
    keeper_cache_hours: int = field(default_factory=lambda: int(os.environ.get("KEEPER_CACHE_HOURS", "6")))
    # Follow directory: pinned accounts (handle:role) and the daily cap on "add me" checks
    team_accounts: str = field(default_factory=lambda: os.environ.get("TEAM_ACCOUNTS",
        "Pocket_Dragons_:Official,djsamwithers:Product,TradingJoker:Engineering,HeartyOfDaCards:Community,plooshGWIN:3D Art"))
    directory_adds_per_day: int = field(default_factory=lambda: int(os.environ.get("DIRECTORY_ADDS_PER_DAY", "30")))
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


def _scene_video_map(self) -> dict:
    """SCENE_VIDEOS "day:meadow-day-loop,night:meadow-night-loop" -> {"day": "meadow-day-loop", ...}"""
    return {k.strip(): v.strip() for k, v in (p.split(":", 1) for p in self.scene_videos.split(",") if ":" in p)}


Config.scene_video_map = property(_scene_video_map)
