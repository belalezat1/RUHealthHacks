"""Assemble the full operations report from events + reference data + offer ledger."""
from __future__ import annotations

import time
from dataclasses import fields, replace
from datetime import datetime, timedelta

from .coverage import Commitment, project_all
from .data import ReferenceData
from .events import Event
from .replay import (OPEN_NOTE_STAGES, State, availability, fmt_et_time, minutes_between,
                     open_consults_for, replay)
from .risks import DOC_STANDARDS, detect
from .routing import route_order, simulate_trap, trap_analysis
from .staffing import EMPTY_LEDGER, OfferLedgerView, recommend
from .verify import compare_snapshot, consult_row, physician_row

ASSUMPTIONS = [
    "Scenario clock follows the supplied dataset day (reference cutoff 18:20 ET); it is not today's wall clock.",
    "Coverage: busy/unavailable physicians stay that way for the 90-minute horizon (persistent-activity scenario).",
    "Demand: trailing-60-min count = observed arrivals + 12-week weekday mean arrivals for the unobserved part.",
    "Night shifts have no end time in the roster; they are assumed to last 12 hours.",
    "Agent offline: physician counted as available (as routing does) but flagged unverified.",
    "Shared credentials are counted at each hospital; per-hospital capacity must not be summed.",
    "Deficit physician-minutes measure hospital-access coverage, not patient wait time.",
    "Weekly offer limit uses the calendar week (Mon-Sun); the dataset has no historical offer counts, so a fresh run starts at 0.",
    "Explicit stage breaches precede gap and workload priorities; a supplied Stroke type is not an independently supplied STAT designation.",
    "Phone-only consults are inferred from the call-ended description text.",
    "Optimizer is exact only for the selected target and a fixed 2-hour offer window.",
    "Accepted offers count only as projected capacity after ETA; imported online evidence is required for actual joiner routing.",
    "No future clinical events, financial values or outcome improvements are generated.",
]


