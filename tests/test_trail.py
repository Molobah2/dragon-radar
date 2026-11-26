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
        if url.endswith("/tweets/counts/all"):
            return R(200, {"data": [{"start": "2026-09-08T00:00:00.000Z", "tweet_count": 3}, {"start": "2026-09-09T00:00:00.000Z", "tweet_count": 0},
                                    {"start": "2026-11-01T00:00:00.000Z", "tweet_count": 2}], "meta": {}})
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
    assert q["query"].startswith("from:keeper_one (") and "-is:retweet" in q["query"] and q["start_time"].startswith("2026-09-08") and "blinky" in q["query"] and " dragon " in q["query"]
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


def test_no_daily_cap_one_card_per_account_is_the_limit(cfg, monkeypatch):
    cfg.trail_daily_cap_usd = 0.0
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    r = c.get("/api/trail/me")
    assert r.status_code == 200 and r.get_json()["cached"] is False
    n = len(fake.calls)
    assert c.get("/api/trail/me").get_json()["cached"] is True and len(fake.calls) == n


def test_the_post_limit_is_300():
    from radar import trail
    assert trail.MAX_POSTS == 300


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


def test_everything_comes_from_x_and_ahead_compares_trail_keepers(cfg, monkeypatch):
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08"), tw("2", "2026-09-09")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)
    with make_session_factory(cfg.database_url)() as s:
        s.add(Post(id="5", author_id="42", created_at=datetime(2026, 9, 20, 9)))       # pdtools knows it: not used
        for i in range(6):
            s.add(trail.TrailCard(user_id=f"o{i}", username=f"o{i}", posts=1, card="{}"))
        s.commit()
    sign_in(c)
    card = c.get("/api/trail/me").get_json()["card"]
    assert card["posts"] == "2" and card["ahead"] == "99"
    assert not [u for m, u, p in fake.calls if u.endswith("/2/tweets")]


def test_ahead_waits_for_five_trail_keepers(cfg, monkeypatch):
    app, c = make(cfg, FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}]), monkeypatch)
    sign_in(c)
    assert c.get("/api/trail/me").get_json()["card"]["ahead"] == "—"


def test_each_keeper_gets_a_card_number_that_never_changes(cfg, monkeypatch):
    page = lambda: {"data": [tw("1", "2026-09-08")], "meta": {}}
    fake = FakeX(pages=[page(), page()])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    assert c.get("/api/trail/me").get_json()["card"]["no"] == 1
    assert c.get("/api/trail/me").get_json()["card"]["no"] == 1            # the same number from the saved card
    fake.me = {"id": "77", "username": "keeper_two", "name": "Keeper Two", "public_metrics": {"followers_count": 9}, "profile_image_url": ""}
    c2 = app.test_client(); sign_in(c2)
    assert c2.get("/api/trail/me").get_json()["card"]["no"] == 2


def test_the_trail_is_open_for_one_day_only(cfg, monkeypatch):
    page = lambda: {"data": [tw("1", "2026-09-08")], "meta": {}}
    fake = FakeX(pages=[page(), page()])
    cfg.trail_opens = "2026-11-07T15:00:00Z"
    app, c = make(cfg, fake, monkeypatch)
    clock = {"now": datetime(2026, 11, 7, 14, 0)}
    monkeypatch.setattr(trail, "utcnow", lambda: clock["now"])
    # before it opens: a countdown, and no way in yet
    r = c.get("/api/trail/me")
    assert r.status_code == 403 and r.get_json() == {"why": "soon", "event": {"opens": "2026-11-07T15:00:00Z", "closes": "2026-11-08T15:00:00Z"}}
    assert c.get("/trail/x/connect").headers["Location"].endswith("/trail/")
    # open: the card carries the day it was opened and the window, so the page can say how long is left
    clock["now"] = datetime(2026, 11, 7, 16, 30)
    assert c.get("/api/trail/me").get_json()["event"]["closes"] == "2026-11-08T15:00:00Z"   # not signed in yet
    sign_in(c)
    card = c.get("/api/trail/me").get_json()["card"]
    assert card["opened"] == "2026-11-07T16:30:00Z" and card["event"]["opens"] == "2026-11-07T15:00:00Z"
    clock["now"] = datetime(2026, 11, 8, 9, 0)
    assert c.get("/api/trail/me").get_json()["card"]["opened"] == "2026-11-07T16:30:00Z"     # the stamp never moves
    # 24 hours later it is closed: no new cards, but this Keeper still opens theirs (15 Nov, Jon)
    clock["now"] = datetime(2026, 11, 8, 15, 0)
    r = c.get("/api/trail/me")
    assert r.status_code == 200 and r.get_json()["closed"] is True
    c2 = app.test_client()
    r = c2.get("/api/trail/me")
    assert r.status_code == 410 and r.get_json()["why"] == "closed"


