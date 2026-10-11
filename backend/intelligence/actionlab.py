"""Recorded replay comparisons, never counterfactual patient-outcome simulation.

All five policies see exactly the same imported evidence at the same cutoff. Their
outputs are recommendations, not invented acceptances, activations or completions.
"""
from __future__ import annotations

import math
from datetime import datetime

from ..core.data import ReferenceData
from ..core.events import Event
from ..core.replay import replay
from ..core.report import build_report
from ..core.routing import DAY_LOW_VOLUME, NIGHT_LOW_VOLUME, route_order
from ..core.staffing import EMPTY_LEDGER, OfferLedgerView
from .decisions import POLICY_VERSION, build_actions, canonical_hash


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    at = (len(sorted_values) - 1) * quantile
    left, right = math.floor(at), math.ceil(at)
    return round(sorted_values[left] + (sorted_values[right] - sorted_values[left]) * (at - left), 3)


def observed_metrics(events: list[Event], ref: ReferenceData, as_of: datetime) -> dict:
    """Only timestamps in imported evidence establish observed measurements."""
    state = replay(events, ref, as_of)
    visible = [event for event in events if event.event_time <= as_of and event.ingested_at <= as_of]
    first_contact: dict[str, datetime] = {}
    signed: set[str] = set()
    for event in visible:
        if event.consult_id and event.event_type in {"incoming_call_started", "outgoing_call_started", "video_started"}:
            first_contact[event.consult_id] = min(event.event_time,
                                                first_contact.get(event.consult_id, event.event_time))
        if event.consult_id and event.event_type == "note_signed":
            signed.add(event.consult_id)
    waits = []
    outstanding = []
    for cid, consult in state.consults.items():
        if consult.received_at is None:
            continue
        contact = first_contact.get(cid)
        if contact is not None and contact >= consult.received_at:
            waits.append((contact - consult.received_at).total_seconds() / 60)
        elif contact is None:
            outstanding.append((as_of - consult.received_at).total_seconds() / 60)
    workloads = [{"physician_id": pid,
                  "recorded_consults_this_shift": len(physician.consults_this_shift),
                  "recorded_calls_this_shift": physician.calls_this_shift,
                  "workload_verified": bool(physician.shift_started_at),
                  "verification_scope": "Imported shift-start scope for recorded counts; event-stream completeness is not certified",
                  "actual_consults_this_shift": None, "actual_calls_this_shift": None,
                  "workload_basis": "recorded events since imported shift start" if physician.shift_started_at else
                                    "counts of supplied events only; actual shift workload is unknown"}
                 for pid, physician in sorted(state.physicians.items())]
    return {
        "evidence_cutoff": as_of.isoformat(), "visible_event_count": len(visible),
        "unique_consults_with_receipt": sum(c.received_at is not None for c in state.consults.values()),
        "open_consults": sum(c.is_open for c in state.consults.values()),
        "observed_note_signed_consults": len(signed),
        "received_to_first_recorded_contact": {
            "unit": "minutes", "sample_size": len(waits),
            "p50": _percentile(waits, 0.5), "p95": _percentile(waits, 0.95),
            "maximum": round(max(waits), 3) if waits else None,
            "definition": "Earliest supplied call/video start minus earliest receipt; not arrival-to-treatment",
        },
        "awaiting_first_recorded_contact": {
            "sample_size": len(outstanding), "maximum_elapsed_minutes": round(max(outstanding), 3) if outstanding else None,
            "censored": True,
        },
        "physician_workloads": workloads,
        "patient_outcome_improvement": None, "policy_specific_wait_reduction": None,
        "financial_savings": None,
        "unavailable_reason": "No counterfactual responses, completion times, clinical outcomes or financial evidence supplied",
    }


