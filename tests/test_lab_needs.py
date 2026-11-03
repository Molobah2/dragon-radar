"""Jon's lab page lists everything on the site that waits for him."""
import hmac, json
from datetime import datetime

from radar.config import Config
from radar.db import ArtEntry, ReportStatus, make_session_factory, set_setting
from radar.web import create_app


def test_needs_you_lists_what_is_waiting(tmp_path, monkeypatch):
    c = Config(); c.database_url = f"sqlite:///{tmp_path / 'n.db'}"; c.secret_key = "t"; c.admin_password = "pw"; c.demo_mode = False
    c.v2_public = True; c.preview_key = "jons-key"; c.suggest_url = "https://forms.example/mailbox"
    S = make_session_factory(c.database_url)
    with S() as s:
        set_setting(s, "v21:creators", json.dumps([{"week": "2026-10-19", "user": "utom_eggs", "name": "utom_eggs"}]))
        s.add(ArtEntry(week=datetime(2026, 10, 26).date(), key="bits", username="BITSAVADOR", title="Charms", status="pending",
                       created_at=datetime(2026, 10, 27)))
        s.add(ReportStatus(post_id="1", status="open")); s.commit()
    monkeypatch.setattr("radar.web.utcnow", lambda: datetime(2026, 11, 2, 9, 0))      # a Monday
    app = create_app(c); cl = app.test_client()
    page = cl.get("/lab").get_data(as_text=True)
    assert "Needs you" not in page                                                    # strangers never see it
    cl.get("/preview/jons-key"); cl.get("/lab/circle/on")
    page = cl.get("/lab").get_data(as_text=True)
    assert "Needs you · 4" in page
    assert "Pick this week&#39;s Creator of the week" in page and "@utom_eggs (week of Oct 19)" in page
    assert "1 Keeper Art entry to review" in page and "The oldest has waited 6 days." in page
    assert "1 reported post to look at" in page and "Read the mailbox" in page
