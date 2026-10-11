"""Recorded judge data only; provider failures use isolated HTTP fault injection."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.api.main import create_app
from backend.api.store import dumps
from backend.intelligence.decisions import DecisionConfig, DecisionEngine
from backend.tests.test_api import User, make_settings, full_loop_to_sent
from backend.tests.test_intelligence import native_answer

CSV = Path(__file__).parent / "fixtures" / "c2_new_events.csv"


@pytest.fixture()
def app(tmp_path):
    application = create_app(make_settings(tmp_path))
    with TestClient(application):
        yield application


def imported(coord):
    response = coord.post("/api/v1/events/import?filename=c2_new_events.csv", content=CSV.read_bytes())
    assert response.status_code == 200, response.text
    return response.json()["result"]


def latest(coord):
    response = coord.post("/api/v1/replays/latest")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def frame(coord, session, index):
    response = coord.post(f"/api/v1/replays/{session['replay_id']}/frames", json={"index": index})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def physician(result, pid):
    return next(p for p in result["report"]["physicians"] if p["physician_id"] == pid)


def assert_routing_rules(result, ref):
    """Independent ranking oracle using roster/credentials and reconstructed signals."""
    at = datetime.fromisoformat(result["as_of"])
    people = {p["physician_id"]: p for p in result["report"]["physicians"]}
    for hid, routing in result["routing"].items():
        expected = []
        for pid, phy in ref.physicians.items():
            p = people[pid]
            if not (phy.shift_start and phy.shift_end and phy.shift_start <= at < phy.shift_end):
                continue
            if hid not in ref.credentials.get(pid, ()):
                continue
            if p["busy"] or p["ringing_consult"] or p["in_cooldown"]:
                continue
            if p["derived_state"] in ("Temporarily Unavailable", "Availability Unverified", "Off Shift"):
                continue
            evidence = next(e for e in routing["evidence"] if e["physician_id"] == pid)
            count = p["consults_this_shift"]
            threshold = 4 if phy.is_night else 6
            last = datetime.fromisoformat(evidence["last_answered_at"]) if evidence["last_answered_at"] else datetime(1970, 1, 1, tzinfo=timezone.utc)
            expected.append(((0 if count <= threshold else 1, count, last, pid), pid))
        expected.sort()
        assert [p["physician_id"] for p in routing["order"]] == [p for _, p in expected]
        assert (routing["selected"] or {}).get("physician_id") == (expected[0][1] if expected else None)


def test_judge_csv_timeline_late_arrival_rules_and_no_operational_writes(app):
    coord = User(app, "coordinator")
    summary = imported(coord)
    assert (summary["accepted"], summary["duplicates"], summary["error_count"]) == (8, 1, 0)
    before = coord.report()
    session = latest(coord)
    assert session["filename"] == "c2_new_events.csv"
    assert session["input_sha256"] == hashlib.sha256(CSV.read_bytes()).hexdigest()
    assert session["default_hospital_id"] == "SYN-005"
    assert len(session["timeline"]) == 8
    assert session["timeline"][0] == "2026-03-17T18:22:02-04:00"
    assert session["timeline"][-1] == "2026-03-17T18:26:57-04:00"
    assert session["baseline"]["report"]["counts"]["events_applied"] == 1163
    all_frames = [session["baseline"]] + [frame(coord, session, i) for i in range(8)]
    assert [r["report"]["counts"]["events_applied"] for r in all_frames] == list(range(1163, 1172))
    assert physician(all_frames[4], "PHY-001")["derived_state"] == "Camera Active - No Synapse Session"
    assert physician(all_frames[5], "PHY-001")["derived_state"] == "Available"
    assert all_frames[5]["as_of"] == "2026-03-17T18:25:40-04:00"
    assert physician(all_frames[6], "PHY-008")["derived_state"] == "Available"
    assert physician(all_frames[-1], "PHY-008")["busy"] is True
    for result in all_frames:
        assert result["preview_only"] and result["decision"]["preview_only"]
        assert_routing_rules(result, app.state.service.ref)
    assert all_frames[-1]["report"]["counts"]["open_consults"] == 19
    assert frame(coord, session, 0) == all_frames[1]  # Restart uses cached decisions.
    after = coord.report()
    for key in ("run", "counts", "offers", "audit_tail", "imports"):
        assert after[key] == before[key]
    with app.state.store.read() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM decisions").fetchone()["n"] == 0
    invalid = coord.post("/api/v1/offers/propose", json={"decision_id": all_frames[-1]["decision"]["decision_id"]})
    assert invalid.status_code == 409 and invalid.json()["error"]["code"] == "stale_decision"


@pytest.mark.parametrize("mode,source,reason", [
    ("success", "jev", None), ("uncertain", "deterministic_fallback", "provider_uncertain"),
    ("timeout", "deterministic_fallback", "provider_timeout"),
    ("missing_key", "deterministic_fallback", "missing_api_key"),
    ("invalid", "deterministic_fallback", "invalid_provider_response"),
])
def test_replay_provider_selection_and_cache(app, mode, source, reason):
    coord = User(app, "coordinator")
    imported(coord)
    requests = []
    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if mode == "timeout": raise httpx.ReadTimeout("Isolated timeout")
        answer = native_answer(payload, uncertain=mode == "uncertain")
        if mode == "invalid": answer["answers"]["staffing_action"]["choice"] = "not-an-eligible-action"
        return httpx.Response(200, json=answer)
    transport = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    engine = DecisionEngine(DecisionConfig(api_key="" if mode == "missing_key" else "isolated-test-only"), client=transport)
    app.state.recorded_replay.engine = engine
    session = latest(coord)
    selection = session["baseline"]["decision"]
    assert selection["source"] == source
    assert selection["fallback_reason"] == reason
    assert selection["selected_physician_ids"] == ["PHY-009"]
    count = len(requests)
    assert frame(coord, session, -1)["decision"] == selection
    assert len(requests) == count


def test_access_expiry_changed_run_and_legacy_receipts(app):
    coord, lead, doc = User(app, "coordinator"), User(app, "lead"), User(app, "phy-009")
    assert coord.post("/api/v1/replays/latest").status_code == 404
    imported(coord)
    assert TestClient(app).post("/api/v1/replays/latest").status_code == 401
    assert coord.c.post("/api/v1/replays/latest").status_code == 403  # CSRF required.
    assert doc.post("/api/v1/replays/latest").status_code == 403
    session = latest(coord)
    path = f"/api/v1/replays/{session['replay_id']}/frames"
    assert lead.post(path, json={"index": 0}).status_code == 404
    assert coord.post(path, json={"index": 8}).status_code == 422
    app.state.recorded_replay.snapshots[session["replay_id"]].created -= 1801
    assert coord.post(path, json={"index": 0}).status_code == 404
    # Full legacy membership can be recovered without guessing.
    with app.state.store.tx() as conn:
        row = conn.execute("SELECT * FROM imports ORDER BY created_at DESC LIMIT 1").fetchone()
        summary = json.loads(row["summary"]); summary.pop("replay")
        conn.execute("UPDATE imports SET summary=? WHERE import_id=?", (dumps(summary), row["import_id"]))
    recovered = latest(coord)
    assert len(recovered["timeline"]) == 8 and recovered["input_sha256"] is None
    assert coord.post("/api/v1/clock", json={"minutes": 1}).status_code == 200
    assert coord.post(f"/api/v1/replays/{recovered['replay_id']}/frames", json={"index": 0}).status_code == 409
    imported(coord)  # Duplicate-only latest CSV still has full membership.
    duplicate = latest(coord)
    assert duplicate["summary"]["accepted"] == 0 and len(duplicate["timeline"]) == 8
    imported(coord)
    changed = coord.post(f"/api/v1/replays/{duplicate['replay_id']}/frames", json={"index": 0})
    assert changed.status_code == 409  # Duplicate-only imports do not change revision.
    with app.state.store.tx() as conn:
        row = conn.execute("SELECT * FROM imports ORDER BY created_at DESC LIMIT 1").fetchone()
        summary = json.loads(row["summary"]); summary.pop("replay"); summary["duplicate_ids"] = []
        conn.execute("UPDATE imports SET summary=? WHERE import_id=?", (dumps(summary), row["import_id"]))
    rejected = coord.post("/api/v1/replays/latest")
    assert rejected.status_code == 422 and rejected.json()["error"]["code"] == "replay_membership_missing"


def test_manual_accepted_offer_not_in_csv_preview(app):
    coord, lead, doc = User(app, "coordinator"), User(app, "lead"), User(app, "phy-009")
    oid = full_loop_to_sent(coord, lead)
    assert doc.post(f"/api/v1/offers/{oid}/accept").status_code == 200
    imported(coord)
    before = coord.report()
    assert before["staffing"]["selected"] == []
    session = latest(coord)
    last = frame(coord, session, 7)
    assert last["decision"]["selected_physician_ids"] == ["PHY-009"]
    assert last["report"]["offers"] == []
    assert coord.report()["offers"] == before["offers"]


def test_no_eligible_candidate_escalates_without_provider_request(app):
    coord = User(app, "coordinator")
    official = app.state.service.ref.data_dir / "event_stream.csv"
    result = coord.post("/api/v1/events/import?filename=event_stream.csv", content=official.read_bytes())
    assert result.status_code == 200 and result.json()["result"]["duplicates"] == 1164
    session = latest(coord)
    index = session["timeline"].index("2026-03-17T16:00:22-04:00")
    def unexpected_request(request):
        raise AssertionError("No eligible candidate must not invoke Jev")
    client = httpx.AsyncClient(transport=httpx.MockTransport(unexpected_request))
    app.state.recorded_replay.engine = DecisionEngine(DecisionConfig(api_key="isolated-test-only"), client=client)
    result = frame(coord, session, index)
    assert result["report"]["staffing"]["target"]
    assert not any(c["eligible"] for c in result["report"]["staffing"]["candidates"])
    assert result["decision"]["source"] == "escalation"
    assert result["decision"]["fallback_reason"] == "no_feasible_action"
    assert result["decision"]["provider"]["status"] == "not_requested"
    assert result["decision"]["selected_physician_ids"] == []
