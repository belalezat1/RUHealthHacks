# Relay

An integrated Challenge 2 operations desk on `belal`: replay organizer CSVs, detect consult and hospital coverage risks, review hard-gated staffing recommendations, obtain clinical-lead approval, and run a simulated offer workflow. React uses one FastAPI API; PostgreSQL owns events, decisions, sessions, offers, reservations and audit history.

The runtime reads only supplied organizer records and explicitly imported CSVs. It generates no patients, financial rates, physician responses, online activations or clinical completions. The organizers describe their supplied dataset as synthetic; we use those files unchanged and add no synthetic operational data. Fault fixtures belong only to isolated tests. Profitability routing is disabled because verified financial inputs were not supplied.

## Local startup

Prerequisites: Python 3.12, Node 22, and PostgreSQL 18 server/client tools on PATH. Run from this repository root:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
bash scripts/dev_db.sh
.venv/bin/python -m backend.api.admin migrate
```

The database helper starts a separate development cluster at `127.0.0.1:55433`, database `sevaro`, using your OS username. Its trust authentication is for local development only. Alternatively, set `SEVARO_DATABASE_URL` to a password-protected PostgreSQL URL in the ignored root `.env`.

Your Jev key stays in the **root `.env`** as `TYPESAFE_API_KEY=...`. The backend loads it automatically; never use a `VITE_` variable for the key. Existing `.env` contents are preserved. See [.env.example](.env.example) for optional settings. Missing or disabled Jev uses a disclosed deterministic fallback.

Provision your own accounts; each command prompts for a unique password of at least 12 characters. There are no default runtime passwords:

```sh
.venv/bin/python -m backend.api.admin create-user --username coordinator --name Coordinator --role coordinator
.venv/bin/python -m backend.api.admin create-user --username lead --name 'Clinical lead' --role clinical_lead
.venv/bin/python -m backend.api.admin create-user --username grace --name 'Grace Okafor' --role physician --physician-id PHY-009
```

Start the backend in one terminal:

```sh
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in another:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Local API documentation is at **http://127.0.0.1:8000/api/docs**. For the built frontend served by FastAPI on port 8000, run `npm run build` in `frontend` before starting the backend.

## Verified workflow

1. Coordinator: view the **208/208** initial reference match, ranked risks, 90-minute hospital forecast and all six off-shift candidate explanations.
2. Review a staffing recommendation. Its actual Jev/fallback source, latency and revision are shown. Propose the selected eligible offer.
3. Clinical lead: approve or reject it under **Offers**. Coordinators can request a lead escalation; leads acknowledge it there.
4. Coordinator: send the approved **simulated** offer. Physician account `PHY-009`: accept or decline only that physician's offer.
5. Acceptance adds a planned reservation. Confirmation requires imported participation evidence and current availability; an ETA or reload never establishes that the physician is online. Leads can cancel accepted commitments; the gap claim is released and work-history reservations remain conservative.
6. **Scenario lab**: validate/import the supplied eight-column event CSV without a restart. New rows can advance the clock to their latest ingestion time. Duplicate-only uploads do not advance it.
7. **Coverage desk → Play imported data**: choose a routing hospital and press **Play**. The latest CSV plays from just before its first unique arrival, with **Pause**, **Next**, **Restart**, and **Return to current state**. Next-consult routing and Jev/fallback backup staffing are displayed separately. Frames reconstruct recorded data; they never assign physicians or create offers. Manual offer commitments are excluded from this preview. The current run, clock and audit remain unchanged.

For `c2_new_events.csv`, choose **Oak Valley Medical** to see the next-consult pick become **Dr. Noah Williams** at 18:26:01 ET, then unavailable when his recorded call starts at 18:26:57. The backup recommendation can remain **Dr. Grace Okafor**. Playback follows ingestion timestamps: the late camera record affects state at 18:25:40, not its earlier event time. Selections are allowed to remain unchanged. Older imports with truncated membership must be reimported before playback; duplicates still add no events.

