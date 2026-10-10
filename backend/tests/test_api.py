from __future__ import annotations

import threading
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.api.config import Settings
from backend.api.main import create_app
from backend.core.data import DEFAULT_DATA_DIR

PASSWORD = "test-password-123"


def make_settings(tmp_path) -> Settings:
    return Settings(mode="local", state_dir=tmp_path, data_dir=DEFAULT_DATA_DIR, allowed_origins=(),
                    demo_password=PASSWORD, release_sha="test", session_hours=1, static_dir=None)


class User:
    def __init__(self, app, username: str):
        self.c = TestClient(app)
        r = self.c.post("/api/v1/session", json={"username": username, "password": PASSWORD})
        assert r.status_code == 200, r.text
        self.csrf = r.json()["csrf_token"]

    def state(self):
        return self.c.get("/api/v1/state").json()

    def post(self, path, json=None, content=None, key=None, revision=None, run=None, headers=None):
        st = self.state()
        h = {"X-CSRF-Token": self.csrf, "Idempotency-Key": key or uuid.uuid4().hex,
             "X-Expected-Run": run or st["run_id"],
             "X-Expected-Revision": str(revision if revision is not None else st["revision"])}
        h.update(headers or {})
        return self.c.post(path, json=json, content=content, headers=h)

    def report(self):
        r = self.c.get("/api/v1/report")
        assert r.status_code == 200, r.text
        return r.json()["data"]


@pytest.fixture()
def app(tmp_path):
    a = create_app(make_settings(tmp_path))
    with TestClient(a):  # runs lifespan
        yield a


def full_loop_to_sent(coord: User, lead: User) -> str:
    r = coord.post("/api/v1/offers/propose", json={})
    assert r.status_code == 200, r.text
    oid = r.json()["result"]["offer_ids"][0]
    assert coord.post(f"/api/v1/offers/{oid}/send").status_code == 409  # not approved yet
    assert lead.post(f"/api/v1/offers/{oid}/approve").status_code == 200
    r = coord.post(f"/api/v1/offers/{oid}/send")
    assert r.status_code == 200, r.text
    assert "Suncrest" in r.json()["result"]["notification_text"]
    return oid


def test_requires_login_and_role(app):
    anon = TestClient(app)
    assert anon.get("/api/v1/report").status_code == 401
    doc = User(app, "phy-009")
    assert doc.c.get("/api/v1/report").status_code == 403
    assert doc.post("/api/v1/offers/propose", json={}).status_code == 403
    coord = User(app, "coordinator")
    assert coord.report()["verification"]["passed"]


def test_csrf_and_idempotency_required(app):
    coord = User(app, "coordinator")
    st = coord.state()
    r = coord.c.post("/api/v1/clock", json={"minutes": 1},
                     headers={"Idempotency-Key": "k1", "X-Expected-Run": st["run_id"],
                              "X-Expected-Revision": str(st["revision"])})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf"
    r = coord.c.post("/api/v1/clock", json={"minutes": 1}, headers={"X-CSRF-Token": coord.csrf,
                     "X-Expected-Run": st["run_id"], "X-Expected-Revision": str(st["revision"])})
    assert r.status_code == 400


def test_full_offer_loop_accept_updates_projected_coverage(app):
    coord, lead, grace = User(app, "coordinator"), User(app, "lead"), User(app, "phy-009")
    assert grace.c.get("/api/v1/me/offers").json()["data"]["offers"] == []  # proposals are not visible
    oid = full_loop_to_sent(coord, lead)
    mine = grace.c.get("/api/v1/me/offers").json()["data"]["offers"]
    assert [o["offer_id"] for o in mine] == [oid]
    assert set(mine[0]) >= {"hospital_names", "start", "end", "hours", "status"}
    assert "rationale" not in mine[0] and "candidate_audit" not in mine[0]
    other = User(app, "phy-010")
    assert other.post(f"/api/v1/offers/{oid}/accept").status_code == 404  # not their offer
    r = grace.post(f"/api/v1/offers/{oid}/accept")
    assert r.status_code == 200, r.text
    assert r.json()["result"]["online_at"].startswith("2026-03-17T18:35")
    rep = coord.report()
    suncrest = next(h for h in rep["coverage"]["hospitals"] if h["hospital_id"] == "SYN-005")
    assert suncrest["deficit_minutes"] == 55
    assert next(p for p in rep["physicians"] if p["physician_id"] == "PHY-009")["planned_capacity"]
    kinds = [a["kind"] for a in rep["audit_tail"]]
    for k in ("offer_proposed", "offer_approved", "offer_sent", "offer_accepted"):
        assert k in kinds
    # accepting twice is definitive
    again = grace.post(f"/api/v1/offers/{oid}/accept")
    assert again.status_code == 409 and again.json()["error"]["offer_status"] == "accepted"


