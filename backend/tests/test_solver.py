"""Exercise the installed CP-SAT solver, plus its bounded no-solution fallback."""

import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.services.eligibility import evaluate
from app.services.optimizer import preview

ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 10, 10, 16, tzinfo=UTC)


def problem():
    state = json.loads((ROOT / "data/synthetic/01_split_shift.json").read_text())
    policy = json.loads((ROOT / "config/demo_policies.json").read_text())
    policy["max_solver_seconds"] = 1.0
    # Short routine work offers several genuinely eligible alternatives; the longer
    # urgent case still exercises rejection of the known future-rest trap elsewhere.
    consultation = next(row for row in state["consultations"]
                        if row["status"] == "waiting" and row["duration_minutes"] <= 30)
    return state, consultation["id"], policy


def test_real_cp_sat_returns_verified_bounded_optimum():
    pytest.importorskip("ortools.sat.python.cp_model")
    state, consultation_id, policy = problem()
    before = deepcopy(state)
    result = preview(state, consultation_id, NOW, policy, method="cp_sat")
    solver, selected = result["solver"], result["selected"]
    assert state == before
    assert solver["method"] == "cp_sat", solver
    assert solver["status"] == "optimal" and solver["optimal"], solver
    assert solver["candidate_count"] >= 2
    assert solver["workers"] == 1 and solver["time_limit_seconds"] <= 1
    assert solver["best_bound"] == solver["objective"]
    assert "bounded" in solver["scope"].lower()
    assert selected["score"] == min(item["score"] for item in [selected, *result["alternatives"]])
    checked = evaluate(state, selected["physician_id"], selected["hospital_id"], consultation_id,
                       "contact", NOW, policy, start_at=selected["start_at"], end_at=selected["end_at"])
    assert checked["outcome"] == "eligible"
    assert all(item["eligibility"]["outcome"] != "eligible" for item in result["rejected"])


def test_cp_sat_no_solution_uses_same_feasible_deterministic_fallback(monkeypatch):
    cp_model = pytest.importorskip("ortools.sat.python.cp_model")
    state, consultation_id, policy = problem()
    greedy = preview(state, consultation_id, NOW, policy, method="greedy")
    monkeypatch.setattr(cp_model.CpSolver, "solve", lambda self, model: cp_model.UNKNOWN)
    result = preview(state, consultation_id, NOW, policy, method="cp_sat")
    assert result["selected"] == greedy["selected"]
    assert result["selected"]["eligibility"]["outcome"] == "eligible"
    assert result["solver"]["status"] == "fallback"
    assert result["solver"]["method"] == "greedy"
    assert result["solver"]["fallback_reason"] == "unknown"
    assert result["solver"]["optimal"] is False
