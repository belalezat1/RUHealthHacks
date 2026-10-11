"""90-minute coverage projection per hospital.

Model (all assumptions are surfaced in the report):
- 19 samples at 5-minute steps from the scenario clock (t = 0 .. 90 min).
- required = coverage block minimum + 1 while projected trailing-60-minute demand exceeds
  that hour's p90 baseline. Projected trailing demand = observed consults received in the
  window + baseline mean arrivals prorated for the not-yet-observed part of the window.
- roster ceiling = physicians scheduled on shift and credentialed at the hospital
  (+ accepted offers scoped to the hospital, as planned capacity).
- persistent-activity capacity = same set, but a physician who is busy or unavailable now
  stays that way for the whole horizon (conservative); physicians starting a scheduled
  shift later count from their start; accepted offers count from time-to-online.
- deficit physician-minutes = sum over the 18 five-minute intervals of deficit x 5.
  This is a hospital-access coverage measure, NOT patient wait time.
- A physician credentialed at several hospitals is counted at each of them; shared
  credentials do not create independent simultaneous capacity, so per-hospital numbers
  must not be summed into network capacity.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .data import ReferenceData
from .replay import State, availability, on_shift

STEP_MIN = 5
HORIZON_MIN = 90
SAMPLES = HORIZON_MIN // STEP_MIN + 1  # 19


@dataclass(frozen=True)
class Commitment:
    """Planned capacity from an accepted split-shift offer."""
    physician_id: str
    hospitals: frozenset[str]
    start: datetime
    end: datetime
    online_at: datetime
    offer_id: str = ""
    confirmed_online_at: datetime | None = None
    confirmation_event_ids: tuple[str, ...] = ()


def sample_times(as_of: datetime) -> list[datetime]:
    return [as_of + timedelta(minutes=STEP_MIN * i) for i in range(SAMPLES)]


def trailing_demand(state: State, ref: ReferenceData, hospital_id: str, at: datetime) -> tuple[float, int, float]:
    """(projected trailing-60 consults, observed part, expected part) at instant ``at``."""
    window_start = at - timedelta(minutes=60)
    observed_end = min(at, state.as_of)
    observed = sum(1 for t in state.received_times.get(hospital_id, []) if window_start < t <= observed_end)
    expected = 0.0
    cursor = max(window_start, state.as_of)
    while cursor < at:
        hour_end = cursor.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        seg_end = min(hour_end, at)
        mean, _ = ref.baseline_for(hospital_id, cursor)
        expected += mean * (seg_end - cursor).total_seconds() / 3600
        cursor = seg_end
    return observed + expected, observed, expected


def capacity_at(state: State, ref: ReferenceData, hospital_id: str, at: datetime,
                commitments: list[Commitment], avail_cache: dict) -> dict:
    ceiling: list[str] = []
    available: list[str] = []
    unverified: list[str] = []
    confirmed: list[str] = []
    assumed: list[str] = []
    future_scheduled: list[str] = []
    for pid in ref.physicians:
        if not ref.credentialed(pid, hospital_id) or not on_shift(ref, pid, at):
            continue
        ceiling.append(pid)
        if on_shift(ref, pid, state.as_of):
            a = avail_cache.setdefault(pid, availability(state, ref, pid))
            if a["busy"] or a["unavailable"] or a["ringing"]:
                continue
            if a["cooldown_until"] and at < a["cooldown_until"]:
                continue
            if not a["verified"]:
                unverified.append(pid)
                assumed.append(pid)
            elif at == state.as_of:
                confirmed.append(pid)
        else:
            future_scheduled.append(pid)
        available.append(pid)
    planned: list[str] = []
    for c in commitments:
        if hospital_id in c.hospitals and c.start <= at < c.end and c.physician_id not in ceiling:
            ceiling.append(c.physician_id)
            a = availability(state, ref, c.physician_id, active_commitment=c)
            observed_online_now = at == state.as_of and bool(a["online_evidence_event_ids"])
            if at >= c.online_at or observed_online_now:
                planned.append(c.physician_id)
                if a["busy"] or a["ringing"] or state.physicians[c.physician_id].status == "Temporarily Unavailable":
                    continue
                if state.physicians[c.physician_id].conflicting_signals:
                    continue
                if a["cooldown_until"] and at < a["cooldown_until"]:
                    continue
                # Retain projected ETA benefit, never upgrade it to observed
                # online capacity merely because scenario time passes.
                available.append(c.physician_id)
                if not a["verified"]:
                    unverified.append(c.physician_id)
                elif at == state.as_of and not a["unavailable"]:
                    confirmed.append(c.physician_id)
    return {"ceiling": ceiling, "available": available, "unverified": unverified, "planned": planned,
            "confirmed": confirmed, "assumed": assumed, "future_scheduled": future_scheduled}


def project_hospital(state: State, ref: ReferenceData, hospital_id: str,
                     commitments: list[Commitment], avail_cache: dict | None = None) -> dict:
    avail_cache = {} if avail_cache is None else avail_cache
    samples = []
    for at in sample_times(state.as_of):
        minimum = ref.required_minimum(hospital_id, at)
        projected, observed, expected = trailing_demand(state, ref, hospital_id, at)
        _, p90 = ref.baseline_for(hospital_id, at)
        spike = projected > p90
        required = minimum + (1 if spike else 0)
        cap = capacity_at(state, ref, hospital_id, at, commitments, avail_cache)
        samples.append({
            "at": at.isoformat(),
            "minimum": minimum,
            "trailing_demand": round(projected, 2),
            "trailing_observed": observed,
            "trailing_expected": round(expected, 2),
            "p90": p90,
            "surge_uplift": 1 if spike else 0,
            "required": required,
            "roster_ceiling": len(cap["ceiling"]),
            "available": len(cap["available"]),
            "available_ids": cap["available"],
            "unverified_ids": cap["unverified"],
            "planned_ids": cap["planned"],
            "confirmed_ids": cap["confirmed"],
            "confirmed_available": len(cap["confirmed"]),
            "assumed_ids": cap["assumed"],
            "future_scheduled_ids": cap["future_scheduled"],
            "capacity_basis": "observed and assumed current capacity" if at == state.as_of else "projection from supplied schedule, activity and accepted commitments",
            "confirmed_deficit": max(0, required - len(cap["confirmed"])) if at == state.as_of else None,
            "deficit": max(0, required - len(cap["available"])),
            "ceiling_deficit": max(0, required - len(cap["ceiling"])),
        })
    deficit_minutes = sum(s["deficit"] * STEP_MIN for s in samples[:-1])
    first_gap = next((s["at"] for s in samples if s["deficit"] > 0), None)
    return {
        "hospital_id": hospital_id,
        "hospital_name": ref.hospitals[hospital_id].name,
        "samples": samples,
        "deficit_minutes": deficit_minutes,
        "peak_deficit": max(s["deficit"] for s in samples),
        "first_gap_at": first_gap,
        "spike_now": samples[0]["surge_uplift"] == 1,
        "confirmed_deficit_now": samples[0]["confirmed_deficit"],
        "planned_capacity_pending_confirmation": samples[0]["planned_ids"],
    }


def project_all(state: State, ref: ReferenceData, commitments: list[Commitment]) -> dict:
    cache: dict = {}
    hospitals = [project_hospital(state, ref, h, commitments, cache) for h in sorted(ref.hospitals)]
    return {
        "as_of": state.as_of.isoformat(),
        "step_minutes": STEP_MIN,
        "horizon_minutes": HORIZON_MIN,
        "hospitals": hospitals,
        "shift_changes": shift_changes(state, ref),
        "total_deficit_minutes": sum(h["deficit_minutes"] for h in hospitals),
        "total_deficit_minutes_basis": "sum of overlapping hospital-access deficits; not independent network supply or patient wait",
        "projection_only": True,
    }


def shift_changes(state: State, ref: ReferenceData) -> list[dict]:
    end = state.as_of + timedelta(minutes=HORIZON_MIN)
    out = []
    for pid, phy in ref.physicians.items():
        for start, stop in phy.scheduled_intervals():
            if state.as_of < start <= end:
                out.append({"at": start.isoformat(), "physician_id": pid, "name": phy.name, "change": "starts",
                            "hospitals": sorted(ref.credentials.get(pid, ()))})
            if state.as_of < stop <= end:
                out.append({"at": stop.isoformat(), "physician_id": pid, "name": phy.name, "change": "ends",
                            "hospitals": sorted(ref.credentials.get(pid, ()))})
    return sorted(out, key=lambda x: (x["at"], x["physician_id"]))
