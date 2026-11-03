"""The dragon season (Nov 2026): every Keeper who finishes the daily goal can find all 35 dragons before mint.
The pace lives in dragons.js; this checks the rules it is built on and replays them for a month."""
import json, math, random
from pathlib import Path

from radar.config import Config

JS = (Path(__file__).parent.parent / "radar" / "static" / "dragons.js").read_text()


def test_the_page_knows_when_the_season_ends(monkeypatch):
    assert Config().dex_season_end == "2026-11-30"
    monkeypatch.setenv("DEX_SEASON_END", "2026-12-03")
    assert Config().dex_season_end == "2026-12-03"
    feed = (Path(__file__).parent.parent / "radar" / "templates" / "feed.html").read_text()
    assert '"season_end": cfg.dex_season_end' in feed and 'id="hatch-next"' in feed


def test_every_egg_is_new_and_no_old_schedule_is_left():
    assert "SCHEDULE" not in JS and "due(tier" not in JS
    assert "Math.ceil(missing / left)" in JS and "MAX_EGGS = 3" in JS
    assert "const NEED = { common: 0, rare: 2, legend: 4 };" in JS and "daysLeft() <= 5" in JS
    assert "ENTRIES.filter((e) => !owned(e) && allowed(e.tier, gs))" in JS


def replay(start, end=30, missed=(), seed=1):
    """The same rules as dragons.js, day by day: eggs today = ceil(missing / days left), at most 3."""
    rnd = random.Random(seed)
    tiers = ["common"] * 15 + ["rare"] * 15 + ["legend"] * 5
    have, streak, most = set(), 0, 0
    need = {"common": 0, "rare": 2, "legend": 4}
    for day in range(start, end + 1):
        if day in missed:
            streak = max(0, streak - 1)
            continue
        streak += 1
        left = end - day + 1
        eggs = min(3, max(1, math.ceil((35 - len(have)) / left))) if len(have) < 35 else 1
        most = max(most, eggs)
        for _ in range(eggs):
            ok = [i for i, t in enumerate(tiers) if i not in have and (left <= 5 or streak >= need[t])]
            if ok:
                have.add(rnd.choice(ok))
    return len(have), most


def test_a_keeper_who_shows_up_finds_all_35_before_mint():
    for seed in range(20):
        assert replay(3, seed=seed) == (35, 2)                    # from November 3: never more than 2 eggs a day
        assert replay(3, missed=(9, 15, 22), seed=seed)[0] == 35   # a few missed days still finish
        assert replay(15, seed=seed)[0] == 35                      # starting halfway still finishes
