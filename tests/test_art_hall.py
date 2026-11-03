"""The Keeper Art hall: museum labels (what it is made with, the artist's line), each artwork's own share link,
Jon's weekly theme, and the new columns added to a database that already has the art table."""
import io
import json
import re
from datetime import datetime
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import create_engine, inspect, text

from radar import art
from radar.config import Config
from radar.db import ArtEntry, Friend, FriendDevice, ensure_columns, make_session_factory
from radar.web import create_app


@pytest.fixture
def cfg(tmp_path):
    c = Config()
    c.database_url = f"sqlite:///{tmp_path / 'a.db'}"
    c.secret_key = "test"; c.admin_password = "pw"; c.demo_mode = False
    c.v2_public = True; c.v21_public = True
    return c


@pytest.fixture
def app(cfg, monkeypatch):
    Session = make_session_factory(cfg.database_url)
    with Session() as s:
        s.add(FriendDevice(vid="a" * 32, key="ola", username="Ola", code="x", confirmed=True))
        s.add(Friend(key="ola", username="Ola", proof_post="1", confirmed_at=datetime(2026, 10, 1)))
        s.commit()
    monkeypatch.setattr("radar.web.utcnow", lambda: datetime(2026, 11, 4, 12, 0))     # a Wednesday
    a = create_app(cfg)
    a.Session = Session
    return a


def send(c, **extra):
    b = io.BytesIO(); Image.new("RGB", (800, 600), "teal").save(b, "JPEG"); b.seek(0)
    data = {"vid": "a" * 32, "title": "Blinky reads", "proof": "https://x.com/ola/status/7", "pledge": "yes", "image": (b, "a.jpg")}
    data.update(extra)
    return c.post("/api/art/submit", data=data, content_type="multipart/form-data").get_json()


def hall_data(page):
    m = re.search(r'<script type="application/json" id="hall-data">(.*?)</script>', page, re.S)
    assert m, "the hall's data is in the page"
    return json.loads(m.group(1))


def test_the_museum_label_carries_what_it_is_made_with_and_the_artists_line(app):
    c = app.test_client()
    out = send(c, medium="  Ink   and watercolour ", line="Blinky reading by lantern light, " + "x" * 200)
    assert out["ok"]
    with app.Session() as s:
        e = s.get(ArtEntry, out["id"])
        assert e.medium == "Ink and watercolour" and len(e.line) == art.LINE_MAX
        art.review(s, e.id, "approve", "", datetime(2026, 11, 4, 13)); s.commit()
    page = c.get("/art").get_data(as_text=True)
    d = hall_data(page)
    it = d["items"][0]
    assert it["medium"] == "Ink and watercolour" and it["line"].startswith("Blinky reading")
    assert d["week"] == "2026-11-02" and d["voting"] is False and d["next"] == "2026-11-06T00:00:00Z"   # voting opens Friday
    assert d["tex"]["wall"].endswith("/art3d/wall") and "vendor/three.min.js" in page and "art3d.js" in page
    assert 'id="hall"' in page and 'data-piece="%d"' % it["id"] in page and "data-vote=" not in page


def test_an_artwork_has_its_own_share_link_only_once_it_is_on_the_wall(app):
    c = app.test_client()
    out = send(c, line="A quiet night")
    assert c.get(f"/art/p/{out['id']}").status_code == 404                       # waiting for Jon: no page
    assert c.get("/art/p/999999").status_code == 404
    with app.Session() as s:
        art.review(s, out["id"], "approve", "", datetime(2026, 11, 4, 13)); s.commit()
    r = c.get(f"/art/p/{out['id']}")
    page = r.get_data(as_text=True)
    assert r.status_code == 200 and hall_data(page)["focus"] == out["id"]
    assert f"https://pdtools.xyz/art/{out['id']}.webp?s=f" in page and "Blinky reads by @Ola" in page and "A quiet night" in page


def test_voting_weekend_counts_down_to_monday_and_the_dialog_can_vote(app, monkeypatch):
    c = app.test_client()
    out = send(c)
    with app.Session() as s:
        art.review(s, out["id"], "approve", "", datetime(2026, 11, 4, 13)); s.commit()
    monkeypatch.setattr("radar.web.utcnow", lambda: datetime(2026, 11, 7, 10, 0))     # Saturday
    page = c.get("/art").get_data(as_text=True)
    d = hall_data(page)
    assert d["voting"] is True and d["next"] == "2026-11-09T00:00:00Z" and 'id="p-vote"' in page


def test_jons_weekly_theme_shows_at_the_entrance(app):
    c = app.test_client()
    with app.Session() as s:
        art.set_prompt(s, "  Blinky   at the   beach " + "!" * 200); s.commit()
        assert art.prompt(s).startswith("Blinky at the beach") and len(art.prompt(s)) == art.PROMPT_MAX
    page = c.get("/art").get_data(as_text=True)
    assert hall_data(page)["prompt"].startswith("Blinky at the beach") and "This week's theme · Blinky at the beach" in page
    assert c.post("/lab/art/prompt", data={"prompt": "x"}).status_code == 404         # Jon's tools stay locked


def test_new_columns_are_added_to_an_art_table_made_before_them(tmp_path):
    url = f"sqlite:///{tmp_path / 'old.db'}"
    eng = create_engine(url)
    with eng.begin() as conn:                                                     # the table as it was before
        conn.execute(text("CREATE TABLE art_entries (id INTEGER PRIMARY KEY, week DATE, key VARCHAR(32), username VARCHAR(32), "
                          "title VARCHAR(80), proof VARCHAR(300), image BLOB, thumb BLOB, status VARCHAR(10), note VARCHAR(160), "
                          "created_at DATETIME, reviewed_at DATETIME)"))
        conn.execute(text("INSERT INTO art_entries (id, week, key, username, title, proof, image, thumb, status, note, created_at) "
                          "VALUES (1, '2026-10-26', 'b', 'B', 'Old one', 'https://x.com/b/status/1', x'00', x'00', 'approved', '', '2026-10-27 10:00:00')"))
    Session = make_session_factory(url)
    cols = {c["name"] for c in inspect(create_engine(url)).get_columns("art_entries")}
    assert {"medium", "line"} <= cols
    with Session() as s:
        assert art.card(s.get(ArtEntry, 1))["medium"] == ""
    ensure_columns(create_engine(url))                                            # safe to run again on every start


def test_the_hall_script_walks_and_keeps_phones_light():
    js = (Path(__file__).parent.parent / "radar" / "static" / "art3d.js").read_text()
    assert "lightMap" in js and "castShadow" not in js and "shadowMap" not in js   # light is painted, never real time shadows
    assert "seeded(" in js and "?s=f" in js                                        # own order per visitor; full picture only up close
    assert (Path(__file__).parent.parent / "radar" / "static" / "vendor" / "three.min.js").stat().st_size > 400_000
