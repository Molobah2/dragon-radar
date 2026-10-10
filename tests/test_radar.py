from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
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
    r = client.get("/")
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


def test_only_recent_team_posts_are_pinned(cfg, Session):
    now = utcnow()
    with Session() as s:
        s.add_all([
            Post(id="old-team", author_username="u", text="hello", author_id="t", created_at=now - timedelta(hours=30), is_team=True),
            Post(id="new-community", author_username="u", text="hello", author_id="c", created_at=now - timedelta(hours=1)),
            Post(id="new-team", author_username="u", text="hello", author_id="t", created_at=now - timedelta(hours=2), is_team=True),
        ])
        s.commit()
    app = create_app(cfg)
    got = ids(app.test_client().get("/api/posts?range=7d"))
    assert got == ["new-team", "new-community", "old-team"]


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
            self.calls.append(max_results)
            n = len(self.calls)
            return {"data": [{"id": f"{n}{i:03d}", "author_id": "9", "created_at": "2026-10-10T01:00:00.000Z",
                              "text": "hi"} for i in range(max_results)], "meta": {"next_token": "x"}}
        def user_id_for(self, u):
            return "1"
        def existing_ids(self, ids):
            return set(ids)

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
