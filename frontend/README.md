# Relay — Coverage desk

Hackathon frontend for Rutgers Health Hack 2026 (Sevaro Challenge 2).

Detect → Decide → Act. Eligibility first. Human approval. Synthetic data only — no PHI.

## Run

```bash
cd frontend
npm.cmd install
npm.cmd run dev
```

## Routes

- `/` — Dark landing (neural scene, capability cards, mission, FAQ)
- `/app` — Coverage desk (consult board, 90m horizon, Decide drawer)
- `/app/lab` — Scenario lab (event inject)

## Theme

Dark default. Toggle on the landing page only (right of Get started). Persists as `relay-theme`.