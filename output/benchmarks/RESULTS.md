# On Deck: verified quick benchmark

Measured October 11, 2026 on local macOS ARM64 / Python 3.12.14, application checkout `c54c2e9`. Later frontend/deployment commits are not included in these timings. All operational input is from the nine unchanged organizer CSVs: **1,164 rows, 1,163 unique events, 14 physicians, 12 hospitals**. The supplied snapshot matched **208/208 reference fields**. Source hashes and individual samples are in [raw-results.json](raw-results.json).

## Numbers we can quote

- **25/25 routing scenarios matched an independent challenge-handbook oracle**, including credentials, busy/ringing state, cooldown, workload, low-volume preference, and last-answer tie-breaks. Four scenarios correctly returned no eligible physician. Unspecified complete ties accept any equally best doctor. These are rule-conformance cases, not clinical accuracy.
- **15/15 constraint checks passed:** rest 3/3, weekly cap 3/3, overlap 3/3, offer expiration 2/2, approval 4/4. Another **6/6 off-shift eligibility checks passed**. Schedule boundaries use hypothetical offer windows against unchanged official roster facts; workflow checks execute the actual API in an isolated adapter.
- **43 existing backend regressions passed in 6.08 seconds**, including PostgreSQL concurrency tests. See [regression-tests.xml](regression-tests.xml).
- **25/25 live Jev selections succeeded with no fallback:** median **144.85 ms**, p95 **240.83 ms**, versus deterministic selection **0.36 / 0.57 ms**. Decisions agreed 25/25, but these repeated one staffing state with one feasible physician plus escalation; they do not establish diverse Jev decision accuracy.

## Speed: 25 runs per measurement

Three warm-ups precede each ordinary operation. Percentiles use linear interpolation between sorted samples. Timings are serial local measurements, not production SLAs.

| Operation | p50 (ms) | p95 (ms) |
|---|---:|---:|
| Routing one hospital, prepared state | 0.0117 | 0.0158 |
| Parse, deduplicate and replay events | 7.7778 | 7.9054 |
| Forecast 12 hospitals over 90 minutes | 4.3339 | 4.4614 |
| Full reference load, analysis and JSON | 18.4841 | 20.4033 |
| Local HTTP report, warm | 14.3825 | 15.5283 |
| Local HTTP state | 4.8832 | 5.0502 |
| Local HTTP Action Lab | 15.5988 | 18.3319 |

CSV text is already in memory; full reference load reads the reference files with a warm OS cache. HTTP measurements use the running PostgreSQL application; its recorded state had 1,163 events and one existing offer. Read-only timings do not create offers.

## Volume and coverage limits

At 1× / 5× / 10× input rows, processing p50 was **15.86 / 39.41 / 71.82 ms**; p95 was **20.17 / 42.00 / 73.60 ms**. Larger inputs repeat unchanged source rows and deduplicate to 1,163 unique events. This measures duplicate-heavy upload processing; **10× unique-event scalability was not tested**. No additional operational facts were invented.

Suncrest's conditional coverage model projects **100 → 55 deficit physician-minutes**, a **45% modeled shortfall reduction**, assuming acceptance and a 15-minute arrival ETA. This is **not observed activation, reduced patient wait, clinical benefit, or financial savings**. No financial estimates were generated.

Cold-start HTTP latency, concurrent-user throughput, production network performance, and diverse Jev accuracy were skipped for this lightweight pass.

## Presentation graphs and raw evidence

1. [Algorithm and API speed](01_algorithm_speed.png)
2. [Selection and constraint pass rates](02_accuracy_constraints.png)
3. [Runtime versus uploaded rows](03_runtime_dataset_size.png)
4. [Live Jev versus deterministic latency](04_jev_vs_deterministic.png)
5. [Modeled coverage gaps](05_modeled_coverage_gaps.png)

All five PNGs are 2560×1440 and were visually inspected. [timings.csv](timings.csv) contains individual samples; [jev-results.json](jev-results.json) contains the paired live decisions. [Frontend review](FRONTEND_REVIEW.md) documents the newly fetched branches.

Reproduce with `.venv/bin/python output/benchmarks/run_quick.py`, then `check_workflow.py`, then `run_quick.py --jev`, then `render_graphs.py` in that directory. The live command makes 25 provider requests using the ignored server-side key. The baseline needs the running local application and provisioned local browser accounts; regression reproduction uses the local PostgreSQL test URL.
