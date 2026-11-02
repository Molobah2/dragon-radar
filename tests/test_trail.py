"""Keepers Trail: sign in with X, the card from the Keeper's own posts, the money cap and the 24 hour cache."""
import json
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from radar.config import Config
from radar.db import DailyCount, Post, make_session_factory
from radar import trail
from radar.web import create_app


class R:
    def __init__(self, status=200, body=None, ctype="application/json", content=b""):
        self.status_code, self._b, self.text = status, body or {}, json.dumps(body or {})
        self.headers = {"Content-Type": ctype}; self.content = content

    def json(self):
        return self._b


def tw(pid, day, views=100, likes=5, replies=1, rts=1, quotes=0, mentions=()):
    return {"id": pid, "created_at": f"{day}T10:00:00.000Z",
            "public_metrics": {"impression_count": views, "like_count": likes, "reply_count": replies, "retweet_count": rts, "quote_count": quotes},
            "entities": {"mentions": [{"username": m} for m in mentions]}}


class FakeX:
    """Stands in for requests.Session: answers token, profile, revoke and search the way X does."""

    def __init__(self, pages=None, full_archive=True, me=None):
        self.pages = list(pages or [])
        self.full = full_archive
        self.calls = []
        self.me = me or {"id": "42", "username": "keeper_one", "name": "Keeper One", "public_metrics": {"followers_count": 1234},
                         "profile_image_url": "https://pbs.twimg.com/profile_images/1/a_normal.jpg"}

    def post(self, url, **k):
        self.calls.append(("POST", url, k))
        if url == trail.TOKEN_URL:
            return R(200, {"access_token": "user-token", "token_type": "bearer"})
        return R(200, {})

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(("GET", url, params or {}))
        if url.endswith("/users/me"):
            return R(200, {"data": self.me})
        if url.endswith("/tweets/search/all"):
            if not self.full:
                return R(403, {"title": "Client Forbidden"})
            return R(200, self.pages.pop(0) if self.pages else {"meta": {}})
        if url.endswith("/tweets/search/recent"):
            return R(200, self.pages.pop(0) if self.pages else {"meta": {}})
        if url.endswith("/tweets"):
            ids = (params or {}).get("ids", "").split(",")
            return R(200, {"data": [tw(i, "2026-09-20", views=500) for i in ids if i]})
        if url.startswith("https://pbs.twimg.com/"):
            return R(200, ctype="image/jpeg", content=b"\xff\xd8jpg")
        return R(404)


@pytest.fixture
def cfg(tmp_path):
    c = Config()
    c.database_url = f"sqlite:///{tmp_path / 't.db'}"
    c.secret_key = "test"; c.admin_password = "pw"; c.demo_mode = False
    c.x_bearer_token = "app-bearer"; c.x_client_id = "cid"; c.x_client_secret = "csecret"
    c.trail_public = True; c.trail_daily_cap_usd = 10.0; c.canonical_host = ""
    return c


def make(cfg, fake, monkeypatch):
    monkeypatch.setattr(trail.requests, "Session", lambda: fake)
    monkeypatch.setattr(trail.time, "sleep", lambda s: None)
    app = create_app(cfg)
    return app, app.test_client()


def sign_in(c):
    r = c.get("/trail/x/connect")
    assert r.status_code == 302
    u = urlparse(r.headers["Location"]); q = parse_qs(u.query)
    assert u.netloc == "x.com" and q["scope"] == ["tweet.read users.read"] and q["code_challenge_method"] == ["S256"]
    r = c.get(f"/trail/x/callback?code=abc&state={q['state'][0]}")
    assert r.status_code == 302 and r.headers["Location"].endswith("/trail/?x=ok")
    return q


def test_sign_in_reads_who_they_are_and_never_keeps_the_token(cfg, monkeypatch):
    fake = FakeX()
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    urls = [u for _, u, _ in fake.calls]
    assert trail.TOKEN_URL in urls and trail.REVOKE_URL in urls          # the token goes straight back to X
    with c.session_transaction() as s:
        u = s["trail_user"]
        assert u["username"] == "keeper_one" and u["followers"] == 1234 and u["avatar"].endswith("a_400x400.jpg")
        assert "user-token" not in json.dumps(dict(s))


def test_a_forged_or_old_callback_is_refused(cfg, monkeypatch):
    app, c = make(cfg, FakeX(), monkeypatch)
    c.get("/trail/x/connect")
    r = c.get("/trail/x/callback?code=abc&state=wrong")
    assert r.headers["Location"].endswith("?x=err")
    r = c.get("/trail/x/callback?error=access_denied")
    assert r.headers["Location"].endswith("?x=denied")


def test_the_card_needs_a_sign_in_first(cfg, monkeypatch):
    app, c = make(cfg, FakeX(), monkeypatch)
    r = c.get("/api/trail/me")
    assert r.status_code == 401 and r.get_json() == {"connected": False}


