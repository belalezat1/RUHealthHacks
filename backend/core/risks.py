"""Detect and rank what needs attention, with a reason and an owner for each item.

Each risk carries a short ``title`` and one-line ``summary`` for the UI, a longer ``detail``
for the expanded view, and exactly one ``action`` (reassign, escalate, nudge, propose_offer
or monitor).

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
STAGE_SHORT = {"Triaged": "unassigned", "Assigned": "not contacted", "CT/CTA or Imaging Pending": "imaging pending",
               "Imaging Review": "video not started"}


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


def _nudge(pid: str, why: str) -> dict:
    return {"action": "nudge", "role": "coordinator", "label": f"Nudge {pid}", "target_physician_id": pid, "why": why}


def detect(state: State, ref: ReferenceData, coverage: dict, commitments: list[Commitment],
           target_hospital: str | None) -> list[dict]:
    now = state.as_of
    risks: list[dict] = []
    active_commitments = {c.physician_id: c for c in commitments if c.start <= now < c.end}
    avail = {pid: availability(state, ref, pid, active_commitment=active_commitments.get(pid)) for pid in ref.physicians}

    def add(**r) -> None:
        r.setdefault("physician_id", None)
        r.setdefault("consult_id", None)
        r.setdefault("hospital_id", None)
        r.setdefault("threshold", None)
        r.setdefault("elapsed_min", None)
        r["score"] = (SEVERITY_BASE[r["severity"]] + (40 if r.get("stroke") else 0)
                      + min(99, int(r.pop("overage", 0))))
        r["policy_version"] = "challenge-2-v2.1"
        r["as_of"] = now.isoformat()
        r["evidence_event_ids"] = list(state.consults[r["consult_id"]].event_ids) if r["consult_id"] else []
        r["alternatives"] = (["Escalate to clinical lead if no safe assignment is available"]
                             if r["action"]["action"] == "reassign" else
                             ["Monitor recorded evidence and re-evaluate; do not bypass eligibility or approval"])
        risks.append(r)

    def reassign_or_escalate(c, why: str) -> dict:
        if c.conflicting_hospital_ids:
            return {"action": "escalate", "role": "clinical_lead", "label": "Resolve conflicting hospital evidence",
                    "why": "Consult receipts name conflicting hospitals; no automatic hospital-specific reassignment is safe"}
        targets = route_order(state, ref, c.hospital_id, commitments, exclude=frozenset({c.physician_id or ""}))
        if targets:
            t = targets[0]
            return {"action": "reassign", "role": "coordinator", "label": f"Reassign to {t['physician_id']}",
                    "target_physician_id": t["physician_id"], "why": why}
        return {"action": "escalate", "role": "clinical_lead", "label": "Escalate",
                "why": why + "; no free credentialed physician"}

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
                limit = std[1] if sev == "critical" else std[0]
                detail = (f"{c.consult_type} consult at {hname} in {c.stage} for {int(elapsed)} min "
                          f"(warning {std[0]}, critical {std[1]})")
                summary = f"{hname} · {int(elapsed)} min (limit {limit})"
                if c.stage == "Triaged":
                    if c.routing_failures:
                        detail += f"; routing failed {c.routing_failures}x (no available credentialed provider)"
                        summary += f" · routing failed {c.routing_failures}x"
                    action = reassign_or_escalate(c, "Unassigned past the triage standard")
                elif c.stage == "Assigned":
                    action = reassign_or_escalate(c, "Assigned physician has not made contact")
                elif c.stage == "CT/CTA or Imaging Pending":
                    action = {"action": "escalate", "role": "clinical_lead", "label": "Escalate",
                              "why": "Imaging overdue against the stroke standard"}
                else:
                    action = _nudge(c.physician_id or "", "Imaging is back but video has not started")
                add(id=f"stage:{c.consult_id}", kind="stage_breach", severity=sev, stroke=stroke,
                    title=f"{c.consult_id} {STAGE_SHORT.get(c.stage, c.stage)}", summary=summary, detail=detail,
                    consult_id=c.consult_id, hospital_id=c.hospital_id, physician_id=c.physician_id,
                    stage=c.stage, elapsed_min=int(elapsed), threshold={"warning": std[0], "critical": std[1]},
                    overage=elapsed - limit, action=action)
        if c.stage in OPEN_NOTE_STAGES and c.clinical_end_at and c.consult_type in DOC_STANDARDS:
            doc_elapsed = _minutes(c.clinical_end_at, now) or 0
            w, cr = DOC_STANDARDS[c.consult_type]
            sev = _severity(doc_elapsed, w, cr)
            if sev:
                limit = cr if sev == "critical" else w
                add(id=f"doc:{c.consult_id}", kind="documentation_delay", severity=sev, stroke=stroke,
                    title=f"{c.consult_id} note overdue",
                    summary=f"{c.physician_id} · {int(doc_elapsed)} min (limit {limit})",
                    detail=(f"{c.consult_type} note open {int(doc_elapsed)} min since {c.clinical_end_reason} "
                            f"(warning {w}, critical {cr})"),
                    consult_id=c.consult_id, hospital_id=c.hospital_id, physician_id=c.physician_id,
                    stage=c.stage, elapsed_min=int(doc_elapsed), threshold={"warning": w, "critical": cr},
                    overage=doc_elapsed - limit, action=_nudge(c.physician_id or "", "Documentation standard"))
        if c.physician_id and c.physician_id in avail:
            a = avail[c.physician_id]
            waiting = c.stage in ("Assigned", "Provider Contacted", "Triaged")
            existing = next((r for r in risks if r["id"] == f"stage:{c.consult_id}"), None)
            if a["unavailable"] and waiting and existing:
                existing["detail"] += f"; assigned physician {c.physician_id} is {a['derived_state']}"
                existing["summary"] += f" · {c.physician_id} unavailable"
                existing["kind_tags"] = ["assigned_to_unavailable"]
            elif a["unavailable"] and waiting:
                add(id=f"unavail:{c.consult_id}", kind="assigned_to_unavailable",
                    severity="critical" if stroke else "warning", stroke=stroke,
                    title=f"{c.consult_id} physician unavailable",
                    summary=f"{c.physician_id} is {a['derived_state']}",
                    detail=(f"{c.consult_type} consult at {hname} is assigned to {c.physician_id}, "
                            f"who is {a['derived_state']}"),
                    consult_id=c.consult_id, hospital_id=c.hospital_id, physician_id=c.physician_id,
                    stage=c.stage, elapsed_min=int(elapsed),
                    action=reassign_or_escalate(c, "Assigned physician is unavailable"))
        if c.ringing_physician:
            a = avail[c.ringing_physician]
            ring_min = _minutes(c.ringing_since, now) or 0
            if not a["verified"]:
                add(id=f"ring:{c.consult_id}", kind="signal_conflict", severity="warning", stroke=stroke,
                    title=f"{c.consult_id} ringing to offline agent",
                    summary=f"{c.ringing_physician} · presence unverified",
                    detail=(f"Call ringing {int(ring_min)} min to {c.ringing_physician}, whose presence agent is "
                            f"offline; they cannot take another routed call while ringing"),
                    consult_id=c.consult_id, hospital_id=c.hospital_id, physician_id=c.ringing_physician,
                    action=_nudge(c.ringing_physician, "Confirm the physician is reachable"))

    for pid, phy in ref.physicians.items():
        a = avail[pid]
        shift = current_shift(ref, pid, now)
        commitment = active_commitments.get(pid)
        if commitment is not None:
            shift = (commitment.start, commitment.end)
        if state.physicians[pid].conflicting_signals:
            add(id=f"conflict:{pid}", kind="signal_conflict", severity="warning", physician_id=pid,
                title=f"{pid} conflicting availability", summary="Equal-time source records disagree · availability unverified",
                detail="No ingestion-order winner is assumed; exclude from routing until newer consistent evidence arrives",
                action=_nudge(pid, "Resolve contradictory availability evidence"))
        if a["derived_state"] == "Camera Active - No Synapse Session":
            add(id=f"camera:{pid}", kind="signal_conflict", severity="warning", physician_id=pid,
                title=f"{pid} on external video?", summary="Camera on, no Synapse session · treated as busy",
                detail=(f"{phy.name}: camera active outside a Synapse video and not In Meeting; "
                        f"probable external video, treated as busy for routing"),
                action=_nudge(pid, "Contradicting signals"))
        if shift and not state.physicians[pid].agent_online:
            add(id=f"agent:{pid}", kind="signal_conflict", severity="warning", physician_id=pid,
                title=f"{pid} presence unverified", summary="Shows Available, but desktop agent is offline",
                detail=(f"{phy.name}: self-reported {state.physicians[pid].status}, agent offline since heartbeat "
                        f"loss; routing assumes available, but this is unverified"),
                action=_nudge(pid, "Unverified availability"))
        if shift:
            mins_left = (shift[1] - now).total_seconds() / 60
            notes = [c for c in open_consults_for(state, pid) if c.stage in OPEN_NOTE_STAGES]
            if 0 < mins_left <= 60 and notes:
                sev = "critical" if len(notes) >= 2 else "warning"
                plural = "s" if len(notes) > 1 else ""
                add(id=f"notes:{pid}", kind="open_notes_near_shift_end", severity=sev, physician_id=pid,
                    title=f"{pid} notes open near shift end",
                    summary=f"{len(notes)} open note{plural} · shift ends in {int(mins_left)} min",
                    detail=(f"{phy.name} has {len(notes)} open note(s) ({', '.join(c.consult_id for c in notes)}) "
                            f"and {len(open_consults_for(state, pid))} open consult(s) with {int(mins_left)} min left"),
                    elapsed_min=int(mins_left), threshold={"warning": 1, "critical": 2}, overage=len(notes) * 5,
                    action=_nudge(pid, "Close notes or hand off before shift end"))

    for h in coverage["hospitals"]:
        s0 = h["samples"][0]
        is_target = h["hospital_id"] == target_hospital
        if h["spike_now"]:
            add(id=f"spike:{h['hospital_id']}", kind="demand_spike", severity="warning", hospital_id=h["hospital_id"],
                title=f"{h['hospital_name']} demand spike",
                summary=f"{s0['trailing_observed']} consults last hour (usual up to {s0['p90']})",
                detail=(f"{s0['trailing_observed']} consults in the trailing hour vs p90 {s0['p90']}; "
                        f"required credentialed coverage rises from {s0['minimum']} to {s0['required']}"),
                overage=(s0["trailing_observed"] - s0["p90"]) * 5,
                action={"action": "propose_offer" if is_target else "monitor", "role": "coordinator",
                        "label": "Propose offer" if is_target else "Monitoring", "why": "Demand above baseline"})
        if h["deficit_minutes"]:
            now_gap = s0["deficit"] > 0
            sev = "critical" if now_gap and h["peak_deficit"] >= 2 else ("warning" if now_gap else "info")
            if is_target and sev == "info":
                sev = "warning"
            short = f"{h['peak_deficit']} physician{'s' if h['peak_deficit'] > 1 else ''} short"
            when = "now" if now_gap else f"from {h['first_gap_at'][11:16]}"
            if is_target:
                action = {"action": "propose_offer", "role": "coordinator", "label": "Propose offer",
                          "why": "Top staffing target"}
            elif sev == "critical":
                action = {"action": "escalate", "role": "clinical_lead", "label": "Escalate",
                          "why": "Critical coverage gap outside the current staffing target"}
            else:
                action = {"action": "monitor", "role": "coordinator", "label": "Monitoring", "why": "Projected gap"}
            add(id=f"gap:{h['hospital_id']}", kind="coverage_gap", severity=sev, hospital_id=h["hospital_id"],
                title=f"{h['hospital_name']} coverage gap",
                summary=f"{short} {when} · {h['deficit_minutes']} physician-min over 90 min",
                detail=(f"{h['deficit_minutes']} deficit physician-minutes over 90 min (peak {h['peak_deficit']} "
                        f"short); now {s0['available']} available vs {s0['required']} required"),
                overage=h["deficit_minutes"] / 10, action=action)
        pending = [pid for pid in s0["planned_ids"] if pid not in s0["confirmed_ids"]]
        if pending:
            add(id=f"pending:{h['hospital_id']}", kind="planned_capacity_unconfirmed", severity="info",
                hospital_id=h["hospital_id"], title=f"{h['hospital_name']} awaiting online evidence",
                summary=f"Accepted coverage is planned; {s0['confirmed_deficit']} confirmed physician(s) short now",
                detail=f"Pending imported online evidence for {', '.join(pending)}. Accepted terms and ETA do not prove actual availability.",
                action={"action": "monitor", "role": "coordinator", "label": "Verify online evidence", "why": "Keep actual capacity unresolved while commitments reserve planned coverage"})

    def priority(r: dict) -> tuple:
        if r["kind"] == "stage_breach":
            tier = 0 if r["severity"] == "critical" else 1
        elif r["kind"] in ("documentation_delay", "assigned_to_unavailable"):
            tier = 2
        elif r["kind"] in ("coverage_gap", "demand_spike"):
            tier = 3
        else:
            tier = 4
        r["priority_tier"] = tier
        return (tier, -r["score"], r["id"])

    risks.sort(key=priority)
    for i, r in enumerate(risks, 1):
        r["rank"] = i
    return risks
