"""Isolated provider fault injection; no generated records enter runtime datasets."""
from __future__ import annotations

import asyncio
import copy
import json
import time

import httpx
import pytest

from backend.core.data import SCENARIO_NOW, load_reference
from backend.core.events import read_csv_text, validate_batch
from backend.core.report import build_report
from backend.intelligence.actionlab import build_actionlab
from backend.intelligence.decisions import (
    QUESTION_ID, DecisionConfig, DecisionEngine, build_actions, build_request,
)


@pytest.fixture(scope="module")
def supplied():
    ref = load_reference()
    rows, errors = read_csv_text((ref.data_dir / "event_stream.csv").read_text())
    assert not errors
    batch = validate_batch(rows, ref, {})
    assert batch.ok
    return ref, batch.accepted, build_report(batch.accepted, ref, SCENARIO_NOW)


def native_answer(request: dict, *, selected: str | None = None, uncertain: bool = False) -> dict:
    choices = list(request["questions"][QUESTION_ID]["criteria"])
    selected = selected or choices[0]
    probabilities = {choice: (1 / len(choices) if uncertain else 1.0 if choice == selected else 0.0)
                     for choice in choices}
    return {"model": "jev-1.13.0", "answers": {QUESTION_ID: {
        "type": "choice", "choice": selected, "confidence": 0 if uncertain else 1,
        "probabilities": probabilities,
    }}, "usage": {"input_tokens": 321, "output_tokens": 25}}


def run_selection(report, handler, *, config=None, current_revision=None):
    async def select():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            engine = DecisionEngine(config or DecisionConfig(api_key="isolated-test-only"), client=client)
            return await engine.select(report, run_id="original", revision=0,
                                       current_revision=current_revision)
    return asyncio.run(select())


def test_actions_are_scoped_unique_and_domain_gated(supplied):
    report = supplied[2]
    actions, baseline = build_actions(report, run_id="original", revision=0)
    assert len({action["action_id"] for action in actions}) == len(actions)
    offers = [action for action in actions if action["kind"] == "scoped_split_shift"]
    assert {pid for action in offers for pid in action["physician_ids"]} == {"PHY-009"}
    assert all(action["offer_hospitals"] == ["SYN-005"] for action in offers)
    assert all(action["requires_clinical_lead_approval"] for action in actions)
    assert baseline == offers[0]["action_id"]
    assert build_actions(report, run_id="original", revision=0) == (actions, baseline)
    assert build_actions(report, run_id="original", revision=1)[1] != baseline


def test_a_rejected_or_unverified_candidate_never_reaches_choice(supplied):
    report = copy.deepcopy(supplied[2])
    candidate = next(c for c in report["staffing"]["candidates"] if c["physician_id"] == "PHY-009")
    candidate["eligible"] = False
    actions, baseline = build_actions(report, run_id="original", revision=0)
    assert len(actions) == 1 and actions[0]["kind"] == "escalate"
    assert baseline == actions[0]["action_id"]
    candidate["eligible"] = True
    candidate["eligibility"] = {"status": "unverified"}
    assert len(build_actions(report, run_id="original", revision=0)[0]) == 1


def test_incomplete_hard_gates_do_not_admit_a_candidate(supplied):
    report = copy.deepcopy(supplied[2])
    candidate = next(c for c in report["staffing"]["candidates"] if c["physician_id"] == "PHY-009")
    candidate["rules"] = [rule for rule in candidate["rules"] if rule["rule"] != "rest"]
    assert build_actions(report, run_id="original", revision=0)[0][0]["kind"] == "escalate"


def test_live_choice_is_primary_and_payload_excludes_names_and_raw_records(supplied):
    report = copy.deepcopy(supplied[2])
    report["raw_clinical_note"] = "NEVER_SEND_THIS"
    report["staffing"]["candidates"][0]["name"] = "NEVER_SEND_THIS"
    requests = []

    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert "NEVER_SEND_THIS" not in json.dumps(payload)
        assert "PHY-009" not in json.dumps(payload)
        assert "SYN-005" not in json.dumps(payload)
        assert set(payload) == {"model", "state", "questions"}
        assert payload["state"]["decision_scope"] == "staffing"
        return httpx.Response(200, json=native_answer(payload))

    result = run_selection(report, handler)
    assert len(requests) == 1
    assert result["source"] == "jev"
    assert result["model"] == "jev-1.13.0"
    assert result["selected_physician_ids"] == ["PHY-009"]
    assert result["provider"]["status"] == "available"
    assert result["requires_clinical_lead_approval"]
    assert result["fallback_reason"] is None


