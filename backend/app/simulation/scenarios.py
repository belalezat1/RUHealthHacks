"""Synthetic scenario schedules. Events are revealed only at their replay time."""

import copy
import random
from datetime import datetime, timedelta

from app.core.clock import utc

SCENARIOS = [
    {"id": "shift_ending_surge", "label": "Shift-ending surge", "description": "Consultations arrive as a current shift ends; compare deterministic staffing policies."},
    {"id": "stale_heartbeat", "label": "Stale heartbeat conflict", "description": "A physician reports available while connectivity evidence has aged out."},
    {"id": "duplicate_late", "label": "Duplicate and late events", "description": "Duplicate events are no-ops and older evidence cannot overwrite newer observations."},
    {"id": "credential_gap", "label": "Missing or expired credentials", "description": "A synthetic license expires before an arriving consultation can be assigned."},
    {"id": "cross_hospital", "label": "Cross-hospital contention", "description": "Simultaneous consultations compete for shared qualified physician capacity."},
    {"id": "split_shift_trap", "label": "Split-shift trap", "description": "An apparently available physician has a future mandatory shift; rest and continuity checks still apply."},
]


def prepare(state: dict, scenario: str, seed: int, now: datetime, policy: dict | None = None) -> tuple[dict, list[dict], list[str]]:
    if scenario not in {item["id"] for item in SCENARIOS}:
        raise ValueError("Unknown simulation scenario")
    initial = copy.deepcopy(state)
    rng = random.Random(seed)
    hospitals = sorted(initial.get("hospitals", []), key=lambda item: item["id"])
    physicians = sorted(initial.get("physicians", []), key=lambda item: item["id"])
    events = []
    assumptions = ["Synthetic physician acceptance is simulated after a feasible contact; no external messages are sent."]
    assumptions.append("Pre-existing active work completes in replay at supplied expected_end_at or assigned_at/requested_at plus supplied duration; missing assignment time uses requested_at as a declared simulation assumption.")
    excluded_heartbeat = set()
    if not hospitals or not physicians:
        return initial, events, assumptions + ["Dataset has no hospital/physician pair; replay preserves unresolved work."]
    first = physicians[0]["id"]
    if scenario == "stale_heartbeat":
        excluded_heartbeat.add(first)
        initial["signals"] = [signal for signal in initial.get("signals", [])
                              if not (signal["physician_id"] == first and signal["kind"] == "heartbeat")]
        initial["signals"].extend([
            {"id": "scenario-stale", "physician_id": first, "kind": "heartbeat", "value": "connected",
             "source": "heartbeat", "observed_at": (now - timedelta(minutes=30)).isoformat(), "received_at": now.isoformat()},
            {"id": "scenario-available", "physician_id": first, "kind": "self_report", "value": "available",
             "source": "self_report", "observed_at": now.isoformat(), "received_at": now.isoformat()},
        ])
    if scenario == "credential_gap":
        licenses = [row for row in initial.get("credentials", []) if row["physician_id"] == first and row["kind"] == "license"]
        if licenses:
            for credential in licenses:
                credential["expires_at"] = (now - timedelta(seconds=1)).isoformat()
        assumptions.append(f"Scenario expires existing synthetic license evidence for {first}; it grants no credentials.")
    if scenario == "shift_ending_surge":
        for shift in initial.get("shifts", []):
            if shift["physician_id"] == first and utc(shift["start_at"]) <= now < utc(shift["end_at"]):
                shift["end_at"] = (now + timedelta(minutes=15)).isoformat()
    if scenario == "split_shift_trap":
        off_shift = next((p["id"] for p in physicians if not any(
            s["physician_id"] == p["id"] and s.get("status") != "cancelled" and
            utc(s["start_at"]) <= now < utc(s["end_at"]) for s in initial.get("shifts", []))), first)
        initial.setdefault("shifts", []).append({
            "id": "scenario-future-commitment", "physician_id": off_shift, "hospital_id": hospitals[0]["id"],
            "start_at": (now + timedelta(minutes=120)).isoformat(),
            "end_at": (now + timedelta(minutes=240)).isoformat(), "mandatory": True, "status": "scheduled",
        })
        assumptions.append(f"Synthetic mandatory future commitment added for {off_shift}, beyond the visible 90-minute window.")
    arrival_minute = 20 if scenario == "shift_ending_surge" else 5
    count = 6 if scenario in {"shift_ending_surge", "cross_hospital"} else 3
    for index in range(count):
        hospital = hospitals[index % len(hospitals)]
        arrived = now + timedelta(minutes=arrival_minute + (0 if scenario == "cross_hospital" else index * 2))
        consultation = {
            "id": f"sim-{scenario}-{seed}-{index}", "hospital_id": hospital["id"], "specialty": hospital["specialty"],
            "priority": "urgent" if index % 3 == 0 else "routine", "requested_at": arrived.isoformat(),
            "deadline_at": (arrived + timedelta(minutes=15 if index % 3 == 0 else 30)).isoformat(),
            "duration_minutes": rng.choice([15, 20, 25]), "status": "waiting", "physician_id": None,
        }
        events.append({"at": arrived.isoformat(), "event_id": consultation["id"], "event_type": "consultation.created", "payload": consultation})
    # Only initially fresh connected telemetry is continued; stale evidence stays stale.
    for physician in physicians:
        heartbeats = [s for s in initial.get("signals", []) if s["physician_id"] == physician["id"] and s["kind"] == "heartbeat"]
        latest = max(heartbeats, key=lambda s: utc(s["observed_at"]), default=None)
        if physician["id"] in excluded_heartbeat or not latest or latest["value"] != "connected":
            continue
        if (now - utc(latest["observed_at"])).total_seconds() > (policy or {}).get("heartbeat_freshness_seconds", 300):
            continue
        for minute in range(0, 91, 2):
            at = now + timedelta(minutes=minute)
            signal = dict(latest, id=f"sim-heartbeat-{physician['id']}-{minute}", observed_at=at.isoformat(), received_at=at.isoformat())
            if latest.get("source_sequence") is not None:
                signal["source_sequence"] = latest["source_sequence"] + minute + 1
            events.append({"at": at.isoformat(), "event_id": signal["id"], "event_type": "availability", "payload": signal})
    if scenario == "duplicate_late":
        at = now + timedelta(minutes=1)
        signal = {"id": "sim-sequence-event", "physician_id": first, "kind": "self_report", "value": "available",
                  "source": "self_report", "observed_at": at.isoformat(), "received_at": at.isoformat(), "source_sequence": 100}
        event = {"at": at.isoformat(), "event_id": signal["id"], "event_type": "availability", "payload": signal}
        events.extend([event, copy.deepcopy(event)])
        old = dict(signal, id="sim-late-event", value="unavailable", observed_at=(now - timedelta(minutes=10)).isoformat(), source_sequence=99)
        events.append({"at": (at + timedelta(minutes=2)).isoformat(), "event_id": old["id"], "event_type": "availability", "payload": old})
    assumptions.append("Two-minute heartbeat telemetry continues only for physicians with initially fresh connected evidence.")
    return initial, sorted(events, key=lambda item: (item["at"], item["event_id"])), assumptions
