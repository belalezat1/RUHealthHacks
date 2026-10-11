# Recorded CSV playback verification

Actual application tested with unchanged `c2_new_events.csv` and official reference records in disposable PostgreSQL. No records were generated. This browser run disabled live Jev; provider success, uncertainty, invalid choices, timeout, missing key and no feasible action were verified separately with isolated HTTP fault injection.

- Import: 8 accepted, 1 duplicate, 0 errors; 8 unique ingestion time points.
- Baseline: 1,163 recorded events; final: 1,171 and 19 open consults.
- Late camera record affects state at 18:25:40 ET.
- Oak Valley routing picks Dr. Noah Williams at 18:26:01, then no eligible physician when he becomes busy at 18:26:57.
- Backup recommendation remains Dr. Grace Okafor in the deterministic browser run. Forecasts are modeled, not observed clinical benefits.
- Play, Pause, Next, Restart and Return to current state verified on desktop; mobile has no horizontal overflow. No browser page errors.
- Operational run, counts, clock, revision, offers, imports and audit remain unchanged by playback.
- Backend/domain/provider checks: 61 passed. Frontend tests: 3 passed. Actual-browser workflows: 4 passed in 23.6 seconds. Production frontend build passed.

Screenshots: `01-physician-selected.png`, `02-mobile-playback.png`, `03-call-busy.png`. Actual browser response evidence is in `results.json`.

Live Jev verification was not executed: automatic approval review blocked transmitting dataset-derived operational information to the external TypeSafe service. No live-provider success or performance is claimed for this playback verification.

Everything remains local and uncommitted.
