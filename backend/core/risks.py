"""Detect and rank what needs attention, with a reason and an owner for each item.

Standards are the synthetic thresholds from the challenge brief. The source defines no
Received-stage standard and no General Neuro imaging thresholds; none are invented here.
"""
from __future__ import annotations

from datetime import datetime

from .coverage import Commitment
from .data import ReferenceData
from .replay import OPEN_NOTE_STAGES, State, availability, current_shift, open_consults_for
from .routing import route_order

# (stage, applies_to) -> (warning_min, critical_min)
STAGE_STANDARDS = {
    ("Triaged", "All"): (5, 10),
    ("Assigned", "Stroke"): (3, 8),
    ("CT/CTA or Imaging Pending", "Stroke"): (12, 20),
    ("Imaging Review", "Stroke"): (6, 12),
}
DOC_STANDARDS = {"Stroke": (30, 45), "General Neuro": (45, 90)}
SEVERITY_BASE = {"critical": 300, "warning": 200, "info": 100}


def _minutes(start: datetime | None, end: datetime) -> float | None:
    return None if start is None else (end - start).total_seconds() / 60


def _severity(elapsed: float, warn: float, crit: float) -> str | None:
    if elapsed >= crit:
        return "critical"
    if elapsed >= warn:
        return "warning"
    return None


def _stage_standard(stage: str, consult_type: str) -> tuple[int, int] | None:
    return STAGE_STANDARDS.get((stage, "All")) or STAGE_STANDARDS.get((stage, consult_type))


