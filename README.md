# Sevaro Command Center

**Detect coverage risk, decide on an intervention, and act on it, before a stroke consult waits.**

Built for Sevaro's Challenge 2 (Tele-Neurology Operations Command Center) at Rutgers Health Hack 2026.

## The problem

Sevaro's tele-neurologists cover consults for many hospitals at once. Demand is uneven: one hospital can send several stroke consults in half an hour, sometimes right as physicians reach the end of their shift. Sevaro already has a live view of physician workload. What's missing is what happens next: noticing the risk early, working out who is credentialed and eligible to help, and getting that person online with approval.

## What it does

Three connected layers:

1. **Detect.** Rebuilds live state from the event stream and flags what needs attention now and in the next 90 minutes: consults breaching stage time standards, hospitals above their demand baseline, credentialed capacity dropping below the minimum when shifts end, and physician signals that contradict each other.
2. **Decide.** Recommends an intervention for the top issue. For a split shift, it checks every off-shift physician against each eligibility rule and shows which rules each one passed or failed.
3. **Act.** Runs the offer loop: propose, clinical lead approves, offer sent (simulated), physician accepts, declines or times out, projected coverage updates. Offers stop once the gap is filled.

**Design principle:** eligibility first, ranking second, explanation third, human approval before any action.

## How the backend works

```
event_stream.csv + reference CSVs
        │
        ▼
1. Load        parse CSVs, normalize timestamps
        │
        ▼
2. Replay      dedupe by event_id, order by event_time (not arrival),
        │      build physician state and consult state separately
        ▼
3. Eligibility credentialing + real availability (reconciled signals)
        │
        ▼
4. Gaps        15-minute slots over 90 minutes: required vs available,
        │      shift ends, demand-spike adjustment
        ▼
5. Rank        split-shift candidates with pass/fail per rule,
        │      plus a guard against the split-shift trap
        ▼
6. API         FastAPI endpoints for the dashboard + live event injection
```

### Availability reconciliation

Physicians don't report being on a call. Activity is derived from signals that can disagree:

| Signal combination | Interpretation |
|---|---|
| On a Synapse call or video session | Busy |
| Camera active, no Synapse session, status not In Meeting | Busy (likely external video). Flagged. |
| Camera active, status In Meeting | Available (interruptible) |
| Desktop agent offline | Assumed available but **unverified**. Risk surfaced. |

Events can arrive late, and at least one appears twice. State is built from `event_time`, never from arrival order.

### Split-shift eligibility

An off-shift physician can receive an offer only if all of these hold:

- Opted in to split-shift offers
- Credentialed at one or more of the hospitals with the gap
- At least 10 hours since their last shift ended, measured at the offered start time
- Hours worked in the trailing 7 days plus offered hours ≤ 60
- No overlap with a shift they're already scheduled for
- Offer is at least 2 hours long (time to come online counts against it)

Safety constraints: no patient information in notifications, clinical lead approval before every offer, one open offer per physician, at most 3 offers per physician per week, offers expire after 10 minutes, and a full log of who was considered, excluded, approved, and the outcome.

### The split-shift trap

Routing sends calls to the eligible physician with the fewest consults this shift. A physician joining mid-shift starts at zero, so they would receive nearly every call at every hospital they're credentialed for. That just moves the imbalance instead of fixing it. The command center accounts for this, for example by seeding a starting consult count or limiting the new physician to the gap hospitals.

## Demo checklist (from the challenge brief)

- [ ] Rebuild state from the event stream, handling late and duplicate events, and match the 18:20 reference snapshot
- [ ] Show physician activity and consult lifecycle independently, with time in stage vs. standards
- [ ] Detect and rank what needs attention, with a reason for each flag
- [ ] Project coverage at least 90 minutes ahead, accounting for shift ends and demand baseline
- [ ] Recommend an intervention; for a split shift, show every off-shift physician and each rule's pass/fail
- [ ] Run the full loop: propose, approve, send (simulated), accept/decline, update projected coverage
- [ ] Show how we handle the split-shift trap
- [ ] Live test: accept judge-injected events in the same format without a restart