def test_provider_can_choose_escalation_without_creating_an_offer(supplied):
    def handler(request):
        payload = json.loads(request.content)
        escalation = next(a["action_id"] for a in payload["state"]["actions"] if a["kind"] == "escalate")
        return httpx.Response(200, json=native_answer(payload, selected=escalation))
    result = run_selection(supplied[2], handler)
    assert result["source"] == "jev" and result["status"] == "escalated"
    assert result["provider"]["status"] == "available"
    assert result["selected_physician_ids"] == []


@pytest.mark.parametrize("fault", ["unknown", "type", "missing_probability", "nan", "sum", "confidence", "usage", "extra_question"])
def test_invalid_native_response_falls_back_without_substituting_a_mock(supplied, fault):
    def handler(request):
        payload = json.loads(request.content)
        answer = native_answer(payload)
        choice = answer["answers"][QUESTION_ID]
        if fault == "unknown":
            choice["choice"] = "not_admitted"
        elif fault == "type":
            choice["type"] = "score"
        elif fault == "missing_probability":
            choice["probabilities"].pop(next(iter(choice["probabilities"])))
        elif fault == "nan":
            # JSON response constructed manually because compliant encoders reject NaN.
            content = json.dumps(answer).replace('"confidence": 1', '"confidence": NaN')
            return httpx.Response(200, content=content)
        elif fault == "sum":
            choice["probabilities"] = {key: 1 for key in choice["probabilities"]}
        elif fault == "confidence":
            choice["confidence"] = 0
        elif fault == "usage":
            answer["usage"]["input_tokens"] = True
        elif fault == "extra_question":
            answer["answers"]["unrequested"] = {}
        return httpx.Response(200, json=answer)
    result = run_selection(supplied[2], handler)
    assert result["source"] == "deterministic_fallback"
    assert result["fallback_reason"] == "invalid_provider_response"
    assert result["provider"]["status"] == "invalid"
    assert result["model"] is None
    assert result["selected_physician_ids"] == ["PHY-009"]


def test_uncertain_native_response_keeps_real_probabilities_and_discloses_fallback(supplied):
    def handler(request):
        return httpx.Response(200, json=native_answer(json.loads(request.content), uncertain=True))
    result = run_selection(supplied[2], handler)
    assert result["source"] == "deterministic_fallback"
    assert result["fallback_reason"] == "provider_uncertain"
    assert result["model"] == "jev-1.13.0"
    assert result["confidence"] == 0
    assert result["provider"]["probabilities"]


def test_application_deadline_bounds_even_a_slow_transport(supplied):
    requests = []

    async def handler(request):
        requests.append(request)
        await asyncio.sleep(1)
        return httpx.Response(200, json=native_answer(json.loads(request.content)))
    started = time.monotonic()
    result = run_selection(supplied[2], handler, config=DecisionConfig(api_key="isolated-test-only", deadline_ms=20))
    assert time.monotonic() - started < 0.5
    assert len(requests) == 1  # No synchronous retries.
    assert result["fallback_reason"] == "provider_timeout"
    assert result["source"] == "deterministic_fallback"


def test_circuit_opens_after_five_failures_and_can_recover(supplied):
    async def scenario():
        now, requests = [0.0], []

        def handler(request):
            requests.append(request)
            if len(requests) <= 5:
                return httpx.Response(529)
            return httpx.Response(200, json=native_answer(json.loads(request.content)))
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            engine = DecisionEngine(DecisionConfig(api_key="isolated-test-only"), client=client, clock=lambda: now[0])
            for _ in range(5):
                result = await engine.select(supplied[2], run_id="original", revision=0)
                assert result["fallback_reason"] == "provider_http_529"
            blocked = await engine.select(supplied[2], run_id="original", revision=0)
            assert blocked["fallback_reason"] == "circuit_open" and len(requests) == 5
            now[0] = 30.1
            recovered = await engine.select(supplied[2], run_id="original", revision=0)
            assert recovered["source"] == "jev" and len(requests) == 6
    asyncio.run(scenario())


