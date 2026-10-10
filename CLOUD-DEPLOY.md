# Sevaro Command Center: Cloud

How the Command Center runs on AWS for the Rutgers Health Hack 2026 demo. For what the app does and how the backend works, see the [main README](README.md).

**Goal:** a public URL that judges can open and send live events to without restarting anything. Keep it small and reliable. Add nothing that the core demo doesn't need.

## Architecture

```
Judges / team browser
        │  HTTPS
        ▼
CloudFront ──────────── serves the static frontend from a private S3 bucket
        │
        │  HTTPS (API calls, live event injection)
        ▼
App Runner ──────────── FastAPI backend container (image pulled from ECR)
        │                in-memory state, rebuilt by replaying the event stream
        ▼
S3 (datasets) ───────── event_stream.csv + reference CSVs, loaded at startup

CloudWatch ──────────── App Runner logs and metrics
Secrets Manager ─────── API keys (e.g. Jev), if needed
```

## Services

| Component | AWS service | Why |
|---|---|---|
| Frontend | S3 + CloudFront | Static hosting with HTTPS and no servers to manage |
| Backend | App Runner | Runs our Docker image with HTTPS, health checks and logs built in |
| Container registry | ECR | Stores the backend image App Runner deploys |
| Datasets | S3 | Lets us swap in a same-format dataset without redeploying |
| Logs and metrics | CloudWatch | App Runner sends logs here automatically |
| Secrets | Secrets Manager | Keeps keys out of the repo and out of the image |

Out of scope for the MVP: RDS, Cognito, SQS, EventBridge, ECS workers. The build plan lists these for later. The current backend keeps state in memory, so it doesn't need a database.

## Constraints you need to know

**Run exactly one backend instance.** State lives in memory. With two instances, each would hold a different state and the dashboard would flicker between them. Set App Runner auto scaling to min 1, max 1.

**A restart resets the state to the dataset.** On startup the backend replays the dataset from S3. Events injected during the demo are lost if the container restarts. Don't redeploy during the demo.

**No WebSockets on App Runner.** App Runner doesn't support WebSocket connections. The frontend should poll the API every 2–5 seconds. If we really need push updates, use Server-Sent Events or move the backend to ECS behind an ALB. Polling is the safe choice.

**CORS.** The frontend (CloudFront domain) and the API (App Runner domain) are on different origins. FastAPI must allow the CloudFront origin through `CORSMiddleware`.

## Prerequisites

- AWS account with permissions for S3, CloudFront, ECR, App Runner, IAM and CloudWatch
- AWS CLI v2, configured (`aws configure`)
- Docker
- Region: `us-east-1` (change it in the commands below if we pick another)

Set these once per shell:

```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REPO=sevaro-backend
export DATA_BUCKET=sevaro-datasets-$ACCOUNT_ID
export WEB_BUCKET=sevaro-frontend-$ACCOUNT_ID
```

## Deploy

### 1. Upload the dataset

```bash
aws s3 mb s3://$DATA_BUCKET --region $AWS_REGION
aws s3 sync ./data s3://$DATA_BUCKET/default/
```

Leave the bucket private. App Runner reads it through its instance role (step 4).

### 2. Containerize the backend

Reference `Dockerfile` (adjust once the backend layout is final):

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

The backend needs:

- `GET /health` returning 200, for App Runner health checks
- `DATA_S3_URI` env var (e.g. `s3://<DATA_BUCKET>/default/`) to read the dataset at startup
- `CORS_ORIGINS` env var with the CloudFront URL

Before pushing, test it locally:

```bash
docker build -t $ECR_REPO .
docker run -p 8000:8000 $ECR_REPO
curl localhost:8000/health
```

### 3. Push the image to ECR

```bash
aws ecr create-repository --repository-name $ECR_REPO --region $AWS_REGION

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

docker tag $ECR_REPO:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
```

On Apple Silicon, build with `docker build --platform linux/amd64 ...` because App Runner runs x86.

### 4. Create the App Runner service

The console (App Runner → Create service) is the fastest way:

| Setting | Value |
|---|---|
| Source | Container registry → Amazon ECR → `sevaro-backend:latest` |
| Deployment trigger | Manual (we don't want a surprise restart mid-demo) |
| ECR access role | Create new service role |
| Port | `8000` |
| CPU / memory | 1 vCPU / 2 GB |
| Environment variables | `DATA_S3_URI`, `CORS_ORIGINS` |
| Health check | HTTP, path `/health` |
| Auto scaling | Custom configuration: min 1, max 1 |
| Instance role | IAM role with `s3:GetObject` and `s3:ListBucket` on `$DATA_BUCKET` (add `secretsmanager:GetSecretValue` if using secrets) |

When it's running, copy the default domain (`https://xxxx.us-east-1.awsapprunner.com`) and check it:

```bash
curl https://<app-runner-domain>/health
```

### 5. Deploy the frontend

```bash
aws s3 mb s3://$WEB_BUCKET --region $AWS_REGION
# build with the API URL baked in, e.g. VITE_API_URL / NEXT_PUBLIC_API_URL=https://<app-runner-domain>
npm run build
aws s3 sync ./dist s3://$WEB_BUCKET --delete   # or ./out for a Next.js static export
```

In the console, create a CloudFront distribution:

- Origin: the `$WEB_BUCKET` bucket, with **Origin access control** (keep the bucket private)
- Default root object: `index.html`
- Viewer protocol: redirect HTTP to HTTPS
- For client-side routing: custom error response, 403 and 404 → `/index.html`, status 200

Apply the bucket policy CloudFront offers, then set `CORS_ORIGINS` on App Runner to the `https://dxxxx.cloudfront.net` URL and redeploy the backend.

After every frontend update:

```bash
aws s3 sync ./dist s3://$WEB_BUCKET --delete
aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
```

### 6. Redeploy the backend

```bash
docker build -t $ECR_REPO . && docker tag ... && docker push ...   # as in step 3
aws apprunner start-deployment --service-arn <SERVICE_ARN>
```

## Swapping datasets

Judges may load a second dataset in the same format. Upload it to a new prefix:

```bash
aws s3 sync ./data-2 s3://$DATA_BUCKET/dataset-2/
```

Then either point `DATA_S3_URI` at it and redeploy, or (better, with no restart) call a backend reload endpoint that re-reads from S3 and replays. That endpoint is up to the backend team.

## Security

- Synthetic data only. No patient information anywhere.
- All buckets private. The frontend is served only through CloudFront.
- No secrets in the repo, the image or env vars committed to git. Use Secrets Manager.
- HTTPS everywhere (CloudFront and App Runner provide it by default).
- Don't log event payloads that could contain identifiers.

## Monitoring

- **Logs:** CloudWatch → Log groups → `/aws/apprunner/<service>/.../application`
- **Metrics:** App Runner console → Metrics (requests, latency, 4xx/5xx)
- Before the demo, check the logs for replay errors and confirm `/health` passes.

## Demo-day checklist

- [ ] `/health` returns 200 on the App Runner URL
- [ ] Dashboard loads from the CloudFront URL with no CORS errors in the browser console
- [ ] Replayed state matches the 18:20 reference snapshot
- [ ] Injecting an event through the API updates the dashboard within one poll
- [ ] Auto scaling is set to min 1 / max 1
- [ ] Deployment trigger is manual; no deploys after the final check
- [ ] A local fallback works (`uvicorn` + local frontend) in case AWS has issues

## Cost and teardown

Expect a few dollars for the weekend, mostly App Runner. After judging:

```bash
aws apprunner delete-service --service-arn <SERVICE_ARN>
aws cloudfront delete-distribution ...   # disable it first, then delete
aws s3 rb s3://$WEB_BUCKET --force
aws s3 rb s3://$DATA_BUCKET --force
aws ecr delete-repository --repository-name $ECR_REPO --force
```

## Later (not for the hackathon)

From the build plan, once the core works: RDS PostgreSQL for durable state (also allows more than one instance), Cognito for login, SQS and EventBridge for event processing, ECS Fargate workers for forecasting, and GitHub Actions CI/CD that pushes to ECR and deploys App Runner.
