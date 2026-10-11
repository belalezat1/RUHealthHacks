"""Fault-injection fixtures are isolated tests, never application runtime data."""
from dataclasses import replace
from datetime import timedelta
import shutil

import pytest

from backend.core.coverage import Commitment, project_hospital
from backend.core.data import SCENARIO_NOW, load_reference
from backend.core.events import Event, read_csv_text, validate_batch
from backend.core.replay import availability, replay
from backend.core.report import build_report
from backend.core.routing import route_order


@pytest.fixture(scope="module")
def ref():
    return load_reference()


def event(eid, minute, kind, *, cid="REG-1", pid="", hid="SYN-005", description="", ingested_delay=0):
    at = SCENARIO_NOW + timedelta(minutes=minute)
    return Event(eid, at, at + timedelta(seconds=ingested_delay), cid, kind, pid, hid, description)


def commitment():
    return Commitment("PHY-009", frozenset({"SYN-005"}), SCENARIO_NOW,
                      SCENARIO_NOW + timedelta(hours=2), SCENARIO_NOW + timedelta(minutes=15), "reg-offer")


def test_repeat_receipt_preserves_clock_stage_history_and_unique_arrival(ref):
    events = [event("r1", -20, "consult_received", description="Stroke consult request received"),
              event("t1", -19, "consult_triaged"),
              event("r2", -8, "consult_received", description="Stroke hospital retry")]
    state = replay(list(reversed(events)), ref, SCENARIO_NOW)
    consult = state.consults["REG-1"]
    assert consult.received_at == SCENARIO_NOW - timedelta(minutes=20)
    assert consult.stage == "Triaged"
    assert consult.stage_entered_at == SCENARIO_NOW - timedelta(minutes=19)
    assert consult.receipt_event_ids == ["r1", "r2"]
    assert consult.event_ids == ["r1", "t1", "r2"]
    assert state.received_times["SYN-005"] == [consult.received_at]


def test_distinct_consults_at_same_hospital_are_not_merged(ref):
    state = replay([event("r1", -2, "consult_received", description="Stroke"),
                    event("r2", -2, "consult_received", cid="REG-2", description="General Neuro")], ref, SCENARIO_NOW)
    assert len(state.consults) == len(state.received_times["SYN-005"]) == 2


def test_unknown_type_and_missing_receipt_do_not_invent_stroke_or_documentation_clock(ref):
    supplied = event("r1", -10, "consult_received", description="Consult request; type not supplied")
    batch = validate_batch([supplied.to_row()], ref, {})
    assert batch.ok
    events = batch.accepted + [event("n1", -5, "note_started", pid="PHY-004"),
                               event("n2", -5, "note_started", cid="REG-ORPHAN", pid="PHY-004")]
    state = replay(events, ref, SCENARIO_NOW)
    assert state.consults["REG-1"].consult_type == "Unknown"
    assert state.consults["REG-ORPHAN"].consult_type == "Unknown"
    assert state.consults["REG-1"].clinical_end_at is None
    assert not any(r["kind"] == "documentation_delay" for r in build_report(events, ref, SCENARIO_NOW)["risks"])


@pytest.mark.parametrize("first,second", [
    ("physician_status_changed", "physician_status_changed"),
    ("camera_active", "camera_inactive"),
    ("incoming_call_started", "incoming_call_ended"),
    ("video_started", "video_ended"),
])
def test_equal_time_conflicts_are_explicit_and_independent_of_ingestion_order(ref, first, second):
    a = event("a", -5, first, pid="PHY-002", description="Available")
    b = event("b", -5, second, pid="PHY-002", description="Temporarily Unavailable", ingested_delay=20)
    left = availability(replay([a, b], ref, SCENARIO_NOW), ref, "PHY-002")
    right = availability(replay([replace(a, ingested_at=a.ingested_at + timedelta(seconds=25)),
                                  replace(b, ingested_at=b.event_time)], ref, SCENARIO_NOW), ref, "PHY-002")
    assert left == right
    assert not left["verified"] and not left["routable"]
    assert left["conflicting_signal_event_ids"] == ["a", "b"]


def test_later_consistent_signal_resolves_conflict(ref):
    events = [event("a", -5, "camera_active", pid="PHY-002"),
              event("b", -5, "camera_inactive", pid="PHY-002"),
              event("c", -3, "camera_inactive", pid="PHY-002")]
    a = availability(replay(events, ref, SCENARIO_NOW), ref, "PHY-002")
    assert a["routable"] and not a["conflicting_signal_event_ids"]


def test_acceptance_and_eta_are_projection_not_online_evidence(ref):
    now = SCENARIO_NOW + timedelta(minutes=20)
    state = replay([], ref, now)
    c = commitment()
    assert "PHY-009" not in [r["physician_id"] for r in route_order(state, ref, "SYN-005", [c])]
    current = project_hospital(state, ref, "SYN-005", [c])["samples"][0]
    assert "PHY-009" in current["available_ids"] and "PHY-009" in current["planned_ids"]
    assert "PHY-009" not in current["confirmed_ids"]
    assert "PHY-009" in current["unverified_ids"]


def joined_events():
    return [event("s", 15, "shift_started", cid="", pid="PHY-009", hid=""),
            event("r", 16, "consult_received", description="Stroke"),
            event("a", 16, "physician_assigned", pid="PHY-009"),
            event("c", 16.5, "incoming_call_started", pid="PHY-009"),
            event("e", 18, "incoming_call_ended", pid="PHY-009")]


