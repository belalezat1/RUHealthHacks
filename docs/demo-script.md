# Five-minute demo

Start with `make dev`, then `make seed`. Open http://localhost:5173. To reset fixture timestamps before recording, explicitly choose a fixture ID: `make demo-reset DATASET=<ID>`.

1. **0:00–0:40 — Import and orient.** Open Simulation Lab, choose a synthetic fixture, validate it, and activate it. Point out Synthetic demo, dataset ID, connection freshness, and Jev mock mode. Open Command Center and the six-bin forecast.
2. **0:40–1:20 — Change the operational inputs.** Inject a consultation surge or unavailable signal. Show the source version and forecast changing. Explain that heartbeat, current activity, and scheduled coverage are separate.
3. **1:20–2:20 — Review the decision.** In the consultation queue, preview an intervention. Open rule evidence, alternatives, and rejected candidates. Show the split-shift candidate rejected for future rest/coverage. Jev is an explicitly labeled secondary advisory over feasible plans.
4. **2:20–3:20 — Follow the workflow.** Approve for contact; use the clearly labeled synthetic physician response; commit the assignment. Show that improvement is projected. Inject the separate synthetic activation event and verify. Open the audit trail.
5. **3:20–4:20 — Measure.** Run a split-shift or surge replay in Simulation Lab. Compare baseline and optimized raw metrics, including unassigned and unfinished work. Export the result JSON. Explain that the live dataset and assignments are unchanged by replay.
6. **4:20–5:00 — Robustness.** Validate/import the second same-format fixture or replay a duplicate event. Demonstrate that invalid imports preserve the prior dataset, and duplicate semantic events do not duplicate work.

Use local synthetic actor controls only. Do not describe mock Jev, a projected improvement, or a simulated consent event as a live external integration or a confirmed clinical outcome.
