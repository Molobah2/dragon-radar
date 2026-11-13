"""Dragon Guard: the gate, the config handed to the page, the anonymous counts, and the content rules."""
import json
import re
from pathlib import Path

import pytest

from radar.config import Config
from radar.db import DailyCount, make_session_factory
from radar import guard
from radar.web import create_app

STATIC = Path(guard.GUARD_DIR)


@pytest.fixture
def cfg(tmp_path):
    c = Config()
    c.database_url = f"sqlite:///{tmp_path / 't.db'}"
    c.secret_key = "test"; c.admin_password = "pw"; c.demo_mode = False; c.canonical_host = ""
    c.guard_public = True
    return c


def client(cfg):
    return create_app(cfg).test_client()


def page_cfg(html: str) -> dict:
    return json.loads(re.search(r"window\.GUARD = (\{.*?\});</script>", html).group(1))


def test_hidden_until_launch_then_open(cfg):
    cfg.guard_public = False
    c = client(cfg)
    assert c.get("/guard/").status_code == 404
    assert c.get("/guard/guard.js").status_code == 404
    cfg.guard_public = True
    c = client(cfg)
    r = c.get("/guard/")
    assert r.status_code == 200 and b"Dragon Guard" in r.data
    assert c.get("/guard").status_code in (301, 302, 308)
    assert c.get("/security").headers["Location"].endswith("/guard/")


def test_preview_device_sees_it_before_launch_and_may_set_the_clock(cfg):
    cfg.guard_public = False; cfg.preview_key = "jons-key"
    c = client(cfg)
    c.get("/preview/jons-key")
    r = c.get("/guard/?now=2026-11-16T12:00:00Z")
    assert r.status_code == 200
    assert page_cfg(r.get_data(as_text=True))["now"] == "2026-11-16T12:00:00Z"


def test_the_public_can_not_move_the_clock(cfg):
    r = client(cfg).get("/guard/?now=2026-12-01T00:00:00Z")
    assert "now" not in page_cfg(r.get_data(as_text=True))


def test_page_gets_dates_and_safe_headers(cfg):
    cfg.guard_dates = '{"3": "2026-11-20", "4": "nonsense", "99": "2026-01-01"}'
    r = client(cfg).get("/guard/")
    conf = page_cfg(r.get_data(as_text=True))
    assert conf["dates"]["1"] == "2026-11-08" and conf["dates"]["3"] == "2026-11-20" and conf["dates"]["4"] == "2026-11-10"
    assert "99" not in conf["dates"]
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    assert r.headers["X-Frame-Options"] == "DENY"


def test_no_lesson_first_opens_on_an_event_day():
    for m, d in guard.DATES.items():
        assert d not in ("2026-11-13", "2026-11-16", "2026-11-30"), m
    assert all(guard.DATES[m] <= "2026-11-15" for m in range(1, 9))


def test_official_links_are_https_only():
    got = guard.official("Pocket Dragons on X|https://x.com/Pocket_Dragons_;bad|http://evil.example;js|javascript:alert(1);x")
    assert got == [["Pocket Dragons on X", "https://x.com/Pocket_Dragons_"]]


def test_tally_counts_only_known_moments(cfg):
    c = client(cfg)
    assert c.post("/api/guard/tally", data=json.dumps({"m": 3, "ev": "done", "s": 5})).status_code == 204
    c.post("/api/guard/tally", data=json.dumps({"m": 3, "ev": "start"}))
    c.post("/api/guard/tally", data=json.dumps({"m": 99, "ev": "done"}))
    c.post("/api/guard/tally", data=json.dumps({"m": 1, "ev": "drop table"}))
    c.post("/api/guard/tally", data="not json")
    S = make_session_factory(cfg.database_url)
    with S() as s:
        keys = {r.key: r.count for r in s.query(DailyCount).all() if r.key.startswith("guard_")}
    assert keys == {"guard_3_done": 1, "guard_3_s5": 1, "guard_3_start": 1}


# ---------- the content and the app itself ----------
def lessons():
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((STATIC / "content").glob("m*.json"))]


def visible(seg_list):
    return "".join(s if isinstance(s, str) else s["t"] for s in seg_list or [])