def detect(state: State, ref: ReferenceData, coverage: dict, commitments: list[Commitment],
           target_hospital: str | None) -> list[dict]:
    now = state.as_of
    risks: list[dict] = []
    avail = {pid: availability(state, ref, pid) for pid in ref.physicians}

    def add(**r) -> None:
        r.setdefault("physician_id", None)
        r.setdefault("consult_id", None)
        r.setdefault("hospital_id", None)
        r.setdefault("threshold", None)
        r.setdefault("elapsed_min", None)
        r["score"] = (SEVERITY_BASE[r["severity"]] + (40 if r.get("stroke") else 0)
                      + min(99, int(r.pop("overage", 0))))
        risks.append(r)

    def reassign_or_escalate(c, why: str) -> dict:
        targets = route_order(state, ref, c.hospital_id, commitments, exclude=frozenset({c.physician_id or ""}))
        if targets:
            t = targets[0]
            return {"action": "reassign", "role": "coordinator",
                    "label": f"Reassign to {t['name']} ({t['physician_id']}), next eligible by routing rules",
                    "target_physician_id": t["physician_id"], "why": why}
        return {"action": "escalate", "role": "clinical_lead",
                "label": "Escalate to clinical lead: no eligible credentialed physician is free", "why": why}

    for c in state.consults.values():
        if not c.is_open:
            continue
        stroke = c.consult_type == "Stroke"
        hosp = ref.hospitals.get(c.hospital_id)
        hname = hosp.name if hosp else c.hospital_id
        elapsed = _minutes(c.stage_entered_at, now) or 0
        std = _stage_standard(c.stage, c.consult_type)
        if std:
            sev = _severity(elapsed, *std)
            if sev:
                detail = f"{c.consult_type} consult at {hname} in {c.stage} for {int(elapsed)} min " \
                         f"(warning {std[0]}, critical {std[1]})"
                if c.stage == "Triaged":
                    if c.routing_failures:
                        detail += f"; routing failed {c.routing_failures}x (no available credentialed provider)"
                    action = reassign_or_escalate(c, "Unassigned past the triage standard")
                elif c.stage == "Assigned":
                    action = reassign_or_escalate(c, "Assigned physician has not made contact")
                elif c.stage == "CT/CTA or Imaging Pending":
                    action = {"action": "escalate", "role": "clinical_lead",
                              "label": "Escalate imaging delay; coordinator contacts hospital imaging",
                              "why": "Imaging overdue against the stroke standard"}
                else:
                    action = {"action": "escalate", "role": "clinical_lead",
                              "label": f"Prompt {c.physician_id} to begin video; escalate if not possible",
                              "why": "Imaging is back but video has not started"}
                add(id=f"stage:{c.consult_id}", kind="stage_breach", severity=sev, stroke=stroke,
                    title=f"{c.consult_id} {c.stage} {int(elapsed)} min", detail=detail,
                    consult_id=c.consult_id, hospital_id=c.hospital_id, physician_id=c.physician_id,
                    stage=c.stage, elapsed_min=int(elapsed), threshold={"warning": std[0], "critical": std[1]},
                    overage=(elapsed - std[1] if sev == "critical" else elapsed - std[0]), action=action)
        if c.stage in OPEN_NOTE_STAGES and c.clinical_end_at:
            doc_elapsed = _minutes(c.clinical_end_at, now) or 0
            w, cr = DOC_STANDARDS[c.consult_type]
            sev = _severity(doc_elapsed, w, cr)
            if sev:
                add(id=f"doc:{c.consult_id}", kind="documentation_delay", severity=sev, stroke=stroke,
                    title=f"{c.consult_id} note open {int(doc_elapsed)} min",
                    detail=f"{c.consult_type} note open {int(doc_elapsed)} min since {c.clinical_end_reason} "
                           f"(warning {w}, critical {cr})",
                    consult_id=c.consult_id, hospital_id=c.hospital_id, physician_id=c.physician_id,
                    stage=c.stage, elapsed_min=int(doc_elapsed), threshold={"warning": w, "critical": cr},
                    overage=doc_elapsed - (cr if sev == "critical" else w),
                    action={"action": "notify", "role": "coordinator",
                            "label": f"Ask {c.physician_id} to complete the note", "why": "Documentation standard"})
        if c.physician_id and c.physician_id in avail:
            a = avail[c.physician_id]
            existing = next((r for r in risks if r["id"] == f"stage:{c.consult_id}"), None)
            if a["unavailable"] and c.stage in ("Assigned", "Provider Contacted", "Triaged") and existing:
                existing["detail"] += f"; assigned physician {c.physician_id} is {a['derived_state']}"
                existing["kind_tags"] = ["assigned_to_unavailable"]
            elif a["unavailable"] and c.stage in ("Assigned", "Provider Contacted", "Triaged"):
                add(id=f"unavail:{c.consult_id}", kind="assigned_to_unavailable",
                    severity="critical" if stroke else "warning", stroke=stroke,
                    title=f"{c.consult_id} assigned to {a['derived_state'].lower()} physician",
                    detail=f"{c.consult_type} consult at {hname} is assigned to {c.physician_id}, "
                           f"who is {a['derived_state']}",
                    consult_id=c.consult_id, hospital_id=c.hospital_id, physician_id=c.physician_id,
                    stage=c.stage, elapsed_min=int(elapsed),
                    action=reassign_or_escalate(c, "Assigned physician is unavailable"))
        if c.ringing_physician:
            a = avail[c.ringing_physician]
            ring_min = _minutes(c.ringing_since, now) or 0
            if not a["verified"]:
                add(id=f"ring:{c.consult_id}", kind="signal_conflict", severity="warning", stroke=stroke,
                    title=f"{c.consult_id} ringing to unverified {c.ringing_physician}",
                    detail=f"Call ringing {int(ring_min)} min to {c.ringing_physician}, whose presence agent is "
                           f"offline; they cannot take another routed call while ringing",
                    consult_id=c.consult_id, hospital_id=c.hospital_id, physician_id=c.ringing_physician,
                    action={"action": "verify", "role": "coordinator",
                            "label": f"Confirm {c.ringing_physician} is actually reachable", "why": "Unverified presence"})

    for pid, phy in ref.physicians.items():
        a = avail[pid]
        shift = current_shift(ref, pid, now)
        if a["derived_state"] == "Camera Active - No Synapse Session":
            add(id=f"camera:{pid}", kind="signal_conflict", severity="warning", physician_id=pid,
                title=f"{pid} camera active, no Synapse session",
                detail=f"{phy.name}: camera active outside a Synapse video and not In Meeting; "
                       f"probable external video, treated as busy for routing",
                action={"action": "verify", "role": "coordinator", "label": f"Check what {pid} is doing",
                        "why": "Contradicting signals"})
        if shift and not state.physicians[pid].agent_online:
            add(id=f"agent:{pid}", kind="signal_conflict", severity="warning", physician_id=pid,
                title=f"{pid} looks available but presence agent is offline",
                detail=f"{phy.name}: self-reported {state.physicians[pid].status}, agent offline since heartbeat "
                       f"loss; routing assumes available, but this is unverified",
                action={"action": "verify", "role": "coordinator", "label": f"Confirm {pid} is at their desk",
                        "why": "Unverified availability"})
        if shift:
            mins_left = (shift[1] - now).total_seconds() / 60
            notes = [c for c in open_consults_for(state, pid) if c.stage in OPEN_NOTE_STAGES]
            if 0 < mins_left <= 60 and notes:
                sev = "critical" if len(notes) >= 2 else "warning"
                add(id=f"notes:{pid}", kind="open_notes_near_shift_end", severity=sev, physician_id=pid,
                    title=f"{pid} {len(notes)} open note(s), shift ends in {int(mins_left)} min",
                    detail=f"{phy.name} has {len(notes)} open note(s) ({', '.join(c.consult_id for c in notes)}) "
                           f"and {len(open_consults_for(state, pid))} open consult(s) with {int(mins_left)} min left",
                    elapsed_min=int(mins_left), threshold={"warning": 1, "critical": 2}, overage=len(notes) * 5,
                    action={"action": "handoff", "role": "coordinator",
                            "label": "Plan note completion / handoff before shift end", "why": "Shift-end standard"})

    for h in coverage["hospitals"]:
        s0 = h["samples"][0]
        if h["spike_now"]:
            add(id=f"spike:{h['hospital_id']}", kind="demand_spike", severity="warning", hospital_id=h["hospital_id"],
                title=f"{h['hospital_name']} demand spike",
                detail=f"{s0['trailing_observed']} consults in the trailing hour vs p90 {s0['p90']}; "
                       f"required credentialed coverage rises from {s0['minimum']} to {s0['required']}",
                overage=(s0["trailing_observed"] - s0["p90"]) * 5,
                action={"action": "propose_offer" if h["deficit_minutes"] else "monitor", "role": "coordinator",
                        "label": "Propose split-shift coverage" if h["deficit_minutes"] else "Monitor",
                        "why": "Demand above baseline"})
        if h["deficit_minutes"]:
            now_gap = s0["deficit"] > 0
            sev = "critical" if now_gap and h["peak_deficit"] >= 2 else ("warning" if now_gap else "info")
            if h["hospital_id"] == target_hospital and sev == "info":
                sev = "warning"
            first = h["first_gap_at"]
            add(id=f"gap:{h['hospital_id']}", kind="coverage_gap", severity=sev, hospital_id=h["hospital_id"],
                title=f"{h['hospital_name']} coverage gap" + ("" if now_gap else f" from {first[11:16]}"),
                detail=f"{h['deficit_minutes']} deficit physician-minutes over 90 min (peak {h['peak_deficit']} "
                       f"short); now {s0['available']} available vs {s0['required']} required",
                overage=h["deficit_minutes"] / 10,
                action={"action": "propose_offer" if h["hospital_id"] == target_hospital else "monitor",
                        "role": "coordinator",
                        "label": "Propose split-shift offer (top target)" if h["hospital_id"] == target_hospital
                        else "Monitor; not the current top target", "why": "Projected coverage gap"})

    risks.sort(key=lambda r: (-r["score"], r["id"]))
    for i, r in enumerate(risks, 1):
        r["rank"] = i
    return risks
