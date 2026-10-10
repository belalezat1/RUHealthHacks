"""Compare a replay against the supplied 18:20 reference snapshot (208 fields)."""
from __future__ import annotations

from .data import SCENARIO_NOW, ReferenceData
from .replay import State, current_shift, derived_state, fmt_et_time, minutes_between, open_consults_for

PHYSICIAN_FIELDS = ("shift_et", "self_reported_status", "desktop_agent", "derived_state",
                    "consults_this_shift", "calls_this_shift", "open_consults", "minutes_to_shift_end")
CONSULT_FIELDS = ("hospital_id", "hospital_name", "physician_id", "consult_type", "current_stage",
                  "stage_entered_at", "minutes_in_stage", "minutes_since_received")


def physician_row(state: State, ref: ReferenceData, pid: str) -> dict:
    phy = ref.physicians[pid]
    p = state.physicians[pid]
    shift = current_shift(ref, pid, state.as_of)
    shift_et = f"{phy.shift_start:%H:%M}-{phy.shift_end:%H:%M}" if phy.shift_start else ""
    return {
        "physician_id": pid,
        "name": phy.name,
        "shift_et": shift_et,
        "self_reported_status": p.status,
        "desktop_agent": "Online" if p.agent_online else "Offline",
        "derived_state": derived_state(state, ref, pid),
        "consults_this_shift": len(p.consults_this_shift),
        "calls_this_shift": p.calls_this_shift,
        "open_consults": len(open_consults_for(state, pid)),
        "minutes_to_shift_end": int((shift[1] - state.as_of).total_seconds() // 60) if shift else None,
    }


def consult_row(state: State, ref: ReferenceData, cid: str) -> dict:
    c = state.consults[cid]
    hosp = ref.hospitals.get(c.hospital_id)
    return {
        "consult_id": cid,
        "hospital_id": c.hospital_id,
        "hospital_name": hosp.name if hosp else "",
        "physician_id": c.physician_id or "Unassigned",
        "consult_type": c.consult_type,
        "current_stage": c.stage,
        "stage_entered_at": fmt_et_time(c.stage_entered_at),
        "minutes_in_stage": minutes_between(c.stage_entered_at, state.as_of),
        "minutes_since_received": minutes_between(c.received_at, state.as_of),
    }


def compare_snapshot(state: State, ref: ReferenceData) -> dict:
    """Field-by-field comparison. Only meaningful for the original data at the 18:20 cutoff."""
    applicable = state.as_of == SCENARIO_NOW
    mismatches = []
    compared = matched = 0
    for snap in ref.snapshot_physicians:
        pid = snap["physician_id"]
        ours = physician_row(state, ref, pid) if pid in state.physicians else {}
        for f in PHYSICIAN_FIELDS:
            compared += 1
            if str(ours.get(f, "")) == snap[f].strip():
                matched += 1
            else:
                mismatches.append({"entity": pid, "field": f, "expected": snap[f], "actual": ours.get(f)})
    snap_ids = {s["consult_id"] for s in ref.snapshot_consults}
    for snap in ref.snapshot_consults:
        cid = snap["consult_id"]
        ours = consult_row(state, ref, cid) if cid in state.consults else {}
        for f in CONSULT_FIELDS:
            compared += 1
            if str(ours.get(f, "")) == snap[f].strip():
                matched += 1
            else:
                mismatches.append({"entity": cid, "field": f, "expected": snap[f], "actual": ours.get(f)})
    extra_open = sorted(cid for cid, c in state.consults.items() if c.is_open and cid not in snap_ids)
    return {
        "applicable": applicable,
        "compared": compared,
        "matched": matched,
        "mismatches": mismatches,
        "extra_open_consults": extra_open,
        "passed": applicable and matched == compared and not extra_open,
    }