def conditional_scope_analysis(report: dict, ref: ReferenceData) -> dict:
    """Demonstrate routing exposure without manufacturing an online physician.

    Credential intersections and scope are factual; current workload is recorded.
    Admission/online/free status remains an explicit condition, not an observed event.
    """
    staffing = report.get("staffing", {})
    selected = staffing.get("selected", [])
    by_id = {c["physician_id"]: c for c in staffing.get("candidates", [])}
    recorded_work = {p["physician_id"]: p for p in report.get("physicians", [])}
    rows = []
    for pid in selected:
        candidate = by_id.get(pid)
        if not candidate or not candidate.get("eligible"):
            continue
        scope = set(candidate.get("offer_hospitals", []))
        credential_scope = set(ref.credentials.get(pid, ()))
        threshold = NIGHT_LOW_VOLUME if ref.physicians[pid].is_night else DAY_LOW_VOLUME
        workload_row = recorded_work.get(pid, {})
        workload = workload_row.get("consults_this_shift")
        verified = workload_row.get("workload_verified", False)
        # Missing counts stay unknown. No future workload is inferred from current counts.
        current_low_volume = workload <= threshold if isinstance(workload, int) else None
        rows.append({
            "physician_id": pid, "recorded_consults_this_shift": workload,
            "workload_verified": verified,
            "verification_scope": "Imported shift-start scope for recorded counts; actual workload completeness is unverified",
            "actual_consults_this_shift": None,
            "workload_basis": workload_row.get("workload_basis", "Actual shift workload is unknown"),
            "low_volume_threshold": threshold, "current_recorded_low_volume_priority": current_low_volume,
            "verified_low_volume_priority": None,
            "challenge_policy_assumption": "Supplied-event count is the challenge router's workload proxy; no records does not prove actual workload zero",
            "naive_hospital_scope": sorted(credential_scope), "guarded_hospital_scope": sorted(scope),
            "protected_from_unscoped_routing": sorted(credential_scope - scope),
            "offered_minutes_to_online": candidate.get("minutes_to_online"),
        })
    return {
        "kind": "conditional_scope_analysis", "observed_online_activation": False,
        "candidates": rows,
        "condition": "Routing exposure applies only if the proposed physician later becomes confirmed online and free. "
                     "An unscoped router could use all credentials; the guard admits only offered hospitals.",
        "interpretation": "Low supplied-event counts explain the challenge router's workload-proxy trap; actual workload can remain unknown. This is a policy comparison "
                          "on one recorded state, not a forecast of future assignments or measured overload reduction.",
        "future_assignments_generated": 0,
    }


