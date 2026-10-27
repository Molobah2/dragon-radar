import json
from pathlib import Path
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy import func, select
from werkzeug.datastructures import MultiDict

from radar.collector import run_collection
from radar.config import Config
from radar.db import BlockedAuthor, CollectorRun, Post, get_setting, make_session_factory, utcnow
from radar.web import create_app, resolve_range
from radar.xapi import RateLimited

TEAM_ID = "999"


def post(pid, author="1", text="gm dragons", created="2026-10-09T10:00:00.000Z", quoted=False):
    p = {"id": pid, "author_id": author, "text": text, "created_at": created}
    if quoted:
        p["referenced_tweets"] = [{"type": "quoted", "id": "1"}]
    return p


class FakeClient:
    """Stands in for XClient. pages: list of response dicts returned in order."""

    def __init__(self, pages, fail_at=None):
        self.pages = list(pages)
        self.calls = []
        self.fail_at = fail_at

    def search_recent(self, query, since_id=None, start_time=None, next_token=None, max_results=100):
        self.calls.append({"query": query, "since_id": since_id, "start_time": start_time, "next_token": next_token})
        if self.fail_at is not None and len(self.calls) - 1 == self.fail_at:
            raise RateLimited(429, "Too Many Requests")
        return self.pages.pop(0) if self.pages else {"meta": {"result_count": 0}}

    def user_id_for(self, username):
        return TEAM_ID

    def existing_ids(self, ids):
        return set(ids) - getattr(self, "deleted", set())

    def users_by_usernames(self, names):
        return getattr(self, "team", [])


@pytest.fixture(autouse=True)
def _fast_hands(monkeypatch):
    """Tests open posts much faster than a person can; the human pace rule has its own test."""
    import radar.web as _w
    monkeypatch.setattr(_w, "HABIT_GAP_S", 0)


@pytest.fixture
def cfg(tmp_path):
    c = Config()
    c.database_url = f"sqlite:///{tmp_path / 'test.db'}"
    c.team_user_id = ""
    c.monthly_spend_limit_usd = 50
    c.max_pages_per_run = 10
    c.default_blocklist = "claim your airdrop"
    c.admin_password = "pw"
    c.secret_key = "test"
    c.demo_mode = False
    c.recheck_deleted = False
    c.daily_post_cap = 0
    c.crew_x = False   # the spotlight read has its own tests below
    return c


@pytest.fixture
def Session(cfg):
    return make_session_factory(cfg.database_url)


NOW = datetime(2026, 10, 9, 12, 0, 0)


def test_first_run_uses_backfill_window_and_stores_posts(cfg, Session):
    client = FakeClient([{"data": [post("10"), post("11", author=TEAM_ID), post("12", quoted=True)],
                          "meta": {"newest_id": "12", "result_count": 3}}])
    with Session() as s:
        run = run_collection(s, client, cfg, now=NOW)
        assert run.status == "ok"
        assert run.posts_new == 3
        assert client.calls[0]["since_id"] is None
        assert client.calls[0]["start_time"] == "2026-10-08T12:00:00Z"
        assert client.calls[0]["query"] == cfg.search_query
        assert s.get(Post, "11").is_team is True
        assert s.get(Post, "12").is_quote is True
        assert get_setting(s, "newest_id") == "12"
        # 3 posts at $0.005 + one user lookup at $0.01
        assert run.est_cost_usd == pytest.approx(0.025)


def test_default_query_excludes_replies_and_reposts():
    q = Config().search_query
    assert "-is:reply" in q and "-is:retweet" in q and "@Pocket_Dragons_" in q
    assert "is:verified" in q
    assert '"pocket dragons"' in q and '"ancient hatchery"' in q


def test_second_run_uses_since_id_and_dedupes(cfg, Session):
    with Session() as s:
        run_collection(s, FakeClient([{"data": [post("10")], "meta": {"newest_id": "10"}}]), cfg, now=NOW)
        client = FakeClient([{"data": [post("10"), post("13")], "meta": {"newest_id": "13"}}])
        run = run_collection(s, client, cfg, now=NOW + timedelta(minutes=20))
        assert client.calls[0]["since_id"] == "10"
        assert run.posts_new == 1
        assert s.scalar(select(func.count()).select_from(Post)) == 2


def test_pagination_follows_next_token(cfg, Session):
    pages = [
        {"data": [post("30"), post("29")], "meta": {"newest_id": "30", "next_token": "p2"}},
        {"data": [post("28")], "meta": {"newest_id": "28"}},
    ]
    client = FakeClient(pages)
    with Session() as s:
        run = run_collection(s, client, cfg, now=NOW)
        assert [c["next_token"] for c in client.calls] == [None, "p2"]
        assert run.posts_new == 3
        assert get_setting(s, "newest_id") == "30"  # newest from the first page, not the last


def test_page_limit_resumes_without_rereading(cfg, Session):
    cfg.max_pages_per_run = 1
    with Session() as s:
        run_collection(s, FakeClient([{"data": [post("5")], "meta": {"newest_id": "5"}}]), cfg, now=NOW)
        first = FakeClient([{"data": [post("30")], "meta": {"newest_id": "30", "next_token": "p2"}}])
        run = run_collection(s, first, cfg, now=NOW + timedelta(minutes=20))
        assert run.status == "page_limit"
        assert get_setting(s, "newest_id") == "5"  # bookmark held until the gap is read
        second = FakeClient([{"data": [post("29")], "meta": {"newest_id": "29"}}])
        run = run_collection(s, second, cfg, now=NOW + timedelta(minutes=40))
        assert second.calls[0]["next_token"] == "p2"
        assert second.calls[0]["since_id"] == "5"
        assert run.status == "ok"
        assert get_setting(s, "newest_id") == "30"


def test_rate_limit_keeps_place(cfg, Session):
    pages = [{"data": [post("30")], "meta": {"newest_id": "30", "next_token": "p2"}}]
    with Session() as s:
        run = run_collection(s, FakeClient(pages, fail_at=1), cfg, now=NOW)
        assert run.status == "rate_limited"
        assert get_setting(s, "resume_token") == "p2"
        assert s.get(Post, "30") is not None


def test_blocklist_and_blocked_authors_are_skipped(cfg, Session):
    with Session() as s:
        s.add(BlockedAuthor(author_id="666"))
        s.commit()
        client = FakeClient([{"data": [post("1", text="CLAIM YOUR AIRDROP now"), post("2", author="666"), post("3")],
                              "meta": {"newest_id": "3"}}])
        run = run_collection(s, client, cfg, now=NOW)
        assert run.posts_new == 1 and run.posts_skipped == 2
        assert run.est_cost_usd == pytest.approx(3 * 0.005 + 0.01)  # skipped posts are still billed


def test_spend_guard_skips_when_limit_reached(cfg, Session):
    cfg.monthly_spend_limit_usd = 1.0
    with Session() as s:
        s.add(CollectorRun(started_at=NOW - timedelta(days=1), status="ok", est_cost_usd=0.9))
        s.commit()
        client = FakeClient([{"data": [post("1")], "meta": {"newest_id": "1"}}])
        run = run_collection(s, client, cfg, now=NOW)
        assert run.status == "skipped_budget"
        assert client.calls == []


def test_spend_from_last_month_does_not_count(cfg, Session):
    cfg.monthly_spend_limit_usd = 1.0
    with Session() as s:
        s.add(CollectorRun(started_at=datetime(2026, 9, 30, 23, 0), status="ok", est_cost_usd=5.0))
        s.commit()
        run = run_collection(s, FakeClient([{"data": [post("1")], "meta": {"newest_id": "1"}}]), cfg, now=NOW)
        assert run.status == "ok"


def test_resolve_range_today_and_yesterday_in_accra():
    tz = ZoneInfo("Africa/Accra")
    key, start, end = resolve_range({"range": "today"}, tz, datetime(2026, 10, 9, 0, 30), 7)
    assert (key, start, end) == ("today", datetime(2026, 10, 9), datetime(2026, 10, 10))
    key, start, end = resolve_range({"range": "yesterday"}, tz, datetime(2026, 10, 9, 0, 30), 7)
    assert (start, end) == (datetime(2026, 10, 8), datetime(2026, 10, 9))


def test_resolve_range_uses_local_day_for_other_timezones():
    tz = ZoneInfo("Australia/Melbourne")  # UTC+11 in October
    key, start, end = resolve_range({"range": "today"}, tz, datetime(2026, 10, 9, 14, 0), 7)
    assert start == datetime(2026, 10, 9, 13, 0) and end == datetime(2026, 10, 10, 13, 0)


def test_resolve_range_7d_and_custom_and_bad_input():
    tz = ZoneInfo("Africa/Accra")
    now = datetime(2026, 10, 9, 12, 0)
    _, start, end = resolve_range({"range": "7d"}, tz, now, 7)
    assert (start, end) == (datetime(2026, 10, 3), datetime(2026, 10, 10))
    _, start, end = resolve_range({"range": "custom", "from": "2026-10-07", "to": "2026-10-05"}, tz, now, 7)
    assert (start, end) == (datetime(2026, 10, 5), datetime(2026, 10, 8))
    key, _, _ = resolve_range({"range": "custom", "from": "nope"}, tz, now, 7)
    assert key == "24h"
    key, start, end = resolve_range({}, tz, now, 7)
    assert key == "24h" and start == now - timedelta(hours=24)


@pytest.fixture
def client(cfg, Session):
    now = utcnow()
    with Session() as s:
        s.add_all([
            Post(id="1", author_username="u", text="hello", author_id="a", created_at=now - timedelta(minutes=5), is_team=True),
            Post(id="2", author_username="u", text="hello", author_id="b", created_at=now - timedelta(minutes=10)),
            Post(id="3", author_username="u", text="hello", author_id="c", created_at=now - timedelta(minutes=15), is_quote=True),
            Post(id="4", author_username="u", text="hello", author_id="d", created_at=now - timedelta(minutes=20), hidden=True),
            Post(id="5", author_username="u", text="hello", author_id="blocked", created_at=now - timedelta(minutes=25)),
        ])
        s.add(BlockedAuthor(author_id="blocked"))
        s.commit()
    app = create_app(cfg)
    app.config["TESTING"] = True
    return app.test_client()


def ids(resp):
    return [p["id"] for p in resp.get_json()["posts"]]


def test_feed_api_filters(client):
    assert ids(client.get("/api/posts?range=7d")) == ["1", "2", "3"]  # team first, hidden and blocked removed
    assert ids(client.get("/api/posts?range=7d&who=team")) == ["1"]
    assert ids(client.get("/api/posts?range=7d&who=community")) == ["2", "3"]
    assert ids(client.get("/api/posts?range=7d&quotes=0")) == ["1", "2"]
    # the form sends quotes=0 then quotes=1 when the box is ticked
    assert ids(client.get("/api/posts?range=7d&quotes=0&quotes=1")) == ["1", "2", "3"]


def test_feed_page_renders(client):
    r = client.get("/friends")
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    assert "Unofficial community tool" in html
    assert "platform.twitter.com/widgets.js" not in html


def test_admin_requires_login_and_csrf(client):
    assert client.get("/admin").status_code == 302
    assert client.post("/admin/login", data={"password": "wrong"}).status_code == 200
    r = client.post("/admin/login", data={"password": "pw"})
    assert r.status_code == 302
    # no csrf token -> rejected
    assert client.post("/admin/hide", data={"post": "2"}).status_code == 400
    with client.session_transaction() as sess:
        token = sess["csrf"]
    r = client.post("/admin/hide", data={"post": "https://x.com/someone/status/2?s=20", "csrf": token,
                                         "block_author": "1"})
    assert r.status_code == 302
    assert ids(client.get("/api/posts?range=7d")) == ["1", "3"]
    assert client.get("/admin").status_code == 200


def test_admin_disabled_without_password(cfg, Session):
    cfg.admin_password = ""
    app = create_app(cfg)
    assert app.test_client().get("/admin/login").status_code == 404
    assert app.test_client().get("/admin").status_code == 404


def test_four_newest_team_posts_are_always_pinned(cfg, Session):
    now = utcnow()
    with Session() as s:
        s.add_all([
            Post(id="team-oldest", author_username="u", text="hello", author_id="t", created_at=now - timedelta(days=6), is_team=True),
            Post(id="team-older", author_username="u", text="hello", author_id="t", created_at=now - timedelta(days=5, hours=12), is_team=True),
            Post(id="team-old", author_username="u", text="hello", author_id="t", created_at=now - timedelta(days=5), is_team=True),
            Post(id="team-mid", author_username="u", text="hello", author_id="t", created_at=now - timedelta(days=3), is_team=True),
            Post(id="team-new", author_username="u", text="hello", author_id="t", created_at=now - timedelta(hours=30), is_team=True),
            Post(id="community", author_username="u", text="hello", author_id="c", created_at=now - timedelta(hours=1)),
        ])
        s.commit()
    app = create_app(cfg)
    data = app.test_client().get("/api/posts?range=24h").get_json()
    assert [p["id"] for p in data["pinned"]] == ["team-new", "team-mid", "team-old", "team-older"]
    assert [p["id"] for p in data["posts"]] == ["community"]


def test_team_posts_are_collected_separately_in_testing_mode(cfg, Session):
    cfg.daily_post_cap = 50
    cfg.team_user_id = TEAM_ID
    now = utcnow()
    created = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    class Fake(FakeClient):
        def search_recent(self, query, since_id=None, start_time=None, next_token=None, max_results=100):
            self.calls.append({"query": query, "since_id": since_id})
            if query.startswith("from:"):
                return {"data": [post("t1", author=TEAM_ID, created=created)], "meta": {"newest_id": "t1"}}
            return {"data": [], "meta": {}}

    client = Fake([])
    with Session() as s:
        run_collection(s, client, cfg, now=now)
        assert s.get(Post, "t1").is_team
        assert get_setting(s, "team_newest_id") == "t1"
    assert client.calls[-1]["query"].startswith("from:Pocket_Dragons_")


def test_scheduler_due_logic(cfg, Session):
    from radar import scheduler
    assert scheduler.due(Session, 20) is True
    with Session() as s:
        s.add(CollectorRun(started_at=utcnow() - timedelta(minutes=5), status="ok"))
        s.commit()
    assert scheduler.due(Session, 20) is False
    with Session() as s:
        s.add(CollectorRun(started_at=utcnow() - timedelta(minutes=25), status="ok"))
        s.query(CollectorRun).filter(CollectorRun.started_at > utcnow() - timedelta(minutes=10)).delete()
        s.commit()
    assert scheduler.due(Session, 20) is True


def test_scheduler_needs_flag_and_token(cfg, Session):
    from radar import scheduler
    cfg.run_scheduler = False
    assert scheduler.start(cfg, Session) is False
    cfg.run_scheduler = True
    cfg.x_bearer_token = ""
    assert scheduler.start(cfg, Session) is False


def test_database_url_uses_installed_driver():
    from radar.config import _db_url
    assert _db_url("postgres://u:p@h:5432/db") == "postgresql+psycopg2://u:p@h:5432/db"
    assert _db_url(" postgresql://u:p@h:5432/postgres ") == "postgresql+psycopg2://u:p@h:5432/postgres"
    assert _db_url("postgresql+psycopg2://x") == "postgresql+psycopg2://x"
    assert _db_url("sqlite:///radar.db") == "sqlite:///radar.db"
    from sqlalchemy import create_engine
    assert create_engine(_db_url("postgresql://u:p@localhost:1/db")).dialect.driver == "psycopg2"


def test_database_url_with_symbols_in_password():
    from sqlalchemy.engine import make_url
    from radar.config import _db_url
    for pw in ["ab@cd", "a/b#c?d", "plain123", "ends@", "p:w"]:
        url = make_url(_db_url(f"postgresql://postgres.ref:{pw}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"))
        assert url.password == pw
        assert url.host == "aws-0-eu-west-1.pooler.supabase.com"
        assert url.username == "postgres.ref" and url.port == 5432 and url.database == "postgres"


def test_daily_cap_spreads_reads():
    from datetime import datetime, timedelta
    from radar.collector import run_collection
    from radar.config import Config
    from radar.db import make_session_factory

    class Fake:
        calls = []
        def search_recent(self, q, since_id=None, start_time=None, next_token=None, max_results=100):
            if q.startswith(("from:", "(from:")):
                return {"meta": {}}
            self.calls.append(max_results)
            n = len(self.calls)
            return {"data": [{"id": f"{n}{i:03d}", "author_id": "9", "created_at": "2026-10-10T01:00:00.000Z",
                              "text": "hi"} for i in range(max_results)], "meta": {"next_token": "x"}}
        def user_id_for(self, u):
            return "1"
        def existing_ids(self, ids):
            return set(ids)
        def users_by_usernames(self, names):
            return []

    cfg = Config(database_url="sqlite://", team_user_id="1", daily_post_cap=50, monthly_spend_limit_usd=20)
    S = make_session_factory(cfg.database_url)
    fake = Fake()
    t = datetime(2026, 10, 10, 0, 10)
    statuses = []
    for i in range(72):  # every 20 minutes for one day
        with S() as s:
            statuses.append(run_collection(s, fake, cfg, now=t + timedelta(minutes=20 * i)).status)
    assert fake.calls == [10] * 5
    assert statuses.count("ok") == 5


def test_cards_get_author_details_and_deleted_posts_are_hidden(cfg, Session):
    cfg.recheck_deleted = True
    now = utcnow()
    created = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    page = {"data": [post("10", author="7", created=created, text="a &amp; b"),
                     post("11", author="8", created=created)],
            "includes": {"users": [{"id": "7", "name": "Ann", "username": "ann",
                                    "profile_image_url": "https://pbs.twimg.com/a_normal.jpg"}]},
            "meta": {"newest_id": "11"}}
    client = FakeClient([page])
    client.deleted = {"11"}
    with Session() as s:
        run_collection(s, client, cfg, now=now)
        a, b = s.get(Post, "10"), s.get(Post, "11")
        assert (a.author_name, a.author_username, a.author_avatar) == ("Ann", "ann", "https://pbs.twimg.com/a_bigger.jpg")
        assert a.text == "a &amp; b" and not a.hidden
        assert b.hidden and b.text is None
        assert get_setting(s, "last_recheck")


def test_cron_collect_ignores_calls_that_come_too_soon(cfg, Session):
    cfg.x_bearer_token = "t"
    app = create_app(cfg)
    with Session() as s:
        s.add(CollectorRun(started_at=utcnow(), status="ok"))
        s.commit()
    r = app.test_client().post("/cron/collect")
    assert r.status_code == 200 and r.get_json()["reason"] == "too soon"


def test_open_counter_counts_once_per_address(cfg, Session):
    app = create_app(cfg)
    with Session() as s:
        s.add(Post(id="42", author_id="a", author_username="u", text="hi", created_at=utcnow()))
        s.commit()
    c = app.test_client()
    op = lambda vid, **h: c.post("/api/open/42", data=json.dumps({"vid": vid}), content_type="text/plain", headers=h).get_json()
    assert op("a" * 32) == {"counted": True, "opens": 1}
    assert op("a" * 32) == {"counted": False}
    assert op("a" * 32, **{"CF-Connecting-IP": "9.9.9.9"})["opens"] == 2
    assert c.post("/api/open/42").get_json()["opens"] == 3                 # a browser that cannot store an id: once per connection
    assert op("not a browser id") == {"counted": False}
    assert c.post("/api/open/abc").status_code == 400
    assert c.get("/api/posts?range=24h").get_json()["posts"][0]["opens"] == 3


def test_keeper_card_locked_by_default(cfg, Session):
    cfg.x_bearer_token = "t"
    c = create_app(cfg).test_client()
    r = c.get("/api/keeper/someone")
    assert r.status_code == 403 and r.get_json()["locked"] is True
    page = c.get("/friends").get_data(as_text=True)
    assert "keeper-locked" in page and 'id="keeper-open"' not in page and 'class="mailbox"' not in page
    cfg.suggest_url = "https://docs.google.com/document/d/x"
    assert 'class="mailbox"' in create_app(cfg).test_client().get("/friends/keepers").get_data(as_text=True)


def test_keeper_lookup_asks_x_and_caches(cfg, Session, monkeypatch):
    from radar import xapi
    cfg.keeper_card_open = True
    calls = []

    class Fake:
        def __init__(self, token): pass
        def user_profile(self, u):
            calls.append("user")
            return {"id": "7", "name": "Ann", "username": "Ann_X", "profile_image_url": "https://pbs.twimg.com/a_normal.jpg"}
        def search_recent(self, q, **kw):
            calls.append(q)
            return {"data": [{"id": "1", "text": "Uptober is for dragons", "public_metrics": {"like_count": 4, "reply_count": 1, "retweet_count": 2, "quote_count": 0}},
                             {"id": "2", "text": "recap with @pocket_dragons_", "public_metrics": {"like_count": 3}},
                             {"id": "3", "text": "gm friends", "public_metrics": {"like_count": 50}},
                             {"id": "4", "text": "so good https://t.co/x", "entities": {"urls": [{"expanded_url": "https://x.com/Pocket_Dragons_/status/9"}]}, "public_metrics": {"like_count": 1}}], "meta": {}}
    monkeypatch.setattr(xapi, "XClient", Fake)
    cfg.x_bearer_token = "t"
    c = create_app(cfg).test_client()
    got = c.get("/api/keeper/@ann_x").get_json()
    assert got["found"] and got["name"] == "Ann" and got["posts_week"] == "3" and got["love"] == 11
    assert "from:Ann_X" in calls[1] and "-is:retweet" in calls[1]
    assert got["posts_read"] == 4
    c.get("/api/keeper/ann_x")
    assert len(calls) == 2  # second time comes from the cache
    with Session() as s:
        run = s.scalars(select(CollectorRun).where(CollectorRun.status == "keeper_lookup")).one()
        assert round(run.est_cost_usd, 3) == 0.03
    assert c.get("/api/keeper/bad%20name").get_json()["found"] is False


def test_keeper_lookup_respects_daily_budget(cfg, Session):
    cfg.x_bearer_token = "t"
    cfg.keeper_card_open = True
    cfg.keeper_daily_budget_usd = 0.0
    got = create_app(cfg).test_client().get("/api/keeper/someone").get_json()
    assert got["found"] is False and "resting" in got["note"]


