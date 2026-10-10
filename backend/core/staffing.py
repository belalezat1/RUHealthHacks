"""Split-shift target selection, candidate eligibility and the scoped offer optimizer.

Eligibility rules are hard constraints. The optimizer solves only the selected target
with a fixed offer window; it is an exact subset search over at most MAX_CANDIDATES
eligible physicians, not a global network staffing optimizer.

Lexicographic objective:
  1. maximize target deficit physician-minutes removed over the horizon
  2. minimize paid physician-hours (or complete supplied staffing costs)
  3. minimize total time to online, then stable physician id
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import combinations

from .coverage import Commitment, project_hospital
from .data import ReferenceData
from .replay import State

OFFER_HOURS = 2
MIN_OFFER_HOURS = 2
MIN_REST_HOURS = 10
MAX_WEEKLY_HOURS = 60
MAX_OFFERS_PER_WEEK = 3
MAX_CANDIDATES = 18


@dataclass(frozen=True)
class OfferLedgerView:
    """What the eligibility check needs to know about existing offers."""
    open_offer_physicians: frozenset[str]  # proposed / approved / sent
    accepted: tuple[Commitment, ...]
    sent_counts_by_week: dict[tuple[str, tuple[int, int]], int]  # (physician, iso (year, week)) -> sent offers


EMPTY_LEDGER = OfferLedgerView(frozenset(), (), {})


def week_key(at: datetime) -> tuple[int, int]:
    iso = at.isocalendar()  # calendar week Mon-Sun (convention disclosed in the report)
    return iso[0], iso[1]


def select_target(state: State, ref: ReferenceData, coverage: dict) -> dict | None:
    """Dominant demand-spike hospital with a projected gap, else the largest coverage gap."""
    gaps = [h for h in coverage["hospitals"] if h["deficit_minutes"] > 0]
    if not gaps:
        return None
    spiking = [h for h in gaps if h["spike_now"]]
    pool = spiking or gaps
    best = max(pool, key=lambda h: (h["deficit_minutes"], h["samples"][0]["trailing_observed"], h["hospital_id"]))
    return {
        "hospital_id": best["hospital_id"],
        "hospital_name": best["hospital_name"],
        "reason": "demand spike with projected coverage gap" if spiking else "largest projected coverage gap",
        "deficit_minutes": best["deficit_minutes"],
        "peak_deficit": best["peak_deficit"],
        "trailing_observed": best["samples"][0]["trailing_observed"],
        "p90": best["samples"][0]["p90"],
    }


def evaluate_candidate(ref: ReferenceData, pid: str, hospitals: frozenset[str], start: datetime,
                       end: datetime, ledger: OfferLedgerView) -> dict:
    phy = ref.physicians[pid]
    hours = (end - start).total_seconds() / 3600
    online = start + timedelta(minutes=phy.minutes_to_online)
    rules = []

    def rule(key: str, label: str, passed: bool, detail: str) -> None:
        rules.append({"rule": key, "label": label, "passed": passed, "detail": detail})

    rule("opt_in", "Opted in to split-shift offers", bool(phy.opt_in),
         "Opted in" if phy.opt_in else "Not opted in")
    creds = ref.credentials.get(pid, frozenset())
    scope = hospitals & creds
    rule("credentialed", "Credentialed at a gap hospital", bool(scope),
         f"Credentialed at {', '.join(sorted(scope))}" if scope else
         f"Not credentialed at {', '.join(sorted(hospitals))}")
    if phy.last_shift_end:
        rest = start - phy.last_shift_end
        rest_h = rest.total_seconds() / 3600
        rule("rest", f"At least {MIN_REST_HOURS}h since last shift (at offer start)", rest_h >= MIN_REST_HOURS,
             f"{int(rest_h)}h{int(rest.total_seconds() % 3600 // 60):02d}m rest")
    else:
        rule("rest", f"At least {MIN_REST_HOURS}h since last shift (at offer start)", False, "Last shift end unknown")
    total = phy.hours_worked_7d + hours
    rule("weekly_hours", f"Trailing 7-day hours + offer <= {MAX_WEEKLY_HOURS}", total <= MAX_WEEKLY_HOURS,
         f"{phy.hours_worked_7d:g}h + {hours:g}h = {total:g}h")
    overlaps = [(s, e) for s, e in phy.scheduled_intervals() if s < end and start < e]
    rule("no_schedule_overlap", "No overlap with a scheduled shift", not overlaps,
         "No overlap" if not overlaps else
         "Overlaps scheduled shift starting " + ", ".join(f"{s:%m-%d %H:%M}" for s, _ in overlaps))
    effective = (end - online).total_seconds() / 60
    rule("duration", f"Offer at least {MIN_OFFER_HOURS}h", hours >= MIN_OFFER_HOURS,
         f"{hours:g}h offered; {phy.minutes_to_online} min to online leaves {int(effective)} min of coverage")
    clash = [c for c in ledger.accepted if c.physician_id == pid and c.start < end and start < c.end]
    rule("no_accepted_overlap", "No overlapping accepted offer", not clash,
         "None" if not clash else f"Already committed {clash[0].start:%H:%M}-{clash[0].end:%H:%M}")
    has_open = pid in ledger.open_offer_physicians
    rule("one_open_offer", "No other open offer", not has_open, "Has an open offer" if has_open else "None open")
    sent = ledger.sent_counts_by_week.get((pid, week_key(start)), 0)
    rule("weekly_offer_limit", f"Fewer than {MAX_OFFERS_PER_WEEK} offers sent this calendar week",
         sent < MAX_OFFERS_PER_WEEK, f"{sent} sent this week (no historical offer counts in dataset; run starts at 0)")
    eligible = all(r["passed"] for r in rules)
    failed = [r["label"] for r in rules if not r["passed"]]
    return {
        "physician_id": pid,
        "name": phy.name,
        "role": phy.role,
        "eligible": eligible,
        "rules": rules,
        "failed_rules": failed,
        "offer_hospitals": sorted(scope),
        "minutes_to_online": phy.minutes_to_online,
        "online_at": online.isoformat(),
        "effective_minutes": int(effective),
        "paid_hours": hours,
        "preferred_channel": phy.preferred_channel,
    }


def recommend(state: State, ref: ReferenceData, coverage: dict, ledger: OfferLedgerView,
              costs_cents_per_hour: dict[str, int] | None = None) -> dict:
    target = select_target(state, ref, coverage)
    off_shift = sorted(pid for pid, p in ref.physicians.items() if not p.on_roster_shift)
    if target is None:
        return {"target": None, "candidates": [], "selected": [], "message": "No projected coverage gap"}

    start = state.as_of
    end = start + timedelta(hours=OFFER_HOURS)
    gap_hospitals = frozenset({target["hospital_id"]})
    candidates = [evaluate_candidate(ref, pid, gap_hospitals, start, end, ledger) for pid in off_shift]
    eligible = [c for c in candidates if c["eligible"]]

    hid = target["hospital_id"]
    base = project_hospital(state, ref, hid, list(ledger.accepted))
    base_minutes = base["deficit_minutes"]

    def commitment(c: dict) -> Commitment:
        return Commitment(c["physician_id"], frozenset(c["offer_hospitals"]), start, end,
                          datetime.fromisoformat(c["online_at"]))

    for c in eligible:
        with_c = project_hospital(state, ref, hid, list(ledger.accepted) + [commitment(c)])
        c["deficit_minutes_removed"] = base_minutes - with_c["deficit_minutes"]

    guard_note = None
    pool = sorted(eligible, key=lambda c: (-c["deficit_minutes_removed"], c["minutes_to_online"], c["physician_id"]))
    if len(pool) > MAX_CANDIDATES:
        guard_note = f"{len(pool)} eligible; exact search limited to the top {MAX_CANDIDATES} by individual value"
        pool = pool[:MAX_CANDIDATES]

    slots = max(1, base["peak_deficit"])
    best_key, best_set, best_result = None, (), base
    for size in range(1, min(slots, len(pool)) + 1):
        for subset in combinations(pool, size):
            proj = project_hospital(state, ref, hid, list(ledger.accepted) + [commitment(c) for c in subset])
            removed = base_minutes - proj["deficit_minutes"]
            if removed <= 0:
                continue
            if costs_cents_per_hour and all(c["physician_id"] in costs_cents_per_hour for c in subset):
                cost = sum(costs_cents_per_hour[c["physician_id"]] * c["paid_hours"] for c in subset)
            else:
                cost = sum(c["paid_hours"] for c in subset)
            key = (-removed, cost, sum(c["minutes_to_online"] for c in subset),
                   tuple(c["physician_id"] for c in subset))
            if best_key is None or key < best_key:
                best_key, best_set, best_result = key, subset, proj

    selected_ids = [c["physician_id"] for c in best_set]
    rank = {pid: i + 1 for i, pid in enumerate(c["physician_id"] for c in pool)}
    for c in candidates:
        c["rank"] = rank.get(c["physician_id"])
        c["selected"] = c["physician_id"] in selected_ids
    return {
        "target": target,
        "offer_window": {"start": start.isoformat(), "end": end.isoformat(), "hours": OFFER_HOURS},
        "gap_hospitals": sorted(gap_hospitals),
        "slots": slots,
        "candidates": candidates,
        "selected": selected_ids,
        "baseline_deficit_minutes": base_minutes,
        "projected_deficit_minutes": best_result["deficit_minutes"],
        "deficit_minutes_removed": base_minutes - best_result["deficit_minutes"],
        "residual_peak_deficit": best_result["peak_deficit"],
        "objective": "maximize target deficit minutes removed, then minimize paid hours/cost, then time to online",
        "search_note": guard_note,
        "message": None if selected_ids else "No eligible off-shift physician reduces the projected gap; escalate",
    }
