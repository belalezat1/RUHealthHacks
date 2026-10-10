"""Metrics use raw work/wait values and include unresolved consultations."""

import math
from datetime import datetime

from app.core.clock import utc

DEFINITIONS = {
    "mean_wait_minutes": "Mean time from requested_at to assignment; unresolved consults are right-censored at window end and included.",
    "p95_wait_minutes": "Nearest-rank 95th percentile of the same assigned and right-censored waiting durations.",
    "urgent_delay_minutes": "Total urgent minutes after supplied deadline until assignment, or window end when unassigned.",
    "uncovered_qualified_capacity_minutes": "First forecast-bin unmet clinician work-minutes integrated over replay sampling duration, without summing overlapping future bins.",
    "overtime_minutes": "Assigned clinician minutes outside original scheduled shifts during the evaluation window.",
    "activation_count": "Number of simulated off-shift activations accepted and started during the window.",
    "constraint_violations": "Attempted replay assignments failing final shared eligibility validation (never committed).",
    "decision_latency_ms": "Measured mean wall-clock optimizer duration; excluded from strict reproducibility comparisons.",
    "unassigned_consults": "Arrived consultations still waiting at the end of the window.",
    "unfinished_consults": "All arrived consultations not completed at the end, including assigned work.",
}


def calculate(state: dict, assignments: dict[str, datetime], start: datetime, end: datetime,
              uncovered: float, overtime: float, activations: int, violations: int, latencies: list[float]) -> dict:
    consultations = [row for row in state.get("consultations", []) if utc(row["requested_at"]) <= end]
    waits, urgent_delay = [], 0.0
    for consultation in consultations:
        assigned = assignments.get(consultation["id"])
        if consultation["status"] == "completed" and not assigned:
            # Pre-existing completed consultations are outside this run's queue cohort.
            continue
        endpoint = assigned or end
        waits.append(max(0, (endpoint - utc(consultation["requested_at"])).total_seconds() / 60))
        if consultation["priority"] == "urgent":
            urgent_delay += max(0, (endpoint - utc(consultation["deadline_at"])).total_seconds() / 60)
    waits.sort()
    return {
        "mean_wait_minutes": round(sum(waits) / len(waits), 3) if waits else 0.0,
        "p95_wait_minutes": round(waits[max(0, math.ceil(len(waits) * 0.95) - 1)], 3) if waits else 0.0,
        "urgent_delay_minutes": round(urgent_delay, 3),
        "uncovered_qualified_capacity_minutes": round(uncovered, 3),
        "overtime_minutes": round(overtime, 3),
        "activation_count": activations,
        "constraint_violations": violations,
        "decision_latency_ms": round(sum(latencies) / len(latencies), 3) if latencies else 0.0,
        "unassigned_consults": sum(c["status"] == "waiting" for c in consultations),
        "unfinished_consults": sum(c["status"] != "completed" for c in consultations),
        "completed_consults": sum(c["status"] == "completed" and c["id"] in assignments for c in consultations),
    }
