import copy
from datetime import datetime, timedelta, timezone

from app.simulation.metrics import calculate
from app.simulation.replay import _apply, _one_policy, run_simulation
from app.simulation.scenarios import SCENARIOS, prepare

NOW = datetime(2026, 10, 10, 16, tzinfo=timezone.utc)


def sample():
    return {
        "dataset_id": "replay-test", "source_version": 1,
        "hospitals": [{"id": "h1", "name": "Synthetic", "jurisdiction": "NJ", "specialty": "neurology",
                       "timezone": "America/New_York", "minimum_coverage": 0, "arrival_work_minutes_per_bin": 0}],
        "physicians": [{"id": "p1", "name": "Synthetic clinician", "specialties": ["neurology"], "max_concurrent": 1}],
        "credentials": [
            {"id": "license", "physician_id": "p1", "kind": "license", "jurisdiction": "NJ", "expires_at": (NOW + timedelta(days=1)).isoformat()},
            {"id": "privilege", "physician_id": "p1", "kind": "privilege", "hospital_id": "h1", "expires_at": (NOW + timedelta(days=1)).isoformat()},
        ],
        "shifts": [{"id": "s1", "physician_id": "p1", "hospital_id": "h1", "start_at": (NOW - timedelta(minutes=30)).isoformat(),
                    "end_at": (NOW + timedelta(minutes=90)).isoformat(), "status": "scheduled", "mandatory": False}],
        "signals": [{"id": f"signal-{kind}", "physician_id": "p1", "source": kind, "kind": kind, "value": value,
                     "observed_at": NOW.isoformat(), "received_at": NOW.isoformat()}
                    for kind, value in [("heartbeat", "connected"), ("self_report", "available")]],
        "consultations": [], "assignments": [],
    }


def stable(result):
    result = copy.deepcopy(result)
    for name in ["baseline", "optimized"]:
        result[name].pop("decision_latency_ms", None)
    return result


def test_replay_is_isolated_and_deterministic_with_unresolved_counts():
    original = sample()
    before = copy.deepcopy(original)
    policy = {"version": "test", "heartbeat_freshness_seconds": 300,
              "self_report_freshness_seconds": 7200, "min_rest_minutes": 120}
    first = run_simulation(original, "cross_hospital", 42, NOW, policy)
    second = run_simulation(original, "cross_hospital", 42, NOW, policy)
    assert original == before
    assert stable(first) == stable(second)
    assert first["metadata"]["external_calls"] is False
    assert first["metadata"]["window_minutes"] == 90
    assert first["baseline"]["constraint_violations"] == 0
    assert "unassigned_consults" in first["optimized"] and "unfinished_consults" in first["optimized"]
    assert first["optimized"]["completed_consults"] > 0
    created = [row for row in first["trace"] if row.get("event_type") == "consultation.created"]
    assert all(row["at"] >= (NOW + timedelta(minutes=5)).isoformat() for row in created)


def test_all_scenarios_supported_and_future_commitment_is_preserved():
    for scenario in SCENARIOS:
        initial, events, assumptions = prepare(sample(), scenario["id"], 9, NOW)
        assert initial is not sample() and events and assumptions
    initial, _, _ = prepare(sample(), "split_shift_trap", 9, NOW)
    future = [row for row in initial["shifts"] if row["id"] == "scenario-future-commitment"]
    assert future[0]["start_at"] > (NOW + timedelta(minutes=90)).isoformat()


def test_duplicate_and_late_replay_events_do_not_change_version():
    initial, events, _ = prepare(sample(), "duplicate_late", 9, NOW)
    selected = [event for event in events if event["event_id"] in {"sim-sequence-event", "sim-late-event"}]
    seen = set()
    assert _apply(initial, selected[0], seen) == "applied"
    version = initial["source_version"]
    assert _apply(initial, selected[1], seen) == "duplicate"
    assert _apply(initial, selected[2], seen) == "late"
    assert initial["source_version"] == version


def test_unassigned_waits_are_not_hidden_by_mean():
    state = sample()
    state["consultations"] = [{"id": "waiting", "requested_at": NOW.isoformat(),
                                "deadline_at": (NOW + timedelta(minutes=15)).isoformat(),
                                "priority": "urgent", "status": "waiting"}]
    metrics = calculate(state, {}, NOW, NOW + timedelta(minutes=90), 0, 0, 0, 0, [])
    assert metrics["mean_wait_minutes"] == 90 and metrics["p95_wait_minutes"] == 90
    assert metrics["urgent_delay_minutes"] == 75
    assert metrics["unassigned_consults"] == metrics["unfinished_consults"] == 1


def test_existing_active_work_completes_only_in_replay_and_does_not_wait_again():
    state = sample()
    state["consultations"] = [{"id": "existing", "hospital_id": "h1", "physician_id": "p1",
        "specialty": "neurology", "priority": "urgent", "status": "active", "duration_minutes": 20,
        "requested_at": (NOW - timedelta(minutes=10)).isoformat(),
        "deadline_at": NOW.isoformat(), "expected_end_at": (NOW + timedelta(minutes=10)).isoformat()}]
    original = copy.deepcopy(state)
    metrics, trace, _ = _one_policy(state, [], NOW, {"self_report_freshness_seconds": 7200}, "baseline")
    assert state == original
    assert metrics["mean_wait_minutes"] == 0 and metrics["unfinished_consults"] == 0
    completion = next(row for row in trace if row["action"] == "completed")
    assert completion["at"] == (NOW + timedelta(minutes=10)).isoformat()


def test_heartbeat_replay_preserves_source_sequence_ordering():
    state = sample()
    state["signals"][0]["source_sequence"] = 50
    _, events, _ = prepare(state, "cross_hospital", 9, NOW)
    heartbeat = [event["payload"] for event in events if "sim-heartbeat" in event["event_id"]]
    assert heartbeat[0]["source_sequence"] > 50
    assert all(right["source_sequence"] > left["source_sequence"] for left, right in zip(heartbeat, heartbeat[1:]))
