"""Bounded, isolated replay using the same pure forecast, optimizer, and rules."""

import copy
import hashlib
import json
import time
from datetime import datetime, timedelta

from app.core.clock import SimulationClock, utc
from app.services.availability import signal_order
from app.services.eligibility import evaluate
from app.services.forecast import build_forecast
from app.services.optimizer import preview
from app.simulation.metrics import DEFINITIONS, calculate
from app.simulation.scenarios import prepare


def _apply(state: dict, event: dict, seen: set[str]) -> str:
    if event["event_id"] in seen:
        return "duplicate"
    seen.add(event["event_id"])
    payload = copy.deepcopy(event["payload"])
    if event["event_type"] == "consultation.created":
        state["consultations"].append(payload)
    else:
        prior = [row for row in state.get("signals", []) if all(row.get(k) == payload.get(k)
                 for k in ("physician_id", "kind", "source"))]
        latest = max(prior, key=signal_order, default=None)
        if latest and signal_order(payload) < signal_order(latest):
            return "late"
        state["signals"].append(payload)
    state["source_version"] = state.get("source_version", 0) + 1
    return "applied"


def _one_policy(initial: dict, events: list[dict], now: datetime, policy: dict, method: str) -> tuple[dict, list[dict], list[dict]]:
    state = copy.deepcopy(initial)
    state.setdefault("assignments", [])
    state.setdefault("signals", [])
    state.setdefault("consultations", [])
    represented = {assignment["consultation_id"] for assignment in state["assignments"]}
    for consultation in state["consultations"]:
        if (consultation["status"] in {"active", "assigned"} and consultation.get("physician_id")
                and consultation["id"] not in represented):
            starts = utc(consultation.get("assigned_at") or consultation["requested_at"])
            ends = utc(consultation["expected_end_at"]) if consultation.get("expected_end_at") else starts + timedelta(minutes=consultation["duration_minutes"])
            state["assignments"].append({"id": f"simulation-existing-{consultation['id']}",
                "consultation_id": consultation["id"], "physician_id": consultation["physician_id"],
                "hospital_id": consultation["hospital_id"], "start_at": starts.isoformat(),
                "end_at": ends.isoformat(), "status": "assigned"})
    clock = SimulationClock(now)
    end = now + timedelta(minutes=90)
    original_shifts = copy.deepcopy(state.get("shifts", []))
    cohort = {row["id"] for row in state["consultations"] if row["status"] != "completed"}
    assigned_at = {row["consultation_id"]: utc(row["start_at"]) for row in state["assignments"]
                   if row["consultation_id"] in cohort}
    seen, trace, solver_results = set(), [], []
    latencies = []
    event_index, activations, violations, uncovered, overtime = 0, 0, 0, 0.0, 0.0
    for minute in range(91):
        instant = clock.now()
        while event_index < len(events) and utc(events[event_index]["at"]) <= instant:
            event = events[event_index]
            outcome = _apply(state, event, seen)
            if event["event_type"] != "availability" or outcome != "applied" or "heartbeat" not in event["event_id"]:
                trace.append({"policy": method, "at": instant.isoformat(), "action": "scenario_event",
                              "event_id": event["event_id"], "event_type": event["event_type"], "outcome": outcome})
            event_index += 1
        for assignment in state["assignments"]:
            if assignment["status"] != "completed" and utc(assignment["end_at"]) <= instant:
                assignment["status"] = "completed"
                consultation = next((c for c in state["consultations"] if c["id"] == assignment["consultation_id"]), None)
                if consultation:
                    consultation["status"] = "completed"
                state["source_version"] = state.get("source_version", 0) + 1
                trace.append({"policy": method, "at": instant.isoformat(), "action": "completed", "consultation_id": assignment["consultation_id"]})
        if minute == 90:
            break
        waiting = [c for c in state["consultations"] if c["status"] == "waiting" and utc(c["requested_at"]) <= instant]
        waiting.sort(key=lambda c: (0 if c["priority"] == "urgent" else 1, c["deadline_at"], c["requested_at"], c["id"]))
        for consultation in waiting[:30]:
            started = time.perf_counter()
            recommendation = preview(state, consultation["id"], instant, policy, method=method)
            latencies.append((time.perf_counter() - started) * 1000)
            candidate = recommendation.get("selected")
            if not candidate:
                continue
            physician = candidate["physician_id"]
            starts, ends = utc(candidate["start_at"]), utc(candidate["end_at"])
            if starts > instant:
                # Do not reserve or grant future work based on information not yet observed.
                continue
            activate = candidate.get("action") == "activate"
            trial = copy.deepcopy(state)
            if activate:
                trial.setdefault("shifts", []).append({
                    "id": f"simulation-activation-{consultation['id']}", "physician_id": physician,
                    "hospital_id": consultation["hospital_id"], "start_at": starts.isoformat(),
                    "end_at": ends.isoformat(), "status": "scheduled", "mandatory": False,
                })
                for kind, value in [("heartbeat", "connected"), ("self_report", "available"), ("activation", "active")]:
                    trial["signals"].append({"id": f"simulation-{kind}-{consultation['id']}", "physician_id": physician,
                        "source": "simulation", "kind": kind, "value": value,
                        "observed_at": instant.isoformat(), "received_at": instant.isoformat()})
            check = evaluate(trial, physician, consultation["hospital_id"], consultation["id"], "assign", instant,
                             policy, consent=True, start_at=starts, end_at=ends)
            if check["outcome"] != "eligible":
                violations += 1
                trace.append({"policy": method, "at": instant.isoformat(), "action": "final_validation_rejected",
                              "physician_id": physician, "consultation_id": consultation["id"], "rules": check["rules"]})
                continue
            state = trial
            consultation = next(c for c in state["consultations"] if c["id"] == consultation["id"])
            consultation.update(status="assigned", physician_id=physician)
            state["assignments"].append({"id": f"simulation-assignment-{consultation['id']}",
                "physician_id": physician, "hospital_id": consultation["hospital_id"],
                "consultation_id": consultation["id"], "start_at": starts.isoformat(),
                "end_at": ends.isoformat(), "status": "verified"})
            assigned_at[consultation["id"]] = instant
            state["source_version"] = state.get("source_version", 0) + 1
            activations += int(activate)
            solver_results.append(recommendation.get("solver", {}))
            trace.append({"policy": method, "at": instant.isoformat(), "action": "simulated_assignment",
                          "physician_id": physician, "consultation_id": consultation["id"], "activation": activate,
                          "synthetic_consent": True, "synthetic_activation_evidence": activate,
                          "eligibility": check["outcome"]})
        # Integrate only the first bin, avoiding double-counting 90-minute forecasts at every tick.
        forecast = build_forecast(state, instant, policy)
        if forecast.get("intervals"):
            first = forecast["intervals"][0]
            bin_minutes = max(1, (utc(first["end_at"]) - utc(first["start_at"])).total_seconds() / 60)
            uncovered += first["unmet_minutes"] / bin_minutes
        for assignment in state["assignments"]:
            if assignment["status"] == "completed" or not utc(assignment["start_at"]) <= instant < utc(assignment["end_at"]):
                continue
            if not any(s["physician_id"] == assignment["physician_id"] and s.get("status") != "cancelled" and
                       utc(s["start_at"]) <= instant < utc(s["end_at"]) for s in original_shifts):
                overtime += 1
        clock.advance(1)
    metrics = calculate(state, assigned_at, now, end, uncovered, overtime, activations, violations, latencies)
    return metrics, trace, solver_results


