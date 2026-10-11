"""Jev selects a bounded staffing recommendation; code owns eligibility and execution.

No mock adapter exists in the application. A missing key, uncertain response, invalid
answer or failed provider call uses the already prepared deterministic recommendation.
This module never sends outreach or mutates application state.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import time
from dataclasses import dataclass, field
from typing import Callable
from uuid import uuid4

import httpx

POLICY_VERSION = "challenge-staffing-v1"
API_URL = "https://api.typesafe.ai/v1/systemone"
QUESTION_ID = "staffing_action"
REQUIRED_GATES = frozenset({"opt_in", "credentialed", "rest", "weekly_hours", "no_schedule_overlap",
                           "duration", "no_accepted_overlap", "one_open_offer", "weekly_offer_limit"})


def canonical_hash(value: object) -> str:
    """Stable hash for validated JSON, excluding transient provider/timing fields."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


@dataclass(frozen=True)
class DecisionConfig:
    api_key: str = field(default="", repr=False)
    model: str = "jev-latest"
    deadline_ms: float = 900
    confidence_threshold: float = 0.75
    failure_limit: int = 5
    circuit_open_seconds: float = 30
    max_actions: int = 32
    enabled: bool = True

    def __post_init__(self) -> None:
        if not self.model.startswith("jev") or len(self.model) > 128:
            raise ValueError("The configured TypeSafe model must belong to the Jev family")
        if not math.isfinite(self.deadline_ms) or not 10 <= self.deadline_ms <= 5000:
            raise ValueError("Jev deadline must be between 10 and 5000 ms")
        if not math.isfinite(self.confidence_threshold) or not 0 <= self.confidence_threshold <= 1:
            raise ValueError("Jev confidence threshold must be between 0 and 1")
        if not 2 <= self.max_actions <= 255:
            raise ValueError("Jev Choice accepts at most 255 options, including escalation")
        if self.failure_limit < 1 or self.circuit_open_seconds <= 0:
            raise ValueError("Jev circuit breaker requires positive limits")

    @classmethod
    def from_env(cls) -> DecisionConfig:
        return cls(
            api_key=os.environ.get("TYPESAFE_API_KEY", ""),
            model=os.environ.get("SEVARO_JEV_MODEL", "jev-latest"),
            deadline_ms=float(os.environ.get("SEVARO_JEV_DEADLINE_MS", "900")),
            confidence_threshold=float(os.environ.get("SEVARO_JEV_CONFIDENCE", "0.75")),
            failure_limit=int(os.environ.get("SEVARO_JEV_FAILURE_LIMIT", "5")),
            circuit_open_seconds=float(os.environ.get("SEVARO_JEV_CIRCUIT_SECONDS", "30")),
            max_actions=int(os.environ.get("SEVARO_JEV_MAX_ACTIONS", "32")),
            enabled=os.environ.get("SEVARO_JEV_ENABLED", "true").lower() in {"1", "true", "yes"},
        )


def _number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("invalid finite numeric value")
    return float(value)


def _safe_candidate(candidate: dict, target: str) -> bool:
    """Defense in depth around the canonical domain engine's typed hard gates."""
    rules = candidate.get("rules")
    eligibility = candidate.get("eligibility", {})
    if not isinstance(eligibility, dict) or not isinstance(rules, list):
        return False
    if not all(isinstance(rule, dict) and rule.get("passed") is True for rule in rules):
        return False
    if not REQUIRED_GATES.issubset({rule.get("rule") for rule in rules}):
        return False
    try:
        effective_minutes = _number(candidate.get("effective_minutes", 0))
    except ValueError:
        return False
    return (candidate.get("eligible") is True
            and eligibility.get("status", "eligible") == "eligible"
            and candidate.get("eligibility_status", "eligible") == "eligible"
            and not candidate.get("failed_rules")
            and target in candidate.get("offer_hospitals", [])
            and bool(candidate.get("physician_id")) and effective_minutes > 0)


