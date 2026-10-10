"""One shared HTTPX client, bounded deadline, and explicitly labeled fallback modes."""

import asyncio
import time
from typing import Protocol

import httpx
from pydantic import ValidationError

from app.schemas.jev import (
    AdvisoryResult,
    ChoiceAnswer,
    ChoiceQuestion,
    JevRequest,
    NoulAnswer,
    NoulQuestion,
    ScoreAnswer,
    validate_response,
)


class JevAdapter(Protocol):
    mode: str
    model: str

    async def evaluate(self, request: JevRequest) -> AdvisoryResult: ...


def normalize(payload: dict, request: JevRequest, mode: str, latency_ms: float) -> AdvisoryResult:
    response = validate_response(payload, request)
    reasons = []
    for name, answer in response.answers.items():
        if isinstance(answer, NoulAnswer) and 0.25 <= answer.noul <= 0.75:
            reasons.append(f"{name}: ambiguous yes/no distribution")
        elif isinstance(answer, (ChoiceAnswer, ScoreAnswer)) and answer.confidence < 0.5:
            reasons.append(f"{name}: low advisory confidence")
        if isinstance(answer, ChoiceAnswer) and answer.choice in {"no_preference", "defer"}:
            reasons.append(f"{name}: model deferred preference")
    return AdvisoryResult(
        mode=mode,
        status="mock" if mode == "mock" else "uncertain" if reasons else "available",
        model=response.model,
        requested_model=request.model,
        answers={name: answer.model_dump() for name, answer in response.answers.items()},
        usage=response.usage.model_dump(),
        latency_ms=round(latency_ms, 2),
        uncertain=bool(reasons),
        uncertainty_reasons=reasons,
        message=(
            "Synthetic deterministic mock; no live provider call. "
            if mode == "mock" else "TypeSafe advisory received. "
        ) + "Confidence summarizes model distribution, not clinical safety or hospital risk.",
    )


class DisabledJevAdapter:
    mode = "off"

    def __init__(self, model: str = "jev-latest"):
        self.model = model

    async def evaluate(self, request: JevRequest) -> AdvisoryResult:
        return AdvisoryResult(mode="off", status="disabled", model=self.model,
                              message="Jev is disabled; deterministic rules remain authoritative.")


class MockJevAdapter:
    mode = "mock"

    def __init__(self, model: str = "jev-latest"):
        self.model = model

    async def evaluate(self, request: JevRequest) -> AdvisoryResult:
        answers = {}
        for name, question in request.questions.items():
            if isinstance(question, NoulQuestion):
                answers[name] = {"type": "noul", "noul": 0.5}
            elif isinstance(question, ChoiceQuestion):
                options = list(question.criteria)
                selected = "no_preference" if "no_preference" in options else options[0]
                answers[name] = {"type": "choice", "choice": selected, "confidence": 0.0,
                                 "probabilities": {key: 1 / len(options) for key in options}}
            else:
                size = len(question.criteria)
                answers[name] = {"type": "score", "score": (size - 1) / 2, "confidence": 0.0,
                                 "legend": {str(i): text for i, text in enumerate(question.criteria)},
                                 "probabilities": {str(i): 1 / size for i in range(size)}}
        return normalize({"model": "mock-operations-v1", "answers": answers,
                          "usage": {"input_tokens": 0, "output_tokens": 0}}, request, "mock", 0)


class TypeSafeJevAdapter:
    mode = "live"

    def __init__(self, client: httpx.AsyncClient, api_key: str, model: str = "jev-latest",
                 base_url: str = "https://api.typesafe.ai", timeout_seconds: float = 5,
                 max_retries: int = 1):
        if not api_key:
            raise ValueError("Live Jev requires TYPESAFE_API_KEY")
        self.client = client
        self.api_key = api_key
        self.model = model
        self.url = base_url.rstrip("/") + "/v1/systemone"
        self.timeout = min(max(timeout_seconds, 0.01), 5.0)
        self.max_retries = min(max(max_retries, 0), 1)

    async def evaluate(self, request: JevRequest) -> AdvisoryResult:
        started = time.monotonic()
        status = "unavailable"
        message = "Live Jev is unavailable; deterministic recommendations remain usable."
        try:
            async with asyncio.timeout(self.timeout):
                for attempt in range(self.max_retries + 1):
                    try:
                        response = await self.client.post(
                            self.url,
                            headers={"Authorization": f"Bearer {self.api_key}"},
                            json=request.model_dump(exclude_none=True),
                            timeout=max(0.01, self.timeout - (time.monotonic() - started)),
                        )
                        if response.status_code in {408, 429, 500, 502, 503, 504}:
                            if attempt < self.max_retries:
                                await asyncio.sleep(0.1)
                                continue
                        if response.status_code >= 400:
                            message = f"Live Jev HTTP {response.status_code}; no mock substitution."
                            status = "invalid" if response.status_code in {400, 422} else "unavailable"
                            break
                        try:
                            return normalize(response.json(), request, "live", (time.monotonic() - started) * 1000)
                        except (ValueError, ValidationError):
                            status = "invalid"
                            message = "Live Jev response failed requested answer/rubric validation."
                            break
                    except httpx.TransportError:
                        if attempt >= self.max_retries:
                            break
                        await asyncio.sleep(0.1)
        except TimeoutError:
            message = "Live Jev exceeded the total application deadline; no mock substitution."
        return AdvisoryResult(mode="live", status=status, model=self.model, requested_model=request.model,
                              latency_ms=round((time.monotonic() - started) * 1000, 2), message=message)


def get_adapter(settings, client: httpx.AsyncClient) -> JevAdapter:
    mode = settings.jev_mode
    if mode == "off":
        return DisabledJevAdapter(settings.jev_model)
    if mode == "mock":
        return MockJevAdapter(settings.jev_model)
    key = settings.typesafe_api_key
    if hasattr(key, "get_secret_value"):
        key = key.get_secret_value()
    return TypeSafeJevAdapter(client, key or "", model=settings.jev_model,
                             base_url=settings.jev_base_url, timeout_seconds=settings.jev_timeout_seconds,
                             max_retries=settings.jev_max_retries)