def test_stale_revision_does_not_return_an_executable_old_action(supplied):
    def handler(request):
        return httpx.Response(200, json=native_answer(json.loads(request.content)))
    result = run_selection(supplied[2], handler, current_revision=lambda: 1)
    assert result["status"] == "stale" and result["fallback_reason"] == "stale_revision"
    assert result["selected_action"] is None and result["selected_physician_ids"] == []


def test_missing_key_is_disclosed_and_no_request_is_sent(supplied):
    def handler(request):
        pytest.fail("Missing-key fallback must not call the provider")
    result = run_selection(supplied[2], handler, config=DecisionConfig(api_key=""))
    assert result["source"] == "deterministic_fallback"
    assert result["fallback_reason"] == "missing_api_key"
    assert result["provider"]["status"] == "unavailable"


def test_no_safe_action_explicitly_escalates_without_spending_provider_tokens(supplied):
    report = copy.deepcopy(supplied[2])
    report["staffing"]["candidates"] = []
    report["staffing"]["selected"] = []
    result = run_selection(report, lambda request: pytest.fail("no feasible action must not call provider"))
    assert result["source"] == "escalation"
    assert result["fallback_reason"] == "no_feasible_action"


def test_recorded_actionlab_is_reproducible_and_does_not_generate_events(supplied):
    ref, events, report = supplied
    original = [event.to_row() for event in events]
    lab = build_actionlab(events, ref, SCENARIO_NOW, report=report, run_id="original")
    again = build_actionlab(list(reversed(events)), ref, SCENARIO_NOW, report=report, run_id="original")
    assert lab == again
    assert [event.to_row() for event in events] == original
    assert lab["scope"] == "recorded_replay" and lab["generated_event_count"] == 0
    assert len(lab["policies"]) == 5
    assert lab["observed_metrics"]["patient_outcome_improvement"] is None
    assert lab["observed_metrics"]["policy_specific_wait_reduction"] is None
    assert lab["observed_metrics"]["financial_savings"] is None
    trap = lab["split_shift_trap"]
    assert trap["observed_online_activation"] is False and trap["future_assignments_generated"] == 0
    grace = next(row for row in trap["candidates"] if row["physician_id"] == "PHY-009")
    assert grace["guarded_hospital_scope"] == ["SYN-005"]
    assert len(grace["protected_from_unscoped_routing"]) >= 1
    assert grace["actual_consults_this_shift"] is None and grace["verified_low_volume_priority"] is None
    assert grace["challenge_policy_assumption"]
    recorded_grace = next(row for row in lab["observed_metrics"]["physician_workloads"] if row["physician_id"] == "PHY-009")
    assert recorded_grace["recorded_consults_this_shift"] == 0
    assert recorded_grace["actual_consults_this_shift"] is None and not recorded_grace["workload_verified"]


def test_actionlab_only_replays_matching_persisted_decision(supplied):
    ref, events, report = supplied

    def handler(request):
        return httpx.Response(200, json=native_answer(json.loads(request.content)))
    decision = run_selection(report, handler)
    lab = build_actionlab(events, ref, SCENARIO_NOW, report=report, decision=decision, run_id="original")
    choice = next(policy for policy in lab["policies"] if policy["policy"] == "jev_selected")
    assert choice["actual_source"] == "jev" and choice["status"] == "stored_decision_replay"
    assert choice["recommendation"]["physician_ids"] == ["PHY-009"]
    changed = build_actionlab(events, ref, SCENARIO_NOW, report=report, decision=decision, run_id="original", revision=1)
    choice = next(policy for policy in changed["policies"] if policy["policy"] == "jev_selected")
    assert choice["status"] == "unavailable" and choice["recommendation"] is None


def test_key_is_never_in_configuration_repr():
    assert "test-secret" not in repr(DecisionConfig(api_key="test-secret"))
