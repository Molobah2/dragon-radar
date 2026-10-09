"""Fill a local database with clearly labelled sample posts:  DEMO_MODE=1 python -m radar.demo

Demo IDs are fake, so the feed draws placeholder cards instead of X embeds.
Never run this against the production database.
"""
import random
from datetime import timedelta

from .config import Config
from .db import Post, make_session_factory, utcnow


def main() -> None:
    cfg = Config()
    if not cfg.demo_mode:
        raise SystemExit("Refusing to seed: set DEMO_MODE=1 (and use a local DATABASE_URL).")
    Session = make_session_factory(cfg.database_url)
    rng = random.Random(7)
    now = utcnow()
    with Session() as s:
        for i in range(40):
            created = now - timedelta(minutes=rng.randint(5, 60 * 24 * 6))
            pid = str(1900000000000000000 + i)
            if s.get(Post, pid):
                continue
            s.add(Post(id=pid, author_id=str(1000 + rng.randint(0, 25)), created_at=created,
                       is_quote=rng.random() < 0.2, is_team=(i % 9 == 0)))
        s.commit()
    print("Seeded 40 demo posts.")


if __name__ == "__main__":
    main()