def physicians_view(state: State, ref: ReferenceData, commitments: list[Commitment]) -> list[dict]:
    out = []
    committed = {}
    for c in sorted((c for c in commitments if c.end > state.as_of),
                    key=lambda c: (not (c.start <= state.as_of < c.end), c.start)):
        committed.setdefault(c.physician_id, c)
    for pid in sorted(ref.physicians):
        phy = ref.physicians[pid]
        row = physician_row(state, ref, pid)
        p = state.physicians[pid]
        c = committed.get(pid)
        active = c if c and c.start <= state.as_of < c.end else None
        a = availability(state, ref, pid, active_commitment=active)
        if active is not None:
            row = {**row, "shift_et": f"{active.start:%H:%M}-{active.end:%H:%M}",
                   "derived_state": a["derived_state"],
                   "consults_this_shift": len({cid for t, cid in p.assignment_history if t >= active.start}),
                   "calls_this_shift": sum(t >= active.start for t in p.call_history),
                   "minutes_to_shift_end": int((active.end - state.as_of).total_seconds() // 60)}
        out.append({
            **row,
            "on_roster_shift": phy.on_roster_shift,
            "role": phy.role,
            "routable": a["routable"],
            "busy": a["busy"],
            "ringing_consult": a["ringing"],
            "in_cooldown": a["in_cooldown"],
            "presence_verified": a["verified"],
            "online_evidence_event_ids": a["online_evidence_event_ids"],
            "conflicting_signal_event_ids": a["conflicting_signal_event_ids"],
            "flags": a["flags"],
            "credentials": sorted(ref.credentials.get(pid, ())),
            "open_consult_ids": [x.consult_id for x in open_consults_for(state, pid)],
            "active_call": {"kind": p.active_call[0], "consult_id": p.active_call[1]} if p.active_call else None,
            "active_video": p.active_video[0] if p.active_video else None,
            "planned_capacity": {"hospitals": sorted(c.hospitals), "online_at": c.online_at.isoformat(),
                                 "start": c.start.isoformat(), "end": c.end.isoformat(), "offer_id": c.offer_id,
                                 "capacity_status": "confirmed online" if active and a["verified"] else "planned, pending imported online evidence"} if c else None,
        })
    return out


def consults_view(state: State, ref: ReferenceData) -> list[dict]:
    out = []
    for cid in sorted(state.consults):
        c = state.consults[cid]
        if not c.is_open:
            continue
        row = consult_row(state, ref, cid)
        doc_min = minutes_between(c.clinical_end_at, state.as_of) if c.stage in OPEN_NOTE_STAGES else None
        out.append({
            **row,
            "received_at": c.received_at.isoformat() if c.received_at else None,
            "routing_failures": c.routing_failures,
            "next_retry_at": (c.last_routing_failure_at + timedelta(minutes=5)).isoformat() if c.last_routing_failure_at else None,
            "retry_basis": "policy schedule only; no future observed retry event is generated",
            "receipt_event_ids": c.receipt_event_ids,
            "repeat_receipts": max(0, len(c.receipt_event_ids) - 1),
            "evidence_event_ids": c.event_ids,
            "conflicting_hospital_ids": sorted(c.conflicting_hospital_ids),
            "consult_type_verified": c.consult_type != "Unknown",
            "explicit_urgency": None,
            "ringing_physician": c.ringing_physician,
            "phone_only": c.phone_only,
            "documentation_clock_min": doc_min,
            "documentation_standard": DOC_STANDARDS.get(c.consult_type) if doc_min is not None else None,
            "waiting_for_assignment": c.stage in ("Received", "Triaged") or (c.stage == "Assigned"),
        })
    stage_order = {"Received": 0, "Triaged": 0}
    out.sort(key=lambda r: (0 if r["consult_type"] == "Stroke" else 1,
                            stage_order.get(r["current_stage"], 1), r["received_at"] or ""))
    return out


def build_report(events: list[Event], ref: ReferenceData, as_of: datetime,
                 ledger: OfferLedgerView = EMPTY_LEDGER, *, original_run: bool = True) -> dict:
    t0 = time.perf_counter()
    state = replay(events, ref, as_of)
    if "observed_work_intervals" in {f.name for f in fields(ledger)}:
        ledger = replace(ledger, observed_work_intervals=state.observed_work_intervals)
    t_replay = time.perf_counter()
    commitments = list(ledger.accepted)
    coverage = project_all(state, ref, commitments)
    staffing = recommend(state, ref, coverage, ledger)
    target = staffing["target"]["hospital_id"] if staffing.get("target") else None
    risks = detect(state, ref, coverage, commitments, target)
    trap = trap_analysis(state, ref, commitments)
    if staffing.get("selected"):
        sel = next(c for c in staffing["candidates"] if c["physician_id"] == staffing["selected"][0])
        trap["illustration"] = simulate_trap(state, ref, Commitment(
            sel["physician_id"], frozenset(sel["offer_hospitals"]), state.as_of,
            datetime.fromisoformat(staffing["offer_window"]["end"]), datetime.fromisoformat(sel["online_at"])))
    verification = compare_snapshot(state, ref)
    verification["original_run"] = original_run
    if not original_run:
        verification["label"] = "live data (new events imported; reference snapshot no longer applies)"
    elif not verification["applicable"]:
        verification["label"] = "scenario clock moved from 18:20; reference snapshot applies only at 18:20"
    else:
        verification["label"] = "original snapshot verification"
    t_end = time.perf_counter()
    return {
        "as_of": as_of.isoformat(),
        "is_reference_time": as_of == ref.scenario_now,
        "schema_version": "1.1",
        "policy_version": "challenge-2-v2.1",
        "provenance": {"source": "organizer or judge supplied records", "source_hashes": ref.source_hashes,
                       "runtime_records_generated": False, "reference_snapshot_used_for_verification_only": True},
        "counts": {
            "events_applied": state.events_applied,
            "events_not_yet_visible": state.events_excluded_future,
            "open_consults": sum(1 for c in state.consults.values() if c.is_open),
            "orphan_events": len(state.orphan_event_ids),
        },
        "risks": risks,
        "physicians": physicians_view(state, ref, commitments),
        "consults": consults_view(state, ref),
        "coverage": coverage,
        "staffing": staffing,
        "routing_trap": trap,
        "verification": verification,
        "assumptions": ASSUMPTIONS,
        "engine_timing_ms": {
            "replay": round((t_replay - t0) * 1000, 3),
            "analysis": round((t_end - t_replay) * 1000, 3),
            "total": round((t_end - t0) * 1000, 3),
        },
    }


def eligible_reassignment_targets(events: list[Event], ref: ReferenceData, as_of: datetime,
                                  consult_id: str, commitments: list[Commitment]) -> tuple[dict | None, list[dict]]:
    state = replay(events, ref, as_of)
    c = state.consults.get(consult_id)
    if c is None or not c.is_open:
        return None, []
    consult = {"consult_id": consult_id, "hospital_id": c.hospital_id, "stage": c.stage,
               "physician_id": c.physician_id, "consult_type": c.consult_type}
    targets = route_order(state, ref, c.hospital_id, commitments, exclude=frozenset({c.physician_id or ""}))
    return consult, targets


__all__ = ["build_report", "eligible_reassignment_targets", "ASSUMPTIONS", "fmt_et_time"]