def test_directory_lists_only_verified_dragon_names_and_pins_team(cfg, Session):
    now = utcnow()
    created = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    page = {"data": [post("21", author="1", created=created), post("22", author="2", created=created),
                     post("23", author="3", created=created)],
            "includes": {"users": [
                {"id": "1", "username": "ann", "name": "Ann \U0001F409", "verified": True, "verified_type": "blue"},
                {"id": "2", "username": "bob", "name": "Bob \U0001F409", "verified": False},
                {"id": "3", "username": "cat", "name": "Cat", "verified": True, "verified_type": "blue"},
                {"id": "4", "username": "dan", "name": "Dan \U0001F409", "verified": True, "verified_type": "business"},
                {"id": "5", "username": "eli", "name": "Eli \U0001F432", "verified": True, "verified_type": "blue"}]},
            "meta": {"newest_id": "23"}}
    client = FakeClient([page])
    client.team = [{"id": "9", "username": "Pocket_Dragons_", "name": "Pocket Dragons", "profile_image_url": "https://pbs.twimg.com/p_normal.jpg"}]
    with Session() as s:
        run_collection(s, client, cfg, now=now)
    c = create_app(cfg).test_client()
    data = c.get("/api/keepers").get_json()
    assert [k["username"] for k in data["keepers"]] == ["ann"]
    assert data["team"][0]["username"] == "Pocket_Dragons_" and data["team"][0]["role"] == "Official"
    assert len(data["team"]) == 5
    # Ann removes the dragon from her name: she drops off on the next post we see
    page2 = {"data": [post("24", author="1", created=created)],
             "includes": {"users": [{"id": "1", "username": "ann", "name": "Ann", "verified": True, "verified_type": "blue"}]}, "meta": {"newest_id": "24"}}
    with Session() as s:
        run_collection(s, FakeClient([page2]), cfg, now=now + timedelta(minutes=30))
    assert c.get("/api/keepers").get_json()["keepers"] == []


def test_directory_add_checks_name_and_limits(cfg, Session, monkeypatch):
    from radar import xapi
    from radar import fxpic
    monkeypatch.setattr(fxpic, "profile", lambda u, http, timeout=8: None)   # FxTwitter busy: X is asked

    class Fake:
        def __init__(self, token): pass
        def user_profile(self, u):
            return {"id": "5", "username": u, "name": "Dee \U0001F409" if u == "dee" else "Eve", "verified": True, "verified_type": "blue"}
    monkeypatch.setattr(xapi, "XClient", Fake)
    cfg.x_bearer_token = "t"
    c = create_app(cfg).test_client()
    assert c.post("/api/keepers/add", json={"handle": "@dee"}).get_json()["ok"] is True
    got = c.post("/api/keepers/add", json={"handle": "eve"}).get_json()
    assert got["ok"] is False and "display name" in got["message"]
    for h in ["zed", "a1", "a2", "a3", "a4", "a5", "a6", "a7"]:
        c.post("/api/keepers/add", json={"handle": h})
    assert "10 handles" in c.post("/api/keepers/add", json={"handle": "yan"}).get_json()["message"]
    assert [k["username"] for k in c.get("/api/keepers").get_json()["keepers"]] == ["dee"]


def test_cron_is_not_blocked_by_a_directory_check(cfg, Session):
    cfg.x_bearer_token = "t"
    with Session() as s:
        s.add(CollectorRun(started_at=utcnow(), status="directory_add"))
        s.commit()
    r = create_app(cfg).test_client().post("/cron/collect")
    assert r.get_json().get("reason") != "too soon"



def test_directory_add_never_pays_twice_for_the_same_handle(cfg, Session, monkeypatch):
    from radar import xapi
    from radar import fxpic
    monkeypatch.setattr(fxpic, "profile", lambda u, http, timeout=8: None)   # FxTwitter busy: X is asked
    calls = []

    class Fake:
        def __init__(self, token): pass
        def user_profile(self, u):
            calls.append(u)
            if u == "ghost":
                return None
            return {"id": "5", "username": u, "name": u + " \U0001F409" if u == "dee" else u, "verified": True, "verified_type": "blue"}
    monkeypatch.setattr(xapi, "XClient", Fake)
    cfg.x_bearer_token = "t"
    c = create_app(cfg).test_client()
    for h in ["dee", "@DEE", "dee", "ghost", "ghost", "eve", "Eve"]:
        c.post("/api/keepers/add", json={"handle": h})
    assert calls == ["dee", "ghost", "eve"]


def test_oembed_parse_keeps_text_and_spots_media():
    from radar import oembed
    got = oembed.parse({"author_name": "Ann 🐉", "author_url": "https://twitter.com/ann_x",
                        "html": '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">gm <a href="https://twitter.com/Pocket_Dragons_">@Pocket_Dragons_</a> &amp; friends<br>egg day <a href="https://t.co/x">pic.twitter.com/abc</a></p>&mdash; Ann</blockquote>'})
    assert got == {"name": "Ann 🐉", "username": "ann_x", "text": "gm @Pocket_Dragons_ & friends\negg day", "media": True}


def test_backfill_fills_textless_posts_and_hides_deleted(cfg, Session, monkeypatch):
    from radar import collector, oembed
    now = utcnow()
    with Session() as s:
        s.add_all([Post(id="1", author_id="a", created_at=now - timedelta(hours=20)),
                   Post(id="2", author_id="b", created_at=now - timedelta(hours=20))])
        s.commit()
    monkeypatch.setattr(oembed, "fetch", lambda pid, http=None: {} if pid == "2" else
                        {"name": "Ann", "username": "ann", "text": "hi dragons", "media": False})
    with Session() as s:
        assert collector.backfill_text(s, cfg, now) == 1
        s.commit()
        assert s.get(Post, "1").text == "hi dragons" and s.get(Post, "2").hidden


# ---------- Discord share channel (free collection) ----------
class FakeResp:
    def __init__(self, status, payload):
        self.status_code, self._p = status, payload

    def json(self):
        return self._p

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeHttp:
    """Answers Discord channel reads and oEmbed lookups."""

    def __init__(self, messages, oembeds):
        self.messages, self.oembeds, self.calls = messages, oembeds, []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(url)
        if "discord.com" in url:
            msgs, self.messages = self.messages, []
            return FakeResp(200, msgs)
        pid = params["url"].rsplit("/", 1)[-1]
        o = self.oembeds.get(pid)
        if o is None:
            return FakeResp(404, {})
        return FakeResp(200, {"author_name": o[0], "author_url": f"https://twitter.com/{o[1]}",
                              "html": f"<blockquote><p>{o[2]}</p></blockquote>"})

    def close(self):
        pass


def x_id(when):
    from radar.discord_share import X_EPOCH_MS
    from datetime import timezone
    ms = int(when.replace(tzinfo=timezone.utc).timestamp() * 1000)
    return str((ms - X_EPOCH_MS) << 22)


def test_discord_share_channel_reads_links_free_and_checks_blue_tick_once(cfg, Session):
    from radar.discord_share import collect_discord, post_ids_in
    from radar.db import AuthorCheck
    now = utcnow()
    a, b, c = x_id(now - timedelta(hours=2)), x_id(now - timedelta(hours=1)), x_id(now - timedelta(days=20))
    assert post_ids_in(f"look https://x.com/ann/status/{a}?s=20 and https://fxtwitter.com/bob/status/{b}") == [a, b]
    cfg.discord_bot_token, cfg.discord_channel_ids = "tok", "123"
    cfg.discord_require_verified = True
    http = FakeHttp([{"id": "900", "content": f"https://x.com/ann/status/{a}"},
                     {"id": "901", "content": f"https://twitter.com/bob/status/{b} https://x.com/old/status/{c}"}],
                    {a: ("Ann 🐉", "ann", "hatching in the Ancient Hatchery"), b: ("Bob", "bob", "gm dragons")})
    client = FakeClient([])
    client.team = [{"id": "11", "username": "ann", "name": "Ann 🐉", "verified": True, "verified_type": "blue"},
                   {"id": "12", "username": "bob", "name": "Bob", "verified": False}]
    with Session() as s:
        run = CollectorRun(started_at=now); s.add(run)
        assert collect_discord(s, cfg, run, now, client=client, http=http) == 1   # bob has no blue tick
        s.commit()
        got = s.get(Post, a)
        assert got.author_username == "ann" and got.author_id == "11" and abs((got.created_at - (now - timedelta(hours=2))).total_seconds()) < 2
        assert s.get(Post, c) is None                                  # older than the feed window
        assert {k.key for k in s.scalars(select(AuthorCheck))} == {"ann", "bob"}
        assert round(run.est_cost_usd, 3) == round(2 * cfg.cost_per_user_usd, 3)
        assert get_setting(s, "discord_after:123") == "901"
    # the same author again costs nothing: the check is cached
    d = x_id(now - timedelta(minutes=30))
    http2 = FakeHttp([{"id": "902", "content": f"https://x.com/ann/status/{d}"}], {d: ("Ann 🐉", "ann", "another one")})
    with Session() as s:
        run = CollectorRun(started_at=now); s.add(run)
        assert collect_discord(s, cfg, run, now, client=client, http=http2) == 1
        assert run.est_cost_usd == 0


def test_welcome_row_lists_first_time_posters(cfg, Session):
    now = utcnow()
    with Session() as s:
        s.add(Post(id="1", author_id="old", created_at=now - timedelta(days=20), author_username="vet", text="old"))
        s.add(Post(id="2", author_id="old", created_at=now - timedelta(hours=3), author_username="vet", text="again"))
        s.add(Post(id="3", author_id="new", created_at=now - timedelta(hours=2), author_username="fresh",
                   author_name="Fresh", text="found the Ancient Hatchery"))
        s.commit()
    data = create_app(cfg).test_client().get("/api/posts").get_json()
    assert [n["user"] for n in data["newcomers"]] == ["fresh"] and data["newcomers"][0]["hatchery"] is True


def test_discord_free_mode_takes_every_post_without_paid_checks(cfg, Session):
    from radar.discord_share import collect_discord
    now = utcnow()
    a, b = x_id(now - timedelta(hours=2)), x_id(now - timedelta(hours=1))
    cfg.discord_bot_token, cfg.discord_channel_ids = "tok", "123"
    http = FakeHttp([{"id": "900", "content": f"https://x.com/ann/status/{a} https://x.com/bob/status/{b}"}],
                    {a: ("Ann", "ann", "gm dragons"), b: ("Bob", "bob", "no blue tick here")})
    client = FakeClient([])
    client.users_by_usernames = lambda names: (_ for _ in ()).throw(AssertionError("paid call"))
    with Session() as s:
        run = CollectorRun(started_at=now); s.add(run)
        assert collect_discord(s, cfg, run, now, client=client, http=http) == 2
        assert run.est_cost_usd == 0 and s.get(Post, b).author_id == "u:bob"


def test_x_search_off_makes_no_paid_calls(cfg, Session):
    cfg.x_search = False
    cfg.team_x = False
    cfg.daily_post_cap = 100
    client = FakeClient([])
    client.search_recent = lambda *a, **k: (_ for _ in ()).throw(AssertionError("paid search"))
    with Session() as s:
        run = run_collection(s, client, cfg)
        assert run.status == "ok" and run.est_cost_usd == 0


def test_hub_tool_paths_and_old_host_redirect(cfg, Session):
    c = create_app(cfg).test_client()
    hub = c.get("/").get_data(as_text=True)
    assert 'href="/friends"' in hub and "Blinky" in hub
    assert c.get("/friends").status_code == 200 and c.get("/friends/keepers").status_code == 200
    assert c.get("/keepers").headers["Location"].endswith("/friends/keepers")
    cfg.canonical_host = "pdtools.xyz"
    c = create_app(cfg).test_client()
    r = c.get("/?range=7d", base_url="https://dragon-radar.onrender.com")
    assert r.status_code == 301 and r.headers["Location"] == "https://pdtools.xyz/friends?range=7d"
    assert c.post("/cron/collect", base_url="https://dragon-radar.onrender.com").status_code != 301
    assert c.get("/friends", base_url="https://pdtools.xyz").status_code == 200


def test_hub_forest_scene_and_badge_logo(cfg, Session):
    cfg.scene_base = "https://res.cloudinary.com/demo"
    c = create_app(cfg).test_client()
    hub = c.get("/").get_data(as_text=True)
    assert 'id="forest"' in hub and "forest.js" in hub and '"loop": "hut-loop"' in hub
    assert "brand/pdtools-logo.webp" in hub and 'alt="PD Tools"' in hub and 'rel="apple-touch-icon"' in hub
    feed = c.get("/friends").get_data(as_text=True)
    assert "mark.svg" not in hub and "mark.svg" not in feed and 'class="brand-mark"' in feed and 'class="brand-logo"' in feed


def test_share_card_and_app_manifest(cfg, Session):
    c = create_app(cfg).test_client()
    for path in ("/", "/friends", "/friends/keepers"):
        html = c.get(path).get_data(as_text=True)
        assert 'property="og:image" content="https://pdtools.xyz/static/brand/share.jpg"' in html
        assert 'name="twitter:card" content="summary_large_image"' in html and 'rel="manifest"' in html
    m = c.get("/static/manifest.webmanifest")
    assert m.status_code == 200 and m.json["name"] == "PD Tools"
    for f in ("brand/share.jpg", "brand/badge-180.png", "brand/badge-192.png", "brand/badge-96.webp", "brand/pdtools-logo.webp"):
        assert c.get("/static/" + f).status_code == 200


def test_premium_icons_and_mailbox(cfg, Session):
    cfg.scene_base = "https://res.cloudinary.com/demo"
    cfg.suggest_url = "https://forms.gle/x"
    c = create_app(cfg).test_client()
    feed = c.get("/friends").get_data(as_text=True)
    keepers = c.get("/friends/keepers").get_data(as_text=True)
    hub = c.get("/").get_data(as_text=True)
    assert feed.count('class="ico') >= 10 and "/ico/book" in feed and "e_background_removal" not in feed   # small stored icons, no cut out on each view
    assert "c_scale,w_96/f_auto" in feed and "c_scale,w_160/f_auto" in feed and 'loading="lazy"' in feed
    assert 'class="mb-clip"' in feed and "mailbox-hover" in feed and "mailbox.js" in feed and "<svg viewBox=\"0 0 64 64\"" not in feed
    assert keepers.count('class="ico') >= 4 and 'class="ico egg"' in hub


def test_x_search_off_still_reads_only_team_posts(cfg, Session):
    cfg.x_search = False
    cfg.team_x = True
    cfg.team_user_id = "team1"
    queries = []
    client = FakeClient([])
    def search(q, **k):
        queries.append(q)
        return {"data": [{"id": "1840000000000000000", "author_id": "team1", "created_at": "2026-10-10T10:00:00.000Z", "text": "hi"}],
                "includes": {"users": [{"id": "team1", "username": "Pocket_Dragons_", "name": "Pocket Dragons"}]},
                "meta": {"newest_id": "1840000000000000000"}}
    client.search_recent = search
    with Session() as s:
        run = run_collection(s, client, cfg)
        assert run.status == "ok" and len(queries) == 1 and queries[0].startswith("from:Pocket_Dragons_")
        assert s.get(Post, "1840000000000000000").is_team


def test_authors_get_pictures_and_dragon_keepers_join(cfg, Session):
    from radar.db import Keeper
    from radar.fxpic import refresh_authors
    now = utcnow()
    calls = []
    users = {"bob": {"screen_name": "Bob", "id": "1", "name": "Bob", "avatar_url": "https://pbs.twimg.com/b_normal.jpg",
                     "verification": {"verified": False}},
             "drago": {"screen_name": "Drago", "id": "2", "name": "Drago \U0001F409", "avatar_url": "https://pbs.twimg.com/d.jpg",
                       "verification": {"verified": True, "type": "individual"}}}

    class R:
        def __init__(self, u): self.u = u; self.status_code = 200 if u else 404
        def json(self): return {"user": self.u}

    class H:
        def get(self, url, **k):
            calls.append(url)
            return R(users.get(url.rsplit("/", 1)[-1].lower()))

    with Session() as s:
        s.add_all([Post(id=str(i), author_id="u:bob", author_username="Bob", author_name="Bob", text="x",
                        created_at=now - timedelta(hours=i)) for i in range(1, 4)] +
                  [Post(id="9", author_id="u:amy", author_username="amy", text="x", created_at=now, author_avatar="https://pic/amy"),
                   Post(id="10", author_id="u:amy", author_username="Amy", text="x", created_at=now),
                   Post(id="20", author_id="u:drago", author_username="Drago", author_name="Drago \U0001F409", text="x",
                        created_at=now, author_avatar="https://pic/d")])
        s.commit()
        out = refresh_authors(s, cfg, now, http=H())
        s.commit()
        assert out["pictures"] == 4 and out["keepers"] == 1 and s.get(Post, "10").author_avatar == "https://pic/amy"
        assert s.get(Post, "2").author_avatar.endswith("b_bigger.jpg")
        assert s.get(Keeper, "drago") is not None and s.get(Keeper, "bob") is None
        n = len(calls)
        refresh_authors(s, cfg, now, http=H())       # cached: no new lookups
        assert len(calls) == n

def test_sound_on_pages(cfg, Session):
    c = create_app(cfg).test_client()
    feed = c.get("/friends").get_data(as_text=True)
    hub = c.get("/").get_data(as_text=True)
    assert "meadow-ambience.m4a" in feed and "blinky-song.m4a" in feed and 'id="sound-btn"' in feed
    # the home page carries a song that was already playing (so the playlist never resets), but never starts one
    assert "forest-ambience.m4a" in hub and "sound.js" in hub and '"carryOnly": true' in hub
    assert c.get("/static/audio/blinky-song.m4a").status_code == 200


def test_new_posts_check_and_offline_helper(cfg, Session):
    now = utcnow()
    with Session() as s:
        s.add_all([Post(id="old", author_id="a", author_username="a", text="x", created_at=now - timedelta(hours=2)),
                   Post(id="new", author_id="b", author_username="b", text="x", created_at=now - timedelta(minutes=5))])
        s.commit()
    c = create_app(cfg).test_client()
    after = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    j = c.get(f"/api/posts?range=24h&after={after}").get_json()
    assert [p["id"] for p in j["posts"]] == ["new"] and j["newcomers"] == []
    sw = c.get("/sw.js")
    assert sw.status_code == 200 and "pd-static-" in sw.get_data(as_text=True) and sw.headers["Cache-Control"] == "no-cache"
    page = c.get("/friends").get_data(as_text=True)
    assert "serviceWorker" in page and 'class="post skel"' in page and 'id="new-pill"' in page
    import re
    v = re.search(r'/static/app\.js\?v=(\w+)', page).group(1)
    assert "immutable" in c.get(f"/static/app.js?v={v}").headers["Cache-Control"]
    assert "immutable" not in c.get("/static/app.js").headers.get("Cache-Control", "")


def test_progress_backup_codes(cfg, Session):
    c = create_app(cfg).test_client()
    r = c.post("/api/backup", json={"opened": {"123456": 1700000000000, "bad id": 1}, "streak": {"last": "2026-10-11", "count": 3, "best": 5}})
    j = r.get_json()
    assert j["ok"] and len(j["code"]) == 9 and j["code"][4] == "-"
    back = c.get(f"/api/backup/{j['code'].lower()}").get_json()
    assert back["opened"] == {"123456": 1700000000000} and back["streak"]["count"] == 3
    assert c.get("/api/backup/ZZZZ-ZZZZ").status_code == 404


def test_every_element_the_scripts_use_exists(cfg, Session):
    """app.js and keepers.js look elements up by id; a missing one breaks the page."""
    import re
    from pathlib import Path
    cfg.suggest_url = "https://forms.gle/x"
    c = create_app(cfg).test_client()
    static = Path(__file__).resolve().parents[1] / "radar" / "static"
    for page, script in (("/friends", "app.js"), ("/friends/keepers", "keepers.js")):
        html = c.get(page).get_data(as_text=True)
        ids = set(re.findall(r'\$\("([\w-]+)"\)', (static / script).read_text()))
        optional = {"keeper-open", "keeper", "progress-freeze"}   # only there when the Keeper card / v2 is on
        missing = sorted(i for i in ids - optional if f'id="{i}"' not in html)
        assert not missing, (page, missing)


def test_tester_ratings(cfg, Session):
    c = create_app(cfg).test_client()
    assert c.post("/api/feedback", json={"rating": 9}).status_code == 400
    assert c.post("/api/feedback", json={"rating": 4, "comment": "smooth on my phone", "page": "/friends", "device": "phone"}).get_json()["ok"]
    from radar.db import Feedback
    with Session() as s:
        f = s.query(Feedback).one()
        assert f.rating == 4 and f.device == "phone"
    assert 'id="rate"' in c.get("/friends").get_data(as_text=True)