def build_actions(report: dict, *, run_id: str, revision: int,
                  max_actions: int = 32) -> tuple[list[dict], str]:
    """Use only the canonical target/scope/window; Jev cannot generate new terms.

    The deterministic winning bundle is retained even if candidate count is bounded.
    Singles are individually checked and ranked by the domain engine's objective.
    An explicit escalation is always a Choice option.
    """
    staffing = report.get("staffing", {})
    target = staffing.get("target") or {}
    hospital_id = target.get("hospital_id")
    window = staffing.get("offer_window", {})
    safe: dict[str, dict] = {}
    if hospital_id and window.get("start") and window.get("end"):
        for candidate in staffing.get("candidates", []):
            if _safe_candidate(candidate, hospital_id):
                safe[candidate["physician_id"]] = candidate

    def action(physician_ids: list[str]) -> dict:
        candidates = [safe[pid] for pid in physician_ids]
        # Restrict to the already selected gap. Broad credentials do not broaden scope.
        core = {"kind": "scoped_split_shift", "physician_ids": sorted(physician_ids),
                "offer_hospitals": [hospital_id], "window_start": window["start"],
                "window_end": window["end"]}
        value = {**core, "action_id": "ACT-" + canonical_hash({"run_id": run_id,
                 "revision": revision, **core})[:24],
                 "physician_id": physician_ids[0] if len(physician_ids) == 1 else None,
                 "requires_clinical_lead_approval": True,
                 "priority_tier": "canonical_staffing_target",
                 "eligibility_checks": {c["physician_id"]: [
                     {"rule": r["rule"], "passed": True} for r in c["rules"]] for c in candidates},
                 "minutes_to_online": max(c["minutes_to_online"] for c in candidates),
                 "effective_minutes": min(c["effective_minutes"] for c in candidates),
                 "offer_hours": sum(c["paid_hours"] for c in candidates),
                 "projected_deficit_minutes_removed": sum(c.get("deficit_minutes_removed", 0)
                                                          for c in candidates)}
        if sorted(physician_ids) == sorted(staffing.get("selected", [])):
            value["projected_deficit_minutes_removed"] = staffing.get("deficit_minutes_removed", 0)
        return value

    actions = []
    selected = staffing.get("selected", [])
    if selected and len(set(selected)) == len(selected) and all(pid in safe for pid in selected):
        actions.append(action(selected))
    for candidate in sorted(safe.values(), key=lambda c: (-c.get("deficit_minutes_removed", 0),
                                                         c["minutes_to_online"], c["physician_id"])):
        if candidate.get("deficit_minutes_removed", 0) <= 0:
            continue
        value = action([candidate["physician_id"]])
        if value["action_id"] not in {a["action_id"] for a in actions}:
            actions.append(value)
        if len(actions) >= max_actions - 1:
            break

    escalate = {"action_id": "ACT-" + canonical_hash({"run_id": run_id, "revision": revision,
                "kind": "escalate", "hospital_id": hospital_id})[:24],
                "kind": "escalate", "physician_ids": [], "physician_id": None,
                "offer_hospitals": [hospital_id] if hospital_id else [],
                "requires_clinical_lead_approval": True,
                "reason": "Clinical-lead review: no suitable action or operational ambiguity"}
    fallback_id = actions[0]["action_id"] if actions else escalate["action_id"]
    return [*actions, escalate], fallback_id


