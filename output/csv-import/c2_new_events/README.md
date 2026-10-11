# CSV import screenshots

Input: `c2_new_events.csv`, unchanged. Screenshots captured from the actual application using a disposable local database seeded with the official challenge records. The current application run was not changed.

- Validation/import: 9 rows, 8 new events, 1 duplicate (`EVT-01165`), 0 errors.
- Recorded events: 1,163 → 1,171.
- Open consults: 18 → 19.
- Scenario clock: 18:20:00 → 18:26:57 ET on 17 March 2026.
- `CON-2120`: triaged, awaiting assignment, one recorded routing failure.
- `CON-2105`: assigned to `PHY-008`, Provider Contacted.
- `PHY-008`: Incoming Hospital Call, busy and not routable.

Forecasts visible in the dashboard are modeled; these screenshots do not establish improved clinical outcomes. Financial inputs were not supplied.

Primary screenshot: `06-csv-operational-results.png` shows the actual before/after operational comparison and backend staffing recommendation.

Screenshots: validation, import confirmation, dashboard after import, consult queue, and physician states. Machine-readable evidence is in `results.json`.