def test_joiner_uses_actual_workload_busy_cooldown_and_scope(ref):
    c = commitment()
    for minute in (17, 19):
        state = replay(joined_events(), ref, SCENARIO_NOW + timedelta(minutes=minute))
        assert "PHY-009" not in [r["physician_id"] for r in route_order(state, ref, "SYN-005", [c])]
    state = replay(joined_events(), ref, SCENARIO_NOW + timedelta(minutes=20))
    row = next(r for r in route_order(state, ref, "SYN-005", [c]) if r["physician_id"] == "PHY-009")
    assert row["consults_this_shift"] == 1
    assert row["last_answered_at"] == (SCENARIO_NOW + timedelta(minutes=16.5)).isoformat()
    assert row["presence_verified"]
    assert "PHY-009" not in [r["physician_id"] for r in route_order(state, ref, "SYN-004", [c])]
    current = project_hospital(state, ref, "SYN-005", [c])["samples"][0]
    assert "PHY-009" in current["confirmed_ids"]
    ringing = replay(joined_events() + [event("ring", 20, "incoming_call_ringing", pid="PHY-009")], ref, state.as_of)
    assert "PHY-009" not in [r["physician_id"] for r in route_order(ringing, ref, "SYN-005", [c])]


def test_imported_online_evidence_can_precede_estimated_eta(ref):
    state = replay([event("s", 5, "shift_started", cid="", pid="PHY-009", hid="")], ref,
                   SCENARIO_NOW + timedelta(minutes=10))
    current = project_hospital(state, ref, "SYN-005", [commitment()])["samples"][0]
    assert "PHY-009" in current["confirmed_ids"]
    assert "PHY-009" in current["available_ids"]


def test_future_scheduled_capacity_is_not_confirmed(ref):
    state = replay([], ref, SCENARIO_NOW)
    at19 = project_hospital(state, ref, "SYN-005", [])["samples"][8]
    assert "PHY-011" in at19["future_scheduled_ids"]
    assert "PHY-011" in at19["available_ids"] and not at19["confirmed_ids"]
    assert at19["confirmed_deficit"] is None


def test_surge_is_unique_receipts_and_exact_p90_plus_one(ref):
    by_day = dict(ref.baseline_by_day)
    by_day[("SYN-005", "weekday", 18)] = (2.0, 2)
    ref = replace(ref, baseline_by_day=by_day)
    repeated = [event(f"r{i}", -10 + i / 100, "consult_received", description="Stroke") for i in range(20)]
    state = replay(repeated, ref, SCENARIO_NOW)
    first = project_hospital(state, ref, "SYN-005", [])["samples"][0]
    assert first["trailing_observed"] == 1 and first["surge_uplift"] == 0
    distinct = [event(f"d{i}", -5, "consult_received", cid=f"REG-D{i}", description="Stroke") for i in range(2)]
    first = project_hospital(replay(repeated + distinct, ref, SCENARIO_NOW), ref, "SYN-005", [])["samples"][0]
    assert first["trailing_observed"] == 3 and first["surge_uplift"] == 1
    assert first["required"] == first["minimum"] + 1


def test_note_writing_does_not_reset_interaction_end_clock(ref):
    events = [event("r", -60, "consult_received", description="Stroke"),
              event("a", -59, "physician_assigned", pid="PHY-004"),
              event("v", -50, "video_started", pid="PHY-004"),
              event("e", -45, "video_ended", pid="PHY-004"),
              event("n", -30, "note_started", pid="PHY-004")]
    report = build_report(events, ref, SCENARIO_NOW)
    risk = next(r for r in report["risks"] if r["id"] == "doc:REG-1")
    assert risk["elapsed_min"] == 45 and risk["severity"] == "critical"


def test_reference_identifiers_and_dated_schedule_are_input_driven(ref, tmp_path):
    for name in ref.source_hashes:
        shutil.copyfile(ref.data_dir / name, tmp_path / name)
        text = (tmp_path / name).read_text()
        (tmp_path / name).write_text(text.replace("SYN-005", "HOSP-REAL-FORMAT").replace("2026-03-17", "2026-03-24"))
    loaded = load_reference(tmp_path)
    assert loaded.credentialed("PHY-009", "HOSP-REAL-FORMAT")
    assert loaded.scenario_now.day == 24
    assert loaded.physicians["PHY-001"].shift_start.day == 24
    assert loaded.supported_start.day == 24 and loaded.supported_end.day == 25
    assert validate_batch([event("r", -10, "consult_received", description="Stroke").to_row()], loaded, {}).errors


def test_missing_baseline_or_coverage_is_not_assumed_zero(ref):
    with pytest.raises(ValueError, match="supplied.*baseline"):
        replace(ref, baseline_by_day={}).baseline_for("SYN-005", SCENARIO_NOW)
    with pytest.raises(ValueError, match="supplied coverage"):
        replace(ref, coverage=()).required_minimum("SYN-005", SCENARIO_NOW)


@pytest.mark.parametrize("csv", [
    "event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description,event_id\n",
    "event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description,money\n",
    "event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description\na,b,c,d,e,f,g,h,i\n",
])
def test_malformed_judge_schema_is_rejected_atomically(csv):
    rows, errors = read_csv_text(csv)
    assert not rows and errors

