"""The operator check uses the real integration with isolated test transports."""
import asyncio
import json

import httpx
import pytest

from backend.intelligence.decisions import DecisionConfig, QUESTION_ID
from backend.intelligence.smoke import run_smoke


def test_smoke_calls_provider_once_with_anonymized_synthetic_records(monkeypatch):
    monkeypatch.setenv("SEVARO_DATA_DIR", "/must-not-read-runtime-data")
    requests = []

    def handler(request):
        requests.append(request)
        payload = json.loads(request.content)
        assert request.url == "https://api.typesafe.ai/v1/systemone"
        assert request.headers["Authorization"] == "Bearer isolated-test-key"
        assert "PHY-009" not in request.content.decode()
        assert "SYN-005" not in request.content.decode()
        choices = list(payload["questions"][QUESTION_ID]["criteria"])
        return httpx.Response(200, json={"model": "jev-1.13.0", "answers": {QUESTION_ID: {
            "type": "choice", "choice": choices[0], "confidence": 1,
            "probabilities": {choice: int(choice == choices[0]) for choice in choices},
        }}, "usage": {"input_tokens": 1200, "output_tokens": 90}})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_smoke(DecisionConfig(api_key="isolated-test-key"), client=client)

    result = asyncio.run(check())
    assert len(requests) == 1
    assert result["source"] == "jev" and result["provider_status"] == "available"
    assert result["model"] == "jev-1.13.0"
    assert set(result) == {"source", "status", "provider_status", "model", "latency_ms", "fallback_reason"}
    assert "isolated-test-key" not in json.dumps(result)


@pytest.mark.parametrize("key,status,reason", [
    ("", "unavailable", "missing_api_key"),
    ("isolated-test-key", "unavailable", "provider_http_401"),
])
def test_smoke_reports_missing_or_rejected_key_without_exposing_error_body(key, status, reason):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(401, json={"error": "DO_NOT_PRINT_PROVIDER_BODY"})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await run_smoke(DecisionConfig(api_key=key), client=client)

    result = asyncio.run(check())
    assert len(calls) == bool(key)
    assert result["source"] == "deterministic_fallback"
    assert result["provider_status"] == status and result["fallback_reason"] == reason
    assert "DO_NOT_PRINT_PROVIDER_BODY" not in json.dumps(result)
