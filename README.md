# Sevaro Command Center

A working synthetic physician-operations dashboard for the Rutgers HealthHack Sevaro track. It imports operational datasets, reconciles availability, forecasts the next 90 minutes, explains feasible interventions, and records human approval, physician consent, assignment, and activation verification.

The application uses **one FastAPI backend, PostgreSQL, and a React/Vite frontend**. Clinical priority comes from supplied records. Deterministic rules control eligibility and assignment; Jev provides a separately labeled advisory. Verification confirms an assignment's activation evidence and reports any remaining coverage gap—it does not claim a clinical outcome or guarantee all network gaps closed.

## Start the local demo

Prerequisites: Docker Engine/Desktop with Compose v2. The first start downloads the pinned images and dependencies.

```sh
cp .env.example .env
make dev
make seed
```

- Dashboard: **http://localhost:5173**
- API documentation: **http://localhost:8000/docs**
- Liveness: http://localhost:8000/health
- Database readiness: http://localhost:8000/ready

`make dev` runs `docker compose up --build -d`. PostgreSQL becomes healthy, the one-off migration service runs `alembic upgrade head`, and then the backend and frontend start. `make seed` imports the first synthetic fixture idempotently. Alternatively, run `docker compose up --build` in the foreground and execute `make seed` in another terminal, or import a fixture through Simulation Lab.

All published Compose ports bind to localhost. The database uses a persistent named volume. `make down` stops the stack and preserves its volumes. Backend code, policy, and fixture changes require another `make dev`; frontend edits update through Vite.

## What is implemented

| View | Working behavior |
| --- | --- |
| Command Center | Real physician/consultation counts, waiting workload, risks, pending decisions, dataset/version, refresh and connectivity state |
| Coverage Forecast | Six 15-minute bins, hospital filter, demand versus shared qualified capacity, operational risks and explicit assumptions |
| Physician Intelligence | Credentials, schedules, active work, signals and conflicts, contact state, per-consultation eligibility evidence |
| Consultation Queue | Source urgency, waiting time, deadline escalation, assignment and a route to recommendation preview |
| Interventions | Ranked plan, failed/unknown and passing rules, alternatives, downstream effects, Jev status, lifecycle controls, remaining coverage and audit |
| Simulation Lab | JSON validation/import, two same-format fixtures, real event injection, six isolated replay scenarios, raw baseline comparison and JSON export |

The frontend polls every three seconds and refreshes queries after mutations. Filter and selection state persists across polling. Example imports create uniquely named, timestamp-rebased copies; custom uploaded IDs remain unchanged. The persistent **Synthetic demo** label and separate Jev mode make the data and integration status explicit.

The decision sequence is:

```text
Import → event → updated forecast → explained proposal
       → supervisor approval → explicit synthetic physician response
       → revalidated assignment → separate activation event → verification
       → audit → isolated baseline comparison
```

Approval does not imply consent. Consent does not imply activation. Assignment rechecks current evidence within a PostgreSQL transaction. Stale or expired proposals cannot be committed. Event identity, semantic duplicates, late signals, scope checks and assignment constraints are enforced on the backend. Audit records are application append-only; they are not described as cryptographically immutable.

## Commands and checks

Run these from the repository root after `make dev`:

| Command | Effect |
| --- | --- |
| `make migrate` | Wait for PostgreSQL and run the one-off Alembic migration service |
| `make seed` | Import the initial synthetic fixture; an existing seed ID is a no-op |
| `make test` | Backend Ruff checks, domain/integration tests against real PostgreSQL, frontend type check |
| `make smoke` | Exercise the real HTTP import/event/recommendation/consent/activation/audit/simulation workflow |
| `make build` | Build the production backend image and static frontend into `frontend/dist` |
| `make demo-reset DATASET=harbor_demo` | Explicitly reset/rebase that synthetic dataset; preserve audit history and database volumes |
| `make logs` | Recent backend, frontend, and migration logs |
| `make export` | Export a PostgreSQL dump into ignored `exports/` |
| `make down` | Stop containers without deleting volumes |

`make build` additionally requires a local Node.js installation compatible with Vite 7; Compose and CI use Node 22.15.0. Backend dependencies are locked in `backend/uv.lock`; frontend dependencies in `frontend/package-lock.json`.

For host-based development with PostgreSQL already available:

```sh
# Terminal 1, from backend/; Python 3.12 and uv 0.8.22
uv sync --frozen --extra solver
export DATABASE_URL='postgresql+psycopg://sevaro:sevaro-local-only@localhost:5432/sevaro'
uv run alembic upgrade head
uv run python scripts/seed_demo.py
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2, from frontend/
npm ci
npm run dev
```

Host-based settings must be provided to the backend process; the repository-root `.env` is used by Compose, while direct backend commands read their current working directory's environment file. The default policy path resolves from the repository. `VITE_PROXY_TARGET` changes Vite's backend proxy target; `VITE_API_BASE_URL` is the full API prefix, including `/v1`, and defaults to `/v1`.

For direct verification:

```sh
# From backend/; tests create and remove isolated schemas, not the active demo tables
export TEST_DATABASE_URL='postgresql+psycopg://sevaro:sevaro-local-only@localhost:5432/sevaro'
uv run ruff check app tests scripts
uv run pytest -q
uv run python scripts/export_openapi.py

# From frontend/
npm run generate:api
npm run format:check
npm run typecheck
npm run build
```

