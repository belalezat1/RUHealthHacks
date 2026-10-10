# Runbook: deploy, operate, recover

For the Cloud team. Commands assume Windows PowerShell from the repo root with the AWS CLI
configured (`aws sts get-caller-identity` works). Region: `us-east-1` (event accounts allow only
us-east-1 and us-west-2).

## Architecture

```
Browser ──HTTPS──> CloudFront (default *.cloudfront.net domain)
                     │  /assets/*  cached (content-hashed)
                     │  everything else: CachingDisabled, all cookies/headers/query forwarded
                     ▼  private VPC origin (no public IP on the host)
              EC2 t3.small, private subnet ── NAT gateway ──> internet (git, images, SSM, S3, logs)
                ├─ web  (nginx :8080)  static UI + /api proxy
                └─ api  (uvicorn, 1 worker :8000)
                     └─ /state ── EBS gp3 (encrypted, /srv/sevaro/state) ── backups ──> S3 (versioned)
Admin: Session Manager only (no SSH, no inbound internet). Logs: CloudWatch /sevaro/app.
```

Single host, single writer: **not highly available**. If the host dies, state is on the separate
EBS volume (snapshotted on stack delete) and in S3 backups.

## First deployment

| Step | Command | Who |
|---|---|---|
| 1. Check access, list AZs | `.\infra\aws\sevaro.ps1 check` | anyone with credentials |
| 2. Create the stack (10–15 min) | `.\infra\aws\sevaro.ps1 create -AvailabilityZone us-east-1a` | CL-A |
| 3. Store the demo password + allowed origin in SSM | `.\infra\aws\sevaro.ps1 params` (prompts; password never in git) | CL-A |
| 4. Deploy a pushed branch or SHA | `.\infra\aws\sevaro.ps1 deploy -Ref origin/yassin` | CL-B |
| 5. Check health | `.\infra\aws\sevaro.ps1 status` | anyone |
| 6. Live end-to-end check | `python scripts/smoke_live.py --base <AppUrl> --password <pw> --reset` | CL-C |

The host bootstraps itself (Docker, Compose, mounts EBS, clones the repo). If `deploy` says
"bootstrap not finished", wait 2–3 minutes and retry.

## Releases

`deploy` runs [`infra/scripts/deploy.sh`](../infra/scripts/deploy.sh) on the host:

1. checks out the exact ref, records its SHA
2. **consistent SQLite backup** (backup API) → `/srv/sevaro/backups` and S3
3. writes `.env` from SSM (secrets never in images or git)
4. builds `sevaro-api:<sha>` / `sevaro-web:<sha>` (previous images kept)
5. `docker compose up --wait`, then verifies `/health/ready` reports the new SHA
6. records the release in `/srv/sevaro/releases.log`; on any failure it rolls back automatically

Containers never initialise over existing data: migrations are additive and run inside the API
on startup; a fresh run is only created when the database has none.

## Rollback

```
.\infra\aws\sevaro.ps1 rollback -Ref <previous sha>
```

Reuses the old images. If the old release cannot open a database already migrated by the new
one (schema newer than it supports), the script restores the pre-release backup and keeps the
newer database file alongside as `sevaro.sqlite3.rolled-back.<ts>`. Schema version today: 1.

## Backup and restore

- On demand: `.\infra\aws\sevaro.ps1 backup` → local + S3, then a **restore drill** that rebuilds
  the projection from the backup in a temporary path (never over live state).
- Before every release: automatic (see above).
- Real restore (only if the live DB is lost/corrupt): `.\infra\aws\sevaro.ps1 shell`, then
  ```
  cd /opt/sevaro/repo && docker compose -f compose.yaml -f infra/aws/compose.aws.yaml stop api
  cp /srv/sevaro/backups/<file>.sqlite3 /srv/sevaro/state/sevaro.sqlite3 && rm -f /srv/sevaro/state/sevaro.sqlite3-{wal,shm}
  chown 10001:10001 /srv/sevaro/state/sevaro.sqlite3
  docker compose -f compose.yaml -f infra/aws/compose.aws.yaml up -d --wait
  ```

## Demo reset

Use the app's **Data & clock → Start new run** (or `POST /api/v1/runs`). It creates a fresh run
from the original fixture; previous runs and their audit stay in the database. Never delete the
database to reset.

## Hosted verification (release ebd27cd, 10 Oct 2026)

| Check | Result |
|---|---|
| Public URL | https://d36g8wfpwrhreb.cloudfront.net (CloudFront default domain, private VPC origin) |
| `smoke_live.py` through CloudFront, hosted-mode auth/CSRF/origin | 16/16 passed, incl. 208/208 snapshot and live import visible without restart |
| 20 users polling the full report every 2 s for 60 s, 6 writes | 586 requests, 0 errors, p50 44.9 ms, p95 83.8 ms, p99 113.1 ms |
| API restart → identical run, revision, offers, audit | ready in 12 s, state identical |
| Backup to S3 + restore drill in a separate path | integrity ok, report rebuilt |

Load generator ran on the EC2 host itself (us-east-1) through the public CloudFront URL, so the
numbers include CloudFront but little internet distance; judges' browsers add their own network time.

## Monitoring

- `.\infra\aws\sevaro.ps1 logs` tails structured request logs (`rid`, path, status, ms).
- `/health/ready` returns release SHA, schema version and revision.
- GitHub Actions → **Hosted live check** (manual): set repo secrets `SEVARO_URL` and
  `SEVARO_DEMO_PASSWORD`, then run it to execute the smoke test and the 1-user / 20-user latency
  tests against the hosted URL.

## Local fallback (same release, no internet needed)

```
git checkout <release sha>
docker compose up --build            # http://localhost:8080, password sevaro-demo
# or without Docker:
pip install -r backend/requirements.txt; cd frontend; npm ci; npm run build; cd ..
uvicorn backend.api.main:app --port 8000     # http://127.0.0.1:8000
```

Identify it accurately during the demo: "local fallback of release <sha>".

## Security notes

- Host has no public IP; its security group allows :8080 only from inside the VPC and from the
  service-managed `CloudFront-VPCOrigins-Service-SG`. **That second rule is required**: without
  it CloudFront returns 504. `sevaro.ps1 create` adds it automatically after the stack is created.
- Demo auth: hashed passwords, HTTP-only Secure SameSite=Strict session cookie, CSRF token on
  every write, exact origin check in hosted mode. Not enterprise SSO.
- No real physician is ever contacted; "send" is simulated and recorded in the audit.

## Cost and cleanup

Approximate on-demand rates in us-east-1 (estimate; check the AWS pricing pages before relying
on it): t3.small ~$0.021/h, NAT gateway ~$0.045/h + data, public IPv4 ~$0.005/h, EBS 30 GB gp3
~$0.10/day, CloudFront/S3/CloudWatch at demo volume ~pennies. **≈ $0.08/hour, ≈ $2/day.**

Cleanup after the event (owner: CL-A):

```
.\infra\aws\sevaro.ps1 teardown
```

Then, if nothing needs to be kept: empty and delete the retained S3 backup bucket, delete the
EBS snapshot created on stack deletion, and delete SSM parameters `/sevaro/demo-password` and
`/sevaro/allowed-origin`. The script prints the exact commands.
