"""Model of the synthetic call-routing rules (we model the router's effect; we do not replace it).

1. Eligible = on shift (or an online split-shift joiner) and credentialed at the calling hospital.
2. Remove busy, ringing, and anyone who ended a call < 2 minutes ago.
3. Low-volume priority: <= 6 consults this shift (day) or <= 4 (night).
4. Otherwise fewest consults this shift; ties go to whoever answered least recently.

Split-shift trap guard: a joiner starts at zero consults, so rule 3/4 would send them nearly
every call at every hospital they are credentialed for. With the guard on, a joiner is only
routable at the hospitals named in their accepted offer.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .coverage import Commitment
from .data import ReferenceData
from .replay import State, availability, on_shift

DAY_LOW_VOLUME = 6
NIGHT_LOW_VOLUME = 4
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def route_order(state: State, ref: ReferenceData, hospital_id: str, commitments: list[Commitment],
                guard: bool = True, exclude: frozenset[str] = frozenset(),
                reserved: frozenset[str] = frozenset()) -> list[dict]:
    at = state.as_of
    out = []
    joiners = {c.physician_id: c for c in commitments if c.online_at <= at < c.end}
    for pid, phy in ref.physicians.items():
        if pid in exclude or pid in reserved:
            continue
        if not ref.credentialed(pid, hospital_id):
            continue
        joiner = joiners.get(pid)
        if joiner is not None:
            if guard and hospital_id not in joiner.hospitals:
                continue
            consults = 0
            last_answered = None
            source = "split-shift joiner"
        elif on_shift(ref, pid, at):
            a = availability(state, ref, pid)
            if not a["routable"]:
                continue
            p = state.physicians[pid]
            consults = len(p.consults_this_shift)
            last_answered = p.last_answered_at
            source = "on shift" + ("" if a["verified"] else " (presence unverified)")
        else:
            continue
        threshold = NIGHT_LOW_VOLUME if phy.is_night else DAY_LOW_VOLUME
        low = consults <= threshold
        out.append({
            "physician_id": pid,
            "name": phy.name,
            "consults_this_shift": consults,
            "low_volume_priority": low,
            "last_answered_at": last_answered.isoformat() if last_answered else None,
            "source": source,
            "_key": (0 if low else 1, consults, last_answered or _EPOCH, pid),
        })
    out.sort(key=lambda r: r["_key"])
    for r in out:
        r.pop("_key")
    return out


def trap_analysis(state: State, ref: ReferenceData, commitments: list[Commitment]) -> dict:
    """Who would receive the next call at each hospital, with and without the guard."""
    rows = []
    captured_unguarded: list[str] = []
    for hid in sorted(ref.hospitals):
        unguarded = route_order(state, ref, hid, commitments, guard=False)
        guarded = route_order(state, ref, hid, commitments, guard=True)
        u = unguarded[0]["physician_id"] if unguarded else None
        g = guarded[0]["physician_id"] if guarded else None
        joiner_ids = {c.physician_id for c in commitments}
        if u in joiner_ids and hid not in next(c.hospitals for c in commitments if c.physician_id == u):
            captured_unguarded.append(hid)
        rows.append({"hospital_id": hid, "hospital_name": ref.hospitals[hid].name,
                     "next_call_unguarded": u, "next_call_guarded": g})
    return {
        "rows": rows,
        "joiners": [{"physician_id": c.physician_id, "hospitals": sorted(c.hospitals),
                     "online_at": c.online_at.isoformat(), "end": c.end.isoformat()} for c in commitments],
        "out_of_scope_hospitals_captured_without_guard": captured_unguarded,
        "guard": "Joining physicians are routable only at the hospitals in their accepted offer.",
    }


def simulate_trap(state: State, ref: ReferenceData, joiner: Commitment) -> dict:
    """Illustrative: if the joiner were online now, which hospitals would route to them first?"""
    hypothetical = Commitment(joiner.physician_id, joiner.hospitals, state.as_of, joiner.end, state.as_of)
    unguarded, guarded = [], []
    for hid in sorted(ref.hospitals):
        u = route_order(state, ref, hid, [hypothetical], guard=False)
        g = route_order(state, ref, hid, [hypothetical], guard=True)
        if u and u[0]["physician_id"] == joiner.physician_id:
            unguarded.append(hid)
        if g and g[0]["physician_id"] == joiner.physician_id:
            guarded.append(hid)
    return {
        "physician_id": joiner.physician_id,
        "offer_hospitals": sorted(joiner.hospitals),
        "first_in_line_without_guard": unguarded,
        "first_in_line_with_guard": guarded,
    }
