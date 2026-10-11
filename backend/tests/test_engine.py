from __future__ import annotations

from datetime import timedelta

import pytest

from backend.core.coverage import Commitment, project_hospital
from backend.core.data import SCENARIO_NOW, load_reference
from backend.core.events import read_csv_text, validate_batch
from backend.core.replay import availability, derived_state, replay
from backend.core.report import build_report
from backend.core.staffing import EMPTY_LEDGER, OfferLedgerView, evaluate_candidate
from backend.core.verify import compare_snapshot


@pytest.fixture(scope="module")
def ref():
    return load_reference()


@pytest.fixture(scope="module")
def events(ref):
    rows, errs = read_csv_text((ref.data_dir / "event_stream.csv").read_text(encoding="utf-8"))
    assert not errs
    batch = validate_batch(rows, ref, {})
    assert batch.ok
    return batch.accepted


@pytest.fixture(scope="module")
def report(ref, events):
    return build_report(events, ref, SCENARIO_NOW)


def test_source_counts(ref, events):
    assert len(events) == 1163  # 1,164 rows, one repeated event id
    assert len(ref.hospitals) == 12
    assert sum(p.on_roster_shift for p in ref.physicians.values()) == 8
    assert sum(not p.on_roster_shift for p in ref.physicians.values()) == 6


def test_duplicate_event_is_a_retry_not_a_conflict(ref):
    rows, _ = read_csv_text((ref.data_dir / "event_stream.csv").read_text(encoding="utf-8"))
    batch = validate_batch(rows, ref, {})
    assert batch.duplicates == ["EVT-00529"]


def test_snapshot_matches_all_208_fields(ref, events):
    result = compare_snapshot(replay(events, ref, SCENARIO_NOW), ref)
    assert result["compared"] == 208
    assert result["matched"] == 208, result["mismatches"]
    assert result["passed"]


def test_replay_is_order_independent(ref, events):
    shuffled = list(reversed(events))
    assert compare_snapshot(replay(shuffled, ref, SCENARIO_NOW), ref)["matched"] == 208


def test_late_event_uses_event_time_without_future_knowledge(ref, events):
    # EVT-01161 (video_started 18:11:20) was ingested at 18:18:05.
    before = replay(events, ref, SCENARIO_NOW.replace(minute=17))
    after = replay(events, ref, SCENARIO_NOW)
    assert before.consults["CON-2107"].stage != "Video Consult In Progress"
    assert after.consults["CON-2107"].stage == "Video Consult In Progress"
    assert after.consults["CON-2107"].stage_entered_at.strftime("%H:%M:%S") == "18:11:20"


def test_follow_up_call_does_not_regress_consult(ref, events):
    st = replay(events, ref, SCENARIO_NOW)
    assert st.consults["CON-2102"].stage == "CT/CTA or Imaging Pending"
    assert derived_state(st, ref, "PHY-003") == "Outgoing Hospital Call"


def test_signal_reconciliation(ref, events):
    st = replay(events, ref, SCENARIO_NOW)
    assert availability(st, ref, "PHY-001")["busy"]  # camera, no Synapse session
    a7 = availability(st, ref, "PHY-007")
    assert not a7["verified"] and a7["ringing"] == "CON-2109" and not a7["routable"]
    assert availability(st, ref, "PHY-008")["unavailable"]
    assert derived_state(st, ref, "PHY-004") == "Documentation / Note"


def test_in_meeting_is_interruptible(ref, events):
    at = SCENARIO_NOW.replace(hour=13, minute=10)
    st = replay(events, ref, at)
    assert st.physicians["PHY-004"].status == "In Meeting"
    assert not availability(st, ref, "PHY-004")["busy"]


def test_candidate_exclusions_are_rule_derived(report):
    by_id = {c["physician_id"]: c for c in report["staffing"]["candidates"]}
    assert report["staffing"]["target"]["hospital_id"] == "SYN-005"
    assert report["staffing"]["selected"] == ["PHY-009"]
    assert by_id["PHY-009"]["eligible"]
    assert by_id["PHY-010"]["failed_rules"] == ["Credentialed at a gap hospital"]
    assert by_id["PHY-011"]["failed_rules"] == ["No overlap with a scheduled shift"]
    assert set(by_id["PHY-012"]["failed_rules"]) == {"Opted in to split-shift offers", "Credentialed at a gap hospital",
                                                     "No overlap with a scheduled shift"}
    assert by_id["PHY-013"]["failed_rules"] == ["Opted in to split-shift offers"]
    assert by_id["PHY-014"]["failed_rules"] == ["Trailing 7-day hours + offer <= 60"]


