import json
from datetime import datetime, timedelta
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
            if q.startswith("from:"):
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
    assert c.post("/api/open/42").get_json() == {"counted": True, "opens": 1}
    assert c.post("/api/open/42").get_json() == {"counted": False}
    assert c.post("/api/open/42", headers={"X-Forwarded-For": "9.9.9.9"}).get_json()["opens"] == 2
    assert c.post("/api/open/abc").status_code == 400
    assert c.get("/api/posts?range=24h").get_json()["posts"][0]["opens"] == 2


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
    assert feed.count('class="ico') >= 10 and "e_background_removal" in feed
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
    assert "forest-ambience.m4a" in hub and "blinky-song" not in hub and "sound.js" in hub
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
        optional = {"keeper-open", "keeper"}          # only there when the Keeper card is switched on
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