def build_request(report: dict, actions: list[dict], *, model: str, revision: int) -> dict:
    """Allowlisted structured state: no names, contact channels or raw descriptions."""
    staffing = report.get("staffing", {})
    candidates = {c["physician_id"]: c for c in staffing.get("candidates", [])}
    placeholders = {pid: f"candidate_{index + 1}" for index, pid in enumerate(sorted(candidates))}
    target = staffing.get("target") or {}
    state_actions = []
    for action in actions:
        state_actions.append({
            "action_id": action["action_id"], "kind": action["kind"],
            "scope": "target_hospital_only" if action["kind"] == "scoped_split_shift" else "clinical_lead",
            "candidate_ids": [placeholders[pid] for pid in action["physician_ids"]],
            "offer_hours": action.get("offer_hours"),
            "time_to_online_minutes": action.get("minutes_to_online"),
            "effective_coverage_minutes": action.get("effective_minutes"),
            "projected_deficit_minutes_removed": action.get("projected_deficit_minutes_removed"),
            "hard_gate_results": [[{"rule": r["rule"], "passed": r["passed"]} for r in checks]
                                  for checks in action.get("eligibility_checks", {}).values()],
        })
    risks = report.get("risks", [])
    state = {
        "policy_version": report.get("policy_version", POLICY_VERSION),
        "state_revision": revision, "as_of": report.get("as_of"), "decision_scope": "staffing",
        "units": {"durations": "minutes", "offer_work": "physician-hours",
                  "deficit": "hospital-access physician-minutes, not patient waiting time"},
        "target_gap": {"hospital": "target_hospital", "peak_deficit": target.get("peak_deficit"),
                       "deficit_minutes": target.get("deficit_minutes"),
                       "observed_trailing_arrivals": target.get("trailing_observed"),
                       "p90_arrivals": target.get("p90")},
        "critical_risks_count": sum(r.get("severity") == "critical" for r in risks),
        "warning_risks_count": sum(r.get("severity") == "warning" for r in risks),
        "actions": state_actions,
        "constraints": ["Candidates already satisfy eligibility rules enforced in code",
                        "The code-selected staffing target and priority tier cannot change",
                        "The offer scope and terms cannot change",
                        "Offer projections are conditional; acceptance does not confirm presence",
                        "Clinical-lead approval and transactional revalidation remain mandatory",
                        "No financial or clinical-quality evidence is supplied"],
    }
    return {"model": model, "state": state, "questions": {QUESTION_ID: {
        "type": "choice",
        "instructions": {
            "question": "Which bounded staffing recommendation should the clinical lead review for `target_gap`?",
            "priorities": ["Reduce this target's projected coverage gap without broadening hospital scope",
                           "Prefer timely useful coverage and avoid unnecessary offered physician-hours",
                           "Escalate when none of the admitted choices is suitable"],
            "boundary": "Select an existing action_id. Do not authorize execution, infer STAT or costs, "
                        "override eligibility, or treat a projection as an observed outcome.",
        },
        "criteria": {a["action_id"]: (
            "Escalate to the clinical lead; do not create an offer" if a["kind"] == "escalate" else
            {"kind": "scoped_split_shift", "evidence": f"Use the action with this action_id in `actions`",
             "approval": "Recommendation only; clinical lead must approve"}) for a in actions},
    }}}


def validate_answer(payload: object, action_ids: set[str]) -> dict:
    """Validate the exact requested answer, distribution and current Choice semantics."""
    if not isinstance(payload, dict) or set(payload.get("answers", {})) != {QUESTION_ID}:
        raise ValueError("unexpected answer map")
    model = payload.get("model")
    if not isinstance(model, str) or not model.startswith("jev") or len(model) > 128:
        raise ValueError("missing resolved Jev model")
    answer = payload["answers"][QUESTION_ID]
    if not isinstance(answer, dict) or answer.get("type") != "choice":
        raise ValueError("wrong answer type")
    choice, probabilities = answer.get("choice"), answer.get("probabilities")
    if choice not in action_ids or not isinstance(probabilities, dict) or set(probabilities) != action_ids:
        raise ValueError("response choices differ from admitted actions")
    probabilities = {key: _number(value) for key, value in probabilities.items()}
    if any(not 0 <= value <= 1 for value in probabilities.values()) or abs(sum(probabilities.values()) - 1) > 0.015:
        raise ValueError("invalid probability distribution")
    confidence = _number(answer.get("confidence"))
    if not 0 <= confidence <= 1 or probabilities[choice] + 1e-6 < max(probabilities.values()):
        raise ValueError("invalid confidence or non-maximal selection")
    # Published confidence is the top probability normalized above a uniform split.
    n = len(action_ids)
    computed_confidence = (max(probabilities.values()) - 1 / n) / (1 - 1 / n) if n > 1 else 1
    if abs(confidence - computed_confidence) > 0.025:
        raise ValueError("confidence is inconsistent with Choice probabilities")
    usage = payload.get("usage")
    if not isinstance(usage, dict) or any(isinstance(usage.get(key), bool)
          or not isinstance(usage.get(key), int) or usage[key] < 0 for key in ("input_tokens", "output_tokens")):
        raise ValueError("invalid usage schema")
    return {"choice": choice, "confidence": confidence, "probabilities": probabilities,
            "model": model, "usage": {key: usage[key] for key in ("input_tokens", "output_tokens")}}


