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
    offline_cache: bool = field(default_factory=lambda: _bool("OFFLINE_CACHE", "1"))
    # v2 preview: tools still being built are hidden from the public. Opening /preview/<PREVIEW_KEY> once
    # turns them on for that device only. V2_PUBLIC=1 is the launch switch that shows them to everyone.
    preview_key: str = field(default_factory=lambda: os.environ.get("PREVIEW_KEY", "").strip())
    v2_public: bool = field(default_factory=lambda: _bool("V2_PUBLIC", "0"))
    # My week card opens every Friday (UTC) for the whole day. MYWEEK_ALWAYS=1 keeps it open (local testing only)
    myweek_always: bool = field(default_factory=lambda: _bool("MYWEEK_ALWAYS", "0"))
    # test copies of the site ask search engines to stay away
    noindex: bool = field(default_factory=lambda: _bool("NOINDEX", "0"))
    author_x: str = field(default_factory=lambda: os.environ.get("AUTHOR_X", "jonwynnx").lstrip("@"))
    # Jon's own Discord server, shown on the home page next to his X
    author_discord: str = field(default_factory=lambda: os.environ.get("AUTHOR_DISCORD", "https://discord.gg/pxqERbCEk"))
    hub_name: str = field(default_factory=lambda: os.environ.get("HUB_NAME", "pdtools"))
    # Main web address; requests to any other host (like the old onrender.com address) are sent here
    canonical_host: str = field(default_factory=lambda: os.environ.get("CANONICAL_HOST", "").strip().lower())
    # Paid X search on/off. Off = posts come only from the free Discord share channel
    x_search: bool = field(default_factory=lambda: _bool("X_SEARCH", "1"))
    # With paid search off, still read the team's own new posts from X (a few cents a month)
    team_x: bool = field(default_factory=lambda: _bool("TEAM_X", "1"))
    site_name: str = field(default_factory=lambda: os.environ.get("SITE_NAME", "Blinky's Friends"))
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
    discord_require_verified: bool = field(default_factory=lambda: _bool("DISCORD_REQUIRE_VERIFIED", "0"))
    discord_max_per_run: int = field(default_factory=lambda: int(os.environ.get("DISCORD_MAX_PER_RUN", "60")))
    # Daily drop: one message a day in a Discord channel the team chooses. Empty means switched off.
    drop_channel_id: str = field(default_factory=lambda: os.environ.get("DROP_CHANNEL_ID", "").strip())
    drop_hour: int = field(default_factory=lambda: int(os.environ.get("DROP_HOUR", "18")))
    # Realistic meadow renders on a Cloudinary CDN (empty base = the hand drawn canvas meadow)
    scene_base: str = field(default_factory=lambda: os.environ.get("SCENE_BASE", "https://res.cloudinary.com/gosbi0oh").rstrip("/"))
    scene_folder: str = field(default_factory=lambda: os.environ.get("SCENE_FOLDER", "dragon-radar"))
    scene_version: str = field(default_factory=lambda: os.environ.get("SCENE_VERSION", "2").strip())
    scene_videos: str = field(default_factory=lambda: os.environ.get("SCENE_VIDEOS", ""))  # e.g. "day:meadow-day-loop,night:meadow-night-loop"
    # pdtools home: forest hut scene (still, walk out intro, idle loop) and the badge logo, all on the same CDN
    hub_scene: str = field(default_factory=lambda: os.environ.get("HUB_SCENE", "hut-day"))
    hub_intro: str = field(default_factory=lambda: os.environ.get("HUB_INTRO", "hut-intro"))
    hub_loop: str = field(default_factory=lambda: os.environ.get("HUB_LOOP", "hut-loop"))
    hub_version: str = field(default_factory=lambda: os.environ.get("HUB_VERSION", "1").strip())
    brand_logo: str = field(default_factory=lambda: os.environ.get("BRAND_LOGO", "pdtools-badge"))
    # Keeper card is locked until this is switched on (no lookups, button shows as coming soon)
    keeper_card_open: bool = field(default_factory=lambda: _bool("KEEPER_CARD_OPEN"))
    # v2 music credits, one track per entry: "Track title|Maker name|x_handle" separated by ";".
    # Only tracks with the maker's permission go here; the credits row stays hidden while this is empty.
    music_credits_raw: str = field(default_factory=lambda: os.environ.get("MUSIC_CREDITS", "").strip())
    # Where the mailbox button leads (a Google Doc or Form for suggestions); the mailbox hides when empty
    suggest_url: str = field(default_factory=lambda: os.environ.get("SUGGEST_URL", "").strip())
    # Live Keeper card lookups on X: most posts read per lookup, and a daily spend cap for them
    keeper_max_posts: int = field(default_factory=lambda: int(os.environ.get("KEEPER_MAX_POSTS", "40")))
    keeper_daily_budget_usd: float = field(default_factory=lambda: float(os.environ.get("KEEPER_DAILY_BUDGET_USD", "1.5")))
    keeper_cache_hours: int = field(default_factory=lambda: int(os.environ.get("KEEPER_CACHE_HOURS", "6")))
    # Follow directory: pinned accounts (handle:role) and the daily cap on "add me" checks
    team_accounts: str = field(default_factory=lambda: os.environ.get("TEAM_ACCOUNTS",
        "Pocket_Dragons_:Official,djsamwithers:Product,TradingJoker:Engineering,HeartyOfDaCards:Community,plooshGWIN:3D Art"))
    # Team spotlight row under the official posts: the newest post from each team member in TEAM_ACCOUNTS
    # (everyone except the official account). Only posts about the dragons are read, and a slot steps aside
    # once its post is older than CREW_HOURS.
    crew_x: bool = field(default_factory=lambda: _bool("CREW_X", "1"))
    crew_hours: int = field(default_factory=lambda: int(os.environ.get("CREW_HOURS", "48")))
    crew_terms: str = field(default_factory=lambda: os.environ.get("CREW_TERMS",
        '("pocket dragons" OR @Pocket_Dragons_ OR "ancient hatchery" OR blinky OR #PocketDragons)'))
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