def test_fourteen_lessons_with_ten_questions_each():
    ms = lessons()
    assert [m["id"] for m in ms] == list(range(1, 16))   # 15: search ads and fake sites (13 Nov)
    for m in ms:
        assert len(m["questions"]) == 10 and m["cards"][-1]["type"] == "rule" and m["sources"]
        for q in m["questions"]:
            assert q["why"] and q["source"].startswith("https://")
            if q["kind"] == "choice":
                assert 0 <= q["answer"] < len(q["options"]) <= 4


def test_no_wallet_code_and_no_inputs_in_simulators():
    js = (STATIC / "guard.js").read_text(encoding="utf-8")
    for bad in ("window.ethereum", "eth_requestAccounts", "walletconnect", "wagmi", "ethers.", "web3."):
        assert bad not in js
    sim_code = js[js.index("function sim("):js.index("function allSegs(")]
    assert "<input" not in sim_code and "<textarea" not in sim_code and "contenteditable" not in sim_code and "<form" not in sim_code


def shown_strings(x, out):
    """Every string a Keeper can read, leaving out the source links."""
    if isinstance(x, dict):
        for k, v in x.items():
            if k not in ("url", "source", "sources"):
                shown_strings(v, out)
    elif isinstance(x, list):
        for v in x:
            shown_strings(v, out)
    elif isinstance(x, str):
        out.append(x)
    return out


REAL = {"revoke.cash", "etherscan.io", "chainabuse.com", "ethereum.org", "pdtools.xyz", "pdtools.xyz/guard", "x.com",
        "google.com", "sites.google.com", "docs.google.com"}   # lesson 15 names where scam pages hide; never a link


def test_fake_domains_are_reserved_and_no_contract_addresses():
    text = " ".join(shown_strings(lessons(), []))
    for d in re.findall(r"\b(?:[a-z0-9-]+\.)+(?:example|test|xyz|io|com|org|net|app|site|cash|gg)\b", text.lower()):
        assert d.endswith((".example", ".test")) or d in REAL, d
    assert not re.search(r"0x[0-9a-fA-F]{40}", text)


def test_no_dashes_in_what_people_read():
    for m in lessons():
        bits = [m["title"], m["takeaway"]] + [c.get("title", "") + " " + c.get("body", "") + " " + " ".join(c.get("points", [])) for c in m["cards"]]
        bits += [q["stem"] + " " + q["why"] + " " + " ".join(q.get("options", [])) for q in m["questions"]]
        for t in bits:
            assert not re.search(r"[–—]| - ", t), (m["id"], t)


def test_v3_scroll_only_on_preview_or_after_v3_switch(tmp_path):
    from radar.config import Config
    from radar.web import create_app
    c = Config(); c.database_url = f"sqlite:///{tmp_path / 'g.db'}"; c.guard_public = True; c.secret_key = "t"
    app = create_app(c); cl = app.test_client()
    body = cl.get("/guard/").get_data(as_text=True)
    assert "guard-v3.js" not in body and '"v3"' not in body
    c.v3_public = True
    body = cl.get("/guard/").get_data(as_text=True)
    assert "guard-v3.js" in body and '"v3": 1' in body and "/*VER*/" not in body


def test_v3_guard_and_trail_are_never_dead_ends(tmp_path):
    """In v3 Dragon Guard carries the same pdtools dock as every other page (it steps aside during a lesson and the
    quiz), and the Keepers Trail has a way back to PD Tools. Before the v3 switch both pages are unchanged."""
    from radar.config import Config
    from radar.web import create_app
    c = Config(); c.database_url = f"sqlite:///{tmp_path / 'n.db'}"; c.guard_public = True; c.trail_public = True
    c.v21_public = True; c.secret_key = "t"
    app = create_app(c); cl = app.test_client()
    assert 'id="pdnav"' not in cl.get("/guard/").get_data(as_text=True)
    assert "pdt-home" not in cl.get("/trail/").get_data(as_text=True)
    c.v3_public = True
    g = cl.get("/guard/").get_data(as_text=True)
    assert 'id="pdnav"' in g and 'href="/friends"' in g and 'href="/learn"' in g and g.count("</body>") == 1
    css = (Path(__file__).resolve().parents[1] / "radar" / "static" / "guard" / "v3" / "guard-v3.css").read_text()
    assert 'body[data-view="q"] .pdnav' in css
    t = cl.get("/trail/").get_data(as_text=True)
    assert 'class="pdt-home" href="/create"' in t


