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


def test_late_original_receipt_rebuilds_earliest_clock_once(ref):
    earlier = event("original", -19, "consult_received", description="Stroke", ingested_delay=18 * 60)
    retry = event("retry", -8, "consult_received", description="Stroke")
    before = replay([earlier, retry], ref, SCENARIO_NOW - timedelta(minutes=3))
    after = replay([retry, earlier], ref, SCENARIO_NOW)
    assert before.consults["REG-1"].received_at == retry.event_time
    assert after.consults["REG-1"].received_at == earlier.event_time
    assert after.received_times["SYN-005"] == [earlier.event_time]
    assert after.consults["REG-1"].receipt_event_ids == ["original", "retry"]


@pytest.mark.parametrize("started,ended", [
    ("incoming_call_started", "incoming_call_ended"),
    ("video_started", "video_ended"),
])
def test_ending_one_concurrent_interaction_does_not_manufacture_free_capacity(ref, started, ended):
    events = [event("s", 15, "shift_started", cid="", pid="PHY-009", hid=""),
              event("a", 16, started, cid="REG-A", pid="PHY-009"),
              event("b", 17, started, cid="REG-B", pid="PHY-009"),
              event("end-b", 18, ended, cid="REG-B", pid="PHY-009")]
    now = SCENARIO_NOW + timedelta(minutes=21)
    state = replay(events, ref, now)
    assert availability(state, ref, "PHY-009", active_commitment=commitment())["busy"]
    assert "PHY-009" not in [r["physician_id"] for r in route_order(state, ref, "SYN-005", [commitment()])]
    assert (SCENARIO_NOW + timedelta(minutes=16), now) in state.observed_work_intervals["PHY-009"]


def test_answering_one_ring_does_not_clear_another_waiting_call(ref):
    events = [event("s", 15, "shift_started", cid="", pid="PHY-009", hid=""),
              event("a", 16, "incoming_call_ringing", cid="REG-A", pid="PHY-009"),
              event("b", 17, "incoming_call_ringing", cid="REG-B", pid="PHY-009"),
              event("answer-b", 18, "incoming_call_started", cid="REG-B", pid="PHY-009"),
              event("end-b", 19, "incoming_call_ended", cid="REG-B", pid="PHY-009")]
    state = replay(events, ref, SCENARIO_NOW + timedelta(minutes=22))
    assert state.physicians["PHY-009"].ringing[0] == "REG-A"
    assert not availability(state, ref, "PHY-009", active_commitment=commitment())["routable"]


@pytest.mark.parametrize("kind,consult_type,warn,critical", [
    ("consult_triaged", "General Neuro", 5, 10),
    ("physician_assigned", "Stroke", 3, 8),
    ("imaging_requested", "Stroke", 12, 20),
    ("imaging_returned", "Stroke", 6, 12),
])
@pytest.mark.parametrize("boundary", ["before_warning", "warning", "critical"])
def test_stage_thresholds_are_exact_not_rounded(ref, kind, consult_type, warn, critical, boundary):
    elapsed = warn - 1 / 60 if boundary == "before_warning" else warn if boundary == "warning" else critical
    events = [event("r", -elapsed - 2, "consult_received", description=consult_type),
              event("stage", -elapsed, kind, pid="PHY-003" if kind == "physician_assigned" else "")]
    risks = build_report(events, ref, SCENARIO_NOW)["risks"]
    risk = next((r for r in risks if r["id"] == "stage:REG-1"), None)
    if boundary == "before_warning":
        assert risk is None
    else:
        assert risk["severity"] == boundary and risk["elapsed_min"] == elapsed


@pytest.mark.parametrize("consult_type,warn,critical", [("Stroke", 30, 45), ("General Neuro", 45, 90)])
@pytest.mark.parametrize("boundary", ["before_warning", "warning", "critical"])
def test_documentation_thresholds_use_recorded_clinical_end(ref, consult_type, warn, critical, boundary):
    elapsed = warn - 1 / 60 if boundary == "before_warning" else warn if boundary == "warning" else critical
    events = [event("r", -elapsed - 4, "consult_received", description=consult_type),
              event("a", -elapsed - 3, "physician_assigned", pid="PHY-003"),
              event("start", -elapsed - 2, "incoming_call_started", pid="PHY-003"),
              event("end", -elapsed, "incoming_call_ended", pid="PHY-003", description="phone-only consult ended"),
              event("note", -elapsed + 10, "note_started", pid="PHY-003")]
    risks = build_report(events, ref, SCENARIO_NOW)["risks"]
    risk = next((r for r in risks if r["id"] == "doc:REG-1"), None)
    if boundary == "before_warning":
        assert risk is None
    else:
        assert risk["severity"] == boundary and risk["elapsed_min"] == elapsed


def test_shared_credentials_do_not_create_additional_network_physicians(ref):
    state = replay([event("s", -10, "shift_started", cid="", pid="PHY-004", hid="")], ref, SCENARIO_NOW)
    projections = [project_hospital(state, ref, hid, []) for hid in ref.credentials["PHY-004"]]
    memberships = ["PHY-004" in h["samples"][0]["available_ids"] for h in projections]
    assert all(memberships) and len(memberships) > 1
    report = build_report([], ref, SCENARIO_NOW)
    assert "not independent network supply" in report["coverage"]["total_deficit_minutes_basis"]


def test_confirmed_joiner_is_not_flagged_off_shift_by_risk_engine(ref):
    from backend.core.staffing import OfferLedgerView
    events = [event("s", 15, "shift_started", cid="", pid="PHY-009", hid=""),
              event("r", 16, "consult_received", description="Stroke"),
              event("a", 16, "physician_assigned", pid="PHY-009")]
    report = build_report(events, ref, SCENARIO_NOW + timedelta(minutes=17),
                          OfferLedgerView(frozenset(), (commitment(),), {}))
    assert not any(r["id"] == "unavail:REG-1" for r in report["risks"])


def test_ring_and_cooldown_exclude_available_and_confirmed_coverage_headcount(ref):
    ring_events = [event("s", -10, "shift_started", cid="", pid="PHY-003", hid=""),
                   event("ring", -1, "incoming_call_ringing", pid="PHY-003")]
    samples = project_hospital(replay(ring_events, ref, SCENARIO_NOW), ref, "SYN-005", [])["samples"]
    assert all("PHY-003" not in sample["available_ids"] for sample in samples)
    assert "PHY-003" not in samples[0]["confirmed_ids"]
    ended = [event("s", -10, "shift_started", cid="", pid="PHY-003", hid=""),
             event("start", -2, "incoming_call_started", pid="PHY-003"),
             event("end", -1, "incoming_call_ended", pid="PHY-003")]
    samples = project_hospital(replay(ended, ref, SCENARIO_NOW), ref, "SYN-005", [])["samples"]
    assert "PHY-003" not in samples[0]["available_ids"] and "PHY-003" not in samples[0]["confirmed_ids"]
    assert "PHY-003" in samples[1]["available_ids"]  # disclosed projection after known two-minute cooldown


def test_available_self_report_cannot_override_active_call_at_same_time(ref):
    events = [event("status", -1, "physician_status_changed", pid="PHY-003", description="Available"),
              event("call", -1, "incoming_call_started", pid="PHY-003")]
    a = availability(replay(events, ref, SCENARIO_NOW), ref, "PHY-003")
    assert a["busy"] and not a["routable"]
    sample = project_hospital(replay(events, ref, SCENARIO_NOW), ref, "SYN-005", [])["samples"][0]
    assert "PHY-003" not in sample["available_ids"] and "PHY-003" not in sample["confirmed_ids"]