## Data

Synthetic dataset covering Tuesday 17 March 2026, 07:00–18:20 ET. "Now" is 18:20:00 ET.

| File | Contents |
|---|---|
| `event_stream.csv` | ~1,160 events, the source of truth (sorted by `ingested_at`) |
| `hospitals.csv` | 12 hospitals, time zone, coverage tier |
| `physicians_on_shift.csv` | 8 on-shift physicians with shift times |
| `physicians_off_shift_roster.csv` | 6 off-shift physicians: opt-in, last/next shift, hours worked, time to come online |
| `credentialing_matrix.csv` | Which physicians may take consults from which hospitals |
| `baseline_hourly_volume.csv` | 12-week weekday mean and p90 consults per hospital per hour |
| `coverage_requirements.csv` | Minimum available credentialed physicians per hospital per time block |
| `snapshot_*_1820.csv` | Reference state at 18:20; our replay must reproduce it |

All data is synthetic. No patient information is used or required.

## Tech stack

- **Engine:** Python 3.12, deterministic, no network calls on the decision path (`backend/core/`)
- **API:** FastAPI + Uvicorn, one worker (`backend/api/`); contract in [contracts/API_CONTRACT.md](contracts/API_CONTRACT.md)
- **State:** events, offers, audit and sessions in SQLite (transactional, survives restarts); the report is a projection rebuilt from the stored events and cached per revision
- **Frontend:** React + TypeScript + Vite (`frontend/`), polls every 2 s and refetches on revision change
- **Cloud:** Docker Compose on one EC2 host in a private subnet, CloudFront HTTPS via a VPC origin, EBS for state, versioned S3 backups (`infra/`); see [docs/RUNBOOK.md](docs/RUNBOOK.md)

## Getting started

**Run locally (no Docker):**

```bash
python -m venv .venv
.venv/Scripts/activate            # macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements-dev.txt
cd frontend && npm ci && npm run build && cd ..
uvicorn backend.api.main:app --port 8000
```

Open http://127.0.0.1:8000 and click a demo account (local password `sevaro-demo`).
For frontend hot reload, run `npm run dev` in `frontend/` and open http://localhost:5173.

**Run with Docker:** `docker compose up --build` then open http://localhost:8080.

**Test:**

```bash
python -m pytest backend/tests -q                         # engine + API (snapshot, races, persistence)
python scripts/smoke_live.py --base http://127.0.0.1:8000 --reset   # live end-to-end check
python scripts/bench.py                                    # engine latency distribution
python scripts/loadtest.py --base http://127.0.0.1:8000 --users 20 --seconds 60
```

**Demo accounts:** `coordinator`, `lead`, and one per off-shift physician (`phy-009` = Dr. Grace Okafor, ... `phy-014`).

## Measured results (local, Windows 11, Python 3.14, final numbers to be re-run on the release build)

| Measurement | Result | Target |
|---|---|---|
| Reference snapshot | 208/208 fields | 208/208 |
| Warm analysis + JSON (300 runs) | p50 9.3 ms, p95 10.1 ms | p95 ≤ 50 ms |
| Load CSVs + replay + analysis + JSON (100 runs) | p50 17.4 ms, p95 19.1 ms | p95 ≤ 150 ms |
| Report over HTTP, 20 users polling every 2 s (local) | p95 34.5 ms, 0 errors | p95 ≤ 500 ms |
| Write → visible to polling users | ~0.1 s median | ≤ 3 s |

Evidence files: `output/evidence/`. Hosted numbers are measured separately and are not implied by these.

## What is modeled vs. measured

- **Measured:** replay correctness against the reference snapshot, engine and HTTP latency, idempotency, restart persistence.
- **Modeled:** coverage deficits (physician-minutes, a hospital-access measure, *not* patient wait time), routing effects, the split-shift trap.
- **Assumptions:** listed in the app's Evidence tab and in `backend/core/report.py`. No profit, wait-time reduction or clinical outcome is claimed.

## Team

| Name | Role |
|---|---|
| Ibrahim | Backend |
| | |
| | |
