"""Check live Jev using only the bundled synthetic scenario, without persisting state.

Run from the repository root with ``python -m backend.intelligence.smoke``.
Credentials come from the server environment or the ignored root .env file.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
from dotenv import load_dotenv

from ..core.data import DEFAULT_DATA_DIR, SCENARIO_NOW, load_reference
from ..core.events import read_csv_text, validate_batch
from ..core.report import build_report
from .decisions import DecisionConfig, DecisionEngine


async def run_smoke(config: DecisionConfig | None = None, *,
                    client: httpx.AsyncClient | None = None) -> dict:
    # Deliberately ignore database state and SEVARO_DATA_DIR: only bundled synthetic
    # records are eligible for this check, even when running in the hosted container.
    reference = load_reference(DEFAULT_DATA_DIR)
    rows, errors = read_csv_text((reference.data_dir / "event_stream.csv").read_text(encoding="utf-8"))
    if errors:
        raise ValueError("Bundled synthetic events could not be read")
    batch = validate_batch(rows, reference, {})
    if not batch.ok:
        raise ValueError("Bundled synthetic events failed validation")
    report = build_report(batch.accepted, reference, SCENARIO_NOW)
    engine = DecisionEngine(config, client=client)
    try:
        decision = await engine.select(report, run_id="synthetic-provider-smoke", revision=0)
    finally:
        await engine.aclose()
    # Never print credentials, request/response bodies, source records or actions.
    return {"source": decision["source"], "status": decision["status"],
            "provider_status": decision["provider"]["status"], "model": decision["model"],
            "latency_ms": decision["latency_ms"], "fallback_reason": decision["fallback_reason"]}


def main() -> int:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    try:
        result = asyncio.run(run_smoke())
    except (OSError, ValueError):
        # Configuration or fixture errors must not expose exception details/secrets.
        result = {"source": None, "status": "error", "provider_status": "not_requested",
                  "model": None, "latency_ms": 0, "fallback_reason": "smoke_setup_failed"}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["source"] == "jev" and result["provider_status"] == "available" else 1


if __name__ == "__main__":
    raise SystemExit(main())