def test_reject_decline_and_expiry(app):
    coord, lead, grace = User(app, "coordinator"), User(app, "lead"), User(app, "phy-009")
    oid = coord.post("/api/v1/offers/propose", json={}).json()["result"]["offer_ids"][0]
    assert lead.post(f"/api/v1/offers/{oid}/reject", json={"reason": "not needed"}).status_code == 200
    oid = full_loop_to_sent(coord, lead)
    assert grace.post(f"/api/v1/offers/{oid}/decline").status_code == 200
    oid = full_loop_to_sent(coord, lead)
    r = coord.post("/api/v1/clock", json={"minutes": 10})
    assert oid in r.json()["result"]["expired_offers"]
    late = grace.post(f"/api/v1/offers/{oid}/accept")
    assert late.status_code == 409 and late.json()["error"]["offer_status"] == "expired"


def test_stale_revision_and_idempotent_retry(app):
    coord = User(app, "coordinator")
    st = coord.state()
    first = coord.post("/api/v1/clock", json={"minutes": 1}, key="same-key", revision=st["revision"])
    assert first.status_code == 200
    retry = coord.post("/api/v1/clock", json={"minutes": 1}, key="same-key", revision=st["revision"])
    assert retry.status_code == 200 and retry.json()["idempotent_replay"]
    assert coord.state()["revision"] == st["revision"] + 1  # applied once
    stale = coord.post("/api/v1/clock", json={"minutes": 1}, revision=st["revision"])
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "stale_revision"


NEW_EVENTS = """event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description
EVT-90001,2026-03-17T18:21:00-04:00,2026-03-17T18:21:02-04:00,CON-9001,consult_received,,SYN-005,Stroke consult request received
EVT-90002,2026-03-17T18:22:00-04:00,2026-03-17T18:22:03-04:00,CON-9001,consult_triaged,,SYN-005,Consult triaged
"""


def test_live_import_changes_report_without_restart_and_is_idempotent(app):
    coord = User(app, "coordinator")
    before = coord.report()
    r = coord.post("/api/v1/events/import?filename=judge.csv", content=NEW_EVENTS,
                   headers={"Content-Type": "text/csv"})
    assert r.status_code == 200, r.text
    assert r.json()["result"]["accepted"] == 2
    after = coord.report()
    assert after["run"]["revision"] > before["run"]["revision"]
    assert after["as_of"].startswith("2026-03-17T18:22:03")
    assert any(c["consult_id"] == "CON-9001" for c in after["consults"])
    assert not after["verification"]["original_run"]
    suncrest = next(h for h in after["coverage"]["hospitals"] if h["hospital_id"] == "SYN-005")
    assert suncrest["samples"][0]["trailing_observed"] == 6
    rev = coord.state()["revision"]
    dup = coord.post("/api/v1/events/import", content=NEW_EVENTS, headers={"Content-Type": "text/csv"})
    assert dup.status_code == 200 and dup.json()["result"]["accepted"] == 0
    assert dup.json()["result"]["duplicates"] == 2
    assert coord.state()["revision"] == rev
    assert sum(1 for c in coord.report()["consults"] if c["consult_id"] == "CON-9001") == 1


