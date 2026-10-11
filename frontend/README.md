# Sevaro Command Center — Frontend

Premium operations UI for Rutgers Health Hack 2026 (Sevaro Challenge 2).

## Run

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

- `/` — story landing (first value under 60s)
- `/app` — Command Desk (Detect → Decide → Act)
- `/app/lab` — live event inject + audit log

Demo state is preloaded at Tuesday 17 March 2026, 18:20 ET. API client from `origin/ray` remains in `src/api/` for live backend wiring (`VITE_API_BASE_URL`, proxy `/v1`).

## Demo script

1. Landing — say the slogan; open the command center.
2. Desk — gap already visible with reason.
3. Review intervention — eligibility pass/fail + split-shift trap.
4. Approve → Send → Physician accepts.
5. Close on “Gap filled — offers stopped.”
6. Lab — inject an event; desk updates without restart.