def build_actionlab(events: list[Event], ref: ReferenceData, as_of: datetime, *,
                    ledger: OfferLedgerView = EMPTY_LEDGER, decision: dict | None = None,
                    report: dict | None = None, run_id: str = "", revision: int = 0) -> dict:
    report = report or build_report(events, ref, as_of, ledger, original_run=False)
    state = replay(events, ref, as_of)
    actions, baseline_id = build_actions(report, run_id=run_id, revision=revision)
    baseline = next(action for action in actions if action["action_id"] == baseline_id)
    trap = conditional_scope_analysis(report, ref)
    routing = []
    for consult in report.get("consults", []):
        if consult.get("current_stage") not in {"Received", "Triaged", "Assigned"}:
            continue
        order = route_order(state, ref, consult["hospital_id"], list(ledger.accepted),
                            exclude=frozenset({consult.get("physician_id") or ""}))
        routing.append({"consult_id": consult["consult_id"], "hospital_id": consult["hospital_id"],
                        "ranked_physician_ids": [candidate["physician_id"] for candidate in order],
                        "recommended_physician_id": order[0]["physician_id"] if order else None})

    matching_decision = (decision is not None and decision.get("run_id") == run_id
                         and decision.get("revision") == revision and decision.get("as_of") == as_of.isoformat()
                         and decision.get("input_hash") is not None and decision.get("status") != "stale"
                         and decision.get("policy_version") == report.get("policy_version", POLICY_VERSION)
                         and decision.get("selected_action_id") in {action["action_id"] for action in actions})
    selected_jev_action = decision.get("selected_action") if matching_decision else None
    scope_rows = trap["candidates"]
    policies = [
        {"policy": "no_action", "recommendation": None, "status": "comparison",
         "explanation": "Retain the recorded state; no intervention recommendation"},
        {"policy": "deterministic_routing", "status": "recommendation_preview",
         "routing_previews": routing, "recommendation": None,
         "explanation": "Independent per-consult router previews from this cutoff, not simultaneous assignments"},
        {"policy": "naive_split_shift", "status": "unsafe_comparator_only",
         "recommendation": {"physician_ids": baseline["physician_ids"],
                            "scope_by_physician": {r["physician_id"]: r["naive_hospital_scope"] for r in scope_rows}},
         "explanation": "Conditional unscoped credential exposure; cannot be executed through the offer workflow"},
        {"policy": "scoped_split_shift", "status": "recommendation_preview",
         "recommendation": baseline,
         "explanation": "Canonical hard-gated deterministic recommendation with hospital scope"},
        {"policy": "jev_selected", "status": "stored_decision_replay" if matching_decision else "unavailable",
         "recommendation": selected_jev_action, "decision_id": decision["decision_id"] if matching_decision else None,
         "actual_source": decision.get("source") if matching_decision else None,
         "provider_status": decision.get("provider", {}).get("status") if matching_decision else "not_requested",
         "fallback_reason": decision.get("fallback_reason") if matching_decision else "No stored decision matches this run and revision",
         "explanation": "Replay the recorded provider/fallback decision; do not call Jev during a read-only comparison"},
    ]
    identity = {
        "as_of": as_of.isoformat(), "run_id": run_id, "revision": revision,
        "policy_version": report.get("policy_version", POLICY_VERSION),
        "source_hashes": ref.source_hashes,
        "events": [event.to_row() for event in sorted(events, key=Event.sort_key)],
        "ledger": {"policy_mode": ledger.policy_mode,
                   "historical_reservations": [{"physician_id": c.physician_id, "start": c.start.isoformat(),
                       "end": c.end.isoformat(), "offer_id": c.offer_id}
                       for c in sorted(ledger.historical_reservations, key=lambda c: (c.physician_id, c.start, c.offer_id))],
                   "observed_work_intervals": {pid: [[s.isoformat(), e.isoformat()] for s, e in sorted(intervals)]
                       for pid, intervals in sorted((ledger.observed_work_intervals or {}).items())},
                   "open": sorted(ledger.open_offer_physicians),
                   "accepted": [{"physician_id": commitment.physician_id,
                                 "hospitals": sorted(commitment.hospitals),
                                 "start": commitment.start.isoformat(), "end": commitment.end.isoformat(),
                                 "online_at": commitment.online_at.isoformat(), "offer_id": commitment.offer_id}
                                for commitment in sorted(ledger.accepted,
                                    key=lambda c: (c.physician_id, c.start, c.offer_id))],
                   "sent_counts": sorted((pid, year_week, count) for (pid, year_week), count
                                          in ledger.sent_counts_by_week.items())},
        "decision": {"decision_id": decision["decision_id"], "input_hash": decision["input_hash"],
                     "source": decision.get("source"), "selected_action_id": decision.get("selected_action_id")}
                    if matching_decision else None,
    }
    return {
        "schema_version": "1.0", "scope": "recorded_replay", "run_id": run_id,
        "revision": revision, "as_of": as_of.isoformat(),
        "input_hash": canonical_hash(identity), "policy_version": identity["policy_version"],
        "source_hashes": ref.source_hashes,
        "observed_metrics": observed_metrics(events, ref, as_of),
        "policies": policies, "split_shift_trap": trap,
        "projection": {
            "kind": "conditional_coverage_projection", "is_observed_outcome": False,
            "baseline_deficit_minutes": report.get("staffing", {}).get("baseline_deficit_minutes"),
            "scoped_offer_projected_deficit_minutes": report.get("staffing", {}).get("projected_deficit_minutes"),
            "unit": "hospital-access physician-minutes, not patient waiting time",
            "assumptions": report.get("assumptions", []),
        },
        "limits": ["Each policy sees the same imported records and cutoff",
                   "No simulated patients, arrivals, consent, activation or completion events",
                   "Observed metrics are shared evidence, not outcomes attributed to a policy",
                   "Offer effectiveness and routing exposure are labeled conditional projections",
                   "Patient outcomes and financial savings are unavailable"],
        "generated_event_count": 0,
    }
