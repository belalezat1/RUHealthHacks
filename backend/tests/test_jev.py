import asyncio
import copy
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.integrations.jev import DisabledJevAdapter, MockJevAdapter, TypeSafeJevAdapter
from app.schemas.jev import ChoiceQuestion, JevRequest, NoulQuestion, ScoreQuestion, validate_response
from app.services import advisory


def request():
    return JevRequest(model="jev-latest", state={"candidate_ids": ["a", "b"]}, questions={
        "ambiguity": NoulQuestion(instructions="Assess the supplied note."),
        "preference": ChoiceQuestion(instructions="Choose from state.candidate_ids or defer.",
                                     criteria={"a": "Candidate a", "b": "Candidate b", "defer": "No preference"}),
        "difficulty": ScoreQuestion(instructions="Rate handoff wording.", criteria=["Easy", "Medium", "Hard"]),
    })


def valid_response():
    return {"model": "jev-test-returned", "answers": {
        "ambiguity": {"type": "noul", "noul": 0.9},
        "preference": {"type": "choice", "choice": "a", "confidence": 0.8,
                       "probabilities": {"a": 0.8, "b": 0.1, "defer": 0.1}},
        "difficulty": {"type": "score", "score": 1.5, "confidence": 0.6,
                       "legend": {"0": "Easy", "1": "Medium", "2": "Hard"},
                       "probabilities": {"0": 0.0, "1": 0.5, "2": 0.5}},
    }, "usage": {"input_tokens": 42, "output_tokens": 12}}


def test_fractional_score_native_noul_and_exact_coverage():
    result = validate_response(valid_response(), request())
    assert result.answers["difficulty"].score == 1.5
    assert not hasattr(result.answers["ambiguity"], "confidence")
    payload = valid_response()
    del payload["answers"]["ambiguity"]
    with pytest.raises(ValueError, match="exactly match"):
        validate_response(payload, request())


@pytest.mark.parametrize("mutation", [
    lambda p: p["answers"]["preference"].update(choice="unknown"),
    lambda p: p["answers"]["preference"]["probabilities"].update(unknown=0.0),
    lambda p: p["answers"]["difficulty"]["legend"].update({"1": "Invented"}),
    lambda p: p["answers"]["difficulty"].update(score=3.0),
    lambda p: p["answers"]["difficulty"].update(score=1.0),
    lambda p: p["answers"]["preference"].update(confidence=float("nan")),
    lambda p: p["answers"]["preference"]["probabilities"].update(a=1.2),
    lambda p: p["answers"]["preference"]["probabilities"].update(a=0.1),
    lambda p: p["answers"]["ambiguity"].update(confidence=0.5),
    lambda p: p["answers"]["ambiguity"].update(type="score"),
    lambda p: p["answers"].update(extra={"type": "noul", "noul": 0.2}),
])
def test_malformed_or_incompatible_answers_rejected(mutation):
    payload = valid_response()
    mutation(payload)
    with pytest.raises(ValueError):
        validate_response(payload, request())


@pytest.mark.asyncio
async def test_mock_off_and_actual_model_labels():
    result = await MockJevAdapter().evaluate(request())
    assert result.mode == "mock" and result.status == "mock" and result.uncertain
    assert result.model == "mock-operations-v1"
    assert (await DisabledJevAdapter().evaluate(request())).status == "disabled"
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=valid_response()))) as client:
        live = await TypeSafeJevAdapter(client, "test-key").evaluate(request())
    assert live.model == "jev-test-returned" and live.status == "available"


@pytest.mark.asyncio
@pytest.mark.parametrize("code,attempts", [(401, 1), (422, 1), (503, 2), (429, 2)])
async def test_only_transient_errors_retry_once(code, attempts):
    calls = []

    def handle(req):
        calls.append(req)
        assert req.headers["Authorization"] == "Bearer test-key"
        assert str(req.url) == "https://api.typesafe.ai/v1/systemone"
        return httpx.Response(code, json={"sensitive": "must not appear"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await TypeSafeJevAdapter(client, "test-key").evaluate(request())
    assert len(calls) == attempts
    assert result.status in {"invalid", "unavailable"} and result.mode == "live"
    assert not result.answers and "sensitive" not in result.message


@pytest.mark.asyncio
async def test_total_deadline_covers_request_and_retry():
    calls = []

    async def handle(req):
        calls.append(req)
        await asyncio.sleep(0.025)
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await TypeSafeJevAdapter(client, "test-key", timeout_seconds=0.05).evaluate(request())
    assert result.status == "unavailable" and result.latency_ms < 200
    assert len(calls) == 1 and "deadline" in result.message


@pytest.mark.asyncio
async def test_invalid_live_is_not_mock_and_low_confidence_is_uncertain():
    payload = valid_response()
    payload["answers"]["preference"]["choice"] = "unknown"
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))) as client:
        result = await TypeSafeJevAdapter(client, "test-key").evaluate(request())
        assert result.status == "invalid" and not result.answers
        payload["answers"]["preference"]["choice"] = "a"
        payload["answers"]["preference"]["confidence"] = 0.1
        result = await TypeSafeJevAdapter(client, "test-key").evaluate(request())
        assert result.status == "uncertain" and result.uncertain


@pytest.mark.asyncio
async def test_preview_cache_invalidation_stale_arrival_and_bounds(monkeypatch):
    advisory.clear_cache()
    now = datetime.now(timezone.utc)
    state = {"dataset_id": "test", "source_version": 1, "physicians": []}
    proposal = {"id": "p1", "expires_at": (now + timedelta(minutes=1)).isoformat(),
                "candidate": {"physician_id": "a", "action": "activate", "eligibility": {"outcome": "eligible"}}}

    class CountingAdapter(MockJevAdapter):
        calls = 0

        async def evaluate(self, req):
            self.calls += 1
            return await super().evaluate(req)

    adapter = CountingAdapter()
    first = await advisory.build_advisory(state, proposal, adapter, now)
    cached = await advisory.build_advisory(state, proposal, adapter, now)
    assert first == cached and adapter.calls == 1
    changed = copy.deepcopy(state) | {"source_version": 2}
    stale = await advisory.build_advisory(changed, proposal, adapter, now, lambda: ("test", 3))
    assert stale["status"] == "stale" and stale["answers"] == {}
    await advisory.build_advisory(state, proposal, adapter, now + timedelta(seconds=31))
    assert adapter.calls == 3
    monkeypatch.setattr(advisory, "MAX_CACHE_ENTRIES", 2)
    for version in range(4, 8):
        await advisory.build_advisory(state | {"source_version": version}, proposal, adapter, now)
    assert len(advisory._cache) == 2
    no_plan = await advisory.build_advisory(state, {"id": "none"}, adapter, now)
    assert no_plan["status"] == "not_requested"
