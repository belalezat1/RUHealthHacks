# Implemented Sevaro integration — October 11, 2026

The Challenge 2 application is integrated on `belal`: one FastAPI backend, PostgreSQL canonical state, one connected React frontend, native Jev selection with deterministic fallback, role-protected staffing offers and recorded ActionLab comparisons. The official snapshot remains 208/208. This establishes a working local challenge implementation, not clinical production readiness.

## Delivered behavior

- Original organizer CSVs are unchanged; 1,163 unique events replay into 14 physicians and 12 hospitals. Same-consult repeat receipts preserve the earliest receipt and count one demand arrival. Late/duplicate events, concurrent activity and contradictory signals are reconciled deterministically. Missing workload/presence evidence remains explicit.
- Official stage standards, physician activity, consult lifecycle, risk ordering, hospital credentialing, p90 demand uplift and 19 five-minute forecast samples cover 90 minutes. Shared credentials represent hospital access, not independent simultaneous network capacity.
- Split-shift rules enforce opt-in, credential scope, 10-hour rest, conservative trailing-seven-day work plus reservations, schedule/commitment conflicts, duration, ETA, one open offer and weekly send limits. Accepted and observed overlapping work are counted once. Cancelled commitments retain conservative history until better evidence exists. Production policy blocks candidates without authoritative licensing/privilege/specialty evidence.
- Proposal → clinical-lead approval → simulated send → physician-specific response is server-owned. Immutable terms are rechecked at approval, send and acceptance. Offers expire after ten scenario minutes. A revision mismatch or conflicting idempotency payload fails safely. Cross-worker PostgreSQL locking, exclusion constraints and unique gap claims prevent competing acceptances.
- Accepted commitments are planned capacity. Imported operational participation plus current availability establishes challenge-level confirmation; an ETA, accepted response or physician attestation never manufactures online evidence. Lead cancellation releases capacity and reopens necessary gap claims while retaining work history.
- Jev's native Choice API selects only code-defined hard-gated scoped actions or escalation. The deterministic fallback exists before provider I/O, with a 900 ms total request deadline, no synchronous retry and an explicit circuit breaker. State/actor binding and transactional revalidation govern application. Provider inputs contain anonymous labels, opaque action IDs and allowlisted operational features, excluding names, raw narratives, consult IDs and patient information.
- The frontend displays initial reference evidence, actual rankings/forecasts, all six candidate explanations, source/latency, lead approval, simulated sending, physician responses, audit export and live CSV validation/import. It refreshes automatically and distinguishes stale state, errors, planned coverage and confirmed evidence. Source-row browser injection changes the existing run and clock without a restart.
- ActionLab compares no action, deterministic routing, naive split shift, scoped split shift and the stored Jev/fallback decision on one recorded cutoff. The unsafe naive comparator cannot be executed. Observed waits/workloads are shared evidence; conditional scope/coverage estimates are separate. Generated event count is zero; patient outcome improvement and financial savings remain unavailable.
- Financial optimization is disabled. A typed future cost contract requires verified provenance, scope, unit, currency and effective interval, and supplies no values. The upstream frontend's invented reimbursement/rate/experience values and mock operational provider are excluded.

## Sources and local checkpoints

| Source | Contribution |
| --- | --- |
| `origin/yassin` `29f0b60` | Official domain engine, CSV files, reference oracle and API/offer foundations, corrected during integration |
| `origin/ray` `ae6bdff` | PostgreSQL/concurrency and native Jev design patterns, adapted to the official challenge policy |
| `origin/frontend` `8806f78` | Latest assets/styles at initial integration; operational screens replaced with canonical backend reads/writes |
| Later `origin/frontend` `67176cc` | Inspected when an independent fetch advanced the tracking ref; shared icons/font/token/index changes adopted, demo store/economics excluded, broader visual redesign deferred |