Without `TEST_DATABASE_URL`, PostgreSQL tests explicitly skip. `make test` and CI provide it. OpenAPI generation writes `docs/openapi.json`, and the frontend generator derives `src/api/generated.ts` from that contract. The typed client narrows the API's flexible domain dictionaries.

The browser acceptance test requires running frontend/backend services and changes the active **synthetic** dataset:

```sh
# From frontend/, with an installed Chrome
E2E_BROWSER_CHANNEL=chrome npm run test:e2e

# Or install the pinned Playwright Chromium browser for CI
npx playwright install --with-deps chromium
npm run test:e2e
```

It covers UI import, a real consultation event, event-to-queue latency, all consent/assignment/activation steps, audit, replay, JSON download and a second dataset. See [verification results](docs/verification.md) for checks actually executed, browser observations and measured latency. The five-second update goal is a target unless backed by a recorded measurement.

[GitHub Actions](.github/workflows/ci.yml) runs lint, domain/Jev tests, explicit real-PostgreSQL integration tests, migrations, generated-type consistency, formatting, type checking, production builds and the browser workflow. It does not deploy AWS resources or contain workshop credentials.

## Data, rules, and Jev

Imports accept the documented `synthetic_v1` schema directly. The official Sevaro developer-kit format was not supplied and is not supported. Source IDs, original payloads, timestamps and import hashes are retained. Imports validate before atomic activation, and switching datasets does not mix records. Requests are limited to 2 MB and datasets to 10,000 rows; event batches are atomic and limited to 100 events.

The two fixtures are in [data/synthetic](data/synthetic), and explicit demo staffing/freshness assumptions are in [config/demo_policies.json](config/demo_policies.json). A physician has one globally shared active work slot. Forecasts use clinician work-minutes and allocated capacity, not learned clinical predictions. The optimizer offers deterministic greedy/baseline modes and a bounded CP-SAT option with fallback and reported solver status.

`JEV_MODE=mock` is the local default, with a configured `JEV_MODEL=jev-latest` alias and visibly synthetic responses. `off` disables advisory evaluation. `live` requires a confirmed TypeSafe sponsor/project key in the **backend** environment as `TYPESAFE_API_KEY`. Live failures remain unavailable or invalid; they never silently become mock successes. Jev evaluates a small already-feasible shortlist at preview time, never on every dashboard poll and never as an authority for clinical priority, credentials or assignment.

A successful live provider call has not been claimed. After credentials are confirmed, run `JEV_MODE=live uv run python scripts/jev_smoke.py` from `backend/` with the key already supplied securely. The command checks available models and validates the actual typed response. See [Jev integration details](docs/jev-integration.md).

## API and source map

| API group | Endpoints |
| --- | --- |
| Health | `GET /health`, `GET /ready` |
| Datasets | `GET /v1/datasets/examples`, `POST /v1/datasets/validate`, `POST /v1/datasets/import` |
| Events | `POST /v1/events`, `POST /v1/events/batch`, `GET /v1/events` |
| Operations | `GET /v1/dashboard`, `/v1/physicians`, `/v1/consultations`, `/v1/coverage/forecast`, `/v1/risks`, `/v1/physicians/{id}/eligibility` |
| Decisions | `POST /v1/optimizations/preview`, `GET /v1/recommendations/{id}`, `POST /v1/recommendations/{id}/{approve,reject,physician-response,commit,verify}` |
| Audit | `GET /v1/audit` |
| Simulations | `GET /v1/simulations/scenarios`, `POST /v1/simulations`, `GET /v1/simulations/{id}`, `GET /v1/simulations/{id}/export` |

Local requests require explicit `X-Demo-Role` and `X-Demo-Actor` headers; optional `X-Demo-Hospitals` restricts scope. Imports and decision mutations use `Idempotency-Key`. The frontend supplies these local actors and keys. Production configuration refuses demo authentication.

- `backend/app/`: API, PostgreSQL persistence, domain rules, workflow, Jev and replay modules.
- `backend/alembic/`: versioned migrations; `backend/tests/`: domain and real-database regressions.
- `frontend/src/`: six React views, reusable components and generated API types.
- [Architecture](docs/architecture.md), [assumptions](docs/assumptions.md), [API implementation contract](docs/implementation-contract.md), [frontend notes](frontend/README.md), [five-minute demo](docs/demo-script.md).

## AWS status

The AWS foundation has been created in workshop account `033301207528`, region `us-west-2`: private S3 buckets, ECR, an ECS cluster and service roles, private RDS PostgreSQL with a managed secret, Cognito, CloudFront, and CloudWatch logs. See [resource identifiers and current provisioning status](docs/deployment.md).

The application still runs locally. No backend image or frontend bundle has been published. Hosted login, application database credentials, migrations, and the backend service are the next deployment steps. The official Sevaro format and live Jev credentials have not been supplied.

Run `make aws-preflight` with AWS CLI and the workshop session to check only the resources recorded in [the inventory](docs/aws-resources.json). It verifies the account and does not modify resources or retrieve secret values. Setup uses ordinary AWS console/CLI actions, with no infrastructure framework.