def test_invalid_batch_changes_nothing(app):
    coord = User(app, "coordinator")
    rev = coord.state()["revision"]
    bad = NEW_EVENTS.replace("EVT-90002", "EVT-90003").replace("SYN-005,Consult triaged", "SYN-999,Consult triaged")
    r = coord.post("/api/v1/events/import", content=bad, headers={"Content-Type": "text/csv"})
    assert r.status_code == 422
    assert r.json()["error"]["summary"]["error_count"] == 1
    assert coord.state()["revision"] == rev
    assert not any(c["consult_id"] == "CON-9001" for c in coord.report()["consults"])
    conflict = "event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description\n" \
               "EVT-00001,2026-03-17T07:00:00-04:00,2026-03-17T07:00:01-04:00,,shift_started,PHY-001,,Shift started\n"
    r = coord.post("/api/v1/events/import", content=conflict, headers={"Content-Type": "text/csv"})
    assert r.status_code == 422 and "conflict" in r.text


def test_one_slot_race_has_exactly_one_winner(app):
    """Synthetic race fixture: two physicians offered the same one-slot gap.

    PHY-010 is not credentialed at Suncrest in the source data, so we exercise the ledger
    directly by inserting a second approved+sent offer for the same gap. This alters the
    fixture for the test only.
    """
    coord, lead = User(app, "coordinator"), User(app, "lead")
    oid = full_loop_to_sent(coord, lead)
    store = app.state.store
    with store.tx() as conn:
        row = dict(conn.execute("SELECT * FROM offers WHERE offer_id=?", (oid,)).fetchone())
        conn.execute("UPDATE gaps SET slots=1 WHERE gap_id=?", (row["gap_id"],))
        row.update(offer_id="OFF-RACE-2", physician_id="PHY-011", minutes_to_online=0)
        cols = ",".join(row)
        conn.execute(f"INSERT INTO offers({cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
    app.state.service.invalidate()
    service = app.state.service
    service._revalidate = lambda conn, run, r: {"eligible": True, "failed_rules": []}  # fixture override
    grace, hannah = User(app, "phy-009"), User(app, "phy-011")
    st = grace.state()
    results = {}

    def go(name, user, offer):
        results[name] = user.post(f"/api/v1/offers/{offer}/accept", revision=st["revision"], run=st["run_id"])

    threads = [threading.Thread(target=go, args=("a", grace, oid)),
               threading.Thread(target=go, args=("b", hannah, "OFF-RACE-2"))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    codes = sorted(r.status_code for r in results.values())
    assert codes == [200, 409]
    with store.read() as conn:
        accepted = conn.execute("SELECT COUNT(*) n FROM offers WHERE status='accepted'").fetchone()["n"]
        claims = conn.execute("SELECT COUNT(*) n FROM gap_claims").fetchone()["n"]
    assert accepted == 1 and claims == 1
    # the loser retries with a fresh revision and gets a definitive answer
    loser = grace if results["a"].status_code == 409 else hannah
    loser_offer = oid if loser is grace else "OFF-RACE-2"
    final = loser.post(f"/api/v1/offers/{loser_offer}/accept")
    assert final.status_code == 409 and final.json()["error"]["offer_status"] == "cancelled"


def test_escalation_and_reassignment_rules(app):
    coord, lead = User(app, "coordinator"), User(app, "lead")
    r = coord.post("/api/v1/actions/escalate", json={"risk_id": "stage:CON-2105", "consult_id": "CON-2105",
                                                     "note": "No eligible physician"})
    assert r.status_code == 200
    aid = r.json()["result"]["action_id"]
    assert coord.post(f"/api/v1/actions/{aid}/acknowledge", json={}).status_code == 403
    assert lead.post(f"/api/v1/actions/{aid}/acknowledge", json={"decision": "Authorized"}).status_code == 200
    # CON-2101 is in an active video encounter: never reassigned
    r = coord.post("/api/v1/actions/reassign", json={"consult_id": "CON-2101", "physician_id": "PHY-004"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "consult_not_waiting"
    # CON-2105 is waiting but nobody credentialed at SYN-010 is free
    r = coord.post("/api/v1/actions/reassign", json={"consult_id": "CON-2105", "physician_id": "PHY-004"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "target_ineligible"
    # CON-2114 (Suncrest, triaged): PHY-005/003/006 are busy -> ineligible as well
    targets = coord.c.get("/api/v1/consults/CON-2114/reassignment-targets").json()["data"]
    assert targets["waiting"]


def test_reassignment_records_when_target_eligible(app):
    coord = User(app, "coordinator")
    # PHY-005 finishes the CON-2104 call at 18:21; after the 2-minute cooldown they are the
    # only free physician credentialed at Suncrest, where CON-2114 is waiting unassigned.
    call_end = ("event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description\n"
                "EVT-90100,2026-03-17T18:21:00-04:00,2026-03-17T18:21:01-04:00,CON-2104,incoming_call_ended,"
                "PHY-005,SYN-004,Call ends\n")
    assert coord.post("/api/v1/events/import", content=call_end, headers={"Content-Type": "text/csv"}).status_code == 200
    t = coord.c.get("/api/v1/consults/CON-2114/reassignment-targets").json()["data"]["targets"]
    assert t == []  # still in post-call cooldown
    coord.post("/api/v1/clock", json={"minutes": 2})
    t = coord.c.get("/api/v1/consults/CON-2114/reassignment-targets").json()["data"]["targets"]
    assert [x["physician_id"] for x in t] == ["PHY-005"]
    r = coord.post("/api/v1/actions/reassign", json={"consult_id": "CON-2114", "physician_id": "PHY-005"})
    assert r.status_code == 200, r.text
    c = next(c for c in coord.report()["consults"] if c["consult_id"] == "CON-2114")
    assert c["modeled_reassignment"]["target_physician_id"] == "PHY-005"
    # the same physician is not reserved twice at the same scenario time
    r = coord.post("/api/v1/actions/reassign", json={"consult_id": "CON-2114", "physician_id": "PHY-005"})
    assert r.status_code == 409


def test_state_survives_restart(tmp_path):
    settings = make_settings(tmp_path)
    a = create_app(settings)
    with TestClient(a):
        coord, lead, grace = User(a, "coordinator"), User(a, "lead"), User(a, "phy-009")
        oid = full_loop_to_sent(coord, lead)
        assert grace.post(f"/api/v1/offers/{oid}/accept").status_code == 200
        coord.post("/api/v1/events/import", content=NEW_EVENTS, headers={"Content-Type": "text/csv"})
        before = coord.state()
        audit_before = coord.c.get("/api/v1/audit.csv").text
    b = create_app(settings)
    with TestClient(b):
        coord = User(b, "coordinator")
        after = coord.state()
        assert (after["run_id"], after["revision"], after["as_of"]) == \
               (before["run_id"], before["revision"], before["as_of"])
        assert coord.c.get("/api/v1/audit.csv").text == audit_before
        rep = coord.report()
        assert any(o["status"] == "accepted" for o in rep["offers"])
        assert any(c["consult_id"] == "CON-9001" for c in rep["consults"])


def test_new_run_keeps_history(app):
    coord = User(app, "coordinator")
    old = coord.state()["run_id"]
    coord.post("/api/v1/clock", json={"minutes": 5})
    r = coord.post("/api/v1/runs", json={"label": "demo reset"})
    assert r.status_code == 200
    rep = coord.report()
    assert rep["run"]["run_id"] != old and rep["verification"]["passed"]
    assert any(x["run_id"] == old for x in rep["runs"])
    with app.state.store.read() as conn:
        assert conn.execute("SELECT COUNT(*) n FROM audit WHERE run_id=?", (old,)).fetchone()["n"] >= 2


def test_logout_invalidates_session(app):
    coord = User(app, "coordinator")
    r = coord.c.delete("/api/v1/session", headers={"X-CSRF-Token": coord.csrf})
    assert r.status_code == 200
    assert coord.c.get("/api/v1/state").status_code == 401