def test_without_a_window_the_trail_stays_open(cfg, monkeypatch):
    assert trail.event_phase(cfg, datetime(2030, 1, 1)) is None and trail.event_json(cfg) is None
    cfg.trail_opens, cfg.trail_closes = "2026-11-07T15:00:00+01:00", "2026-11-07T20:00:00Z"
    assert trail.event_window(cfg) == (datetime(2026, 11, 7, 14, 0), datetime(2026, 11, 7, 20, 0))



def test_one_card_per_account_never_read_from_x_again(cfg, monkeypatch):
    """9 Nov: once a Keeper has a card it is theirs for good. Days later, cut short or an older version, X is never read again."""
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    first = c.get("/api/trail/me").get_json()
    assert first["cached"] is False
    n = len(fake.calls)
    with make_session_factory(cfg.database_url)() as s:
        row = s.get(trail.TrailCard, "42")
        row.fetched_at = row.fetched_at - timedelta(days=30)
        row.partial = True
        card = json.loads(row.card); card["v"] = -1; row.card = json.dumps(card)
        s.commit()
    again = c.get("/api/trail/me").get_json()
    assert again["cached"] is True and len(fake.calls) == n


def test_jons_test_devices_walk_the_trail_before_it_opens(cfg, monkeypatch):
    """15 Nov: the devices Jon unlocked (g.circle) can check the Trail before Dec 1; everyone else sees the countdown."""
    from flask import g
    cfg.trail_opens = "2026-11-07T15:00:00Z"
    app, c = make(cfg, FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}]), monkeypatch)
    who = {"tester": False}
    app.before_request(lambda: setattr(g, "circle", who["tester"]) if who["tester"] else None)
    monkeypatch.setattr(trail, "utcnow", lambda: datetime(2026, 11, 7, 14, 0))
    assert c.get("/api/trail/me").status_code == 403                       # a normal visitor: soon
    who["tester"] = True
    r = c.get("/api/trail/me")
    assert r.status_code == 401 and "event" not in r.get_json()            # a tester: open, no countdown
    assert not c.get("/trail/x/connect").headers.get("Location", "").endswith("/trail/")


def test_walks_with_most_shows_x_names():
    """15 Nov (Jon): the card names the Keepers by their X name, emoji and flags out; an unknown handle stays a handle."""
    assert trail.clean_name("Anastasiya🐉🇺🇦") == "Anastasiya"
    assert trail.clean_name("Sam Withers 🐉") == "Sam Withers"
    assert trail.clean_name("  Shiv  🐉 ") == "Shiv"
    assert trail.clean_name("🐉") == ""


def test_per_post_tile_replaces_ahead_of():
    """15 Nov (Jon): the tile that waited for five other Keepers now shows views per dragon post, from the first card."""
    assert trail.per_post(14_350, 10) == "1,435" and trail.per_post(250_000, 10) == "25K" and trail.per_post(0, 0) == "0"
    import glob, json
    for f in glob.glob(str(trail.TRAIL_DIR / "themes" / "*.json")):
        blk = [b for b in json.load(open(f))["scene"]["back"]["live"]["blocks"] if b.get("on") == "tile" and b.get("i") == 4][0]
        assert [s.get("k") or s.get("t") for s in blk["segs"]] == ["perPost", " ", "views"], f


def test_a_made_card_is_locked_in_the_hall_once(cfg, monkeypatch):
    cfg.trail_opens, cfg.trail_closes = "2026-01-01T00:00:00Z", "2099-01-01T00:00:00Z"
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    assert c.get("/api/trail/me").status_code == 200
    from radar.db import make_session_factory
    S = make_session_factory(cfg.database_url)
    with S() as s:
        rows = s.scalars(trail.select(trail.TrailHall)).all()
        assert len(rows) == 1 and rows[0].username == "keeper_one" and rows[0].no == 1 and rows[0].posts == 1
        assert rows[0].avatar == b"\xff\xd8jpg" and rows[0].avatar_url.endswith("a_400x400.jpg")      # the picture itself is kept
        assert json.loads(rows[0].card)["n"] == 1
    c.get("/api/trail/me")
    assert c.post("/api/trail/design", json={"k": "panda"}).get_json()["ok"] is True
    assert c.post("/api/trail/design", json={"k": "../x"}).status_code == 400
    with S() as s:
        rows = s.scalars(trail.select(trail.TrailHall)).all()
        assert len(rows) == 1 and rows[0].design == "panda"