def test_v3_needs_the_full_circle_pass_and_never_leaks_to_the_public(tmp_path):
    """The preview link alone (pd_v2) is not v3: Guard and the Trail use the same two-cookie pass as the rest of the
    site. The v3 empty states never reach a public visitor, and the lesson counter cannot be pumped."""
    from radar.config import Config
    from radar.web import create_app
    c = Config(); c.database_url = f"sqlite:///{tmp_path / 'n.db'}"; c.guard_public = True; c.trail_public = True
    c.v2_public = True; c.v21_public = True; c.secret_key = "t"; c.preview_key = "k" * 24
    app = create_app(c); cl = app.test_client()
    cl.get("/preview/" + c.preview_key)                     # the preview link, without the Circle unlock
    assert '"v3": 1' not in cl.get("/guard/").get_data(as_text=True)
    assert "pdt-home" not in cl.get("/trail/").get_data(as_text=True)
    anon = app.test_client()
    assert "tally-empty" not in anon.get("/friends/keepers").get_data(as_text=True)
    assert "wl-quiet" not in anon.get("/welcome").get_data(as_text=True)
    for _ in range(170):
        r = anon.post("/api/guard/tally", data='{"m":1,"ev":"start"}', headers={"Content-Type": "application/json"})
        assert r.status_code == 204


def test_cron_doors_answer_only_the_scheduler_once_a_secret_is_set(tmp_path, monkeypatch):
    from radar.config import Config
    from radar.web import create_app
    c = Config(); c.database_url = f"sqlite:///{tmp_path / 'n.db'}"; c.secret_key = "t"
    cl = create_app(c).test_client()
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    assert cl.post("/cron/collect").status_code == 403
    assert cl.post("/cron/collect", headers={"X-Cron-Key": "nope"}).status_code == 403
    assert cl.post("/cron/collect", headers={"X-Cron-Key": "s3cret"}).status_code != 403
    monkeypatch.delenv("CRON_SECRET")
    assert cl.post("/cron/collect").status_code != 403


def test_german_is_in_v3_only(tmp_path):
    """German (11 Nov) ships with v3: every page, Dragon Guard and the Trail can show it where v3 is open, and the
    public site keeps its ten languages until the v3 switch."""
    from radar.config import Config
    from radar.web import create_app
    from radar.i18n_pack import build
    root = Path(__file__).resolve().parents[1] / "radar"
    packs = build()
    assert "de" in packs and "Tagesziel" in packs["de"]
    loader = (root / "static" / "i18n.js").read_text()
    assert 'classList.contains("v3") || window.PD_V3) LANGS.splice(1, 0, ["de", "Deutsch"])' in loader
    es = json.loads((root / "static" / "guard" / "i18n" / "es.json").read_text())
    de = json.loads((root / "static" / "guard" / "i18n" / "de.json").read_text())
    assert set(de) == set(es) and all(de.values())
    assert 'concat(CFG.v3 ? ["de"] : [])' in (root / "static" / "guard" / "guard.js").read_text()
    assert "if (window.PD_V3) NAMES.splice(1, 0, ['de', 'Deutsch'])" in (root / "static" / "trail" / "index.html").read_text()
    c = Config(); c.database_url = f"sqlite:///{tmp_path / 'n.db'}"; c.guard_public = True; c.trail_public = True
    c.v21_public = True; c.secret_key = "t"
    cl = create_app(c).test_client()
    assert "window.PD_V3=1" not in cl.get("/guard/").get_data(as_text=True) and "window.PD_V3=1" not in cl.get("/trail/").get_data(as_text=True)
    c.v3_public = True
    assert "window.PD_V3=1" in cl.get("/guard/").get_data(as_text=True) and "window.PD_V3=1" in cl.get("/trail/").get_data(as_text=True)


def test_counters_never_collide(tmp_path):
    """Two beacons for the same lesson at the same moment both inserted the day's first row and one failed with a
    duplicate key (seen live, 11 Nov). bump is one upsert now, and every hit counts."""
    import threading
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from datetime import date
    from radar.db import Base, DailyCount
    from radar.visits import bump
    eng = create_engine(f"sqlite:///{tmp_path / 'c.db'}", connect_args={"timeout": 30})
    Base.metadata.create_all(eng); S = sessionmaker(eng)
    def one():
        with S() as s:
            bump(s, date(2026, 11, 13), "guard_1_start"); s.commit()
    ts = [threading.Thread(target=one) for _ in range(20)]
    [t.start() for t in ts]; [t.join() for t in ts]
    with S() as s:
        assert s.get(DailyCount, (date(2026, 11, 13), "guard_1_start")).count == 20