def run_simulation(state: dict, scenario: str, seed: int, now: datetime, policy: dict) -> dict:
    if len(state.get("physicians", [])) > 100 or len(state.get("consultations", [])) > 300:
        raise ValueError("Simulation is bounded to 100 physicians and 300 consultations")
    initial, events, assumptions = prepare(state, scenario, seed, now, policy)
    baseline, baseline_trace, baseline_solvers = _one_policy(initial, events, now, policy, "baseline")
    optimized, optimized_trace, optimized_solvers = _one_policy(initial, events, now, policy, "greedy")
    return {"baseline": baseline, "optimized": optimized, "trace": baseline_trace + optimized_trace,
            "metadata": {
                "dataset_id": state["dataset_id"], "source_version": state.get("source_version", 0),
                "dataset_hash": hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest(),
                "scenario_state_hash": hashlib.sha256(json.dumps(initial, sort_keys=True).encode()).hexdigest(),
                "scenario": scenario, "seed": seed, "start_time": now.isoformat(),
                "end_time": (now + timedelta(minutes=90)).isoformat(), "window_minutes": 90, "tick_minutes": 1,
                "policy_version": policy.get("version", "demo-v1"),
                "solver_configuration": {"baseline": "baseline", "optimized": "greedy", "cp_sat": False},
                "solver_status": {"baseline": baseline_solvers, "optimized": optimized_solvers},
                "advisory_mode": "off", "external_calls": False, "synthetic": True,
                "assumptions": assumptions, "metric_definitions": DEFINITIONS,
                "reproducibility": "Domain metrics and traces are deterministic for the same snapshot, clock, seed and policy. Measured decision latency varies by machine.",
            }}
