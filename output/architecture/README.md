# Relay architecture diagram

Presentation export: `relay-architecture.png` (3600 × 2100). Editable vector: `relay-architecture.svg` (1800 × 1050).

This depicts the local implementation, rather than asserting a verified hosted deployment. Inputs are supplied official CSVs and user imports. CSV playback reconstructs historical state without operational writes; replay snapshots and completed frames are held in an owner-bound 30-minute memory cache. Forecasts are modeled. Code determines eligibility and routing; optional Jev chooses among approved staffing actions with deterministic fallback. Offers require clinical-lead approval and use simulated notifications.

Sources: `compose.yaml`, `backend/Dockerfile`, `backend/api/main.py`, `backend/api/recorded_replay.py`, `backend/api/service.py`, `docs/jev-contract.md`, and the connected frontend. The Relay mark follows `frontend/src/components/RelayMark.tsx`.

Regenerate SVG with `python output/architecture/generate.py`, then PNG with `node output/architecture/render.mjs` (requires the locally installed Playwright Chromium path).