Local history includes `ab72706` (official backend checkpoint), `c6eb230` (existing integration checkpoint), and `21d9c96` (verified browser, cancellation and recovery checkpoint), followed by the final hardening/report commit. Run `git rev-parse HEAD` for the final checkout SHA; the final chat handoff records it explicitly.

The starting `belal` commit `fb87fbd88080262f92963352d7f3f2889d2982ec` remains at `backup/belal-pre-integration-20261011-fb87fbd`. No teammate branch was committed to, reset, rebased or merged into. Other source tracking refs still match the initial manifest. `origin/frontend` advanced by a fetch during the session; it was inspected and was not reset. No remote push, AWS modification, real physician notification or use of real patient data occurred. See [source-preservation evidence](evidence/source-preservation.json) and [integration manifest](integration-sources.json).

## Actual verification

| Check | Command / result |
| --- | --- |
| Full backend including PostgreSQL | `SEVARO_TEST_DATABASE_URL=postgresql://b@127.0.0.1:55433/postgres .venv/bin/python -m pytest backend/tests -q`: **111 passed in 5.94 s** |
| PostgreSQL integrity | Fresh database migration, offer loop/restart, rollback, uniqueness/exclusion and two-application competing acceptance tests passed in the full suite |
| Frontend compile/build | `cd frontend && npm run build`: passed TypeScript and Vite 7.3.7 build; final bundle 368.68 kB JS / 118.46 kB gzip |
| Browser integration | `.venv/bin/python scripts/e2e.py` with installed Chromium override: **2 passed in 13.3 s**; isolated PostgreSQL, three roles, initial oracle, approval/send/accept, persistence, mobile overflow, duplicate replay, recorded ActionLab and new supplied-row injection |
| Live source-row injection | Withheld genuine organizer rows in a disposable test run, then imported the original CSV through the UI. Same run/revision update; clock advanced 18:17 → actual latest ingestion 18:19:43 ET. Explicit clock movement to the supplied 18:20 cutoff restored 208/208; no events were generated |
| Live Jev | One anonymous allowlisted request, `jev-latest` resolved to `jev-1.13.0`; valid ready selection, confidence 0.9, provider 203.068 ms, 1,215 input / 97 output tokens; [sanitized evidence](evidence/jev-live.json) |
| Dependency audit | `cd frontend && npm audit`: **zero reported vulnerabilities** after same-major Router/Vite fixes; [audit](evidence/npm-audit.json). This is not an independent security assessment |
| PostgreSQL recovery | Canonical custom-format backup restored into a separate disposable database; schema 2, all table counts/current run/revision matched; report rebuilt. Original database untouched; [evidence](evidence/postgres-recovery.json) |
| Local Docker | Multi-stage Python 3.12 + Node 22 image built successfully; PostgreSQL 18 and app healthy; complete three-role browser workflow passed against built static frontend; container restart preserved an accepted offer, 1,163 source events and audit history. No deployment performed; [container evidence](evidence/docker-verification.json) |
| Source integrity | Nine CSV files byte-identical to the official developer kit; source refs/backup checked and recorded |

The full suite produces one upstream Starlette/httpx TestClient deprecation warning. Test fault fixtures and ephemeral credentials remain isolated from runtime source data. The root key was checked against tracked files and the built frontend without printing it; the image excludes `.env` and contains no baked API key. Runtime configuration rejects non-PostgreSQL database URLs. CI configuration reproduces PostgreSQL tests, build/audit and browser checks; the remote CI job has not run because the branch was not pushed.

## Performance and complexity

Measurements use organizer records on macOS arm64, Python 3.12.14, eight CPU cores. OS caches may be warm; interpreter startup is excluded. No invented event simulation is timed.

| Operation | Sample | p50 | p95 |
| --- | --- | --- | --- |
| Replay + analysis + JSON, in-memory reference data | 100 | 14.457 ms | 15.162 ms |
| CSV read/validate + replay + analysis + JSON | 50 | 23.569 ms | 25.003 ms |
| Warm cached HTTP report, local PostgreSQL | 50 | 15.477 ms | 16.760 ms |
| HTTP report, four concurrent clients | 40 | 42.979 ms | 56.955 ms |
| Native live Jev | 1 | 203.068 ms | Not estimable from one sample |