def test_grace_offer_reduces_suncrest_deficit_100_to_55(report):
    st = report["staffing"]
    assert st["baseline_deficit_minutes"] == 100
    assert st["projected_deficit_minutes"] == 55
    assert st["residual_peak_deficit"] >= 1  # residual shortage stays visible


def test_forecast_has_19_samples_for_every_hospital(report):
    assert len(report["coverage"]["hospitals"]) == 12
    assert all(len(h["samples"]) == 19 for h in report["coverage"]["hospitals"])
    changes = {(c["physician_id"], c["change"]) for c in report["coverage"]["shift_changes"]}
    assert {("PHY-003", "ends"), ("PHY-006", "ends"), ("PHY-011", "starts")} <= changes


def test_split_shift_trap_guard(report):
    ill = report["routing_trap"]["illustration"]
    assert ill["first_in_line_with_guard"] == ["SYN-005"]
    assert len(ill["first_in_line_without_guard"]) > 1


def test_eligibility_boundaries(ref):
    grace = ref.physicians["PHY-009"]
    start = grace.last_shift_end + timedelta(hours=10)  # exactly 10h rest
    r = evaluate_candidate(ref, "PHY-009", frozenset({"SYN-005"}), start, start + timedelta(hours=2), EMPTY_LEDGER)
    assert next(x for x in r["rules"] if x["rule"] == "rest")["passed"]
    early = start - timedelta(minutes=1)
    r = evaluate_candidate(ref, "PHY-009", frozenset({"SYN-005"}), early, early + timedelta(hours=2), EMPTY_LEDGER)
    assert not next(x for x in r["rules"] if x["rule"] == "rest")["passed"]
    # 36 + 24 = 60 is allowed; 36 + 24.5 is not
    s = SCENARIO_NOW
    ok = evaluate_candidate(ref, "PHY-009", frozenset({"SYN-005"}), s, s + timedelta(hours=24), EMPTY_LEDGER)
    assert next(x for x in ok["rules"] if x["rule"] == "weekly_hours")["passed"]
    bad = evaluate_candidate(ref, "PHY-009", frozenset({"SYN-005"}), s, s + timedelta(hours=24.5), EMPTY_LEDGER)
    assert not next(x for x in bad["rules"] if x["rule"] == "weekly_hours")["passed"]
    short = evaluate_candidate(ref, "PHY-009", frozenset({"SYN-005"}), s, s + timedelta(minutes=119), EMPTY_LEDGER)
    assert not next(x for x in short["rules"] if x["rule"] == "duration")["passed"]
    ledger = OfferLedgerView(frozenset(), (), {("PHY-009", s.isocalendar()[:2]): 3})
    capped = evaluate_candidate(ref, "PHY-009", frozenset({"SYN-005"}), s, s + timedelta(hours=2), ledger)
    assert not next(x for x in capped["rules"] if x["rule"] == "weekly_offer_limit")["passed"]


def test_accepted_capacity_starts_after_time_to_online(ref, events):
    st = replay(events, ref, SCENARIO_NOW)
    online = SCENARIO_NOW + timedelta(minutes=15)
    c = Commitment("PHY-009", frozenset({"SYN-005"}), SCENARIO_NOW, SCENARIO_NOW + timedelta(hours=2), online)
    samples = project_hospital(st, ref, "SYN-005", [c])["samples"]
    assert "PHY-009" not in samples[2]["available_ids"]  # 18:30
    assert "PHY-009" in samples[3]["available_ids"]  # 18:35


def test_risks_cover_known_situations(report):
    ids = {r["id"] for r in report["risks"]}
    for expected in ("stage:CON-2102", "stage:CON-2112", "stage:CON-2105", "stage:CON-2110",
                     "camera:PHY-001", "agent:PHY-007", "notes:PHY-003", "spike:SYN-005", "gap:SYN-005"):
        assert expected in ids
    assert all(r["action"]["label"] for r in report["risks"])
