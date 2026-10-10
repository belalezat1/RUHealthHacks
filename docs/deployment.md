# Running locally and AWS status

The app currently runs locally with Docker Compose. **No AWS resources have been created for Sevaro, and there is no hosted application URL.**

## What is ready

- PostgreSQL, FastAPI and React run with `make dev`; `make seed` loads synthetic data.
- The backend image, frontend production build, database migrations and health checks work.
- Local URLs: http://localhost:5173 and http://localhost:8000/docs.
- Database data persists across `make down` and restarts. Run `make dev` again after backend changes.

## Workshop access

The [Rutgers HealthHack workshop dashboard](https://catalog.us-east-1.prod.workshops.aws/event/dashboard/en-US) was checked on October 10, 2026. It provides AWS console access and an existing code-editor environment. Its listed regions are `us-west-2` and `us-east-1`; the console link opens `us-west-2`.

The previous CloudShell identity check confirmed account `033301207528` and role `WSParticipantRole/Participant`. That confirms access, not an application deployment. The dashboard lists a 72-hour event starting October 9 at 6:43 PM; it does not label that display's timezone.

| Item | Status |
| --- | --- |
| Workshop account and console | Available |
| Workshop code editor | Provided by the workshop |
| Local app, database and builds | Working |
| Sevaro AWS compute, database and hosting | Not created |
| Hosted login and HTTPS app URL | Not configured |

## Keep deployment simple

Use the workshop's AWS console or CLI directly. Reuse its existing environment where practical; choose one place to run the app before adding separate services. There is no infrastructure provisioning framework or multi-service deployment pipeline in this repository.

`AWS_REGION=us-west-2 make aws-preflight` is a read-only account check when AWS CLI and the workshop session are available. It does not create services or install credentials. Local AWS CLI is not currently installed.

The backend can validate Cognito access tokens, but the frontend still uses explicit local demo actors. Hosted login must be wired before public deployment. Keep keys and database credentials on the server.

## Preserve the demo

`make export` saves a PostgreSQL dump under ignored `exports/`. `scripts/restore-local.sh exports/<file>.dump sevaro_restore_review` restores into a separate database. Keep needed source and exports outside the temporary workshop account before it expires. `make down` preserves local volumes.