def test_cards_made_before_the_trail_opens_never_go_in_the_hall(cfg, monkeypatch):
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)          # no opening set: nothing goes in
    sign_in(c)
    assert c.get("/api/trail/me").status_code == 200
    from radar.db import make_session_factory
    S = make_session_factory(cfg.database_url)
    with S() as s:
        assert s.scalars(trail.select(trail.TrailHall)).all() == []
        row = s.scalars(trail.select(trail.TrailCard)).first()
        assert trail.lock_in_hall(s, row, fake, trail._at("2099-12-02T00:00:00Z")) is False   # made before the opening
        assert trail.lock_in_hall(s, row, fake, trail._at("2026-01-01T00:00:00Z")) is True


def test_test_cards_from_before_the_opening_are_remade_and_numbering_restarts(cfg, monkeypatch):
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}, {"data": [tw("1", "2026-09-08"), tw("2", "2026-09-09")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    first = c.get("/api/trail/me").get_json()                    # a test card, before any opening is set
    assert first["cached"] is False
    from radar.db import make_session_factory
    S = make_session_factory(cfg.database_url)
    with S() as s:                                               # someone else's test card took No. 1 earlier
        row = s.scalars(trail.select(trail.TrailCard)).first(); row.no = 7; s.commit()
    cfg.trail_opens, cfg.trail_closes = "2026-11-15T00:00:00Z", "2099-01-01T00:00:00Z"
    with S() as s:
        row = s.scalars(trail.select(trail.TrailCard)).first()
        row.opened_at = trail._at("2026-11-10T00:00:00Z"); s.commit()       # made before the opening
    n = len(fake.calls)
    r = c.get("/api/trail/me"); again = r.get_json()
    assert again.get("cached") is False and len(fake.calls) > n, (r.status_code, again)       # made again from X
    assert again["card"]["no"] == 1                               # the first real card
    with S() as s:
        assert len(s.scalars(trail.select(trail.TrailHall)).all()) == 1
    assert c.get("/api/trail/me").get_json()["cached"] is True


def test_gate_watcher_opens_for_week_one_keepers_with_ten_weeks():
    from datetime import date, datetime, timedelta
    u = {"username": "k", "name": "K"}
    weekly = lambda start, k: [{"id": str(i), "at": datetime(2026, 9, start) + timedelta(weeks=i), "m": {}} for i in range(k)]
    gate = lambda posts: trail.compute(posts, u, date(2026, 12, 2), [])["markers"][3]
    assert gate(weekly(9, 10)) == ["gate", "Gate Watcher", "Here since week one", 1]
    assert gate(weekly(9, 9)) == ["gate", "Gate Watcher", "9 of 10 weeks", 0]
    assert gate(weekly(15, 12)) == ["gate", "Gate Watcher", "Week one Keepers", 0]


def test_a_keeper_with_more_posts_than_the_card_reads_keeps_true_dates_and_counts():
    from datetime import date, datetime, timedelta
    u = {"username": "k", "name": "K"}
    newest = [{"id": str(i), "at": datetime(2026, 11, 10) + timedelta(hours=i), "m": {"impression_count": 10}} for i in range(5)]
    counts = {date(2026, 9, 8) + timedelta(days=i): 4 for i in range(70)}           # every day since week one
    card = trail.compute(newest, u, date(2026, 12, 2), [], day_counts=counts)
    assert card["posts"] == "280" and card["n"] == 280
    assert card["first"] == "8 Sep 2026" and card["streak"] == "70"
    assert card["markers"][3][3] == 1 and card["perPost"] == "10"


def test_search_marks_a_card_cut_at_the_post_limit_as_partial(monkeypatch):
    monkeypatch.setattr(trail, "MAX_POSTS", 2)
    pages = [{"data": [tw("1", "2026-11-01"), tw("2", "2026-11-02")], "meta": {"next_token": "t"}}]
    fake = FakeX(pages=pages)
    posts, cost, src, partial = trail.search_posts(fake, "b", "k", 100.0, 0.005, sleep=lambda s: None)
    assert len(posts) == 2 and partial is True


def test_a_card_cut_at_the_limit_counts_every_post_by_day(cfg, monkeypatch):
    monkeypatch.setattr(trail, "MAX_POSTS", 2)
    fake = FakeX(pages=[{"data": [tw("1", "2026-11-01"), tw("2", "2026-11-01")], "meta": {"next_token": "t"}}])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    card = c.get("/api/trail/me").get_json()["card"]
    assert card["posts"] == "5" and card["first"] == "8 Sep 2026"
    assert any(u.endswith("/tweets/counts/all") for _, u, _ in fake.calls)


def test_x_busy_makes_the_page_wait_instead_of_failing(cfg, monkeypatch):
    fake = FakeX()
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    real = fake.get
    def busy(url, **k):
        if url.endswith("/tweets/search/all"):
            fake.calls.append(("GET", url, k.get("params") or {}))
            return R(429, {"title": "Too Many Requests"})
        return real(url, **k)
    fake.get = busy
    r = c.get("/api/trail/me")
    assert r.status_code == 202 and r.get_json()["wait"] is True
    assert sum(1 for _, u, _ in fake.calls if u.endswith("/tweets/search/all")) == 3      # tried again before giving way


def test_after_the_close_a_keeper_still_opens_their_card_but_nobody_makes_one(cfg, monkeypatch):
    cfg.trail_opens, cfg.trail_closes = "2026-01-01T00:00:00Z", "2099-01-01T00:00:00Z"
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    assert c.get("/api/trail/me").status_code == 200
    cfg.trail_closes = "2026-02-01T00:00:00Z"                     # now closed
    r = c.get("/api/trail/me")
    assert r.status_code == 200 and r.get_json()["closed"] is True and r.get_json()["card"]["n"] == 1
    c.post("/trail/x/disconnect")
    assert c.get("/api/trail/me").status_code == 410


def test_the_page_is_versioned_and_answers_not_modified(cfg, monkeypatch):
    import hashlib
    app, c = make(cfg, FakeX(), monkeypatch)
    r = c.get("/trail/")
    v = hashlib.md5((trail.TRAIL_DIR / "kt-world-nt.js").read_bytes()).hexdigest()[:8]
    assert f"kt-world-nt.js?v={v}" in r.get_data(as_text=True)
    assert c.get("/trail/", headers={"If-None-Match": r.headers["ETag"]}).status_code == 304


# ---------- paying for the card on chain (26 Nov 2026, Jon: $0.50 a card) ----------
from radar import trailpay

WALLET = "0x" + "ab" * 20
PAYER = "0x" + "12" * 20


def _topic(addr):
    return "0x" + "0" * 24 + addr[2:].lower()


def fake_chain(monkeypatch, txs, now_ts=None, head=1000):
    """Stands in for the chain nodes: txs maps hash -> (receipt, tx)."""
    import time as _t
    ts = int(now_ts or _t.time()) - 60

    def rpc(http, chain, method, params):
        if method == "eth_blockNumber":
            return hex(head)
        if method == "eth_getBlockByNumber":
            return {"timestamp": hex(ts)}
        h = params[0]
        if h not in txs:
            return None
        return txs[h][0] if method == "eth_getTransactionReceipt" else txs[h][1]
    monkeypatch.setattr(trailpay, "_rpc", rpc)
    monkeypatch.setattr(trailpay, "prices", lambda http: {"ETH": 2000.0, "BNB": 600.0, "POL": 0.2})


def usdc_tx(to=WALLET, units=500000, frm=PAYER, chain="base", status="0x1"):
    tok = trailpay.CHAINS[chain]["tokens"]["USDC"][0]
    rec = {"status": status, "blockNumber": hex(990), "logs": [{"address": tok, "topics": [trailpay.TRANSFER, _topic(frm), _topic(to)], "data": hex(units)}]}
    return rec, {"to": tok, "from": frm, "value": "0x0"}


def paid_app(cfg, monkeypatch, txs, pages=None):
    cfg.trail_pay_wallet = WALLET
    fake_chain(monkeypatch, txs)
    page = pages or {"data": [tw("1", "2026-09-08"), tw("2", "2026-09-09")], "meta": {}}
    fake = FakeX(pages=[page])
    app, c = make(cfg, fake, monkeypatch)
    return app, c, fake


H1, H2, H3 = "0x" + "a1" * 32, "0x" + "b2" * 32, "0x" + "c3" * 32


def test_with_a_wallet_set_the_card_waits_for_payment_and_reads_nothing_from_x(cfg, monkeypatch):
    app, c, fake = paid_app(cfg, monkeypatch, {})
    sign_in(c)
    r = c.get("/api/trail/me")
    assert r.status_code == 402 and r.get_json()["why"] == "pay" and r.get_json()["price"] == "0.50" and r.get_json()["wallet"] == WALLET
    assert not [u for _, u, _ in fake.calls if "/tweets/search" in u]


def test_a_usdc_payment_unlocks_the_card_once(cfg, monkeypatch):
    app, c, fake = paid_app(cfg, monkeypatch, {H1: usdc_tx()})
    sign_in(c)
    r = c.post("/api/trail/pay", json={"chain": "base", "tx": f"https://basescan.org/tx/{H1}"})
    assert r.status_code == 200 and r.get_json()["ok"] and r.get_json()["token"] == "USDC"
    r = c.get("/api/trail/me")
    assert r.status_code == 200 and r.get_json()["card"]["posts"] == "2"
    # the same payment can not make a card for someone else
    c2 = app.test_client()
    fake.me = {"id": "77", "username": "other", "name": "Other", "public_metrics": {}, "profile_image_url": ""}
    sign_in(c2)
    r = c2.post("/api/trail/pay", json={"chain": "base", "tx": H1})
    assert r.status_code == 409 and r.get_json()["why"] == "used"
    assert c2.get("/api/trail/me").status_code == 402


def test_payments_that_do_not_count(cfg, monkeypatch):
    other = "0x" + "99" * 20
    txs = {H1: usdc_tx(to=other), H2: usdc_tx(units=100000), H3: usdc_tx(status="0x0")}
    app, c, _ = paid_app(cfg, monkeypatch, txs)
    sign_in(c)
    why = lambda h, chain="base": c.post("/api/trail/pay", json={"chain": chain, "tx": h}).get_json()["why"]
    assert why(H1) == "wallet" and why(H2) == "short" and why(H3) == "failed"
    assert why("0x" + "dd" * 32) == "pending" and why("hello") == "hash" and why(H1, "dogechain") == "chain"


def test_old_payments_and_gas_refunds_do_not_count(monkeypatch):
    import time as _t
    rec, tx = usdc_tx()
    fake_chain(monkeypatch, {H1: (rec, tx)}, now_ts=_t.time() - 5 * 86400)
    with pytest.raises(trailpay.PayError) as e:
        trailpay.verify(None, "base", H1, WALLET, 0.5)
    assert e.value.code == "old"
    refund = {"status": "0x1", "blockNumber": hex(990), "logs": [{"address": trailpay.ZK_COIN, "topics": [trailpay.TRANSFER, _topic(trailpay.BOOTLOADER), _topic(WALLET)], "data": hex(10**18)}]}
    fake_chain(monkeypatch, {H2: (refund, {"to": "0x" + "33" * 20, "from": WALLET, "value": "0x0"})})
    with pytest.raises(trailpay.PayError) as e:
        trailpay.verify(None, "abstract", H2, WALLET, 0.5)
    assert e.value.code in ("wallet", "self")


def test_coin_payments_are_valued_at_todays_price(monkeypatch):
    rec = {"status": "0x1", "blockNumber": hex(990), "logs": []}
    fake_chain(monkeypatch, {H1: (rec, {"to": WALLET, "from": PAYER, "value": hex(int(0.00026 * 10**18))}),
                             H2: (rec, {"to": WALLET, "from": PAYER, "value": hex(int(0.0001 * 10**18))})})
    got = trailpay.verify(None, "arbitrum", H1, WALLET, 0.5)
    assert got["token"] == "ETH" and abs(got["usd"] - 0.52) < 0.01 and got["payer"] == PAYER
    with pytest.raises(trailpay.PayError) as e:
        trailpay.verify(None, "arbitrum", H2, WALLET, 0.5)
    assert e.value.code == "short"
    zk = {"status": "0x1", "blockNumber": hex(990), "logs": [{"address": trailpay.ZK_COIN, "topics": [trailpay.TRANSFER, _topic(PAYER), _topic(WALLET)], "data": hex(int(0.0003 * 10**18))}]}
    fake_chain(monkeypatch, {H3: (zk, {"to": "0x" + "44" * 20, "from": PAYER, "value": "0x0"})})
    assert trailpay.verify(None, "abstract", H3, WALLET, 0.5)["token"] == "ETH"


def test_without_a_wallet_cards_stay_free(cfg, monkeypatch):
    fake = FakeX(pages=[{"data": [tw("1", "2026-09-08")], "meta": {}}])
    app, c = make(cfg, fake, monkeypatch)
    sign_in(c)
    assert c.get("/api/trail/me").status_code == 200
    assert c.get("/api/trail/pay/quote").status_code == 404


def test_the_wallet_paying_itself_says_so(monkeypatch):
    fake_chain(monkeypatch, {H1: usdc_tx(frm=WALLET)})
    with pytest.raises(trailpay.PayError) as e:
        trailpay.verify(None, "base", H1, WALLET, 0.5)
    assert e.value.code == "self" and "itself" in str(e.value)