class DecisionEngine:
    """Reusable async provider client and process-local circuit breaker.

    Durable immutable decisions/audit and revision revalidation belong to the service
    transaction. The circuit state deliberately contains no dataset or clinical data.
    """
    def __init__(self, config: DecisionConfig | None = None, *,
                 client: httpx.AsyncClient | None = None,
                 clock: Callable[[], float] = time.monotonic):
        self.config = config or DecisionConfig.from_env()
        self._client = client
        self._owns_client = client is None
        self._clock = clock
        self._consecutive_failures = 0
        self._open_until = 0.0

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    def _failed(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= self.config.failure_limit:
            self._open_until = self._clock() + self.config.circuit_open_seconds

    async def select(self, report: dict, *, run_id: str, revision: int,
                     current_revision: Callable[[], int] | None = None) -> dict:
        started = self._clock()
        actions, baseline_id = build_actions(report, run_id=run_id, revision=revision,
                                             max_actions=self.config.max_actions)
        action_map = {a["action_id"]: a for a in actions}
        request = build_request(report, actions, model=self.config.model, revision=revision)
        # Bind the hash to real immutable terms while sending only opaque identifiers.
        input_hash = canonical_hash({"request": request, "run_id": run_id, "actions": actions})
        selected_id, source, reason = baseline_id, "deterministic_fallback", None
        provider = {"status": "not_requested", "requested_model": self.config.model,
                    "model": None, "confidence": None, "probabilities": {}, "usage": None,
                    "latency_ms": 0.0, "confidence_threshold": self.config.confidence_threshold}
        if action_map[baseline_id]["kind"] == "escalate":
            reason = "no_feasible_action"
        elif not self.config.enabled:
            reason, provider["status"] = "provider_disabled", "disabled"
        elif not self.config.api_key:
            reason, provider["status"] = "missing_api_key", "unavailable"
        elif self._open_until > self._clock():
            reason, provider["status"] = "circuit_open", "circuit_open"
        else:
            try:
                if self._client is None:
                    self._client = httpx.AsyncClient(follow_redirects=False)
                # One application deadline includes transport, parsing and validation.
                # No retries are attempted within this request's latency budget.
                async with asyncio.timeout(self.config.deadline_ms / 1000):
                    response = await self._client.post(
                        API_URL, headers={"Authorization": f"Bearer {self.config.api_key}"},
                        json=request, timeout=self.config.deadline_ms / 1000,
                    )
                    if response.status_code != 200:
                        reason, provider["status"] = f"provider_http_{response.status_code}", "unavailable"
                        self._failed()
                    elif len(response.content) > 65536:
                        reason, provider["status"] = "invalid_provider_response", "invalid"
                        self._failed()
                    else:
                        try:
                            answer = validate_answer(response.json(), set(action_map))
                        except (ValueError, TypeError, KeyError):
                            reason, provider["status"] = "invalid_provider_response", "invalid"
                            self._failed()
                        else:
                            self._consecutive_failures = 0
                            self._open_until = 0
                            provider.update({key: answer[key] for key in
                                             ("model", "confidence", "probabilities", "usage")})
                            if answer["confidence"] < self.config.confidence_threshold:
                                reason, provider["status"] = "provider_uncertain", "uncertain"
                            else:
                                selected_id, source = answer["choice"], "jev"
                                provider["status"] = "available"
            except (TimeoutError, httpx.TimeoutException):
                reason, provider["status"] = "provider_timeout", "timeout"
                self._failed()
            except httpx.HTTPError:
                # Never persist exception strings: they may contain credentials or source data.
                reason, provider["status"] = "provider_transport_error", "unavailable"
                self._failed()
            provider["latency_ms"] = round((self._clock() - started) * 1000, 3)

        status = "ready"
        if current_revision is not None and current_revision() != revision:
            selected_id, source, reason, status = None, "escalation", "stale_revision", "stale"
        selected_action = action_map.get(selected_id)
        if selected_action and selected_action["kind"] == "escalate":
            # Preserve the actual selector when Jev itself requests escalation.
            source, status = ("jev" if source == "jev" else "escalation"), "escalated"
            reason = reason or "provider_escalated"
        return {
            "decision_id": "DEC-" + uuid4().hex, "scope": "staffing", "run_id": run_id,
            "revision": revision, "as_of": report.get("as_of"),
            "policy_version": report.get("policy_version", POLICY_VERSION), "input_hash": input_hash,
            "status": status, "selected_action_id": selected_id, "selected_action": selected_action,
            "selected_physician_ids": selected_action["physician_ids"] if selected_action else [],
            "actions": actions, "feasible_actions": actions, "baseline_action_id": baseline_id,
            "source": source, "fallback_reason": reason, "provider": provider,
            "model": provider["model"], "confidence": provider["confidence"],
            "latency_ms": provider["latency_ms"], "requires_clinical_lead_approval": True,
            "confidence_note": "Distribution concentration, not clinical safety or authorization",
        }
