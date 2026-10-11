# Canonical API contract

One frontend client (`frontend/src/backendClient.ts`) calls `/api/v1`; its interfaces live in `frontend/src/backendTypes.ts`, with playback types in `frontend/src/recordedReplay.tsx`. These interfaces are maintained alongside the server and exercised by TypeScript builds and actual browser calls; they are not auto-generated OpenAPI response models. Request models and routes are available at `/api/openapi.json` locally. Database schema version is 2.

The authenticated session uses an HTTP-only SameSite=Strict cookie; hosted cookies require HTTPS. Session creation returns a CSRF token held in browser memory. Provisioning happens only through the local admin CLI. Physician users cannot read the staff report or another physician's offers.

Reads return `{request_id,schema_version,run_id,revision,as_of,release_sha,timing,data}`. `/state` returns state directly. Mutations return current state plus `result`. Every operational mutation binds `X-CSRF-Token`, `Idempotency-Key`, `X-Expected-Run` and `X-Expected-Revision`; a reused key with different payload/query fails 409. A fresh revision is required after conflict, not a silent replay under a new key. A single network retry uses the same key. Errors return `{error:{code,message,...},request_id}`.

| Route | Behavior / authorization |
| --- | --- |
| POST/GET/DELETE `/session` | Authenticate / recover session / revoke |
| GET `/state`, `/report` | Operational state; report for coordinator/lead only |
| GET `/me/offers` | Physician's own sent/responded offers, no patient details |
| POST `/events/validate` | Coordinator-only validation; CSRF, max 5 MB; no import |
| POST `/events/import?filename=...&advance_clock=true` | Coordinator-only atomic import; exact eight-column header; validation failure imports nothing |
| POST `/replays/latest` | Coordinator/lead, CSRF; `{data,request_id}` contains private replay ID, latest filename/import ID, input hash, unique-ingestion timeline, default hospital and baseline frame; no operational writes |
| POST `/replays/{id}/frames` | Coordinator/lead, CSRF; `{index}` (-1 for baseline), returns `{data,request_id}` with report, per-hospital routing evidence and preview-only Jev/fallback decision; owner-bound 30-minute memory cache |
| POST `/clock` | Coordinator/lead; `{minutes}` or `{to:offset_timestamp}`; forward-only, within supplied schedule |
| POST `/runs` | Coordinator; `{label}` creates another run from the supplied dataset and preserves earlier history |
| POST `/decisions/preview` | Staff; persistent bounded Jev/fallback decision for current revision; no offer or outreach |
| POST `/offers/propose` | Coordinator; `{decision_id}` applies only the recorded actor-owned selection with immutable terms and current hard gates |
| POST `/offers/{id}/approve`, `/reject` | Clinical lead only |
| POST `/offers/{id}/send` | Coordinator; approved terms rechecked, simulated only; 10-minute scenario-time expiry |
| POST `/offers/{id}/accept`, `/decline` | Matching physician; current offer, expiry and gap benefit rechecked |
| POST `/offers/{id}/cancel` | Staff for unsatisfied offers; accepted commitment cancellation requires clinical lead |
| POST `/actions/escalate` | Internal escalation/nudge only; no off-shift approval bypass |
| POST `/actions/{id}/acknowledge` | Clinical lead review record |
| POST `/actions/reassign` | Coordinator; credentialed/currently available target, modeled request rather than EHR assignment |
| GET `/actionlab` | Staff; recorded comparison, no provider calls, generated events = 0 |
| GET `/audit.csv` | Staff-only audit export |
| GET `/health/live`, `/health/ready` | Process/database readiness; database outage makes readiness fail |

`Decision.source` is `jev`, `deterministic_fallback` or `escalation`; the output carries actual provider model, probabilities, confidence, time and reason. Preview does not change the operational revision; creating an offer does. A stale decision cannot create an offer. The fallback is computed before I/O; provider I/O occurs outside database transactions.

Recorded replay POSTs perform read-only computation and require CSRF but not operational idempotency/revision headers. Snapshots pin the current run/revision and latest import ID, including duplicate-only receipts; changed state fails 409. Unknown/expired/other-owner sessions fail 404. Incomplete legacy import membership fails 422 with a reimport instruction. New import receipts retain complete deduplicated membership and the received CSV SHA-256 inside their existing JSON metadata, without a database migration. Replay excludes manual offer commitments, makes no clinical events or assignments, and never persists its `RPLDEC-` decisions as executable offers. Each unique frame is cached under an asynchronous lock so repeated requests do not repeat provider calls.

Coverage separates confirmed, assumed/unverified, planned and future scheduled IDs. Confirmed presence is imported operational participation evidence under the challenge semantics; it does not certify independent desktop heartbeat or real clinical availability. Workload counters describe supplied events and disclose missing completeness. Coverage projections freeze unresolved current activity, use 19 five-minute samples and never invent completion events.

PostgreSQL read snapshots keep envelope and report revisions consistent. Transactions use a shared advisory lock across workers, a unique open-offer constraint, accepted-interval exclusion and unique gap slots. The global lock is conservative; write scalability beyond the local challenge workload is unverified. SQLite exists only as an explicit isolated test adapter.

Financial capability remains disabled/null. A future verified rate contract in `backend/api/finance.py` requires scope, unit, currency, effective interval, source and verification provenance. It does not supply rates or enable cost routing. Revenue additionally needs authoritative payer, reimbursement and HB/PB ownership data.