The four-client smoke completed about 89 reads/s with zero failed requests. It excludes Jev, mutations, production network latency and external services; it is not a maximum-throughput or 200-hospital load test. [Engine evidence](evidence/engine-benchmark.json), [HTTP evidence](evidence/api-benchmark.json).

Let E be events, C consults, P physicians, H hospitals and T forecast samples (19). Parsing/deduplication is O(E); sorting/replay is O(E log E) with O(E+C+P) retained evidence/state. Hospital projection scans credentialed physicians and recorded arrival times at each sample: approximately O(T·(H·P+C)) plus availability evidence work. Split-shift selection evaluates combinations of K eligible candidates up to the needed slots: O(sum binomial(K,i) · projection cost), worst-case exponential O(2^K), with K capped at 18. The supplied target has one eligible candidate, so this is small here. The cap bounds search size but does not demonstrate acceptable worst-case latency for a large roster. Network-scale optimization, indexing and write-lock granularity require measured redesign/load tests before broader deployment. Jev action enumeration is separately capped at 32 options including escalation.

## Judging and challenge alignment

| Area | Reviewable evidence / limits |
| --- | --- |
| Innovation & creativity | Detect → hard-gated selection → approval/action loop; Jev selection with recorded fallback and conditional split-shift scope guard. Novelty and score remain judges' assessments |
| Technical implementation | Verified reference oracle, PostgreSQL durability/concurrency, role authorization, actual native provider call, canonical UI, live CSV import and Docker build. Remote CI/cloud operations remain unverified |
| Healthcare impact | Targets recorded consult-stage breaches, coverage gaps and workload imbalance. No clinical benefit, treatment effect or patient outcome is claimed without clinical validation |
| Presentation & demonstration | Connected role workflow, source/latency evidence, readable five-policy ActionLab, candidate explanations, persistent audit, runbook and screenshots. A concise live presentation should distinguish confirmed facts from projections |
| Feasibility & scalability | Container packaging, explicit provisioning, recovery drill and bounded performance measurements. Institutional identity, real integration, regulatory/clinical/security review and network-scale testing are required before clinical use |

All requested challenge mechanics have an implementation and verification path. The handbook/PRD's intended future capabilities are not substituted for available source evidence. Profitability, real licensing, clinical quality and existing Sevaro interfaces are deliberately unavailable unless their authoritative inputs are supplied.

## Remaining issues

**P0 for clinical production deployment:** institutional trusted identity/SSO and clinician mapping; real Sevaro/EHR/event/notification integration contracts and freshness guarantees; authoritative licensing, jurisdiction, privileges and specialty evidence; clinical validation and production security/privacy review. Current imported participation is a challenge presence proxy, not independent real-time availability certification. Clinical deployment must wait for these requirements and explicit deployment authorization.

**P1:** labelled healthcare evaluation/calibration of the provisional Jev threshold and escalation policy; dated authoritative work history and offer history (undated baseline retained conservatively); reliable heartbeat/availability completeness; network-scale load testing and bounded staffing optimization; hosted TLS/secrets/backups/PITR/observability and AWS operational validation. The global advisory lock and process-local circuit/cache are safe local mechanisms, not a demonstrated production scaling design. Actual patient outcomes and policy-specific benefit require prospective evidence.

**P2:** full response-schema generation instead of maintained TypeScript interfaces; broader independent dependency/security review and image scanning; remote CI execution; final UI/UX redesign and presentation assets; verified financial contracts if profitability is later required. No invented finance is needed to run the challenge workflow.

There are no known unresolved P0 failures in the tested local challenge workflow. Production P0 requirements remain above. Local startup, provisioning and recovery commands are in [README](../README.md). Permission is still required before any push, hosted/AWS deployment, external physician communications or real patient-data integration.