def test_v2_preview_is_private_until_launch(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    # the public sees nothing of v2
    assert c.get("/lab").status_code == 404
    assert "v2-pill" not in c.get("/").get_data(as_text=True)
    assert c.get("/preview/wrong-key").status_code == 404
    # the secret link turns it on for this browser only
    r = c.get("/preview/secret-preview-phrase-123")
    assert r.status_code == 302 and r.headers["Location"].endswith("/lab")
    assert "pd_v2=" in r.headers.get("Set-Cookie", "") and "HttpOnly" in r.headers["Set-Cookie"]
    lab = c.get("/lab")
    assert lab.status_code == 200 and "v2 lab" in lab.get_data(as_text=True)
    assert lab.headers["X-Robots-Tag"].startswith("noindex")
    hub = c.get("/")
    assert "v2-pill" in hub.get_data(as_text=True) and hub.headers["Cache-Control"] == "private, no-store"
    assert "v2-pill" in c.get("/friends").get_data(as_text=True)
    # a different visitor still sees the normal site
    other = create_app(cfg).test_client()
    assert other.get("/lab").status_code == 404
    # turning it off works, and a changed key switches old devices off
    c.get("/preview/off")
    assert c.get("/lab").status_code == 404
    c.get("/preview/secret-preview-phrase-123")
    cfg.preview_key = "a-new-key-456789"
    assert c.get("/lab").status_code == 404


def test_v2_launch_switch_and_noindex(cfg, Session):
    cfg.preview_key = ""
    c = create_app(cfg).test_client()
    assert c.get("/preview/anything").status_code == 404      # no key set: preview cannot be turned on
    cfg.v2_public = True
    c2 = create_app(cfg).test_client()
    assert c2.get("/lab").status_code == 200 and "v2-pill" not in c2.get("/").get_data(as_text=True)
    cfg.noindex = True
    r = create_app(cfg).test_client().get("/")
    assert 'name="robots" content="noindex' in r.get_data(as_text=True) and r.headers["X-Robots-Tag"].startswith("noindex")


def test_visitor_counting_is_private_and_unique(cfg, Session):
    cfg.admin_password = "pw"
    app = create_app(cfg)
    c = app.test_client()
    phone = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile"}
    pc = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"}
    a, b = "a" * 32, "b" * 32
    hit = lambda vid, path, h, ref="": c.post("/api/hit", data=json.dumps({"vid": vid, "path": path, "ref": ref}),
                                              headers=h, content_type="text/plain").get_json()["counted"]
    assert hit(a, "/", phone, "https://t.co/abc") is True
    assert hit(a, "/friends", phone) is True
    assert hit(a, "/friends", phone) is False                     # same page twice in a row is ignored
    assert hit(b, "/friends/keepers", pc, "https://discord.com/channels/1") is True
    assert hit("not-an-id", "/", pc) is False
    assert hit("c" * 32, "/", {"User-Agent": "Googlebot/2.1"}) is False
    assert hit("d" * 32, "/admin", pc) is False
    from radar.db import Visitor
    from radar.visits import summary
    with Session() as s:
        assert s.scalar(select(func.count()).select_from(Visitor)) == 2
        v = s.get(Visitor, a)
        assert v.views == 2 and v.device == "phone" and v.source == "x"
        today = datetime.now(ZoneInfo(cfg.timezone)).date()
        out = summary(s, today)
    assert out["total"] == 2 and out["today"] == 2 and out["views_today"] == 3 and out["phone_pct"] == 50
    assert dict(out["sources"]) == {"x": 1, "discord": 1}
    # admin shows the numbers
    with c.session_transaction() as sess:
        sess["admin"] = True
    page = c.get("/admin").get_data(as_text=True)
    assert "people ever (unique)" in page


def test_preview_devices_are_not_counted(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    c.get("/preview/secret-preview-phrase-123")
    r = c.post("/api/hit", data=json.dumps({"vid": "e" * 32, "path": "/"}), content_type="text/plain")
    assert r.get_json()["counted"] is False


def test_my_week_card_is_v2_only(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    public = c.get("/friends").get_data(as_text=True)
    assert "myweek.js" not in public and 'id="myweek"' not in public and "cards-data.js" not in public
    c.get("/preview/secret-preview-phrase-123")
    page = c.get("/friends").get_data(as_text=True)
    assert "myweek.js" in page and 'id="myweek-canvas"' in page and page.count("data-myweek") == 2
    assert "cards-data.js" in page and 'id="mw-eggs"' in page and 'id="mw-times"' in page and 'id="mw-designs"' in page
    assert "My week card" in c.get("/lab").get_data(as_text=True)


def test_weekly_designs_are_v2_only(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    public = c.get("/friends").get_data(as_text=True)
    assert "weekly.js" in public and "weekly2.js" not in public and 'id="wk-designs"' not in public
    c.get("/preview/secret-preview-phrase-123")
    page = c.get("/friends").get_data(as_text=True)
    assert "weekly2.js" in page and 'id="wk-designs"' in page and "/weekly.js" not in page


def test_hatchery_numbers_on_home_are_v2_only(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    pc = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"}
    for vid in ("a" * 32, "b" * 32, "c" * 32):
        c.post("/api/hit", data=json.dumps({"vid": vid, "path": "/"}), headers=pc, content_type="text/plain")
    public = c.get("/").get_data(as_text=True)
    assert 'id="numbers"' not in public and "The Hatchery so far" not in public
    c.get("/preview/secret-preview-phrase-123")
    page = c.get("/").get_data(as_text=True)
    assert 'id="numbers"' in page and "people have visited" in page and "<b>3</b>" in page
    assert page.count('class="later"') == 13         # the chart starts on the first counted day and fills up
    assert "Hatchery numbers" in c.get("/lab").get_data(as_text=True)


def test_collectible_dragons_are_v2_only(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    public = c.get("/friends").get_data(as_text=True)
    assert "dragons.js" not in public and 'id="hatch"' not in public and "data-dex" not in public
    c.get("/preview/secret-preview-phrase-123")
    page = c.get("/friends").get_data(as_text=True)
    assert "dragons.js" in page and "dex-data.js" in page and 'id="hatch"' in page and 'id="dex"' in page
    assert page.count("data-dex") == 2
    assert "Collectible dragons" in c.get("/lab").get_data(as_text=True)


def test_backup_carries_dragons_and_drops_junk(cfg, Session):
    c = create_app(cfg).test_client()
    dex = {"have": {"lava": {"c": 2, "r": 1}, "ruby": {"l": 1}, "notadragon": {"c": 5}, "ice": {"c": "lots", "r": True},
                    "tiger": {"c": 99999}}, "last": "2026-10-11", "log": [{"id": "lava"}]}
    dex2 = dict(dex, n=41, g={"last": "2026-10-11", "count": 12, "best": "x"})
    r = c.post("/api/backup", json={"opened": {}, "streak": {}, "dex": dex}).get_json()
    assert r["ok"]
    back = c.get(f"/api/backup/{r['code']}").get_json()
    assert back["dex"]["have"] == {"lava": {"c": 2, "r": 1}, "ruby": {"l": 1}, "tiger": {"c": 999}}
    assert back["dex"]["last"] == "2026-10-11" and back["dex"]["n"] == 0
    r3 = c.post("/api/backup", json={"opened": {}, "streak": {}, "dex": dex2}).get_json()
    d3 = c.get(f"/api/backup/{r3['code']}").get_json()["dex"]
    assert d3["n"] == 41 and d3["g"] == {"last": "2026-10-11", "count": 12, "best": 0, "fz": None}
    # an old style save without dragons still works
    r2 = c.post("/api/backup", json={"opened": {"123": 1}, "streak": {}}).get_json()
    assert "dex" not in c.get(f"/api/backup/{r2['code']}").get_json()


def test_v2_daily_goal_is_20_keeper_posts(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    public = c.get("/friends").get_data(as_text=True)
    assert '"goal": 5' in public and '"goal_rule": "quiet"' in public and "0/5 quiet posts" in public
    c.get("/preview/secret-preview-phrase-123")
    page = c.get("/friends").get_data(as_text=True)
    assert '"goal": 20' in page and '"goal_rule": "keeper"' in page and "0/20 Keeper posts" in page


def test_directory_add_is_free_and_lets_people_retry_after_fixing_their_name(cfg, Session, monkeypatch):
    from radar import fxpic, xapi
    names = {"nastya": "Anastasiya"}

    def fx(u, http, timeout=8):
        return {"id": "7", "username": u, "name": names[u], "profile_image_url": "", "verified": True, "verified_type": "blue"}
    monkeypatch.setattr(fxpic, "profile", fx)
    monkeypatch.setattr(xapi, "XClient", lambda t: (_ for _ in ()).throw(AssertionError("X must not be paid")))
    app = create_app(cfg)
    c = app.test_client()
    first = c.post("/api/keepers/add", json={"handle": "nastya"}).get_json()
    assert first["ok"] is False and "display name" in first["message"] and "try again" in first["message"]
    names["nastya"] = "Anastasiya \U0001F409"          # she adds the dragon on X
    soon = c.post("/api/keepers/add", json={"handle": "nastya"}).get_json()
    assert soon["ok"] is False and "10 minutes" in soon["message"]   # a short pause, not a whole day
    with Session() as s:                                  # ten minutes later
        from radar.db import get_setting, set_setting
        at, _, why = get_setting(s, "dirno:nastya").partition("|")
        set_setting(s, "dirno:nastya", (datetime.fromisoformat(at) - timedelta(minutes=11)).isoformat() + "|" + why)
        s.commit()
    ok = c.post("/api/keepers/add", json={"handle": "nastya"}).get_json()
    assert ok["ok"] is True
    with Session() as s:
        assert s.scalar(select(func.count()).select_from(CollectorRun).where(CollectorRun.status == "directory_add")) == 0


def test_discord_authors_are_looked_at_again_when_they_put_the_dragon_on(cfg, Session):
    from radar.db import AuthorCheck, Keeper
    from radar.fxpic import refresh_authors
    now = utcnow()
    calls = []

    class R:
        status_code = 200
        def json(self): return {"user": {"screen_name": "Karpo", "id": "3", "name": "Karpo \U0001F409",
                                         "avatar_url": "", "verification": {"verified": True, "type": "individual"}}}

    class H:
        def get(self, url, **k):
            calls.append(url)
            return R()

    with Session() as s:
        s.add(AuthorCheck(key="karpo", username="Karpo", name="Karpo", verified=True, avatar="https://pic/k",
                          checked_at=now - timedelta(hours=10)))   # looked at before the dragon went on
        s.add(Post(id="30", author_id="u:k", author_username="Karpo", author_name="Karpo \U0001F409", text="x",
                   created_at=now, author_avatar="https://pic/k"))
        s.commit()
        refresh_authors(s, cfg, now, http=H())
        s.commit()
        assert len(calls) == 1 and s.get(Keeper, "karpo") is not None


def test_phone_filters_never_float_over_the_page():
    import pathlib, re
    css = (pathlib.Path(__file__).resolve().parents[1] / "radar" / "static" / "style.css").read_text()
    assert not re.search(r"\.rail\s*\{[^}]*position:\s*sticky", css)
    assert "#k-filters .group" in css and "font-size: 16px !important" in css


def test_phone_replies_open_the_post_not_a_blank_composer(cfg, Session):
    import pathlib
    js = (pathlib.Path(__file__).resolve().parents[1] / "radar" / "static" / "app.js").read_text()
    assert "const replyUrl" in js and "ideas-hint" in js
    page = create_app(cfg).test_client().get("/friends").get_data(as_text=True)
    assert 'id="ideas-hint"' in page


def test_music_carries_on_between_pages_and_starts_on_phone_taps():
    import pathlib
    js = (pathlib.Path(__file__).resolve().parents[1] / "radar" / "static" / "sound.js").read_text()
    assert "pd:soundPos" in js and '"touchend"' in js and "mediaSession" in js
    assert "pauseAll(); else" not in js        # leaving for X no longer stops the music


def test_dark_mode_is_v2_only(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    for path in ("/friends", "/friends/keepers"):
        page = c.get(path).get_data(as_text=True)
        assert "dark.css" not in page and 'id="theme-btn"' not in page and "theme.js" not in page
    c.get("/preview/secret-preview-phrase-123")
    for path in ("/friends", "/friends/keepers"):
        page = c.get(path).get_data(as_text=True)
        assert "dark.css" in page and 'id="theme-btn"' in page and "theme.js" in page and "pd:theme" in page


def test_secret_relics_stay_secret_and_travel_with_backups(cfg, Session):
    import pathlib, json
    root = pathlib.Path(__file__).resolve().parents[1] / "radar"
    js = (root / "static" / "dragons.js").read_text()
    assert "1500" not in js and "3000" not in js and "MARK" in js and "pd:opened" in js
    feed = (root / "templates" / "feed.html").read_text()
    assert 'id="dex-secrets"' in feed and "500" not in feed.split('id="dex"')[1].split("</div>\n  </div>")[0]
    c = create_app(cfg).test_client()
    r = c.post("/api/backup", json={"opened": {}, "dex": {"have": {}, "e": 1234, "s": {"moon": "2026-10-12", "hack": "2026-10-12", "ember": "nope"}}})
    code = r.get_json()["code"]
    back = c.get(f"/api/backup/{code}").get_json()
    assert back["dex"]["e"] == 1234 and back["dex"]["s"] == {"moon": "2026-10-12"}


def test_music_makers_are_credited_for_everyone(cfg, Session):
    c = create_app(cfg).test_client()
    hub = c.get("/").get_data(as_text=True)                      # the public home page, no preview needed
    for name, handle in (("The Panda", "ThePanda_NFT"), ("DJ", "bubblegum_dee"), ("Boxer", "Boxerr110")):
        assert f'<b class="mk-name">{name}</b>' in hub and f"https://x.com/{handle}" in hub
    assert "Now playing on Blinky" in hub and "Four-Leaf Clover Escape" in hub
    feed = c.get("/friends").get_data(as_text=True)               # the song heard on the feed is credited there too
    assert "Music made by the community" in feed and "s song</button> by" in feed and "https://x.com/ThePanda_NFT" in feed
    assert "music.js" not in "".join(__import__("re").findall(r'<script src="([^"]+)"', feed))   # loaded only when opened
    assert 'data-music-by="ThePanda_NFT"' in feed and "data-song=" in feed and 'data-music-by="bubblegum_dee"' in hub
    cfg.music_credits_raw = "Another song|Sample Maker|samplemaker;Bad|<x>|not a handle!"
    page = c.get("/friends").get_data(as_text=True)
    assert "https://x.com/samplemaker" in page and "&lt;x&gt;" in page


def test_keepers_page_says_when_everyone_is_shown(cfg, Session):
    page = create_app(cfg).test_client().get("/friends/keepers").get_data(as_text=True)
    assert 'id="k-end"' in page


def test_relic_cards_can_carry_the_keepers_x_name(cfg, Session):
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1] / "radar"
    assert 'id="hatch-xname-in"' in (root / "templates" / "feed.html").read_text()
    js = (root / "static" / "dragons.js").read_text()
    assert "pd:xname" in js and "EARNED BY" in js and "cleanX" in js


def test_team_spotlight_keeps_one_newest_post_per_member(cfg, Session):
    cfg.team_accounts = "Pocket_Dragons_:Official,TradingJoker:Engineering,HeartyOfDaCards:Community,plooshGWIN:3D Art"
    now = utcnow()
    with Session() as s:
        s.add_all([
            Post(id="off", author_username="Pocket_Dragons_", text="hi", author_id="t", created_at=now - timedelta(hours=1), is_team=True),
            Post(id="tj-old", author_username="TradingJoker", text="old", author_id="tj", created_at=now - timedelta(hours=20)),
            Post(id="tj-new", author_username="tradingjoker", text="new", author_id="tj", created_at=now - timedelta(hours=2)),
            Post(id="hearty", author_username="HeartyOfDaCards", text="gm", author_id="h", created_at=now - timedelta(hours=5)),
            Post(id="ploosh-stale", author_username="plooshGWIN", text="art", author_id="p", created_at=now - timedelta(hours=60)),
            Post(id="fan", author_username="fan", text="gm", author_id="f", created_at=now - timedelta(hours=3)),
        ])
        s.commit()
    data = create_app(cfg).test_client().get("/api/posts?range=24h").get_json()
    pinned = data["pinned"]
    assert [p["id"] for p in pinned if not p.get("crew")] == ["off"]
    crew = [(p["id"], p["crew"]) for p in pinned if p.get("crew")]
    assert crew == [("tj-new", "Engineering"), ("hearty", "Community")]   # newest first, stale slot steps aside
    assert "tj-old" not in [p["id"] for p in pinned]
    feed_ids = [p["id"] for p in data["posts"]]
    assert "fan" in feed_ids


def test_team_spotlight_reads_only_new_dragon_posts_from_members(cfg, Session):
    cfg.daily_post_cap = 50
    cfg.team_user_id = TEAM_ID
    cfg.crew_x = True
    cfg.team_accounts = "Pocket_Dragons_:Official,TradingJoker:Engineering,HeartyOfDaCards:Community"
    now = utcnow()
    created = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    cid = str(int(((now - timedelta(hours=1)).timestamp() * 1000) - 1288834974657) << 22)

    class Fake(FakeClient):
        def search_recent(self, query, since_id=None, start_time=None, next_token=None, max_results=100):
            self.calls.append({"query": query, "since_id": since_id, "start_time": start_time})
            if query.startswith("(from:"):
                return {"data": [post(cid, author="tj", created=created)],
                        "includes": {"users": [{"id": "tj", "username": "TradingJoker", "name": "TJ"}]},
                        "meta": {"newest_id": cid}}
            return {"data": [], "meta": {}}

    client = Fake([])
    with Session() as s:
        run_collection(s, client, cfg, now=now)
        assert s.get(Post, cid).author_username == "TradingJoker"
        assert not s.get(Post, cid).is_team
        assert get_setting(s, "crew_newest_id") == cid
    q = [c for c in client.calls if c["query"].startswith("(from:")][0]
    assert "from:TradingJoker OR from:HeartyOfDaCards" in q["query"]
    assert "Pocket_Dragons_ OR" not in q["query"].split(")")[0]      # the official account is not in the member list
    assert '"pocket dragons"' in q["query"] and "-is:reply" in q["query"]
    with Session() as s:
        run_collection(s, client, cfg, now=now + timedelta(minutes=30))
    q2 = [c for c in client.calls if c["query"].startswith("(from:")][-1]
    assert q2["since_id"] == cid


def test_team_spotlight_failure_does_not_stop_the_run(cfg, Session):
    cfg.daily_post_cap = 50
    cfg.team_user_id = TEAM_ID
    cfg.crew_x = True

    class Fake(FakeClient):
        def search_recent(self, query, since_id=None, start_time=None, next_token=None, max_results=100):
            if query.startswith("(from:"):
                raise RuntimeError("boom")
            return {"data": [], "meta": {}}

    with Session() as s:
        run = run_collection(s, Fake([]), cfg, now=utcnow())
        assert run.status != "error"


def test_relic_films_play_between_the_seal_and_the_relic(cfg, Session):
    c = create_app(cfg).test_client()
    js = c.get("/static/dragons.js").get_data(as_text=True)
    assert "await relicFilm(entry);" in js and "filmEl(entry.sp.id);" in js
    assert "Skip" in js and "pdSound" in js
    data = c.get("/static/dex-data.js").get_data(as_text=True)
    assert "secretFilm" in data and "moon:" in data
    snd = c.get("/static/sound.js").get_data(as_text=True)
    assert "window.pdSound" in snd and "duck(" in snd and "unduck(" in snd



def test_cards_pop_up_for_moments_not_every_day(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    c.get("/preview/secret-preview-phrase-123")
    page = c.get("/friends").get_data(as_text=True)
    assert 'id="daycard"' not in page and "goalcard.js" not in page and "hatch-daycard" not in page
    assert page.index("cardkit.js") < page.index("dragons.js")
    data = c.get("/static/dex-data.js").get_data(as_text=True)
    for k in ("ruby-l", "sapphire-l", "emerald-l", "amethyst-l", "diamond-l"):
        assert f'"{k}"' in data.split("art2d")[1].split("}")[0]
    js = c.get("/static/dragons.js").get_data(as_text=True)
    assert "window.pdCard" in js and "HATCHED BY" in js and "daily card" not in js


def test_habit_number_counts_keepers_who_open_five_posts(cfg, Session):
    app = create_app(cfg)
    with Session() as s:
        for i in range(6):
            s.add(Post(id=str(100 + i), author_id="a", author_username="u", text="hi", created_at=utcnow()))
        s.commit()
    c = app.test_client()
    a, b = "a" * 32, "b" * 32
    for i in range(5):
        c.post(f"/api/open/{100 + i}", data=json.dumps({"vid": a}), content_type="text/plain",
               headers={"X-Forwarded-For": f"1.1.1.{i}"})
    for i in range(3):
        c.post(f"/api/open/{100 + i}", data=json.dumps({"vid": b}), content_type="text/plain",
               headers={"X-Forwarded-For": f"2.2.2.{i}"})
    c.post("/api/open/105", headers={"X-Forwarded-For": "3.3.3.3"})       # old pages without a vid still count opens
    ev = lambda kind, ref="", vid=a: c.post("/api/ev", data=json.dumps({"vid": vid, "kind": kind, "ref": ref}),
                                            content_type="text/plain").get_json()["counted"]
    assert ev("goal") is True and ev("goal") is False                  # once a day
    assert ev("share", "rare") is True and ev("save", "myweek") is True and ev("install") is True
    assert ev("hack") is False and ev("share", "<script>") is False and ev("goal", vid="nope") is False
    from radar.events import summary
    today = datetime.now(ZoneInfo(cfg.timezone)).date()
    with Session() as s:
        out = summary(s, today)
    assert out["habit"] == 1 and out["openers"] == 2 and out["goals_today"] == 1
    assert dict(out["shares"]) == {"rare": 1} and dict(out["saves"]) == {"myweek": 1} and out["installs_week"] == 1
    with c.session_transaction() as sess:
        sess["admin"] = True
    page = c.get("/admin").get_data(as_text=True)
    assert "Is it becoming a habit?" in page and "Reported posts" in page


def test_preview_devices_do_not_count_toward_habits(cfg, Session):
    cfg.preview_key = "secret-preview-phrase-123"
    app = create_app(cfg)
    with Session() as s:
        s.add(Post(id="7", author_id="a", author_username="u", text="hi", created_at=utcnow()))
        s.commit()
    c = app.test_client()
    c.get("/preview/secret-preview-phrase-123")
    c.post("/api/open/7", data=json.dumps({"vid": "a" * 32}), content_type="text/plain")
    assert c.post("/api/ev", data=json.dumps({"vid": "a" * 32, "kind": "goal"}), content_type="text/plain").get_json()["counted"] is False
    from radar.db import Event
    with Session() as s:
        # only a preview open for the book; nothing that reaches the admin numbers
        assert s.scalars(select(Event.kind)).all() == ["popen"]


def test_reports_hide_a_post_only_when_returning_visitors_agree(cfg, Session):
    from radar.db import Keeper, ReportStatus, Visitor
    app = create_app(cfg)
    with Session() as s:
        s.add(Post(id="50", author_id="s", author_username="spammer", text="claim now", created_at=utcnow()))
        s.add(Post(id="51", author_id="k", author_username="goodkeeper", text="gm", created_at=utcnow()))
        s.add(Keeper(key="goodkeeper", username="goodkeeper", verified=True))
        for ch in "abcde":
            s.add(Visitor(vid=ch * 32, days=3 if ch in "abcd" else 1))
        s.commit()
    c = app.test_client()
    rep = lambda pid, vid, why="spam": c.post("/api/report", data=json.dumps({"post": pid, "vid": vid, "reason": why}),
                                              content_type="text/plain",
                                              headers={"CF-Connecting-IP": "10.0.0." + str(ord(vid[0]))}).get_json()
    assert rep("50", "e" * 32)["ok"] is True                             # a brand new browser
    assert rep("50", "a" * 32)["ok"] is True and rep("50", "a" * 32)["why"] == "dup"
    assert rep("50", "b" * 32, "offtopic")["ok"] is True
    with Session() as s:
        assert s.get(Post, "50").hidden is False                         # only 2 returning visitors so far
    rep("50", "c" * 32)
    with Session() as s:
        assert s.get(Post, "50").hidden is True and s.get(ReportStatus, "50").status == "auto"
    for ch in "abc":
        rep("51", ch * 32, "harm")
    with Session() as s:
        assert s.get(Post, "51").hidden is False                         # verified Keepers are never hidden by reports
    assert rep("50", "x" * 32)["ok"] is False and rep("abc", "a" * 32)["ok"] is False
    assert rep("50", "d" * 32, "nonsense")["ok"] is False
    # Jon keeps it: it comes back and new reports no longer hide it
    with c.session_transaction() as sess:
        sess["admin"] = True; sess["csrf"] = "t"
    page = c.get("/admin").get_data(as_text=True)
    assert "Hidden by reports, please check" in page and "@spammer" in page
    c.post("/admin/report", data={"csrf": "t", "post": "50", "action": "keep"})
    with Session() as s:
        assert s.get(Post, "50").hidden is False and s.get(ReportStatus, "50").status == "kept"
    rep("50", "d" * 32)
    with Session() as s:
        assert s.get(Post, "50").hidden is False
    c.post("/admin/report", data={"csrf": "t", "post": "50", "action": "hide", "block_author": "1"})
    with Session() as s:
        assert s.get(Post, "50").hidden is True and s.get(BlockedAuthor, "s") is not None


def test_report_button_and_install_invite_are_on_the_page(cfg, Session):
    page = create_app(cfg).test_client().get("/friends").get_data(as_text=True)
    assert 'id="report"' in page and 'data-why="spam"' in page and "data-install" in page and 'id="install-nudge"' in page
    man = json.loads(open("radar/static/manifest.webmanifest").read())
    assert any(i["sizes"] == "512x512" for i in man["icons"]) and man["start_url"] == "/friends"


def v2_client(cfg):
    cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    c.get("/preview/secret-preview-phrase-123")
    return c


def test_book_is_v2_only(cfg, Session):
    c = create_app(cfg).test_client()
    assert c.get("/api/book").status_code == 404 and c.post("/api/book/sign", data="{}").status_code == 404
    page = c.get("/friends").get_data(as_text=True)
    assert 'id="book"' not in page and "friends.js" not in page and 'id="start-here"' not in page


def test_book_signing_proves_the_name_with_one_post(cfg, Session, monkeypatch):
    c = v2_client(cfg)
    a = "a" * 32
    post = lambda url, body: c.post(url, data=json.dumps(body), content_type="text/plain").get_json()
    assert post("/api/book/sign", {"vid": a, "handle": "not a name!"})["ok"] is False
    j = post("/api/book/sign", {"vid": a, "handle": "@Blinky_Fan"})
    assert j["ok"] and j["status"] == "pending" and j["code"].startswith("PD") and j["code"] in j["text"]
    code = j["code"]
    fake = {}
    monkeypatch.setattr("radar.oembed.fetch", lambda pid, **k: fake.get(pid))
    assert post("/api/book/check", {"vid": a, "link": "hello"})["why"] == "link"
    import time as _t
    fresh = lambda n: str(((int(_t.time() * 1000) - 1288834974657) << 22) + n)   # an X post id made just now
    fake["1111111111"] = {"username": "Blinky_Fan", "text": f"Signing {code}", "name": "x"}
    assert post("/api/book/check", {"vid": a, "link": "https://x.com/Blinky_Fan/status/1111111111"})["why"] == "old"
    p1, p2, p3 = fresh(1), fresh(2), fresh(3)
    fake[p1] = {"username": "someone_else", "text": f"Signing {code}", "name": "x"}
    r = post("/api/book/check", {"vid": a, "link": f"https://x.com/someone_else/status/{p1}"})
    assert r["why"] == "other" and r["found"] == "someone_else"
    fake[p2] = {"username": "Blinky_Fan", "text": "forgot the code", "name": "Fan"}
    assert post("/api/book/check", {"vid": a, "link": f"https://x.com/Blinky_Fan/status/{p2}"})["why"] == "nocode"
    fake[p3] = {"username": "Blinky_Fan", "text": f"Signing Blinky's Book of Friends {code.lower()} #PocketDragons", "name": "Fan"}
    assert post("/api/book/check", {"vid": a, "link": f"https://twitter.com/Blinky_Fan/status/{p3}?s=20"})["ok"] is True
    assert len(code) == 8                                                  # PD plus 6: far too many to guess
    me = c.get(f"/api/book/me?vid={a}").get_json()
    assert me["status"] == "confirmed" and me["handle"] == "Blinky_Fan" and me["week"] == 0
    book = c.get("/api/book").get_json()
    assert book["count"] == 1 and book["friends"][0]["handle"] == "Blinky_Fan"


def test_tiers_supporters_and_top(cfg, Session):
    from datetime import date, timedelta
    from radar.book import me, public_book, tier_of
    from radar.db import Event, Friend, FriendDevice
    assert tier_of([60, 60, 60]) == "gold" and tier_of([60, 59, 60]) == "silver" and tier_of([30]) == "silver"
    assert tier_of([10]) == "bronze" and tier_of([9]) == ""
    today = date(2026, 10, 20)
    with Session() as s:
        for i in range(40):
            s.add(Post(id=str(500 + i), author_id=f"au{i}", author_username=f"maker{i}", text="hi", created_at=utcnow()))
        s.add(Post(id="900", author_id="star", author_username="Star_Keeper", text="mine", created_at=utcnow()))
        for key, vid, inv in [("star_keeper", "5" * 32, ""), ("helper", "4" * 32, "star_keeper"), ("pal", "7" * 32, "star_keeper"),
                              ("third", "3" * 32, "star_keeper")]:
            s.add(Friend(key=key, username=key.title(), invited_by=inv))
            s.add(FriendDevice(vid=vid, key=key, username=key, code="PDAAAA", confirmed=True))
        s.add(FriendDevice(vid="4b" * 16, key="helper", username="helper", code="PDBBBB", confirmed=True))   # helper's phone
        for i in range(25):                                                   # helper: 25 people on the computer
            s.add(Event(day=today, vid="4" * 32, kind="open", ref=str(500 + i)))
        for i in range(20, 40):                                               # and 20 on the phone, 5 overlap: 40 in all
            s.add(Event(day=today - timedelta(days=1), vid="4b" * 16, kind="open", ref=str(500 + i)))
        s.add(Event(day=today, vid="4" * 32, kind="open", ref="900"))         # helper opened star's post
        s.add(Event(day=today, vid="7" * 32, kind="open", ref="900"))
        s.add(Event(day=today - timedelta(days=9), vid="3" * 32, kind="open", ref="900"))   # too old for this week
        s.commit()
        book = public_book(s, today)
        helper = next(f for f in book["friends"] if f["handle"] == "Helper")
        assert helper["week"] == 41 and helper["tier"] == "silver"
        assert book["top"][0]["handle"] == "Helper"
        star = me(s, "5" * 32, today)
        assert [x["handle"] for x in star["supporters"]] == ["Helper", "Pal"]
        assert "gatherer" not in star and "invited" not in star                 # no referrals: a friendly book, not a race
        assert me(s, "7" * 32, today)["next"] == {"tier": "bronze", "need": 10}


def test_feed_cards_carry_tier_tags_in_v2(cfg, Session):
    from datetime import timedelta
    from radar.db import Event, Friend, FriendDevice
    today = datetime.now(ZoneInfo(cfg.timezone)).date()
    with Session() as s:
        s.add(Post(id="777", author_id="g", author_username="GoodKeeper", text="gm dragons", created_at=utcnow()))
        for i in range(12):
            s.add(Post(id=str(800 + i), author_id=f"o{i}", author_username=f"o{i}", text="x", created_at=utcnow() - timedelta(days=1)))
            s.add(Event(day=today, vid="g" * 32, kind="open", ref=str(800 + i)))
        s.add(Friend(key="goodkeeper", username="GoodKeeper"))
        s.add(FriendDevice(vid="g" * 32, key="goodkeeper", username="GoodKeeper", code="PDCCCC", confirmed=True))
        s.commit()
    c = v2_client(cfg)
    card = next(p for p in c.get("/api/posts?range=24h").get_json()["posts"] if p["id"] == "777")
    assert card["tier"] == "bronze"
    plain = create_app(cfg).test_client().get("/api/posts?range=24h").get_json()["posts"]
    assert "tier" not in next(p for p in plain if p["id"] == "777")


def test_v2_feed_has_start_here_rally_and_book(cfg, Session):
    page = v2_client(cfg).get("/friends").get_data(as_text=True)
    for bit in ['id="start-here"', 'id="rally"', 'id="book"', 'data-book', 'id="book-ask"', "friends.js", 'id="progress-freeze"', '"v2": true']:
        assert bit in page, bit
    import re
    from pathlib import Path
    script = (Path(__file__).resolve().parents[1] / "radar" / "static" / "friends.js").read_text()
    missing = sorted(i for i in set(re.findall(r'\$\("([\w-]+)"\)', script)) if f'id="{i}"' not in page)
    assert not missing, missing


def test_discord_drop_is_off_until_set_and_posts_once_a_day(cfg, Session):
    from radar.discord_drop import build, run_drop
    now = datetime(2026, 10, 20, 19, 0)
    with Session() as s:
        assert run_drop(s, cfg, now)["reason"] == "off"
        cfg.drop_channel_id, cfg.discord_bot_token, cfg.drop_hour = "123", "tok", 18
        assert run_drop(s, cfg, now.replace(hour=9))["reason"] == "too early"
        assert run_drop(s, cfg, now)["reason"] == "nothing today"
        s.add(Post(id="1", author_id=TEAM_ID, author_username="Pocket_Dragons_", is_team=True, text="news", created_at=utcnow()))
        for i, n in enumerate([5, 9, 2, 7]):
            s.add(Post(id=str(10 + i), author_id=f"k{i}", author_username=f"keeper{i}", text="x", opens=n, created_at=utcnow()))
        s.commit()
        text = build(s, utcnow())
        assert "x.com/Pocket_Dragons_/status/1" in text and text.index("@keeper1") < text.index("@keeper3") < text.index("@keeper0")
        assert "@keeper2" not in text and "pdtools.xyz/friends" in text and " - " not in text
        sent = []

        class R:
            status_code = 200
            text = ""
        out = run_drop(s, cfg, now, post=lambda url, **k: sent.append((url, k["json"])) or R())
        assert out == {"sent": True} and sent[0][0].endswith("/channels/123/messages") and sent[0][1]["allowed_mentions"] == {"parse": []}
        assert run_drop(s, cfg, now, post=lambda *a, **k: R())["reason"] == "already sent today"


def test_audit_fixes_preview_opens_proof_posts_moderation_and_backups(cfg, Session, monkeypatch):
    from radar.db import Event, Friend, FriendDevice
    c = v2_client(cfg)
    a, b = "a" * 32, "b" * 32
    with Session() as s:
        s.add(Post(id="61", author_id="x", author_username="maker", text="gm", created_at=utcnow()))
        s.add(Post(id="62", author_id="y", author_username="signer", text="Signing Blinky's Book of Friends PDAAAA #PocketDragons",
                   created_at=utcnow()))
        s.add(Friend(key="pal", username="Pal"))
        s.add(FriendDevice(vid=a, key="pal", username="Pal", code="PDAAAA", confirmed=True))
        s.commit()
    # preview opens count for the book (popen) but never for the admin habit number
    c.post("/api/open/61", data=json.dumps({"vid": a}), content_type="text/plain")
    with Session() as s:
        assert s.scalars(select(Event.kind)).all() == ["popen"]
    assert c.get(f"/api/book/me?vid={a}").get_json()["week"] == 1
    # signing proof posts never show in the feed
    ids = [p["id"] for p in c.get("/api/posts?range=24h").get_json()["posts"]]
    assert "61" in ids and "62" not in ids
    # backups carry the book name to another device, and the freeze date
    r = c.post("/api/backup", json={"opened": {"61": 1}, "streak": {"last": "2026-10-10", "count": 5, "best": 5, "fz": "2026-10-09"}, "vid": a})
    code = r.get_json()["code"]
    j = c.get(f"/api/backup/{code}?vid={b}").get_json()
    assert j["book"] is True and j["streak"]["fz"] == "2026-10-09" and "book_vid" not in j
    assert c.get(f"/api/book/me?vid={b}").get_json()["handle"] == "Pal"
    # Jon removes a name and blocks it from signing again
    with c.session_transaction() as sess:
        sess["admin"] = True; sess["csrf"] = "t"
    assert "@Pal" in c.get("/admin").get_data(as_text=True)
    c.post("/admin/book", data={"csrf": "t", "handle": "Pal", "block": "1"})
    with Session() as s:
        assert s.get(Friend, "pal") is None and s.get(FriendDevice, a) is None
    out = c.post("/api/book/sign", data=json.dumps({"vid": a, "handle": "pal"}), content_type="text/plain").get_json()
    assert out == {"ok": False, "why": "blocked"}
    page = c.get("/friends").get_data(as_text=True)
    assert "What is Blinky's Book of Friends?" in page and 'id="bm-card"' in page and "Nothing is ever posted for you" in page
    assert "Bring a friend" not in page and "Gatherer" not in page and "?by=" not in page


def test_people_sharing_one_connection_each_count(cfg, Session):
    from radar.db import Event
    app = create_app(cfg)
    with Session() as s:
        s.add(Post(id="4242", author_id="a", author_username="u", text="hi", created_at=utcnow()))
        s.commit()
    c = app.test_client()
    op = lambda vid: c.post("/api/open/4242", data=json.dumps({"vid": vid}), content_type="text/plain").get_json()
    assert op("a" * 32)["opens"] == 1 and op("b" * 32)["opens"] == 2       # two people on the same Wi-Fi
    assert op("a" * 32) == {"counted": False}                                # the same browser again
    for ch in "cde":
        op(ch * 32)
    assert op("f" * 32) == {"counted": False}                                # a 4th browser on one connection is ignored
    with Session() as s:
        assert s.get(Post, "4242").opens == 3
        assert s.scalar(select(func.count()).select_from(Event).where(Event.kind == "open")) == 6   # but every browser's own habit counts


def test_opens_stop_counting_after_50_a_day_and_the_visitor_is_told(cfg, Session):
    from radar.db import Event
    from radar.web import OPENS_PER_DAY
    assert OPENS_PER_DAY == 50
    app = create_app(cfg)
    with Session() as s:
        for i in range(55):
            s.add(Post(id=str(5000 + i), author_id=f"a{i}", author_username=f"u{i}", text="hi", created_at=utcnow()))
        s.commit()
    c = app.test_client()
    import radar.web as _w
    _w.HABIT_GAP_S, gap = 0, _w.HABIT_GAP_S
    try:
        full = []
        for i in range(55):
            r = c.post(f"/api/open/{5000 + i}", data=json.dumps({"vid": "c" * 32}), content_type="text/plain")
            assert r.status_code == 200
            full.append(bool(r.get_json().get("full")))
        # the 50 that count say nothing; every new one past the limit gets the friendly note
        assert full == [False] * 50 + [True] * 5
        # opening one that already counted today is not news
        r = c.post("/api/open/5000", data=json.dumps({"vid": "c" * 32}), content_type="text/plain")
        assert not r.get_json().get("full")
    finally:
        _w.HABIT_GAP_S = gap
    with Session() as s:
        assert s.scalar(select(func.count()).select_from(Event).where(Event.vid == "c" * 32)) == 50
    js = (Path(__file__).parent.parent / "radar" / "static" / "dragons.js").read_text()
    assert "RELIC_DAY = 50" in js and "dex.ed.n >= RELIC_DAY" in js


def test_feed_is_shared_for_a_short_while_and_admin_actions_refresh_it(cfg, Session):
    app = create_app(cfg)
    c = app.test_client()
    with Session() as s:
        s.add(Post(id="7001", author_id="a", author_username="u", text="one", created_at=utcnow()))
        s.commit()
    assert len(c.get("/api/posts").get_json()["posts"]) == 1
    with Session() as s:
        s.add(Post(id="7002", author_id="b", author_username="v", text="two", created_at=utcnow()))
        s.commit()
    assert len(c.get("/api/posts").get_json()["posts"]) == 1          # the same minute: served from memory
    assert len(c.get("/api/posts?who=community").get_json()["posts"]) == 2   # other filters have their own entry
    c.post("/api/report", data="{}", content_type="text/plain")
    c.post("/admin/nope")
    assert len(c.get("/api/posts").get_json()["posts"]) == 1          # strangers cannot empty the cache
    c.post("/api/report", data=json.dumps({"post": "7001", "vid": "a" * 32, "reason": "spam"}), content_type="text/plain")
    assert len(c.get("/api/posts").get_json()["posts"]) == 2          # an accepted report (or admin action) refreshes it
    assert len(c.get("/api/posts?after=2099-01-01T00:00:00&after=").get_json()["posts"]) == 0
    assert len(c.get("/api/posts").get_json()["posts"]) == 2          # a repeated filter never poisons another key


def test_english_readers_get_no_translations_and_others_get_one_pack(cfg, Session):
    c = create_app(cfg).test_client()
    core = c.get("/static/i18n.js").get_data(as_text=True)
    assert len(core.encode()) < 4000 and "Algo se mueve" not in core and "document.write" in core
    es = c.get("/i18n/es.js")
    body = es.get_data(as_text=True)
    assert es.status_code == 200 and "javascript" in es.content_type
    assert "Algo se mueve" in body and "Something stirs" in body and "孵化场" not in body and "MutationObserver" in body
    assert c.get("/i18n/en.js").status_code == 404 and c.get("/i18n/xx.js").status_code == 404
    page = c.get("/friends").get_data(as_text=True)
    assert "fonts.googleapis" not in page and "fonts.css" in page


def test_speed_budget(cfg, Session):
    """pdtools must stay smooth and fast: a new feature that makes pages much heavier fails here first.
    Numbers are compressed sizes, as phones receive them. Raise a budget only on purpose."""
    import gzip
    import re
    c = v2_client(cfg)
    # /friends raised on purpose (120k to 124k): the song picker controls and the dragon book; the picker's
    # list itself (music.js) only loads when someone opens it
    budgets = {"/friends": (132_500, 60_000),   # raised on purpose: the X app note, its move code button and the safe copy for signed Keepers, the audit fixes (dialog focus, phone layout), the v2.1 daily goal steps, then the feed keeping its place (26 Oct)
                "/": (15_000, 40_000), "/friends/keepers": (60_000, 40_000)}
    for path, (code_max, html_max) in budgets.items():
        html = c.get(path).get_data(as_text=True)
        assert "fonts.googleapis" not in html and "fonts.gstatic" not in html, path
        assert len(gzip.compress(html.encode())) < html_max, path
        refs = re.findall(r'(?<![\w-])(?:src|href)="(/static/[^"?]+\.(?:js|css))', html)   # files the page loads (not data-src)
        size = sum(len(gzip.compress(c.get(r).get_data())) for r in refs)
        assert size < code_max, f"{path}: scripts and styles {size} bytes"
    assert len(c.get("/static/i18n.js").get_data()) < 4000
    for lang in ("es", "ru", "zh"):
        assert len(gzip.compress(c.get(f"/i18n/{lang}.js").get_data())) < 47_000, lang   # raised on purpose: the full v2 translations, the lab and error pages, then the dragon book pages and the song picker, then the help page, then the v2.1 welcome lane and Creator of the week, then Wrapped and Dragondle, then Cheers, the sticker shelf and the Hatchery canvas, then the v2.1 daily goal and the Dragondle card looks, then the four sections and the dock, then the nests, the Keeper badge and the wallpaper
    page = c.get("/friends").get_data(as_text=True)
    assert "e_background_removal" not in page            # icons are small stored files, not cut out per view


def test_feed_plays_the_community_playlist(cfg, Session):
    import json as _json
    from pathlib import Path as _P
    songs = _json.loads((_P(__file__).parent.parent / "radar" / "static" / "audio" / "playlist.json").read_text())
    assert songs and all(s["mix"] < s["dur"] and s["src"].startswith("audio/") for s in songs)
    page = create_app(cfg).test_client().get("/friends").get_data(as_text=True)
    assert '"songs": [' in page and "audio/blinky-song.m4a?v=" in page and "Music made by the community" in page
    js = (_P(__file__).parent.parent / "radar" / "static" / "sound.js").read_text()
    assert "mixNext" in js and "setValueCurveAtTime" in js and '"ended"' in js     # crossfades, with a safety net



def test_odd_requests_never_crash(cfg, Session):
    c = create_app(cfg).test_client()
    for path in ("/api/hit", "/api/ev", "/api/report", "/api/feedback", "/api/backup", "/api/keepers/add", "/api/open/5"):
        for body in ("[]", "[1]", "5", "null", '{"handle": 5}', '{"handle": null}', '{"opened": {"1": Infinity}}',
                     '{"dex": {"have": {"ice": {"c": NaN}}}}', '{"opened": {"1": 1e400}}', "not json"):
            r = c.post(path, data=body, content_type="application/json")
            assert r.status_code < 500, (path, body, r.status_code)
    for q in ("range=custom&from=2026-10-01&to=9999-12-31", "range=custom&from=0001-01-01&to=0001-01-02",
              "range=custom&from=nope", "who=team&who=community", "after=bad"):
        assert c.get("/api/posts?" + q).status_code == 200, q
        assert c.get("/friends?" + q).status_code == 200, q


def test_opens_cannot_be_sent_through_the_moments_beacon(cfg, Session):
    from radar.db import Event
    c = create_app(cfg).test_client()
    r = c.post("/api/ev", data=json.dumps({"vid": "a" * 32, "kind": "open", "ref": "1"}), content_type="text/plain")
    assert r.get_json() == {"counted": False}
    with Session() as s:
        assert s.scalar(select(func.count()).select_from(Event)) == 0


def test_spoofed_forwarded_for_does_not_beat_cloudflare_address(cfg, Session):
    c = create_app(cfg).test_client()
    codes = [c.get(f"/api/backup/ABCD-EFGH", headers={"CF-Connecting-IP": "1.2.3.4", "X-Forwarded-For": f"5.6.7.{i}"}).status_code
             for i in range(35)]
    assert 429 in codes



def test_spotlight_rules_against_scripts(cfg, Session, monkeypatch):
    """A script cannot open posts faster than a person, old posts never raise a tier, and reports from one
    connection never hide a post, however many browsers it uses."""
    import radar.web as w
    from radar.db import Event, ReportStatus, Visitor
    monkeypatch.setattr(w, "HABIT_GAP_S", 4)
    with Session() as s:
        for i in range(3):
            s.add(Post(id=str(900 + i), author_id=f"x{i}", author_username=f"x{i}", text="gm", created_at=utcnow()))
        s.add(Post(id="990", author_id="sp", author_username="rival", text="gm", created_at=utcnow()))
        for ch in "abcd":
            s.add(Visitor(vid=ch * 32, days=5))
        s.commit()
    c = create_app(cfg).test_client()
    for i in range(3):
        c.post(f"/api/open/{900 + i}", data=json.dumps({"vid": "a" * 32}), content_type="text/plain")
    with Session() as s:
        assert s.scalar(select(func.count()).select_from(Event).where(Event.vid == "a" * 32)) == 1   # 3 opens in a blink: 1 counted
    for ch in "abcd":                                                      # four browsers, one connection
        c.post("/api/report", data=json.dumps({"post": "990", "vid": ch * 32, "reason": "spam"}), content_type="text/plain")
    with Session() as s:
        assert s.get(Post, "990").hidden is False
    assert c.post("/api/open/1", headers={"Host": "dragon-radar.onrender.com"}).status_code in (403, 400) or not cfg.canonical_host
    assert c.get("/healthz", headers={"CF-Connecting-IP": "1.2.3.4"}).get_json()["via"] == "cf"


def test_my_week_card_opens_only_on_friday_utc(cfg, Session):
    cfg.v2_public = True
    app = create_app(cfg)
    o = app.week_card_open
    utc = timezone.utc
    assert o(datetime(2026, 10, 16, 0, 0, tzinfo=utc))                 # Friday 00:00 UTC: opens
    assert o(datetime(2026, 10, 16, 23, 59, 59, tzinfo=utc))           # all of Friday
    assert not o(datetime(2026, 10, 17, 0, 0, tzinfo=utc))             # Saturday 00:00 UTC: locked again
    assert not o(datetime(2026, 10, 15, 23, 59, 59, tzinfo=utc))       # Thursday night: still locked
    for d in range(10, 16):                                              # Saturday through Thursday
        assert not o(datetime(2026, 10, d, 12, tzinfo=utc))
    # Ghana is UTC, but a Friday in Tokyo is not enough: only the UTC day counts
    tokyo = timezone(timedelta(hours=9))
    assert not o(datetime(2026, 10, 16, 8, 0, tzinfo=tokyo))           # Thursday 23:00 UTC
    page = app.test_client().get("/friends").get_data(as_text=True)
    assert "window.PD_WEEK" in page and "Opens every Friday from 00:00 UTC" in page
    is_fri = datetime.now(utc).weekday() == 4
    assert ("today only" in page) == is_fri and ("opens Friday" in page) == (not is_fri)
    cfg.myweek_always = True
    assert create_app(cfg).week_card_open(datetime(2026, 10, 13, tzinfo=utc))


def test_book_signing_card_is_ready(cfg, Session):
    c = v2_client(cfg)
    page = c.get("/friends").get_data(as_text=True)
    assert 'id="sc-canvas"' in page and "signcard.js" in page and "Your signing card" in page
    assert '<script src="/static/signcard.js' not in page   # loaded only once someone has signed
    js = c.get("/static/signcard.js").get_data(as_text=True)
    assert "sign-cards/sign-" in js and "pdtools.xyz" in js
    for i in range(1, 8):                                   # all 7 backgrounds are offered
        assert f"id: {i}," in js
    assert "avc1" in js                                     # X takes H.264 video, so that is tried first
    font = c.get("/static/fonts/dancing-script-latin-700-normal.woff2")
    assert font.status_code == 200 and len(font.get_data()) > 10_000
    friends = c.get("/static/friends.js").get_data(as_text=True)
    assert "pd:bookme" in friends                           # the book tells the card who signed


def test_signing_card_posts_rotate_and_fit_on_x(cfg, Session):
    import re
    js = v2_client(cfg).get("/static/signcard.js").get_data(as_text=True)
    block = js[js.index("const POSTS = ["):js.index("];", js.index("const POSTS = ["))]
    posts = re.findall(r'^\s+"(.+)",$', block, re.M)
    assert len(posts) == 5                                   # five different words, one picked at random
    assert "Math.random() * POSTS.length" in js and "pd:signPost" in js
    for p in posts:
        assert "pdtools.xyz/friends" in p and "@Pocket_Dragons_" in p and "every" in p
        assert "-" not in p.replace("Pocket_Dragons_", "")   # no dashes in Jon's posts
        assert len(p) < 300


def test_progress_code_carries_todays_goal_count(cfg, Session):
    c = v2_client(cfg)
    j = c.post("/api/backup", json={"opened": {"123": 1}, "streak": {}, "goal": {"day": "2026-10-15", "n": 20}}).get_json()
    back = c.get(f"/api/backup/{j['code']}").get_json()
    assert back["goal"] == {"day": "2026-10-15", "n": 20}
    # nonsense is cleaned, never stored
    j2 = c.post("/api/backup", json={"opened": {"1": 1}, "goal": {"day": "<x>", "n": 1e9}}).get_json()
    assert "goal" not in c.get(f"/api/backup/{j2['code']}").get_json()
    j3 = c.post("/api/backup", json={"opened": {"1": 1}, "goal": {"day": "2026-10-15", "n": 99999}}).get_json()
    assert c.get(f"/api/backup/{j3['code']}").get_json()["goal"]["n"] == 200


def test_lab_preview_and_error_pages_are_translated(cfg, Session):
    """Every sentence on the v2 lab, the preview pill and the error pages has a translation key,
    so these pages follow the visitor's language like the rest of pdtools."""
    import json as _json
    from dataclasses import replace
    src = open("radar/i18n_src.js", encoding="utf-8").read()
    en = src[:src.index("const T = {")]
    def has(text):
        return _json.dumps(text, ensure_ascii=False) in en
    priv = replace(cfg, preview_key="test-key", v2_public=False)
    c = create_app(priv).test_client()
    assert c.get("/lab").status_code == 404                        # hidden until preview is on
    c.get("/preview/test-key")
    lab = c.get("/lab").get_data(as_text=True)
    import re as _re
    texts = set()
    for page in (lab, c.get("/no-such-page").get_data(as_text=True)):
        body = " ".join(_re.findall(r'<section class="panel (?:lab|lost)">.*?</section>|<div class="v2-pill".*?</div>', page, flags=_re.S))
        body = _re.sub(r"<(script|style)\b.*?</\1>", " ", body, flags=_re.S)
        for t in _re.split(r"<[^>]+>", body):
            t = " ".join(t.split()).replace("&#39;", "'").replace("&amp;", "&")
            if len(_re.findall(r"[A-Za-z]{2,}", t)) >= 2:
                texts.add(t)
        for m in _re.findall(r'aria-label="([^"]+)"', body):
            texts.add(m)
    assert "Turn preview off" in texts and "This page wandered off" in texts
    missing = sorted(t for t in texts if not has(t))
    assert not missing, missing
    assert c.get("/no-such-page").status_code == 404
    assert c.get("/api/no-such-thing").get_data(as_text=True) == "This page wandered off"


def test_every_language_pack_is_consistent():
    """A key written twice silently replaces the first one, and a translation that uses a different
    placeholder from the English prints "undefined" (this once broke the dragon card in Russian).
    Every language must have each key once, and use the same placeholders as the English."""
    import re as _re
    from collections import Counter
    src = open("radar/i18n_src.js", encoding="utf-8").read()
    t_at = src.index("const T = {")
    blocks = {"en": src[src.index("const EN = {"):t_at]}
    rest = src[t_at:]
    for lang in _re.findall(r"\n    ([a-z]{2}): \{\n", rest):
        a = rest.index(f"\n    {lang}: {{\n"); blocks[lang] = rest[a:rest.index("\n    },", a)]
    pair = _re.compile(r'(?:^|[\s,{])([A-Za-z][A-Za-z0-9_]*): "((?:[^"\\]|\\.)*)"')
    ph = lambda v: sorted(set(_re.findall(r"\{([nahs])\}", v)))
    en = dict(pair.findall(blocks["en"]))
    assert len(blocks) == 10
    for lang, blk in blocks.items():
        found = pair.findall(blk)
        twice = [k for k, n in Counter(k for k, _ in found).items() if n > 1]
        assert not twice, (lang, twice)
        if lang == "en":
            continue
        for k, v in found:
            assert k in en, (lang, k)
            assert ph(v) == ph(en[k]), (lang, k, en[k], v)


def test_dragon_art_never_hatches_into_a_broken_picture():
    """A failed art load must never be remembered, the egg waits for the art, and no card is drawn without it."""
    js = open("radar/static/dragons.js", encoding="utf-8").read()
    assert "imgCache.delete(key)" in js and "loadOnce" in js
    assert "await untilReady(entry, imgP)" in js and "pic.src = await imgP" not in js
    assert js.count("if (!art) return null;") == 2


def test_gold_progress_says_how_many_weeks_are_done(cfg, Session):
    """60 different Keepers in one week is Gold week 1 of 3, not Gold yet: the book says so plainly."""
    from datetime import date
    from radar.book import me
    from radar.db import Event, Friend, FriendDevice
    today = date(2026, 10, 20)
    with Session() as s:
        for i in range(61):
            s.add(Post(id=str(7000 + i), author_id=f"g{i}", author_username=f"maker{i}", text="hi", created_at=utcnow()))
        s.add(Friend(key="nastya", username="Nastya"))
        s.add(FriendDevice(vid="9" * 32, key="nastya", username="Nastya", code="PDAAAA", confirmed=True))
        for i in range(59):
            s.add(Event(day=today, vid="9" * 32, kind="popen", ref=str(7000 + i)))
        s.commit()
        out = me(s, "9" * 32, today)
        assert out["week"] == 59 and out["next"] == {"tier": "gold", "need": 60} and out["goldRun"] == 0 and out["goldWeeks"] == 3
        s.add(Event(day=today, vid="9" * 32, kind="popen", ref="7059")); s.commit()
        out = me(s, "9" * 32, today)
        assert out["week"] == 60 and out["next"] is None and out["tier"] == "silver" and out["goldRun"] == 1
    js = open("radar/static/friends.js", encoding="utf-8").read()
    assert "Gold week ${me.goldRun} of ${gw} done" in js and "me.full" in js


def test_directory_shows_the_newest_dragon_post_from_any_source(cfg, Session):
    """A Keeper whose newest posts reached the feed through Discord shares (not the search) still shows
    as posting today, not on the day the directory last noted them."""
    from radar.db import Keeper
    now = utcnow()
    with Session() as s:
        s.add(Keeper(key="bugaenkonastya", username="BugaenkoNastya", name="Anastasiya \U0001F409", verified=True, tagged=True,
                     first_seen=now - timedelta(days=9), last_checked=now - timedelta(days=3),
                     last_post_at=now - timedelta(days=3)))
        s.add(Post(id="88001", author_id="u:bugaenkonastya", author_username="BugaenkoNastya", text="dragons",
                   created_at=now - timedelta(hours=2)))
        s.add(Post(id="88002", author_id="u:bugaenkonastya", author_username="BugaenkoNastya", text="hidden one",
                   created_at=now - timedelta(minutes=5), hidden=True))   # a hidden post never counts
        s.commit()
    data = create_app(cfg).test_client().get("/api/keepers").get_json()
    got = next(k for k in data["keepers"] if k["username"] == "BugaenkoNastya")
    assert got["last_post"] == (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    src = open("radar/discord_share.py", encoding="utf-8").read()
    assert "k.last_post_at = made" in src


def test_signed_keeper_gets_a_dragon_book_page(cfg, Session):
    """Only a Keeper who signed the Book of Friends can publish a book page, only a real JPEG is kept,
    and pdtools.xyz/k/<name> shows the picture as its X preview with a way to start your own."""
    import base64
    from radar.db import Friend, FriendDevice
    with Session() as s:
        s.add(Friend(key="bookkeeper", username="BookKeeper"))
        s.add(FriendDevice(vid="b" * 32, key="bookkeeper", username="BookKeeper", code="PDDDDD", confirmed=True))
        s.add(FriendDevice(vid="c" * 32, key="waiting", username="Waiting", code="PDEEEE", confirmed=False))
        s.commit()
    c = v2_client(cfg)
    def fake_jpeg(w, h):   # a JPEG start, one APP0 block, then the frame header that carries the size
        app0 = b"\xff\xe0\x00\x10" + b"JFIF\x00" + b"\x00" * 9
        sof = b"\xff\xc0\x00\x11\x08" + h.to_bytes(2, "big") + w.to_bytes(2, "big") + b"\x03" + b"\x00" * 9
        return b"\xff\xd8" + app0 + sof + b"0" * 200
    jpeg = fake_jpeg(1200, 675)
    other = "data:image/jpeg;base64," + base64.b64encode(fake_jpeg(800, 800)).decode()
    img = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
    post = lambda body: c.post("/api/book/page", data=json.dumps(body), content_type="text/plain")
    assert post({"vid": "c" * 32, "img": img}).status_code == 403                  # not confirmed yet
    assert post({"vid": "d" * 32, "img": img}).status_code == 403                  # never signed
    png = "data:image/jpeg;base64," + base64.b64encode(b"\x89PNG....").decode()
    assert post({"vid": "b" * 32, "img": png}).status_code == 400                  # not a JPEG
    assert post({"vid": "b" * 32, "img": other}).status_code == 400                # not the book picture size
    r = post({"vid": "b" * 32, "img": img, "found": 12, "rare": 99, "legend": 2, "streak": 6}).get_json()
    assert r["ok"] and r["url"] == "https://pdtools.xyz/k/BookKeeper"
    page = c.get("/k/bookkeeper").get_data(as_text=True)
    assert "@BookKeeper&#39;s dragon book" in page or "@BookKeeper's dragon book" in page
    assert "12 of 35 dragons found" in page and "6 day goal streak" in page
    assert 'content="https://pdtools.xyz/k/BookKeeper/book.jpg?v=' in page and "?from=book#dragons" in page
    pic = c.get("/k/BookKeeper/book.jpg")
    assert pic.status_code == 200 and pic.data == jpeg and pic.mimetype == "image/jpeg"
    assert c.get("/k/nobody").status_code == 404 and c.get("/k/waiting").status_code == 404
    assert create_app(cfg).test_client().get("/k/bookkeeper").status_code == 404   # v2 only
    from radar.book import remove
    from radar.db import BookPage
    with Session() as s:                                                      # Jon removes a name: the page goes too
        remove(s, "bookkeeper"); s.commit()
        assert s.get(BookPage, "bookkeeper") is None
    assert c.get("/k/bookkeeper").status_code == 404


def test_week_funnel_counts_each_step(cfg, Session):
    from radar.db import VisitDay
    from radar.events import funnel, record
    today = datetime.now(ZoneInfo(cfg.timezone)).date()
    with Session() as s:
        for v, days in (("1" * 32, 2), ("2" * 32, 1), ("3" * 32, 1)):
            for d in range(days):
                s.add(VisitDay(day=today - timedelta(days=d), vid=v))
        record(s, today, "1" * 32, "open", "5")
        record(s, today, "2" * 32, "open", "5")
        record(s, today, "1" * 32, "goal")
        assert record(s, today, "1" * 32, "hatch", "common") is True
        assert record(s, today, "3" * 32, "arrive", "book") is True
        s.commit()
        f = funnel(s, today)
    assert [x["n"] for x in f["steps"]] == [3, 2, 1, 1, 1] and f["from_book"] == 1


def test_new_keepers_get_a_starter_goal_and_a_nudge():
    js = open("radar/static/app.js", encoding="utf-8").read()
    assert "window.pdGoalNow = goalNow" in js and "Math.round(GOAL / 2)" in js and 'store.get("pd:nudge"' in js
    dragons = open("radar/static/dragons.js", encoding="utf-8").read()
    assert "window.pdGoalNow" in dragons and 'track("hatch", entry.tier)' in dragons


def test_admin_shows_the_week_funnel(client):
    client.post("/admin/login", data={"password": "pw"})
    page = client.get("/admin").get_data(as_text=True)
    assert "The week, step by step" in page and "Hatched an egg" in page and "Came back on another day" in page


def test_safety_headers_and_login_limits(client):
    r = client.get("/friends")
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert "frame-ancestors 'self'" in r.headers["Content-Security-Policy"]
    assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert client.get("/admin/login").headers["Cache-Control"] == "no-store"
    # guesses from many faked addresses still hit the shared limit
    codes = [client.post("/admin/login", data={"password": "nope"}, headers={"CF-Connecting-IP": f"10.0.0.{i}"}).status_code
             for i in range(45)]
    assert codes[0] == 200 and codes[-1] == 429
    assert client.post("/admin/login", data={"password": "pw"}, headers={"CF-Connecting-IP": "10.9.9.9"}).status_code == 429


def test_closed_song_picker_never_blocks_the_page():
    """A closed picker must be truly gone: its full screen layer once stayed invisible on top and ate every tap."""
    js = open("radar/static/music.js", encoding="utf-8").read()
    assert ".mp-wrap[hidden]" in js and "display:none!important" in js and ".mp-wrap:not(.open){pointer-events:none}" in js


def test_ama_library_lists_every_ama_newest_first(cfg, Session):
    from radar.ama import AMAS
    c = create_app(cfg).test_client()
    page = c.get("/friends/ama").get_data(as_text=True)
    order = [page.index(f'id="ama-{a["n"]}"') for a in AMAS]
    assert order == sorted(order) and [a["n"] for a in AMAS] == sorted((a["n"] for a in AMAS), reverse=True)
    for a in AMAS:
        assert f'https://x.com/djsamwithers/status/{a["post"]}' in page
    assert "This library was Ismail's idea." in page and "https://x.com/IsmailHA279" in page
    assert "collecting" not in page.lower()
    assert "Watch the recording on X" in page and "on its way" not in page   # every AMA, including 6, has its recap now
    # live counts show rounded down with a plus, never exact: 216 is 200+, AMA 2 is 100+, the 1,020 peak is 1,000+
    assert "1,020" not in page and "216" not in page and "not shared" not in page
    assert "900+ live" in page and "100+ live" in page and "600+ live" in page and ">1,000</span>+</b> peak live" in page
    assert "AMA Library" in c.get("/").get_data(as_text=True)
    assert 'href="/friends/ama"' in c.get("/friends").get_data(as_text=True)


def test_mailbox_ideas_refresh_and_already_following():
    """Mailbox ideas: a feed refresh button, and Keepers you follow on X can be marked so they stop being suggested."""
    ks = open("radar/static/keepers.js", encoding="utf-8").read()
    assert "Already following" in ks and "function already(k)" in ks
    assert "followed[k.username.toLowerCase()] = 1" in ks          # old timestamp, never trips the pacing note
    assert ".concat(list.filter((k) => followed[" in ks              # followed Keepers sink to the bottom
    app = open("radar/static/app.js", encoding="utf-8").read()
    assert 'rbtn = $("refresh")' in app and "await poll()" in app and "pill.click()" in app
    feed = open("radar/templates/feed.html", encoding="utf-8").read()
    assert 'id="refresh"' in feed
    src = open("radar/i18n_src.js", encoding="utf-8").read()
    for k in ("kAlready:", "fRefresh:", "fRefreshL:", "fCaught:"):
        assert src.count(k) == 10, k


def test_follow_asks_before_marking_followed():
    """Tapping Follow on X no longer marks the Keeper as followed: X cannot tell the site, so the card asks first."""
    ks = open("radar/static/keepers.js", encoding="utf-8").read()
    f = ks[ks.index("function follow(k)"):ks.index("function confirmFollow")]
    assert "pending[" in f and "followed[" not in f
    assert "function confirmFollow(k)" in ks and "function notYet(k)" in ks
    assert "Did you follow?" in ks and "Yes, followed" in ks and "Not yet" in ks
    src = open("radar/i18n_src.js", encoding="utf-8").read()
    for k in ("kAskQ:", "kAskYes:", "kAskNo:"):
        assert src.count(k) == 10, k


def test_weekly_keepers_only_leaves_the_team_out(cfg, Session):
    """Shiv's request: the weekly top posts can leave out every team member (TEAM_ACCOUNTS), not just the official account."""
    now = utcnow()
    with Session() as s:
        s.add_all([
            Post(id="11", author_username="Pocket_Dragons_", text="official", author_id="t", created_at=now - timedelta(minutes=5), is_team=True),
            Post(id="12", author_username="HeartyOfDaCards", text="team member", author_id="h", created_at=now - timedelta(minutes=6)),
            Post(id="13", author_username="tradingjoker", text="team member", author_id="j", created_at=now - timedelta(minutes=7)),
            Post(id="14", author_username="shivo222", text="keeper", author_id="k", created_at=now - timedelta(minutes=8)),
        ])
        s.commit()
    app = create_app(cfg); app.config["TESTING"] = True; c = app.test_client()
    assert set(ids(c.get("/api/posts?range=7d&who=community"))) == {"12", "13", "14"}
    assert ids(c.get("/api/posts?range=7d&who=keepers")) == ["14"]
    for f in ("weekly.js", "weekly2.js"):
        js = open(f"radar/static/{f}", encoding="utf-8").read()
        assert "who=${who}" in js and "pd:weeklyWho" in js and "THE TEAM LEFT OUT" in js
    assert 'data-wkwho="keepers"' in open("radar/templates/feed.html", encoding="utf-8").read()
    assert open("radar/i18n_src.js", encoding="utf-8").read().count("wkKeepers:") == 10


def test_new_dragon_art_reaches_everyone():
    """New art for a dragon (Pink) shows for Keepers who already own it: the sticker is built from the live art version,
    and a shared book page is redrawn because the art versions are part of the book key."""
    dd = open("radar/static/dex-data.js", encoding="utf-8").read()
    assert '"pink-c":"v1792336210"' in dd and '"pink-r":"v1792336214"' in dd
    js = open("radar/static/dragons.js", encoding="utf-8").read()
    assert "artKey()" in js and "D.art[entry.key]" in js


def test_days_strip_lists_each_of_the_last_7_days(cfg, Session):
    """Jon's request: posts not opened on a day stay waiting under that date. /api/days gives each of the last
    7 days its own post ids (newest day first); the page compares them with what this browser opened."""
    now = utcnow()
    midnight = now.replace(hour=0, minute=0, second=1, microsecond=0)     # Africa/Accra is UTC, so this is today
    with Session() as s:
        s.add_all([
            Post(id="21", author_username="a", text="today", author_id="a", created_at=midnight),
            Post(id="22", author_username="b", text="yesterday", author_id="b", created_at=midnight - timedelta(days=1)),
            Post(id="23", author_username="c", text="three days ago", author_id="c", created_at=midnight - timedelta(days=3)),
            Post(id="24", author_username="d", text="too old", author_id="d", created_at=midnight - timedelta(days=8)),
            Post(id="25", author_username="Pocket_Dragons_", text="team", author_id="t", created_at=midnight - timedelta(days=1), is_team=True),
        ])
        s.commit()
    app = create_app(cfg); app.config["TESTING"] = True; c = app.test_client()
    j = c.get("/api/days").get_json()
    assert len(j["days"]) == 7 and j["days"][0]["day"] == j["today"] == midnight.date().isoformat()
    by = {d["day"]: set(d["ids"]) for d in j["days"]}
    assert by[midnight.date().isoformat()] == {"21"}
    assert by[(midnight - timedelta(days=1)).date().isoformat()] == {"22", "25"}
    assert by[(midnight - timedelta(days=3)).date().isoformat()] == {"23"}
    assert "24" not in set().union(*by.values())                          # past 7 days the day drops off the strip
    j = c.get("/api/days?who=community").get_json()
    assert set(j["days"][1]["ids"]) == {"22"}                            # the strip follows the Everyone / Team / Community choice
    # a day opened from the strip is just a one day custom range
    assert ids(c.get(f"/api/posts?range=custom&from={j['days'][3]['day']}&to={j['days'][3]['day']}")) == ["23"]
    js = open("radar/static/app.js", encoding="utf-8").read()
    assert "/api/days?" in js and "function skipDay" in js and "function undoSkip" in js
    assert "it never counts as support" in js                              # marking a day done is a tidy up, not support
    html = open("radar/templates/feed.html", encoding="utf-8").read()
    assert 'id="days-row"' in html and 'id="days-skip"' in html
    assert 'id="hub-catchup"' in open("radar/templates/hub.html", encoding="utf-8").read()
    assert open("radar/i18n_src.js", encoding="utf-8").read().count("daysTitle:") == 10


def test_home_links_to_jons_discord_and_x(cfg, Session):
    """A Keeper's feedback: make Jon's own Discord easy to find. The home page shows a Discord button and an X button."""
    app = create_app(cfg); app.config["TESTING"] = True; html = app.test_client().get("/").get_data(as_text=True)
    assert 'href="https://discord.gg/pxqERbCEk"' in html and "Join my Discord" in html
    assert f'href="https://x.com/{cfg.author_x}"' in html and "Follow on X" in html


def test_feed_warns_inside_the_x_app_and_restore_keeps_the_longer_streak(cfg, Session):
    """A Keeper's progress was split between X's own browser and his phone browser. The feed carries a hidden note
    that app.js shows only inside the X app, and restoring a code keeps the longer streak when both devices were used."""
    app = create_app(cfg); app.config["TESTING"] = True; html = app.test_client().get("/friends").get_data(as_text=True)
    assert 'id="inapp" hidden' in html and 'id="ia-move"' in html and "You are inside the X app" in html
    js = (Path(__file__).parent.parent / "radar" / "static" / "app.js").read_text(encoding="utf-8")
    assert "TwitterAndroid" in js and 's2.last === streak.last' in js and "keep the longer run" in js


def test_help_page_and_whats_new(cfg, Session):
    """A help page with the how to video and the progress questions, linked from the home page What's new card and My tools."""
    app = create_app(cfg); app.config["TESTING"] = True; c = app.test_client()
    html = c.get("/help").get_data(as_text=True)
    assert "help/how-to-open.mp4" in html and 'preload="none"' in html and 'id="move"' in html
    assert "Make my move code" in html and "Is pdtools safe to use?" in html   # the FAQ follows (its progress answers are v2 only)
    assert c.get("/static/help/how-to-open.mp4").status_code == 200
    hub = c.get("/").get_data(as_text=True)
    assert "What's new" in hub and 'href="/help"' in hub and 'href="/help#move"' in hub
    assert 'href="/help"' in c.get("/friends").get_data(as_text=True)


def test_days_strip_matches_each_days_feed(cfg, Session):
    """Speed pass: the strip now uses one light query for the whole week. Each day must still list exactly the
    posts the feed shows for that day, with hidden, blocked and proof posts left out and the quote filter applied."""
    now = utcnow(); midnight = now.replace(hour=0, minute=0, second=1, microsecond=0)
    with Session() as s:
        s.add_all([
            Post(id="31", author_username="a", text="hi", author_id="a", created_at=midnight + timedelta(minutes=1)),
            Post(id="32", author_username="b", text="quote", author_id="b", created_at=midnight - timedelta(days=2), is_quote=True),
            Post(id="33", author_username="c", text="hidden", author_id="c", created_at=midnight - timedelta(days=2), hidden=True),
            Post(id="34", author_username="d", text="blocked", author_id="d", created_at=midnight - timedelta(days=4)),
            Post(id="35", author_username="e", text="Book of Friends PD proof", author_id="e", created_at=midnight - timedelta(days=4)),
            Post(id="36", author_username="f", text="ok", author_id="f", created_at=midnight - timedelta(days=6, hours=-2)),
        ])
        s.add(BlockedAuthor(author_id="d")); s.commit()
    app = create_app(cfg); app.config["TESTING"] = True; c = app.test_client()
    for q in ("", "&quotes=0", "&who=community"):
        j = c.get("/api/days?x=1" + q).get_json()
        for d in j["days"]:
            assert sorted(d["ids"]) == sorted(ids(c.get(f"/api/posts?range=custom&from={d['day']}&to={d['day']}{q}"))), (q, d["day"])
    j = c.get("/api/days?quotes=0").get_json()
    assert "32" not in set().union(*[set(d["ids"]) for d in j["days"]])


def test_feed_starts_fresh_when_a_new_day_begins_with_the_tab_open():
    """A Keeper in Taiwan saw "Daily goal done" the next morning: the phone had kept yesterday's page open.
    The feed now notices a new local day (on return, focus or once a minute) and reloads itself."""
    js = (Path(__file__).parent.parent / "radar" / "static" / "app.js").read_text(encoding="utf-8")
    assert "function newDayCheck()" in js and 'addEventListener("pageshow", newDayCheck)' in js and "setInterval(newDayCheck" in js


def test_dragon_circle_counts_tags_both_ways_and_leaves_the_team_out(cfg, Session):
    """Dragon Circle: who a Keeper tags and who tags them in dragon posts. Two way tags rank first, the team,
    blocked authors, hidden posts and emails never count, and the page, picture and API all answer."""
    now = utcnow()
    with Session() as s:
        s.add_all([
            Post(id="401", author_id="a", author_username="Alice", text="GM @Bob and @carol, also @Pocket_Dragons_", created_at=now),
            Post(id="402", author_id="a", author_username="Alice", text="Hatched with @bob today, mail hello@dave.io", created_at=now),
            Post(id="403", author_id="b", author_username="Bob", text="Thanks @alice!", created_at=now),
            Post(id="404", author_id="e", author_username="Erin", text="@Alice your dragon is cute", created_at=now),
            Post(id="405", author_id="z", author_username="Zed", text="spam @alice", created_at=now),
            Post(id="406", author_id="f", author_username="Fay", text="hidden @alice", created_at=now, hidden=True),
            Post(id="407", author_id="t", author_username="TradingJoker", text="welcome @alice", created_at=now, is_team=True),
        ])
        s.add(BlockedAuthor(author_id="z")); s.commit()
    cfg.v2_public = True; cfg.preview_key = "secret-preview-phrase-123"
    app = create_app(cfg); app.config["TESTING"] = True; c = app.test_client()
    # locked: everyone gets a 404 and no link to it, even with the preview on, until this device is unlocked
    stranger = app.test_client()
    assert stranger.get("/circle").status_code == 404 and stranger.get("/api/circle/alice").status_code == 404
    assert stranger.get("/lab/circle/on").status_code == 404 and 'href="/circle"' not in stranger.get("/").get_data(as_text=True)
    c.get("/preview/secret-preview-phrase-123")
    assert c.get("/circle").status_code == 404 and "pd_circle" not in str(c.get("/").headers)
    r = c.get("/lab/circle/on"); assert r.status_code == 302 and "pd_circle=" in r.headers["Set-Cookie"]
    assert 'href="/circle"' in c.get("/").get_data(as_text=True)
    j = c.get("/api/circle/alice").get_json()
    who = [p["user"] for p in j["people"]]
    assert j["ok"] and j["handle"] == "Alice" and j["posts"] == 2
    assert who[0] == "Bob" and set(who) == {"Bob", "carol", "Erin"}     # Bob: tagged twice and tagged back
    bob = j["people"][0]; assert (bob["out"], bob["in"]) == (2, 1)
    assert not any(u.lower() in ("pocket_dragons_", "tradingjoker", "zed", "fay", "dave") for u in who)
    page = c.get("/circle/alice")
    assert page.status_code == 302 and page.headers["Location"].endswith("/circle/Alice")
    html = c.get("/circle/Alice").get_data(as_text=True)
    assert "@Alice" in html and "Save image" in html and "x.com/intent/post" in html and "/circle/Alice.png?v=" in html
    png = c.get("/circle/Alice.png")
    assert png.status_code == 200 and png.data[:8] == b"\x89PNG\r\n\x1a\n" and png.mimetype == "image/png"
    # the video is made on the Keeper's own device from the same circle
    assert 'id="dc-vid"' in html and "v21/circlevideo.js" in html and 'id="dc-video-data"' in html
    from pathlib import Path
    js = (Path(__file__).parent.parent / "radar" / "static" / "v21" / "circlevideo.js").read_text()
    assert "VideoEncoder" in js and "FPS = 60" in js and "1920" in js
    assert c.get("/api/circle/not a handle").status_code in (400, 404)
    assert "Draw my circle" in c.get("/circle").get_data(as_text=True)
    assert c.get("/circle?h=@Alice").headers["Location"].endswith("/circle/Alice")


def test_dragon_circle_locks_again(cfg, Session):
    cfg.v2_public = True; cfg.preview_key = "secret-preview-phrase-123"
    c = create_app(cfg).test_client()
    c.get("/preview/secret-preview-phrase-123"); c.get("/lab/circle/on")
    assert c.get("/circle").status_code == 200
    c.get("/lab/circle/off")
    assert c.get("/circle").status_code == 404


def test_avatar_heals_a_changed_profile_picture(cfg, Session, monkeypatch):
    """X retires the old picture address when someone changes their picture. The avatar route tries every
    address we know, then looks the Keeper up fresh once and saves the new address for every page."""
    now = utcnow()
    with Session() as s:
        s.add(Post(id="501", author_id="n", author_username="Nastya", text="gm", created_at=now,
                   author_avatar="https://pbs.twimg.com/profile_images/1/old_bigger.jpg"))
        s.commit()
    import requests as rq

    class R:
        def __init__(self, code, body=b"", ctype="image/jpeg"):
            self.status_code, self.content, self.headers = code, body, {"Content-Type": ctype}
    calls = []

    def fake_get(url, **k):
        calls.append(url)
        return R(200, b"\xff\xd8newpic") if "new_bigger" in url else R(404)
    monkeypatch.setattr(rq, "get", fake_get)
    import radar.fxpic as fxp
    monkeypatch.setattr(fxp, "profile", lambda u, http, timeout=8: {"username": u, "profile_image_url": "https://pbs.twimg.com/profile_images/2/new_bigger.jpg"})
    c = create_app(cfg).test_client()
    r = c.get("/api/avatar/Nastya")
    assert r.status_code == 200 and r.data == b"\xff\xd8newpic"
    with Session() as s:
        assert s.get(Post, "501").author_avatar.endswith("new_bigger.jpg")
    n = len(calls); c.get("/api/avatar/Nastya"); assert len(calls) == n      # kept for a day
    big = c.get("/api/avatar/Nastya?s=big")                                    # no 400px picture: falls back to the small one
    assert big.status_code == 200 and big.data == b"\xff\xd8newpic" and calls[-1].endswith("new_400x400.jpg")


def test_dragon_circle_counts_replies_quotes_and_signed_opens(cfg, Session):
    """Replies and quote posts (read free from FxTwitter) count double; opens only count Keepers who signed
    the Book of Friends, never an anonymous browser."""
    from radar.db import Event, FriendDevice, PostLink
    now = utcnow(); today = now.date()
    with Session() as s:
        s.add_all([
            Post(id="601", author_id="j", author_username="Jon", text="my dragon", created_at=now),
            Post(id="602", author_id="r", author_username="Rae", text="so cute", created_at=now),
            Post(id="603", author_id="q", author_username="Quinn", text="look at this", created_at=now),
            PostLink(post_id="602", reply_to="jon", done=True), PostLink(post_id="603", quote_of="jon", done=True),
            FriendDevice(vid="v-ola", key="ola", username="Ola", code="x", confirmed=True),
            FriendDevice(vid="v-anon", key="anon", username="Anon", code="y", confirmed=False),
            Event(day=today, vid="v-ola", kind="open", ref="601"),
            Event(day=today, vid="v-anon", kind="open", ref="601"),
        ])
        s.commit()
        from radar.circle import build
        d = build(s, cfg, "jon")
    who = {p["user"].lower(): p for p in d["people"]}
    assert set(who) == {"rae", "quinn", "ola"}
    assert who["rae"]["got"]["replies"] == 1 and who["quinn"]["got"]["quotes"] == 1 and who["ola"]["got"]["opens"] == 1
    assert who["rae"]["score"] > who["ola"]["score"] and d["engaged"] == 3


def test_signed_keepers_progress_is_kept_safe_and_merged(cfg, Session):
    """A signed Keeper's devices send their progress; it is merged (never replaced) and comes back on a new device,
    while an unsigned browser can neither save nor read anything."""
    from radar.db import FriendDevice
    cfg.v2_public = True
    with Session() as s:
        s.add_all([FriendDevice(vid="a" * 32, key="nacho", username="Nacho", code="x", confirmed=True),
                   FriendDevice(vid="b" * 32, key="nacho", username="Nacho", code="y", confirmed=True)])
        s.commit()
    c = create_app(cfg).test_client()
    phone = {"vid": "a" * 32, "opened": {"111": 1000}, "streak": {"last": "2026-10-21", "count": 5, "best": 5},
             "dex": {"have": {"speed": {"c": 1}, "acid": {"c": 1}}, "n": 2, "g": {"last": "2026-10-21", "count": 5, "best": 5}}}
    assert c.post("/api/book/progress", json=phone).get_json()["ok"]
    laptop = {"vid": "b" * 32, "opened": {"222": 2000}, "streak": {"last": "2026-10-22", "count": 1, "best": 1},
              "dex": {"have": {"ghost": {"r": 1}}, "n": 1, "g": {"last": "2026-10-22", "count": 1, "best": 1}}}
    assert c.post("/api/book/progress", json=laptop).get_json()["ok"]
    back = c.get("/api/book/progress?vid=" + "a" * 32).get_json()
    assert set(back["opened"]) == {"111", "222"}
    assert back["streak"]["count"] == 6 and back["dex"]["g"]["count"] == 6        # the next day carries the run on
    assert set(back["dex"]["have"]) == {"speed", "acid", "ghost"}
    assert c.get("/api/book/progress?vid=" + "z" * 32).get_json()["ok"] is False
    assert c.post("/api/book/progress", json={**phone, "vid": "z" * 32}).get_json()["ok"] is False


def _v21_client(cfg):
    cfg.v2_public = True; cfg.preview_key = "secret-preview-phrase-123"
    app = create_app(cfg); app.config["TESTING"] = True
    c = app.test_client(); c.get("/preview/secret-preview-phrase-123"); c.get("/lab/circle/on")
    return app, c


def test_v21_pages_stay_locked_to_unlocked_devices(cfg, Session):
    """v2.1 is private: the welcome lane, Creator of the week and the picker answer 404 to everyone else,
    even with the v2 preview on, and a stranger can never post a pick."""
    app, c = _v21_client(cfg)
    stranger = app.test_client(); preview_only = app.test_client(); preview_only.get("/preview/secret-preview-phrase-123")
    for who in (stranger, preview_only):
        for path in ("/welcome", "/welcome/Alice", "/welcome/Alice.png", "/api/welcome", "/creator", "/lab/creator", "/creator/2026-10-19.png"):
            assert who.get(path).status_code == 404, path
        assert who.post("/lab/creator/pick", data={"user": "Alice"}).status_code == 404
    assert c.get("/welcome").status_code == 200 and c.get("/creator").status_code == 200 and c.get("/lab/creator").status_code == 200
    assert "Pick this week" in c.get("/lab").get_data(as_text=True)
    assert "Pick this week" not in preview_only.get("/lab").get_data(as_text=True)


def test_welcome_lane_shows_first_posts_waiting_first(cfg, Session, monkeypatch):
    """Only Keepers who shared the official join card ("Keeper of the Ancient Hatchery") for the first time in the
    last three days, the unopened ones first. A first post here without the card, an old card shared again, the team,
    blocked and hidden posts never show, and neither does anyone pdtools already knows as a Keeper: Ember Chamber
    shares in any format, rank or badge posts, or posts long before the card. The welcome card is a real picture."""
    import requests as rq
    monkeypatch.setattr(rq, "get", lambda *a, **k: (_ for _ in ()).throw(rq.RequestException("offline")))
    now = utcnow()
    card = "I asked @Pocket_Dragons_ for nothing in particular and got a Ghost egg.\n\nKeeper of the Ancient Hatchery."
    with Session() as s:
        s.add_all([
            Post(id="701", author_id="n1", author_username="Newbie", author_name="New Bie", text=card, created_at=now - timedelta(hours=5)),
            Post(id="702", author_id="n1", author_username="Newbie", text=card, created_at=now - timedelta(hours=1)),
            Post(id="703", author_id="n2", author_username="Opened", text="keeper of the ancient hatchery 🐉", created_at=now - timedelta(hours=30), opens=4),
            Post(id="704", author_id="old", author_username="Regular", text="gm", created_at=now - timedelta(days=9)),
            Post(id="705", author_id="old", author_username="Regular", text="gm again", created_at=now - timedelta(hours=2)),
            Post(id="709", author_id="fan", author_username="LongFan", text="my first dragon post here!", created_at=now - timedelta(hours=1)),
            Post(id="710", author_id="oc", author_username="OldCard", text=card, created_at=now - timedelta(days=9)),
            Post(id="711", author_id="oc", author_username="OldCard", text=card, created_at=now - timedelta(hours=3)),
            Post(id="712", author_id="lj", author_username="LateJoiner", text="been here ages", created_at=now - timedelta(days=12)),
            Post(id="713", author_id="lj", author_username="LateJoiner", text=card, created_at=now - timedelta(hours=8)),
            Post(id="714", author_id="gm", author_username="Gamer", text="Ember Chamber, night 18. Fire night. My best game tonight reached dawn, 340 Keeper of the Ancient Hatchery.", created_at=now - timedelta(hours=2)),
            Post(id="715", author_id="gm2", author_username="Gamer2", text="Come and play tonight Night 4. Fire night. Blinky Keeper of the Ancient Hatchery.", created_at=now - timedelta(hours=2)),
            # Keepers pdtools already knows are never "new", whatever they post next
            Post(id="716", author_id="vt", author_username="Veteran", text="Ember Chamber, night 16. Egg night. 312 Keeper of the Ancient Hatchery.", created_at=now - timedelta(days=3)),
            Post(id="717", author_id="vt", author_username="Veteran", text=card, created_at=now - timedelta(hours=2)),
            Post(id="718", author_id="rk", author_username="Ranker", text="Ranked #55 among 11,000+ Keepers with 11 badges collected!", created_at=now - timedelta(hours=20)),
            Post(id="719", author_id="rk", author_username="Ranker", text=card, created_at=now - timedelta(hours=2)),
            Post(id="720", author_id="sq", author_username="Squares", text="It's Ember night 17 Fast night 🟨🟨🟨🟧🥚🌅 Keeper of the Ancient Hatchery", created_at=now - timedelta(hours=2)),
            Post(id="721", author_id="eb", author_username="EarlyBird", text="can't wait to join the hatchery tomorrow", created_at=now - timedelta(days=1)),
            Post(id="722", author_id="eb", author_username="EarlyBird", text=card, created_at=now - timedelta(hours=4)),
            Post(id="706", author_id="tm", author_username="TeamPerson", text=card, created_at=now, is_team=True),
            Post(id="707", author_id="bl", author_username="Blocked", text=card, created_at=now),
            Post(id="708", author_id="hd", author_username="Hidden", text=card, created_at=now, hidden=True),
        ])
        s.add(BlockedAuthor(author_id="bl")); s.commit()
        from radar.v21 import welcome_lane
        lane = welcome_lane(s, cfg, now)
    # LateJoiner posted about Pocket Dragons 12 days before the card, so they are not new; EarlyBird's post a day before is fine
    assert [x["user"] for x in lane] == ["Newbie", "EarlyBird", "Opened"]
    newbie = next(x for x in lane if x["user"] == "Newbie")
    assert newbie["id"] == "701" and newbie["waited_h"] == 5 and newbie["opens"] == 0
    app, c = _v21_client(cfg)
    html = c.get("/welcome").get_data(as_text=True)
    assert "Be the first to" in html and "Newbie" in html and "Regular" not in html and "LongFan" not in html and "Gamer" not in html and "pocketdragons.io/creator-kit" in html
    r = c.get("/welcome/newbie"); assert r.status_code == 302 and r.headers["Location"].endswith("/welcome/Newbie")
    page = c.get("/welcome/Newbie").get_data(as_text=True)
    assert "Welcome, <span>@Newbie" in page and "/welcome/Newbie.png" in page
    assert c.get("/welcome/Regular").status_code == 302
    png = c.get("/welcome/Newbie.png"); assert png.status_code == 200 and png.data[:2] == b"\xff\xd8" and png.mimetype == "image/jpeg"
    assert c.get("/welcome/Regular.png").status_code == 404


def test_creator_of_the_week_suggests_and_jon_picks(cfg, Session, monkeypatch):
    """pdtools scores the week (replies and quotes from other Keepers count most), Jon picks on his own device,
    the public page and the card follow the pick, undo takes it back, and recent winners step aside."""
    import requests as rq
    from radar.db import PostLink
    monkeypatch.setattr(rq, "get", lambda *a, **k: (_ for _ in ()).throw(rq.RequestException("offline")))
    now = utcnow()
    with Session() as s:
        s.add_all([
            Post(id="801", author_id="ar", author_username="Artie", author_name="Artie", text="painted Blinky", created_at=now - timedelta(days=1), has_media=True, opens=6),
            Post(id="802", author_id="sp", author_username="Spammy", text="gm", created_at=now - timedelta(days=1), opens=1),
            Post(id="803", author_id="r1", author_username="Rae", text="love it", created_at=now),
            Post(id="804", author_id="r2", author_username="Quinn", text="wow", created_at=now),
            Post(id="805", author_id="ar", author_username="Artie", text="self reply", created_at=now),
            PostLink(post_id="803", reply_to="artie", done=True), PostLink(post_id="804", quote_of="artie", done=True),
            PostLink(post_id="805", reply_to="artie", done=True),
            Post(id="806", author_id="jw", author_username="jonwynnx", text="lots of posts", created_at=now, opens=99),
        ])
        for i in range(12):
            s.add(Post(id=f"9{i:02d}", author_id="sp", author_username="Spammy", text="gm", created_at=now - timedelta(hours=i)))
        s.commit()
        from radar.v21 import creator_stats
        st = creator_stats(s, cfg, now)
    top = st[0]
    assert "jonwynnx" not in [x["user"] for x in st]           # Jon never suggests himself
    assert top["user"] == "Artie" and top["engaged"] == 2 and top["art"] == 1 and top["top"][0]["id"] == "801"
    app, c = _v21_client(cfg)
    assert "Pinky is choosing" in c.get("/creator").get_data(as_text=True)
    lab = c.get("/lab/creator").get_data(as_text=True)
    assert "Pick Artie" in lab and lab.index("Artie") < lab.index("Spammy")
    import re
    tok = re.search(r'name="csrf" value="([0-9a-f]+)"', lab).group(1)
    assert c.post("/lab/creator/pick", data={"user": "artie"}).status_code == 400          # no token, no pick
    assert c.post("/lab/creator/pick", data={"user": "artie", "note": "Painted the cutest Blinky", "csrf": tok}).status_code == 302
    page = c.get("/creator").get_data(as_text=True)
    assert "@Artie" in page and "Painted the cutest Blinky" in page and "Creator of the week" in page and "/creator/" in page
    from radar.v21 import week_start
    wk = week_start(now).date().isoformat()
    png = c.get(f"/creator/{wk}.png"); assert png.status_code == 200 and png.data[:2] == b"\xff\xd8"
    assert "no-store" in png.headers["Cache-Control"] and f"/creator/{wk}.png?u=Artie" in page
    with Session() as s:
        from radar.v21 import suggestions
        assert "Artie" in [x["user"] for x in suggestions(s, cfg, now)]          # this week's own pick stays listed
        assert "Artie" not in [x["user"] for x in suggestions(s, cfg, now + timedelta(days=7))]  # next week it steps aside
    c.post("/lab/creator/undo", data={"csrf": tok})
    assert "Pinky is choosing" in c.get("/creator").get_data(as_text=True)
    assert c.post("/lab/creator/pick", data={"user": "not a handle!", "csrf": tok}).status_code == 400


def test_welcome_lane_hellos_count_in_the_feed():
    """A hello on the welcome lane goes in a small queue the feed reads once, so the goal and streak count it."""
    root = Path(__file__).parent.parent / "radar"
    js = (root / "static" / "app.js").read_text(encoding="utf-8")
    page = (root / "templates" / "welcome.html").read_text(encoding="utf-8")
    assert 'store.obj("pd:creditq")' in js and "credit(id, true)" in js
    assert '"pd:creditq"' in page and "DWELL = 8000" in page


def test_wave2_pages_stay_locked(cfg, Session):
    app, c = _v21_client(cfg)
    stranger = app.test_client()
    for path in ("/wrapped", "/api/wrapped?vid=" + "a" * 32, "/quiz", "/dragondle", "/lab/dragondle"):
        assert stranger.get(path).status_code == 404, path
        assert c.get(path).status_code == (301 if path == "/dragondle" else 200), path
    assert c.get("/dragondle").headers["Location"].endswith("/quiz")          # the old name keeps working
    assert stranger.post("/api/dragondle", json={"vid": "a" * 32, "score": 3, "n": 1}).status_code == 404


def test_dragondle_bank_never_mentions_mint_and_days_are_stable():
    """Mint is for the team only: no question, answer or note may touch it. Every day has five different
    questions, the same for everyone, each with four different answers and exactly one right one."""
    import re
    from datetime import date as _d, timedelta as _td
    from radar.dragondle import BANK, MINT_WORDS, today_set
    assert len(BANK) >= 60
    for b in BANK:
        text = " ".join([b["q"], b["a"], b["why"]] + b["w"]).lower()
        assert not any(re.search(r"\b" + re.escape(w) + r"\b", text) for w in MINT_WORDS), b["q"]
        assert len({b["a"], *b["w"]}) == 4 and b["src"]
    day = _d(2026, 10, 30)
    a, b = today_set(day), today_set(day)
    assert a == b and len({q["q"] for q in a["qs"]}) == 5
    for q in a["qs"]:
        assert 0 <= q["a"] < 4 and len(set(q["opts"])) == 4
    assert today_set(day + _td(days=1))["qs"] != a["qs"]
    # the bank grows in steps, and a day that was already played never changes when questions are added
    from radar.dragondle import EPOCHS, _pick
    assert EPOCHS[-1][1] == len(BANK) and all(size % 5 == 0 for _, size in EPOCHS)
    assert [q["q"] for q in today_set(_d(2026, 10, 24))["qs"]][:2] == ["Which two badges could Keepers earn when onboarding first opened?", "Which day of the week are the AMAs held?"]
    assert [q["q"] for q in today_set(_d(2026, 10, 25))["qs"]][:2] == ["Whose idea was the AMA Library on pdtools?", "Which badge do you earn by adopting the Pocket Dragons server tag on Discord?"]
    first, size = EPOCHS[-1]
    assert len({_pick(n, j) for n in range(first, first + size // 5) for j in range(5)}) == size   # every question gets its turn
    # no question comes back within a whole pass of the bank, even across the pass boundary
    start = _d(2026, 10, 24); per = len(BANK) // 5
    asked = [q["q"] for i in range(per * 3) for q in today_set(start + _td(days=i))["qs"]]
    for i in range(0, len(asked) - 30 + 1, 5):           # nothing is asked twice within six days
        window = asked[i:i + 30]
        assert len(window) == len(set(window)), i


def test_dragondle_scores_count_once_a_day(cfg, Session):
    from radar.dragondle import number
    app, c = _v21_client(cfg)
    n = number(utcnow().date())
    r = c.post("/api/dragondle", data=json.dumps({"vid": "a" * 32, "score": 4, "n": n}), content_type="text/plain").get_json()
    assert r["ok"] and r["total"] == 1 and r["dist"][4] == 1
    c.post("/api/dragondle", data=json.dumps({"vid": "a" * 32, "score": 5, "n": n}), content_type="text/plain")     # a replay never changes it
    r = c.post("/api/dragondle", data=json.dumps({"vid": "b" * 32, "score": 2, "n": n}), content_type="text/plain").get_json()
    assert r["total"] == 2 and r["dist"][4] == 1 and r["dist"][5] == 0 and r["beat"] == 0
    assert c.post("/api/dragondle", data=json.dumps({"vid": "c" * 32, "score": 9, "n": n}), content_type="text/plain").status_code == 400
    assert c.post("/api/dragondle", data=json.dumps({"vid": "c" * 32, "score": 3, "n": n + 1}), content_type="text/plain").status_code == 400


def test_wrapped_tells_a_keepers_month(cfg, Session):
    """My opens, best streak and the Keepers I cheered on most; a signed Keeper also sees opens from other
    signed Keepers on their own posts; plus the hatchery's own month."""
    from datetime import date as _d
    from radar.db import Event, FriendDevice
    me, fan = "a" * 32, "b" * 32
    with Session() as s:
        s.add_all([
            Post(id="901", author_id="x1", author_username="Ola", author_name="Ola", text="dragon", created_at=datetime(2026, 10, 10), opens=5),
            Post(id="902", author_id="x2", author_username="Rae", text="dragon", created_at=datetime(2026, 10, 11), opens=2),
            Post(id="903", author_id="me", author_username="Jojo", text="mine", created_at=datetime(2026, 10, 12), opens=1),
            Event(day=_d(2026, 10, 10), vid=me, kind="open", ref="901"), Event(day=_d(2026, 10, 11), vid=me, kind="open", ref="902"),
            Event(day=_d(2026, 10, 12), vid=me, kind="open", ref="901"), Event(day=_d(2026, 10, 20), vid=me, kind="open", ref="901"),
            Event(day=_d(2026, 10, 12), vid=me, kind="hatch", ref="common"),
            Event(day=_d(2026, 10, 13), vid=fan, kind="open", ref="903"),
            FriendDevice(vid=me, key="jojo", username="Jojo", code="x", confirmed=True),
            FriendDevice(vid=fan, key="ola", username="Ola", code="y", confirmed=True),
        ])
        s.commit()
        from radar.wrapped import story
        st = story(s, cfg, me, 2026, 10, _d(2026, 10, 24))
    m = st["me"]
    assert (m["opens"], m["days"], m["streak"], m["keepers"], m["hatches"]) == (4, 4, 3, 2, 1)
    assert m["top"][0] == {"user": "Ola", "name": "Ola", "n": 3}
    assert st["back"]["opens"] == 1 and st["back"]["top"] == [{"user": "Ola", "n": 1}]
    assert st["hatchery"]["opens"] == 5 and st["hatchery"]["posts"] == 3 and st["so_far"] and st["month"] == "October"
    app, c = _v21_client(cfg)
    assert c.get("/api/wrapped?vid=nope").status_code == 400 and c.get("/api/wrapped?vid=" + me + "&m=2031-01").status_code == 400


def test_cheers_signed_keepers_only_once_a_week(cfg, Session, monkeypatch):
    """Only signed Keepers send, only to Keepers who shared a dragon post, never to themselves or the team,
    once per Keeper per week, kind preset words only. The card and the public page follow."""
    import requests as rq
    from radar.db import FriendDevice
    monkeypatch.setattr(rq, "get", lambda *a, **k: (_ for _ in ()).throw(rq.RequestException("offline")))
    now = utcnow()
    me, anon = "a" * 32, "c" * 32
    with Session() as s:
        s.add_all([
            Post(id="1001", author_id="o", author_username="Ola", text="dragon", created_at=now),
            Post(id="1002", author_id="j", author_username="Jojo", text="mine", created_at=now),
            Post(id="1003", author_id="t", author_username="TeamPerson", text="team", created_at=now, is_team=True),
            FriendDevice(vid=me, key="jojo", username="Jojo", code="x", confirmed=True),
        ])
        s.commit()
    app, c = _v21_client(cfg)
    stranger = app.test_client()
    assert stranger.get("/cheers").status_code == 404 and stranger.post("/api/cheers", json={}).status_code == 404
    post = lambda body: c.post("/api/cheers", data=json.dumps(body), content_type="text/plain")
    assert c.get("/api/cheers/me?vid=" + anon).get_json()["signed"] is False
    assert post({"vid": anon, "to": "Ola", "preset": 0}).get_json()["why"] == "unsigned"
    assert post({"vid": me, "to": "Nobody", "preset": 0}).get_json()["why"] == "unknown"
    assert post({"vid": me, "to": "jojo", "preset": 0}).get_json()["why"] == "self"
    assert post({"vid": me, "to": "TeamPerson", "preset": 0}).get_json()["why"] == "unknown"
    assert post({"vid": me, "to": "ola", "preset": 99}).get_json()["why"] == "preset"
    r = post({"vid": me, "to": "ola", "preset": 1}).get_json()
    assert r["ok"] and r["to"] == "Ola"
    assert post({"vid": me, "to": "Ola", "preset": 2}).get_json()["why"] == "already"
    mine = c.get("/api/cheers/me?vid=" + me).get_json()
    assert mine["signed"] and mine["sent"] == [{"user": "Ola", "line": "Your art made my day"}] and mine["left"] == 9
    assert c.get("/api/cheers/find?q=ol").get_json()["people"][0]["user"] == "Ola"
    assert "TeamPerson" not in str(c.get("/api/cheers/find?q=team").get_json())
    page = c.get("/cheers/ola"); assert page.status_code == 302 and page.headers["Location"].endswith("/cheers/Ola")
    html = c.get("/cheers/Ola").get_data(as_text=True)
    assert "@Jojo" in html and "Your art made my day" in html and "/cheers/Ola.png?v=" in html
    png = c.get("/cheers/Ola.png"); assert png.status_code == 200 and png.data[:2] == b"\xff\xd8"
    assert c.post("/api/cheers", data='{"vid": "%s", "to": "Ola", "preset": 1e999}' % me, content_type="text/plain").status_code == 400
    assert c.post("/api/cheers", data=json.dumps({"vid": me, "to": "Ola", "preset": True}), content_type="text/plain").status_code == 400
    assert c.get("/api/cheers/find?q=o_").get_json()["people"] == []          # _ is a letter here, not a wildcard
    assert mine["card"] is True


def test_sticker_shelf_serves_png_for_every_sticker(cfg, Session):
    """Every shelf sticker exists in both kinds, the page lists them, PNGs come out for saving, and odd names 404."""
    from radar.stickers import STICKERS
    root = Path(__file__).parent.parent / "radar" / "static" / "v21" / "stickers"
    for k, *_ in STICKERS:
        assert (root / f"st-{k}.webp").exists() and (root / f"st-{k}-w.webp").exists(), k
    app, c = _v21_client(cfg)
    assert app.test_client().get("/stickers").status_code == 404
    html = c.get("/stickers").get_data(as_text=True)
    assert html.count('class="tile"') == 2 * len(STICKERS) and "never for sale" in html
    for name in ("p-wave", "p-wave-w", "b-gm-w"):
        r = c.get(f"/stickers/{name}.png")
        assert r.status_code == 200 and r.data[:8] == b"\x89PNG\r\n\x1a\n", name
    for bad in ("nope", "p-wave-w-w", "..%2Fsecret"):
        assert c.get(f"/stickers/{bad}.png").status_code == 404


def test_hatchery_canvas_lists_stickers_and_props(cfg, Session):
    """The canvas is locked, lists every sticker in both kinds and every extra, and all its art files exist."""
    from radar.stickers import PROPS, STICKERS
    root = Path(__file__).parent.parent / "radar" / "static" / "v21"
    for k, *_ in PROPS:
        assert (root / "props" / f"prop-{k}.webp").exists(), k
    for f in ("canvas-a.jpg", "canvas-a-s.jpg", "canvas-b.jpg", "canvas-b-s.jpg"):
        assert (root / f).exists(), f
    app, c = _v21_client(cfg)
    assert app.test_client().get("/canvas").status_code == 404
    html = c.get("/canvas").get_data(as_text=True)
    assert html.count('data-kind="st"') == 2 * len(STICKERS) and html.count('data-kind="pr"') == len(PROPS)
    assert "Jon Wynn" not in html.split("<footer")[0]           # the card and the island carry only the pdtools stamp


def test_avatar_big_asks_x_for_the_400px_picture(cfg, Session, monkeypatch):
    """Share cards and the canvas ask for ?s=big: the 400 by 400 picture from X's image host, kept apart from the small one."""
    with Session() as s:
        s.add(Post(id="502", author_id="m", author_username="Mira", text="gm", created_at=utcnow(),
                   author_avatar="https://pbs.twimg.com/profile_images/3/me_bigger.png"))
        s.commit()
    import requests as rq

    class R:
        def __init__(self, code, body=b"", ctype="image/png"):
            self.status_code, self.content, self.headers = code, body, {"Content-Type": ctype}
    calls = []

    def fake_get(url, **k):
        calls.append(url)
        return R(200, b"BIG" if "_400x400." in url else b"small")
    monkeypatch.setattr(rq, "get", fake_get)
    c = create_app(cfg).test_client()
    assert c.get("/api/avatar/Mira").data == b"small"
    assert c.get("/api/avatar/Mira?s=big").data == b"BIG"
    assert calls[-1] == "https://pbs.twimg.com/profile_images/3/me_400x400.png"
    n = len(calls); c.get("/api/avatar/Mira?s=big"); c.get("/api/avatar/Mira"); assert len(calls) == n   # both kept for a day


def test_v21_launch_switch_opens_tools_and_shares_cards(cfg, Session):
    """V21_PUBLIC=1 is launch day: every v2.1 tool opens to everyone and cards may be kept by shared caches,
    while the Dragon Circle stays locked. Before that, strangers get 404 and cards stay private."""
    cfg.v2_public = True
    locked = create_app(cfg).test_client()
    for path in ("/welcome", "/creator", "/wrapped", "/quiz", "/cheers", "/stickers", "/canvas"):
        assert locked.get(path).status_code == 404, path
    cfg.v21_public = True
    c = create_app(cfg).test_client()
    for path in ("/welcome", "/creator", "/wrapped", "/quiz", "/cheers", "/stickers", "/canvas"):
        assert c.get(path).status_code == 200, path
    assert c.get("/stickers/p-wave.png").headers["Cache-Control"].startswith("public")
    assert c.get("/circle").status_code == 404                       # the Circle keeps its own lock


def test_new_tools_row_shows_only_when_v21_is_open(cfg, Session):
    """The home page sections (Feed, Community, Learn, Create, which replaced the "New in pdtools" row) and the Blinky's Friends menu group appear on unlocked devices and,
    after launch, for everyone; before launch nobody else sees a hint of them."""
    cfg.v2_public = True
    assert 'class="nests"' not in create_app(cfg).test_client().get("/").get_data(as_text=True)
    app, c = _v21_client(cfg)
    html = c.get("/").get_data(as_text=True)
    assert 'class="nests"' in html and html.count('class="nst reveal"') == 4
    assert 'id="side-new-btn"' in c.get("/friends").get_data(as_text=True)
    cfg.v21_public = True
    open_c = create_app(cfg).test_client()
    assert 'class="nests"' in open_c.get("/").get_data(as_text=True)
    assert 'id="side-new-btn"' in open_c.get("/friends").get_data(as_text=True)


def test_dragondle_bank_is_translated_item_for_item(cfg, Session):
    """Every site language has every question, with the right answer staying the right answer after the
    shuffle, and no dashes in the translated text."""
    from datetime import date, timedelta
    from radar.dragondle import BANK, _translations, today_set
    tr = _translations()
    assert set(tr) == {"es", "fr", "pt", "tr", "ru", "vi", "id", "ko", "zh"}
    for lang, rows in tr.items():
        assert len(rows) == len(BANK), lang
        for r in rows:
            assert len(r["w"]) == 3 and len({r["a"], *r["w"]}) == 4, (lang, r["q"])
            assert not any(d in " ".join([r["q"], r["a"], r["why"], *r["w"]]) for d in ("—", "–", " - ")), (lang, r["q"])
    for d in range(14):
        game = today_set(date(2026, 10, 24) + timedelta(days=d))
        for q in game["qs"]:
            k = next(i for i, e in enumerate(BANK) if e["q"] == q["q"])
            assert q["opts"][q["a"]] == BANK[k]["a"]
            for lang, t in q["tr"].items():
                assert t["opts"][q["a"]] == tr[lang][k]["a"] and sorted(t["opts"]) == sorted([tr[lang][k]["a"], *tr[lang][k]["w"]])


def test_audit_fixes_server(cfg, Session):
    """Jon's lab tools stay locked after launch, odd numbers are turned away instead of crashing, avatar
    lookups take only real handles, and locked v2.1 answers are never kept by shared caches."""
    cfg.v2_public = True
    app, c = _v21_client(cfg)
    r = c.get("/welcome")
    assert r.status_code == 200 and "no-store" in r.headers["Cache-Control"] and "Cookie" in r.headers.get("Vary", "")
    cfg.v21_public = True
    stranger = create_app(cfg).test_client()
    for path in ("/lab/creator", "/lab/dragondle"):
        assert stranger.get(path).status_code == 404, path
    assert stranger.post("/lab/creator/pick", data={"user": "EvilGuy"}).status_code == 404
    assert stranger.post("/lab/creator/undo").status_code == 404
    assert stranger.get("/welcome").status_code == 200
    raw = '{"vid":"' + "a" * 32 + '","score":1e400,"n":1}'
    assert stranger.post("/api/dragondle", data=raw, content_type="application/json").status_code == 400
    assert stranger.post("/api/dragondle", json={"vid": "a" * 32, "score": 2.5, "n": 1}).status_code == 400
    assert stranger.get("/api/wrapped?vid=" + "a" * 32 + "&m=99999999999999999999-1").status_code == 400
    assert stranger.get("/api/avatar/" + "x" * 200).status_code == 404
    assert stranger.get("/api/avatar/bad%20name").status_code == 404
    r = stranger.post("/api/feedback", data='{"rating":1e999}', content_type="application/json")
    assert r.status_code in (400, 429)


def test_welcome_keepsake_cards(cfg, Session, monkeypatch):
    """A Keeper who just joined gets a relic-style welcome card as a real JPEG (and a small one for link previews),
    only signed Keepers are named as the welcomer (never a name typed into the link), and strangers get 404."""
    import requests as rq
    from radar.db import FriendDevice
    from PIL import Image
    import io
    monkeypatch.setattr(rq, "get", lambda *a, **k: (_ for _ in ()).throw(rq.RequestException("offline")))
    now = utcnow()
    with Session() as s:
        s.add(Post(id="801", author_id="k1", author_username="FreshOne", text="The incubator said PANDA. Keeper of the Ancient Hatchery.", created_at=now - timedelta(hours=2)))
        s.add(FriendDevice(vid="c" * 32, key="helper", username="Helper", code="z", confirmed=True))
        s.commit()
    app, c = _v21_client(cfg)
    r = c.get("/welcome/FreshOne/card.jpg?vid=" + "c" * 32)
    assert r.status_code == 200 and r.data[:2] == b"\xff\xd8"
    assert Image.open(io.BytesIO(r.data)).size == (2400, 1350)
    r = c.get("/welcome/FreshOne.png")
    assert r.status_code == 200 and Image.open(io.BytesIO(r.data)).size == (1200, 675)
    assert c.get("/welcome/FreshOne/card/holo.jpg").status_code == 404
    assert c.get("/welcome/Nobody/card.jpg").status_code == 404
    from radar import welcome_cards
    assert c.get("/welcome/FreshOne/card.jpg?style=holo").status_code == 404
    seen = {}
    def fake(av, user, name, joined, by=None, small=False, style="dusk"):
        seen.update(by=by, style=style); return b"\xff\xd8x"
    real = welcome_cards.card
    monkeypatch.setattr(welcome_cards, "card", fake)
    c.get("/welcome/FreshOne/card.jpg?style=feast&vid=" + "d" * 32 + "&by=Elon")
    assert seen.get("by") is None and seen.get("style") == "feast"   # an unsigned browser is never named, whatever the link says
    monkeypatch.setattr(welcome_cards, "card", real)
    for look in [x for x in welcome_cards.STYLES if x != "feast"]:   # five looks, each a real card with its own picker thumbnail
        r = c.get(f"/welcome/FreshOne/card.jpg?style={look}")
        assert r.status_code == 200 and Image.open(io.BytesIO(r.data)).size == (2400, 1350)
        assert (Path(welcome_cards.__file__).parent / "static" / "v21" / f"wthumb-{look}.webp").exists()
    page = c.get("/welcome").get_data(as_text=True)
    assert page.count("data-look=") == 5
    reqs = (Path(welcome_cards.__file__).parent.parent / "requirements.txt").read_text().lower()
    if "numpy" not in reqs:                                # the server has no numpy, so the card code must never need it
        assert "numpy" not in Path(welcome_cards.__file__).read_text()


def test_circle_links_to_cheers_and_wrapped_only_where_unlocked(cfg, Session):
    """The Circle draws sparks for each way a Keeper engages, offers a lantern for each Keeper (Cheers) and keeps
    "Open on X" on its own id. Wrapped shows the Circle slide only to devices where the Circle is open, so the
    public launch never links to the locked Circle."""
    now = utcnow()
    with Session() as s:
        s.add_all([Post(id="501", author_id="a", author_username="Alice", text="GM @Bob", created_at=now),
                   Post(id="502", author_id="b", author_username="Bob", text="thanks @Alice", created_at=now)])
        s.commit()
    app, c = _v21_client(cfg)
    page = c.get("/circle/Alice").get_data(as_text=True)
    assert 'class="sp in' in page and 'class="sp out' in page and 'id="dc-card-lantern"' in page
    assert page.count('id="dc-card-go"') == 1 and 'id="dc-card-x-link"' in page
    assert "const CIRCLE = true;" in c.get("/wrapped").get_data(as_text=True)
    cfg.v21_public = True
    public = app.test_client()
    assert "const CIRCLE = false;" in public.get("/wrapped").get_data(as_text=True)
    assert public.get("/api/circle/Alice").status_code == 404


def test_daily_goal_mix_with_v21(cfg, Session):
    """With v2.1 open the daily goal is one percentage: 10 Keeper posts, today's Dragondle and one new follow.
    Without it the feed keeps the 20 post goal. The Dragondle question about the goal says 10, the start date the
    feed uses is Dragondle #1, and the two new steps survive a sync from either device."""
    import json as _json, re as _re
    from radar import cloudsave
    from radar.dragondle import BANK, START
    app, c = _v21_client(cfg)
    page = c.get("/friends").get_data(as_text=True)
    data = _json.loads(_re.search(r'<script id="radar-data" type="application/json">(.*?)</script>', page, _re.S).group(1))
    assert data["goal_rule"] == "mix" and data["goal"] == 10 and data["dle_start"] == START.isoformat()
    assert "Daily goal 0%" in page and "Finish the daily goal to hatch" in page
    plain = app.test_client(); plain.get("/preview/secret-preview-phrase-123")
    data2 = _json.loads(_re.search(r'<script id="radar-data" type="application/json">(.*?)</script>', plain.get("/friends").get_data(as_text=True), _re.S).group(1))
    assert data2["goal_rule"] == "keeper" and data2["goal"] == 20
    q = next(q for q in BANK if "daily goal" in q["q"])
    assert q["a"] == "10"
    merged = cloudsave.merge({"goal": {"day": "2026-10-25", "n": 3, "d": True}}, {"goal": {"day": "2026-10-25", "n": 7, "f": True}})
    assert merged["goal"] == {"day": "2026-10-25", "n": 7, "d": True, "f": True}


def test_dragondle_cards_and_gif(cfg, Session):
    """The result screen offers six card looks, and the animated one is a real looping GIF painted from right or wrong
    per question only. Bad input gets a 404, and the GIF stays behind the v2.1 lock."""
    from PIL import Image
    import io
    app, c = _v21_client(cfg)
    page = c.get("/quiz").get_data(as_text=True)
    for look in ("classic", "hatch", "gif", "report", "stars", "polaroid"):
        assert f'data-card="{look}"' in page
    assert "v21/dlecards.js" in page
    r = c.get("/dragondle/card.gif?n=2&m=10110&st=3")
    assert r.status_code == 200 and r.mimetype == "image/gif" and r.data[:3] == b"GIF"
    im = Image.open(io.BytesIO(r.data))
    assert im.size == (800, 450) and im.n_frames > 30
    assert len(r.data) < 2_500_000
    for bad in ("n=2&m=1011&st=3", "n=x&m=10110&st=3", "n=2&m=10210&st=3", "n=2&m=10110&st=-1"):
        assert c.get("/dragondle/card.gif?" + bad).status_code == 404, bad
    stranger = app.test_client()
    assert stranger.get("/dragondle/card.gif?n=2&m=10110&st=3").status_code == 404
    # from Dragon Quiz #3 each digit is the try it was solved on (1 to 3, 0 missed), at the new address
    r = c.get("/quiz/card.gif?n=3&m=12301&st=2")
    assert r.status_code == 200 and r.data[:3] == b"GIF"
    assert c.get("/quiz/card.gif?n=3&m=12401&st=2").status_code == 404 and c.get("/quiz/card.gif?n=2&m=12301&st=2").status_code == 404


def test_tester_bar_walks_testers_through_every_tool(cfg, Session):
    """Unlocked testers get one small bar on each tool to test: the step number, a tick, the next tool, and a list
    of all ten. Unlocking starts them at step 1. Strangers never see it, and it goes away when v2.1 opens."""
    app, c = _v21_client(cfg)
    r = c.get("/lab/circle/on"); assert r.status_code == 302 and r.headers["Location"].endswith("/welcome")
    order = ["/welcome", "/creator", "/wrapped", "/quiz", "/cheers", "/stickers", "/canvas", "/wallpaper", "/circle", "/friends"]
    for i, path in enumerate(order):
        page = c.get(path).get_data(as_text=True)
        assert 'id="tbar"' in page, path
        assert f'<span id="tb-count">{i + 1}</span> of 10' in page, path
        if i + 1 < len(order):
            assert f'class="tb-next" href="{order[i + 1]}"' in page, path
        else:
            assert "Report" in page
    assert 'id="tbar"' not in c.get("/").get_data(as_text=True) and 'id="tbar"' not in c.get("/friends/keepers").get_data(as_text=True)
    plain = app.test_client(); plain.get("/preview/secret-preview-phrase-123")
    assert 'id="tbar"' not in plain.get("/friends").get_data(as_text=True)
    cfg.v21_public = True
    assert 'id="tbar"' not in c.get("/welcome").get_data(as_text=True)


def test_wrapped_offers_a_video_next_to_the_card(cfg, Session):
    """Wrapped can also be saved as a short video, made on the Keeper's own device. The button starts hidden and only
    shows where the browser can record H.264 MP4 (X refuses other video), and the still card always stays."""
    from pathlib import Path
    app, c = _v21_client(cfg)
    page = c.get("/wrapped").get_data(as_text=True)
    assert "v21/wrapvideo.js" in page and 'id="save-vid" type="button" hidden' in page and 'id="save" type="button">Save the card' in page
    js = (Path(__file__).parent.parent / "radar" / "static" / "v21" / "wrapvideo.js").read_text()
    assert "avc1" in js and "VideoEncoder" in js and "captureStream" in js and "video/webm" not in js
    # the MP4 packer is fetched only when a Keeper asks for a video, so the page stays light
    assert "v21/mp4-muxer.min.js" in page and '<script src="/static/v21/mp4-muxer.min.js' not in page
    assert (Path(__file__).parent.parent / "radar" / "static" / "v21" / "mp4-muxer.min.js").read_text().startswith("/*! mp4-muxer")


def test_every_dragon_has_a_clean_cutout_for_wrapped():
    """Wrapped shows dragons without their grey card background: every species and finish in the dex art list has
    its own transparent cut out on pdtools, and Wrapped uses those."""
    import re
    from pathlib import Path
    from PIL import Image
    static = Path(__file__).parent.parent / "radar" / "static"
    keys = set(re.findall(r'"([a-z]+-[crl])"\s*:\s*"v\d+"', (static / "dex-data.js").read_text()))
    assert len(keys) >= 35
    for k in keys:
        f = static / "v21" / "dex-cut" / f"{k}.webp"
        assert f.exists(), k
        im = Image.open(f)
        assert im.mode == "RGBA" and im.getpixel((2, 2))[3] == 0, k          # the corner is see-through


def test_dragon_quiz_three_tries_and_fifteen_points(cfg, Session):
    """The quiz is now the Dragon Quiz at /quiz. From #3 every question gets three tries (3, 2 or 1 points, 0 if
    missed), so a day scores out of 15; days 1 and 2 keep their old score out of 5. The API takes scores up to the
    day's own maximum and the results come back for every possible score."""
    import json as _json
    from datetime import timedelta as _td
    from radar.dragondle import START, max_score, today_set, uses_tries
    assert not uses_tries(2) and uses_tries(3) and max_score(2) == 5 and max_score(3) == 15
    g2, g3 = today_set(START + _td(days=1)), today_set(START + _td(days=2))
    assert (g2["tries"], g2["max"], g3["tries"], g3["max"]) == (1, 5, 3, 15)
    app, c = _v21_client(cfg)
    page = c.get("/quiz").get_data(as_text=True)
    assert "Dragon Quiz #" in page and "Dragondle" not in page
    from radar import web as _w
    import radar.dragondle as dle
    real = _w.utcnow
    try:
        _w.utcnow = lambda: real().replace(year=2026, month=10, day=26, hour=12)     # Dragon Quiz #3
        ok = c.post("/api/dragondle", data=_json.dumps({"vid": "a" * 32, "score": 13, "n": 3}), content_type="text/plain").get_json()
        assert ok["ok"] and ok["max"] == 15 and len(ok["dist"]) == 16 and ok["dist"][13] == 1
        assert c.post("/api/dragondle", data=_json.dumps({"vid": "b" * 32, "score": 16, "n": 3}), content_type="text/plain").status_code == 400
        assert "Three tries a question" in c.get("/quiz").get_data(as_text=True)
    finally:
        _w.utcnow = real


def test_four_sections_group_the_tools_with_one_dock_everywhere(cfg, Session):
    """pdtools is grouped into Feed, Community, Learn and Create. Each section has a home page with its tools side by
    side, one dock at the bottom of every page shows the sections and the tabs of the one you are in, and the hub
    shows the four sections. The section pages stay locked like the rest of v2.1, and old links keep working."""
    from radar.v21 import nav_for
    app, c = _v21_client(cfg)
    plain = app.test_client()
    for path in ("/community", "/learn", "/create"):
        assert plain.get(path).status_code == 404, path
    c.get("/lab/circle/on")
    n = nav_for("/friends/keepers", True, True)
    assert [s["key"] for s in n["sections"]] == ["feed", "community", "learn", "create"]
    assert n["cur"] == "community" and n["tab"] == "keepers"
    assert nav_for("/quiz", True, False)["cur"] == "learn" and nav_for("/quiz", True, False)["tab"] == "quiz"
    assert nav_for("/friends", True, False)["tab"] == "friends"
    assert "circle" not in [t["key"] for s in nav_for("/", True, False)["sections"] for t in s["tabs"]]
    # without v2.1 only the tools that already exist show
    old = nav_for("/", False, False)
    assert all(t["key"] in ("friends", "progress", "keepers", "ama", "help") for s in old["sections"] for t in s["tabs"])
    for path, names in (("/community", ["Keepers", "Welcome lane", "Creator of the week", "Cheers", "Dragon Circle"]),
                        ("/learn", ["Dragon Quiz", "AMA Library", "Help and guides"]),
                        ("/create", ["Sticker shelf", "Hatchery canvas", "Hatchery Wrapped", "My Hatchery wallpaper"])):
        page = c.get(path).get_data(as_text=True)
        assert all(f"<b>{x}</b>" in page for x in names), path
        assert 'class="pdnav"' in page
    for path in ("/friends", "/friends/keepers", "/quiz", "/welcome", "/stickers", "/circle", "/friends/ama", "/"):
        page = c.get(path).get_data(as_text=True)
        assert 'class="pdnav"' in page, path
    quiz = c.get("/quiz").get_data(as_text=True)
    assert 'href="/learn"' in quiz and 'href="/friends/ama"' in quiz and 'href="/help"' in quiz
    hub = c.get("/").get_data(as_text=True)
    assert 'class="nests"' in hub and 'class="newtools"' not in hub
    # before launch, strangers keep the old hub and no dock
    home = plain.get("/").get_data(as_text=True)
    assert 'class="nests"' not in home and 'class="pdnav"' not in home and 'class="tools"' in home
    assert c.get("/dragondle").status_code == 301


def test_my_hatchery_wallpaper_puts_the_keepers_dragons_in_a_phone_scene(cfg, Session):
    """The wallpaper is drawn on the Keeper's device from six scenes made for it, with their own hatched dragons and,
    once they signed Blinky's Book of Friends, their X name. Locked like the rest of v2.1 until launch."""
    from pathlib import Path
    app, c = _v21_client(cfg)
    assert app.test_client().get("/wallpaper").status_code == 404
    page = c.get("/wallpaper").get_data(as_text=True)
    for k in ("glow", "lake", "sunflower", "pond", "blossom", "shore", "autumn", "lavender", "kite", "oasis", "falls"):
        assert f'data-sc="{k}"' in page
        for v in ("", "-m", "-t"):
            assert (Path(__file__).parent.parent / "radar" / "static" / "v21" / "wall" / f"{k}{v}.jpg").is_file(), k + v
    assert 'value="1290x2796"' in page and 'value="1080x2400"' in page and "pd:dex" in page and "pdMe" in page
    assert 'class="pdnav"' in page and 'id="pd-me"' in page


def test_keeper_badge_and_four_nests(cfg, Session):
    """The dock carries a Keeper badge that shows who signed on this device (or invites them to sign), and the home
    page shows the four sections as nests, each with its own egg art and the tools that rise out of it."""
    from pathlib import Path
    app, c = _v21_client(cfg)
    c.get("/lab/circle/on")
    hub = c.get("/").get_data(as_text=True)
    for k in ("feed", "community", "learn", "create"):
        assert f'v21/nest/{k}.webp' in hub
        assert (Path(__file__).parent.parent / "radar" / "static" / "v21" / "nest" / f"{k}.webp").is_file()
    assert hub.count('class="nst reveal"') == 4 and 'href="/wallpaper"' in hub
    page = c.get("/quiz").get_data(as_text=True)
    assert 'id="pd-me"' in page and 'href="/friends#book"' in page and "/api/book/me" in page


def test_launch_switches_open_everything_but_jons_own_tools(cfg, Session):
    """Launch day: V21_PUBLIC=1 and CIRCLE_PUBLIC=1 open every tool, the Dragon Circle included, to everyone with no
    tester bar. Jon's own picking tools stay locked to his unlocked devices."""
    from radar.web import create_app
    cfg.v2_public = True
    stranger = create_app(cfg).test_client()
    assert stranger.get("/circle").status_code == 404 and stranger.get("/wallpaper").status_code == 404
    cfg.v21_public = True
    cfg.circle_public = True
    stranger = create_app(cfg).test_client()
    for path in ("/", "/welcome", "/creator", "/wrapped", "/quiz", "/cheers", "/stickers", "/canvas", "/wallpaper",
                 "/community", "/learn", "/create", "/circle"):
        r = stranger.get(path)
        assert r.status_code == 200, path
        assert 'id="tbar"' not in r.get_data(as_text=True), path
    assert 'href="/circle"' in stranger.get("/community").get_data(as_text=True)
    assert stranger.get("/lab/creator").status_code == 404 and stranger.get("/lab/dragondle").status_code == 404


def test_dragon_circle_sits_with_the_other_new_tools(cfg, Session):
    """The Dragon Circle is one of the new tools, listed with them in the menu (next to Cheers, in the Community
    group) rather than as a separate button, and the wallpaper is there too. Before the Circle opens it is left out."""
    from radar.web import create_app
    cfg.v2_public = True
    cfg.v21_public = True
    page = create_app(cfg).test_client().get("/friends").get_data(as_text=True)
    assert 'href="/circle"><img' not in page and "9 new" not in page and "8 new" in page
    cfg.circle_public = True
    page = create_app(cfg).test_client().get("/friends").get_data(as_text=True)
    menu = page.split('id="side-new-list"')[1].split("</div>")[0]
    assert "9 new" in page and menu.index('href="/cheers"') < menu.index('href="/circle"') < menu.index('href="/quiz"')
    assert 'href="/wallpaper"' in menu and "My Dragon Circle</span>" not in page


def test_jon_can_add_a_newcomer_who_wrote_their_own_words(cfg, Session):
    """Some newcomers write their join post in their own words, so the join card check misses them. Jon adds the
    post from his unlocked device and the Keeper shows in the welcome lane until it ages out. Nobody else can add."""
    from radar.v21 import welcome_lane
    now = utcnow()
    with Session() as s:
        s.add(Post(id="2114222907412840583", author_id="u:k34tyt", author_username="k34tyt", author_name="K 34",
                   text="Pocket Dragons are waking up! Who is ready to become a Keeper?", created_at=now - timedelta(hours=3)))
        s.add(Post(id="2114222907412840999", author_id="u:old", author_username="OldOne", text="hi", created_at=now - timedelta(days=5)))
        s.commit()
    app, c = _v21_client(cfg)
    assert app.test_client().get("/lab/welcome/add?post=https://x.com/k34tyt/status/2114222907412840583").status_code == 404
    with Session() as s:
        assert "k34tyt" not in [x["user"] for x in welcome_lane(s, cfg, now)]
    c.get("/lab/circle/on")
    r = c.get("/lab/welcome/add?post=https://x.com/k34tyt/status/2114222907412840583")
    assert r.status_code == 302 and r.headers["Location"].endswith("/welcome")
    c.get("/lab/welcome/add?post=https://x.com/OldOne/status/2114222907412840999")
    with Session() as s:
        users = [x["user"] for x in welcome_lane(s, cfg, now)]
    assert "k34tyt" in users and "OldOne" not in users        # an old post is past the lane's three days
    assert c.get("/lab/welcome/add?post=https://x.com/a/status/999999999").headers["Location"].endswith("/lab")


def test_keepers_can_add_a_missed_newcomer_to_the_welcome_lane(cfg, Session, monkeypatch):
    """Anyone can paste a newcomer's join post (or their X name when the post is already on pdtools). A post pdtools
    never saw is read for free through oEmbed. Old posts, off topic posts, Ember Chamber shares, the team, blocked
    authors and Keepers pdtools already knows are turned away."""
    from radar import oembed
    from radar.discord_share import x_time
    from radar.v21 import welcome_lane
    now = utcnow()
    fresh = "2114103143474647069"                      # Smoke's join card, shared only on X
    made = x_time(fresh)
    monkeypatch.setattr("radar.web.utcnow", lambda: made + timedelta(hours=20))
    seen = {}
    def fake(pid, session=None, timeout=10):
        seen[pid] = True
        return {"name": "Smoke", "username": "Smoke_defi", "text": "Keeper of the Ancient Hatchery.\n\n@Pocket_Dragons_ gave me a Water egg.", "media": True}
    monkeypatch.setattr(oembed, "fetch", fake)
    app, c = _v21_client(cfg)
    assert app.test_client().post("/api/welcome/suggest", data='{"link":"x"}').status_code == 404
    j = c.post("/api/welcome/suggest", data=json.dumps({"link": f"https://x.com/Smoke_defi/status/{fresh}/photo/1"})).get_json()
    assert j["ok"] and j["user"] == "Smoke_defi" and seen.get(fresh)
    with Session() as s:
        assert "Smoke_defi" in [x["user"] for x in welcome_lane(s, cfg, made + timedelta(hours=20))]
    assert c.post("/api/welcome/suggest", data=json.dumps({"link": "@smoke_defi"})).get_json()["why"] == "already"
    # an old post, and a Keeper pdtools already knows
    old = c.post("/api/welcome/suggest", data=json.dumps({"link": "https://x.com/a/status/1800000000000000000"})).get_json()
    assert old == {"ok": False, "why": "old"}
    with Session() as s:
        t = made + timedelta(hours=19)
        s.add(Post(id="9100000000000000001", author_id="u:vet", author_username="Vet", text="Ranked #4 with 12 badges collected", created_at=t - timedelta(days=9)))
        s.add(Post(id="9100000000000000002", author_id="u:vet", author_username="Vet", text="hello Pocket Dragons", created_at=t))
        s.commit()
    assert c.post("/api/welcome/suggest", data=json.dumps({"link": "@Vet"})).get_json()["why"] in ("known", "old")
    assert c.post("/api/welcome/suggest", data=json.dumps({"link": "@nobody_here"})).get_json()["why"] == "nopost"
    page = c.get("/welcome").get_data(as_text=True)
    assert 'id="suggest"' in page and "/api/welcome/suggest" in page


def test_dragon_circle_card_is_stamped_pdtools_not_a_name():
    """The Circle share card carries the pdtools.xyz stamp in the corner, never a person's name."""
    from pathlib import Path
    src = (Path(__file__).parent.parent / "radar" / "circle.py").read_text()
    card = src[src.index("DRAGON CIRCLE"):src.index("def layout")]
    assert "Jon Wynn" not in card and '"pdtools.xyz"' in card
    # few words: no tagline, no second link, no small print
    assert "engage with" not in card and "pdtools.xyz/circle" not in card and "unofficial" not in card


def test_egg_pops_up_when_goal_finished_on_another_page():
    # v2.1 often finishes the goal on the Dragon Quiz or the Keepers page; the deferred dragons.js must still
    # offer the egg on the feed once a day, not only on the pd:goaldone event it may have missed
    js = (ROOT / "radar" / "static" / "dragons.js").read_text(encoding="utf-8") if "ROOT" in globals() else open("radar/static/dragons.js", encoding="utf-8").read()
    assert "function autoHatch" in js and 'pd:hatchPop' in js
    assert 'addEventListener("pd:goaldone", () => { refreshGoal(); autoHatch(1600); })' in js
    assert "waitReady" in js and 'visibilitychange", () => { if (!document.hidden) autoHatch' in js


def test_feed_keeps_its_place_when_a_card_leaves_or_the_page_reloads():
    # opening a post far down the feed used to rebuild the whole list and drop people at the very bottom
    js = open("radar/static/app.js", encoding="utf-8").read()
    assert "trail.replaceChildren(frag)" not in js                      # no more emptying the list on every change
    assert "function placeNow" in js and "keepPlace(place);" in js
    assert 'history.scrollRestoration = "manual"' in js and "function restorePlace" in js and "restorePlace();" in js
    assert 'addEventListener("pagehide", savePlace)' in js


def test_lite_mode_and_resting_forest_keep_scrolling_smooth():
    speed = open("radar/templates/_speed.html", encoding="utf-8").read()
    assert "window.PD_LITE = true" in speed and 'classList.add("lite")' in speed and "deviceMemory" in speed
    forest = open("radar/static/forest.js", encoding="utf-8").read()
    assert "!reduce && !window.PD_LITE" in forest                          # weaker devices keep the still picture
    assert "if (far && stage === \"loop\") loop.pause();" in forest        # the loop rests once the tools cover it
    assert "if (far && stage === \"loop\") return;" in forest              # and nudge never restarts it down there
    assert "!window.PD_LITE && cfg.video" in open("radar/static/scene.js", encoding="utf-8").read()


def test_create_page_shows_keeper_studio_made_by_a_keeper(cfg):
    import os
    app, c = _v21_client(cfg)
    body = c.get("/create").get_data(as_text=True)
    assert 'href="https://anastas36.github.io/keeper-studio/" target="_blank" rel="noopener"' in body
    assert "Keeper Studio" in body and "@BugaenkoNastya" in body and "Made by a Keeper" in body
    assert "v21/keeper-studio.webp" in body and os.path.exists("radar/static/v21/keeper-studio.webp")
    assert "keeper-studio" not in c.get("/learn").get_data(as_text=True)          # only on the Create page


def test_blinkys_song_then_jons_songs_open_the_playlist():
    import json, os
    pl = json.load(open("radar/static/audio/playlist.json", encoding="utf-8"))
    assert [s["title"] for s in pl[:3]] == ["Blinky's song", "Dragons Season", "Empire of Embers"]   # Blinky's song opens again (27 Oct)
    assert all(s["by"] == "Jon Wynn" and s["x"] == "jonwynnx" and os.path.exists("radar/static/" + s["src"]) for s in pl[1:3])
    assert len(pl) >= 14                                                               # the community songs still follow


def test_welcome_lane_notices_the_return_from_x_and_shows_the_share_button():
    # X opened as its own app window, or the back button, sends no focus or visibility event: the lane checks itself
    html = open("radar/templates/welcome.html", encoding="utf-8").read()
    assert 'addEventListener("pageshow", (e) => { if (e.persisted) back(); });' in html
    assert "document.hasFocus()" in html and "setInterval(() => {" in html
    assert "shareable.add(a.id)" in html and ".card.shareable .done" in html       # too quick to count, card still shareable