def _logo(self, w: int = 96, fmt: str = "auto") -> str:
    """The round Blinky badge, cut to a transparent circle and sized for its slot."""
    if not self.scene_base:
        return ""
    return (f"{self.scene_base}/image/upload/c_crop,w_1784,h_1784,x_96,y_88/r_max/c_scale,w_{int(w)}/f_{fmt}/q_auto/"
            f"v{self.hub_version}/{self.scene_folder}/{self.brand_logo}")


Config.logo = _logo


# Premium 3D icons: two Higgsfield sheets (3 by 3 on 2048 px), cut out once on the CDN and served at one size
ICONS = {
    "egg": ("a", 0), "sparkle": ("a", 1), "chat": ("a", 2), "paw": ("a", 3), "crown": ("a", 4), "quote": ("a", 5),
    "hourglass": ("a", 6), "pulse": ("a", 7), "pin": ("a", 8),
    "flame": ("b", 0), "hatch": ("b", 1), "lock": ("b", 2), "plus": ("b", 3), "shield": ("b", 4), "letter": ("b", 5),
    "bulb": ("b", 6), "book": ("b", 7), "globe": ("b", 8),
}


def _icon(self, name: str, size: int = 40) -> str:
    """The icons were cut out once and stored as their own small files (dragon-radar/ico/<name>), so a page
    only fetches a few KB per icon in webp or avif, at twice the size it is shown."""
    if not self.scene_base or name not in ICONS:
        return ""
    w = 96 if size <= 48 else 160
    return f"{self.scene_base}/image/upload/c_scale,w_{w}/f_auto/q_auto/{self.scene_folder}/ico/{name}"


def _mailbox(self, kind: str = "image") -> str:
    if not self.scene_base:
        return ""
    if kind == "video":
        return f"{self.scene_base}/video/upload/ac_none,c_fill,w_256,h_256/f_auto:video/q_auto/v{self.hub_version}/{self.scene_folder}/mailbox-hover"
    # the clip's own first frame, so the hand over to the animation is seamless
    return f"{self.scene_base}/video/upload/so_0,c_fill,w_256,h_256/q_auto/v{self.hub_version}/{self.scene_folder}/mailbox-hover.jpg"


Config.icon = _icon
Config.mailbox = _mailbox

# Community music makers, credited on the home page for everyone (HeartyBoi named them on 2026-10-13).
# Which of their songs play on the site comes from static/audio/playlist.json. Avatars fall back to a letter.
COMMUNITY_MUSIC = [
    {"name": "The Panda", "x": "ThePanda_NFT", "songs": ["Blinky's song"],
     "avatar": "https://pbs.twimg.com/profile_images/1794018791090708480/cd_1UKgj_200x200.jpg"},
    {"name": "DJ", "x": "bubblegum_dee", "songs": ["The Pocket Dragon Wakes", "Four-Leaf Clover Escape", "Dragons Rule The Den", "Incubator Seven Two Six",
                                                 "Pocket Dragons in the Palm", "Pocket Dragos"],
     "avatar": "https://pbs.twimg.com/profile_images/2106797900298956800/QEgBWpGJ_200x200.jpg"},
    {"name": "Boxer", "x": "Boxerr110", "songs": ["Pocket Dragon"],
     "avatar": "https://pbs.twimg.com/profile_images/2062207325553983491/phRPGgCQ_200x200.jpg"},
    {"name": "Ismail HA", "x": "IsmailHA279", "songs": ["Keeper of the Dragon"],
     "avatar": "https://pbs.twimg.com/profile_images/2023680543871926272/Rv0wREMK_200x200.jpg"},
]


def _music_credits(self) -> list[dict]:
    """Songs heard on the site. MUSIC_CREDITS on Render overrides; otherwise the makers marked playing above."""
    if not self.music_credits_raw:
        return []                                  # the site playlist (playlist.json) is credited instead
    out = []
    for part in self.music_credits_raw.split(";"):
        bits = [b.strip() for b in part.split("|")]
        if len(bits) >= 2 and bits[0] and bits[1]:
            handle = (bits[2] if len(bits) > 2 else "").lstrip("@")
            out.append({"track": bits[0][:60], "by": bits[1][:40],
                        "x": handle if handle.replace("_", "").isalnum() and len(handle) <= 15 else ""})
    return out[:12]


Config.music_credits = _music_credits


def _crew(self) -> list[tuple[str, str]]:
    """Team members for the spotlight row: (handle, role), the official account left out."""
    out = []
    for a in self.team_accounts.split(","):
        h, _, role = a.strip().partition(":")
        h = h.strip().lstrip("@")
        if h and h.lower() != self.team_handle.lower() and h.replace("_", "").isalnum() and len(h) <= 15:
            out.append((h, role.strip() or "Team"))
    return out[:4]


Config.crew = property(_crew)
