# Sevaro Intervention Desk API v1

Machine-readable spec: [`openapi.json`](openapi.json) (regenerate with
`python -c "import json; from backend.api.main import app; print(json.dumps(app.openapi(), indent=2))" > contracts/openapi.json`).

All endpoints are same-origin under `/api/v1`. The UI and API are served from one viewer origin
(nginx locally, CloudFront when hosted), so no CORS is involved.

## Identity

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/session` `{username, password}` | Sign in. Sets an HTTP-only `sevaro_session` cookie (SameSite=Strict, Secure when hosted). Returns `{user, csrf_token}`. |
| `GET /api/v1/session` | Current user + CSRF token (lets the UI recover after reload). |
| `DELETE /api/v1/session` | Sign out; the session is revoked server-side. |
| `GET /api/v1/demo-accounts` | **Local mode only.** Lists demo accounts for the login page. 404 when hosted. |

Roles: `coordinator`, `clinical_lead`, `physician` (bound to one roster ID). The role and physician
ID always come from the server session; request bodies never choose the actor.

## Reads

| Endpoint | Who | Notes |
|---|---|---|
| `GET /health/live` | anyone | Process up. No state. |
| `GET /health/ready` | anyone | 200 only after migrations + projection rebuild. Includes `release_sha`, `schema_version`, `revision`. |
| `GET /api/v1/state` | signed in | Cheap poll target: `{run_id, revision, as_of, label, release_sha, schema_version}`. |
| `GET /api/v1/report` | coordinator, lead | Full report (risks, physicians, consults, 90-min coverage, staffing recommendation, routing trap, verification, offers, gaps, actions, audit tail, imports, evidence). |
| `GET /api/v1/me/offers` | physician | Only the caller's **sent** offers: hospital names, start/end, hours, status, expiry. No clinical rationale. |
| `GET /api/v1/consults/{id}/reassignment-targets` | coordinator, lead | Eligible free credentialed physicians in routing order. |
| `GET /api/v1/audit.csv` | coordinator, lead | Full audit for the current run. |

Data responses use this envelope:

```json
{ "request_id": "…", "schema_version": 1, "run_id": "RUN-…", "revision": 7,
  "as_of": "2026-03-17T18:20:00-04:00", "release_sha": "…",
  "timing": { "engine_ms": 9.4 }, "data": { … } }
```

`timing.engine_ms` is `null` when the report came from the projection cache (cache hits are not
benchmarks). Every response carries `X-Request-ID` and `Server-Timing`.

## Writes

Every write requires:

| Header | Meaning |
|---|---|
| `X-CSRF-Token` | Must equal the session's CSRF token. |
| `Idempotency-Key` | Unique per user action. A retry with the same key returns the original result (`idempotent_replay: true`) and is applied once. |
| `X-Expected-Run`, `X-Expected-Revision` | The state the user was looking at. Mismatch → `409 stale_revision` with `current_run_id` / `current_revision`; nothing is written. |

In hosted mode the `Origin` header must match `SEVARO_ALLOWED_ORIGINS`.

| Endpoint | Who | Effect |
|---|---|---|
| `POST /api/v1/events/import?filename=&advance_clock=true` (body: CSV text) | coordinator | Validates the whole batch first; any invalid row → `422`, nothing committed. Duplicate rows are skipped (no revision change if all are duplicates). Conflicting IDs are errors. The clock advances to the batch's latest `ingested_at` unless `advance_clock=false`. |
| `POST /api/v1/events/validate` (body: CSV text) | coordinator | Dry run, never writes. |
| `POST /api/v1/clock` `{minutes}` or `{to}` | coordinator, lead | Scenario clock moves forward only; expires sent offers past 10 min. Times after 18 Mar 07:00 ET are rejected (schedule unsupported). |
| `POST /api/v1/runs` `{label}` | coordinator, lead | New run from the original fixture; previous runs and audit are kept. |
| `POST /api/v1/offers/propose` `{physician_ids?}` | coordinator | Revalidates eligibility; creates `proposed` offers + gap record with full candidate audit. |
| `POST /api/v1/offers/{id}/approve` | clinical lead | `proposed → approved` |
| `POST /api/v1/offers/{id}/reject` `{reason}` | clinical lead | `proposed/approved → rejected` |
| `POST /api/v1/offers/{id}/send` | coordinator | `approved → sent` (simulated delivery). Revalidates eligibility, weekly limit and that the gap still exists. Expires after 10 scenario minutes. |
| `POST /api/v1/offers/{id}/cancel` `{reason}` | coordinator, lead | `proposed/approved/sent → cancelled` |
| `POST /api/v1/offers/{id}/accept` | owning physician | `sent → accepted`; claims a unique `(gap, slot)`; when the gap fills, peer offers are cancelled. `online_at = max(now, start) + time to online`. |
| `POST /api/v1/offers/{id}/decline` | owning physician | `sent → declined` |
| `POST /api/v1/actions/escalate` `{risk_id, consult_id?, note}` | coordinator, lead | Internal escalation (no external contact). One open escalation per risk. |
| `POST /api/v1/actions/{id}/acknowledge` `{decision}` | clinical lead | `open → acknowledged` |
| `POST /api/v1/actions/reassign` `{consult_id, physician_id, note}` | coordinator | Records a **modeled** reassignment. Only for waiting consults (Received/Triaged/Assigned) and only to a target the routing model says is free and credentialed right now. |

Write responses: `{request_id, schema_version, timing, result, run_id, revision, as_of}`.

## Errors

```json
{ "error": { "code": "stale_revision", "message": "…", "current_revision": 9 }, "request_id": "…" }
```

| Status | Codes |
|---|---|
| 400 | `idempotency_key_required`, `invalid_revision` |
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `forbidden` (role), `csrf`, `bad_origin` |
| 404 | `offer_not_found` (also for another physician's offer), `consult_not_found`, `not_found` |
| 409 | `stale_revision`, `invalid_transition`, `offer_not_open`, `gap_filled`, `gap_resolved`, `candidate_ineligible`, `no_gap`, `no_eligible_candidate`, `already_escalated`, `consult_not_waiting`, `target_ineligible` |
| 413 | `too_large` (CSV > 5 MB) |
| 422 | `invalid_csv`, `invalid_batch` (with `summary.errors[]`), `empty_batch`, `clock_backwards`, `unsupported_time`, `idempotency_key_reused` |
| 503 | `not_ready` |