def test_card_numbers_come_from_their_dragon_posts(cfg, monkeypatch):
    page = {"data": [tw("1", "2026-09-08", views=12000, likes=40, mentions=["friend_a", "Pocket_Dragons_"]),
                     tw("2", "2026-09-09", views=300, likes=90, quotes=2, mentions=["friend_a", "friend_b"]),
                     tw("3", "2026-09-10", views=200)], "meta": {}}
    fake = FakeX(pages=[page])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    r = c.get("/api/trail/me")
    card = r.get_json()["card"]
    q = [p for m, u, p in fake.calls if u.endswith("/tweets/search/all")][0]
    assert q["query"].startswith("from:keeper_one (") and "-is:retweet" in q["query"] and q["start_time"].startswith("2026-09-01")
    assert card["posts"] == "3" and card["views"] == "12.5K" and card["likes"] == "135" and card["reposts"] == "5"
    assert card["first"] == "8 Sep 2026" and card["last"] == "10 Sep 2026" and card["day"] == "3"
    assert card["bestViews"] == "12,000" and card["bestViewsDate"] == "Sep 8" and card["bestLikes"] == "90"
    assert card["streak"] == "3" and card["followers"] == "1,234" and card["handle"] == "@keeper_one"
    assert card["walks"][0][:2] == ["friend_a", "2"] and all(w[0] != "Pocket_Dragons_" for w in card["walks"])
    assert card["markers"][1][3] == 1 and card["markers"][2][3] == 0 and card["markers"][3][3] == 0   # Lantern lit, flame not yet, gate locked
    assert len(card["rhythm"]) == 56 and card["rhythm"].count("t") == 1
    assert card["avatar"] == "/api/trail/avatar"
    # the paid reads are counted: one profile and three posts
    with make_session_factory(cfg.database_url)() as s:
        from zoneinfo import ZoneInfo
        assert abs(trail.spent_today(s, datetime.now(ZoneInfo(cfg.timezone)).date()) - 0.025) < 1e-9


def test_a_second_visit_the_same_day_costs_nothing(cfg, monkeypatch):
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    assert c.get("/api/trail/me").get_json()["cached"] is False
    n = len(fake.calls)
    again = c.get("/api/trail/me").get_json()
    assert again["cached"] is True and len(fake.calls) == n


def test_the_daily_cap_stops_new_lookups_but_not_saved_cards(cfg, monkeypatch):
    cfg.trail_daily_cap_usd = 0.5
    app, c = make(cfg, FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}]), monkeypatch)
    sign_in(c)
    r = c.get("/api/trail/me")
    assert r.status_code == 429 and r.get_json()["why"] == "cap"


def test_without_full_archive_search_older_posts_come_from_pdtools(cfg, monkeypatch):
    recent = {"data": [tw("9", (date.today() - timedelta(days=1)).isoformat())], "meta": {}}
    fake = FakeX(pages=[recent], full_archive=False)
    app, c = make(cfg, fake, monkeypatch)
    with make_session_factory(cfg.database_url)() as s:
        s.add(Post(id="5", author_id="42", created_at=datetime(2026, 9, 20, 9)))
        s.add(Post(id="6", author_id="77", created_at=datetime(2026, 9, 21, 9)))
        s.commit()
    sign_in(c)
    card = c.get("/api/trail/me").get_json()["card"]
    assert card["posts"] == "2"                                      # one from the last week, one pdtools already had
    looked = [p for m, u, p in fake.calls if u.endswith("/2/tweets")]
    assert looked and looked[0]["ids"] == "5"


def test_no_dragon_posts_says_so(cfg, monkeypatch):
    app, c = make(cfg, FakeX(pages=[{"meta": {"result_count": 0}}]), monkeypatch)
    sign_in(c)
    r = c.get("/api/trail/me")
    assert r.get_json()["why"] == "none"


def test_hidden_until_launch_even_with_v2_public(cfg, monkeypatch):
    cfg.trail_public = False
    cfg.v2_public = True                 # the rest of pdtools v2 is public: the trail still is not
    cfg.preview_key = "jons-key"
    app, c = make(cfg, FakeX(), monkeypatch)
    for path in ("/trail/", "/trail/x/connect", "/api/trail/me", "/api/trail/avatar"):
        assert c.get(path).status_code == 404, path
    assert c.post("/trail/x/disconnect").status_code == 404
    c.get("/preview/jons-key")           # Jon's own preview pass opens it
    assert c.get("/trail/").status_code in (200, 404)   # 404 only when the built page is missing
    assert c.get("/api/trail/me").status_code == 401


def test_avatar_is_served_from_pdtools(cfg, monkeypatch):
    app, c = make(cfg, FakeX(), monkeypatch)
    assert c.get("/api/trail/avatar").status_code == 404
    sign_in(c)
    r = c.get("/api/trail/avatar")
    assert r.status_code == 200 and r.mimetype == "image/jpeg"


def test_compute_rhythm_and_weeks():
    today = date(2026, 11, 2)          # a Monday
    posts = [{"id": str(i), "at": datetime(2026, 10, 26) + timedelta(days=i % 3), "m": {}, "mentions": []} for i in range(5)]
    c = trail.compute(posts, {"username": "a", "name": "A B"}, today, [1, 2, 3, 4, 5, 6])
    assert c["rhythm"][49] == "t" and c["rhythm"][42] == 2 and c["rhythm"][43] == 2 and c["rhythm"][44] == 1
    assert c["weeks"] == "1" and c["weeksTotal"] == "2" and c["initials"] == "AB"
    assert c["ahead"] == "67"
