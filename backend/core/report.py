"""Assemble the full operations report from events + reference data + offer ledger."""
from __future__ import annotations

import time
from datetime import datetime

from .coverage import Commitment, project_all
from .data import SCENARIO_NOW, ReferenceData
from .events import Event
from .replay import (OPEN_NOTE_STAGES, State, availability, fmt_et_time, minutes_between,
                     open_consults_for, replay)
from .risks import DOC_STANDARDS, detect
from .routing import route_order, simulate_trap, trap_analysis
from .staffing import EMPTY_LEDGER, OfferLedgerView, recommend
from .verify import compare_snapshot, consult_row, physician_row

ASSUMPTIONS = [
    "Scenario clock is manual (default 18:20 ET on Tue 17 Mar 2026); it is not today's wall clock.",
    "Coverage: busy/unavailable physicians stay that way for the 90-minute horizon (persistent-activity scenario).",
    "Demand: trailing-60-min count = observed arrivals + 12-week weekday mean arrivals for the unobserved part.",
    "Night shifts have no end time in the roster; they are assumed to last 12 hours.",
    "Agent offline: physician counted as available (as routing does) but flagged unverified.",
    "Shared credentials are counted at each hospital; per-hospital capacity must not be summed.",
    "Deficit physician-minutes measure hospital-access coverage, not patient wait time.",
    "Weekly offer limit uses the calendar week (Mon-Sun); the dataset has no historical offer counts, so a fresh run starts at 0.",
    "Simultaneous waiting calls are ordered Stroke first, then oldest receipt (modeling assumption).",
    "Phone-only consults are inferred from the call-ended description text.",
    "Optimizer is exact only for the selected target and a fixed 2-hour offer window.",
]


def physicians_view(state: State, ref: ReferenceData, commitments: list[Commitment]) -> list[dict]:
    out = []
    committed = {c.physician_id: c for c in commitments}
    for pid in sorted(ref.physicians):
        phy = ref.physicians[pid]
        row = physician_row(state, ref, pid)
        a = availability(state, ref, pid)
        p = state.physicians[pid]
        c = committed.get(pid)
        out.append({
            **row,
            "on_roster_shift": phy.on_roster_shift,
            "role": phy.role,
            "routable": a["routable"],
            "busy": a["busy"],
            "ringing_consult": a["ringing"],
            "in_cooldown": a["in_cooldown"],
            "presence_verified": a["verified"],
            "flags": a["flags"],
            "credentials": sorted(ref.credentials.get(pid, ())),
            "open_consult_ids": [x.consult_id for x in open_consults_for(state, pid)],
            "active_call": {"kind": p.active_call[0], "consult_id": p.active_call[1]} if p.active_call else None,
            "active_video": p.active_video[0] if p.active_video else None,
            "planned_capacity": {"hospitals": sorted(c.hospitals), "online_at": c.online_at.isoformat(),
                                 "end": c.end.isoformat(), "offer_id": c.offer_id} if c else None,
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
            datetime.fromisoformat(staffing["offer_window"]["end"]), state.as_of))
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
        "is_reference_time": as_of == SCENARIO_NOW,
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
