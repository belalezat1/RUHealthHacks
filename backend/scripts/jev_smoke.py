"""Opt-in live provider smoke test. Run after confirming the sponsor/project credentials."""

import asyncio
import json

import httpx

from app.core.config import get_settings
from app.integrations.jev import get_adapter
from app.schemas.jev import ChoiceQuestion, JevRequest, NoulQuestion, ScoreQuestion


async def main():
    settings = get_settings()
    if settings.jev_mode != "live":
        raise SystemExit("Set JEV_MODE=live with the confirmed server-side TYPESAFE_API_KEY to run this test.")
    async with httpx.AsyncClient(limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
                                timeout=5, follow_redirects=False) as client:
        response = await client.get(settings.jev_base_url.rstrip("/") + "/v1/models",
                                    headers={"Authorization": f"Bearer {settings.typesafe_api_key}"})
        if response.status_code != 200:
            raise SystemExit(f"Model discovery failed with HTTP {response.status_code}; no key or payload logged.")
        models = response.json().get("models", [])
        if settings.jev_model not in {model["name"] for model in models}:
            raise SystemExit("Configured JEV_MODEL is not in the authenticated model list.")
        request = JevRequest(model=settings.jev_model,
                             state={"synthetic": True, "note": "Handoff needs a dispatcher check before contact."},
                             questions={
                                 "ambiguity": NoulQuestion(instructions="Assess only state.note wording ambiguity."),
                                 "handoff": ScoreQuestion(instructions="Rate state.note handoff coordination wording.",
                                                          criteria=["Straightforward", "Needs coordination", "Complex"]),
                                 "preference": ChoiceQuestion(instructions="Choose whether state.note contains enough evidence for a semantic preference; defer if missing.",
                                                              criteria={"clear": "Enough evidence", "defer": "Insufficient evidence"}),
                             })
        result = await get_adapter(settings, client).evaluate(request)
        print(json.dumps(result.model_dump(), indent=2))
        if result.status not in {"available", "uncertain"}:
            raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