Recorded replay sessions expire after 30 minutes or a server restart. A new import or operational revision stops playback. Jev calls are server-side, using the existing configured deadline and deterministic fallback; provider source and fallback reason remain visible. Forecasts and staffing selections are modeled recommendations, not observed clinical improvements.

Replay deduplicates event IDs, orders visible records by event time, preserves the earliest consult receipt and reconciles concurrent calls/video/ringing. Source schedules and baselines govern forecasts. Challenge credentialing is a documented proxy. `SEVARO_POLICY_MODE=production` blocks automatic eligibility without authoritative license, jurisdiction, privilege and specialty evidence.

## Tests, measurements and recovery

```sh
SEVARO_TEST_DATABASE_URL="postgresql://$(whoami)@127.0.0.1:55433/postgres" .venv/bin/python -m pytest backend/tests -q
cd frontend
npm run build
npm audit
npx playwright install chromium
cd ..
.venv/bin/python scripts/e2e.py
```

The E2E harness creates a disposable PostgreSQL database, unique ephemeral accounts and separate local servers. It disables paid provider calls, exercises three roles and reload persistence, and withholds then imports authentic organizer rows to prove live ingestion. It drops only its own temporary database. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if using an existing compatible Chromium installation.

```sh
.venv/bin/python scripts/bench.py --runs 100 --full-runs 50 --out .local/engine-benchmark.json
.venv/bin/python -m backend.api.admin backup --output .local/backups/pre-change.dump
.venv/bin/python scripts/restore_check.py .local/backups/pre-change.dump --out .local/restore-check.json
```

Use a `pg_dump`/`pg_restore` client at least as new as the database server. Recovery restores into a separate temporary database and compares a quiescent source; it never overwrites the original database. Backups contain sensitive account and operational state: keep them private and out of Git.

Measured on the supplied 1,163 unique events, 14 physicians and 12 hospitals: warm analysis p95 **15.2 ms**, full CSV load/replay/analysis p95 **25.0 ms**, cached HTTP report p95 **16.8 ms**. One anonymous live Jev selection took **203.1 ms**, resolving to `jev-1.13.0`; the configured deadline is 900 ms. These local samples do not establish a production SLA or 200-hospital capacity. Full evidence and limitations: [integration report](docs/implementation-report.md).

## Local containers

Set a unique, URL-safe alphanumeric `SEVARO_LOCAL_DB_PASSWORD` in the ignored root `.env`, then:

```sh
docker compose up --build -d
docker compose exec app python -m backend.api.admin create-user --username coordinator --name Coordinator --role coordinator
docker compose exec app python -m backend.api.admin create-user --username lead --name 'Clinical lead' --role clinical_lead
docker compose exec app python -m backend.api.admin create-user --username grace --name 'Grace Okafor' --role physician --physician-id PHY-009
```

Open **http://127.0.0.1:8080**. PostgreSQL is internal to the Compose network and uses a persistent volume. Use `docker compose stop` to stop services while preserving data. Do not remove the volume to restart the application. Perform container backups with the database container's matching `pg_dump` client. This Compose configuration is local development, not a hosted deployment.

## Scope and handoff

[Yassin](docs/integration-sources.json) contributed official domain/API foundations; Ray informed PostgreSQL/concurrency and native Jev patterns; the latest `frontend` commit contributed visual assets and styles. Its mock operational provider and invented financial values are excluded from the active application. All teammate source refs and the starting `belal` backup are preserved; no remote push or AWS action was performed.

Read [the API contract](docs/api-contract.md), [Jev contract](docs/jev-contract.md), [production gaps and judging evidence](docs/implementation-report.md). Institutional identity, authoritative licensing, real Sevaro/EHR interfaces, clinical validation, production security/load testing and AWS operations remain work before clinical deployment. Passing challenge tests does not establish production readiness or HIPAA compliance.
