# AWS setup

AWS foundation created on October 10, 2026 in workshop account `033301207528`, region **us-west-2**. Setup used the existing workshop session and direct AWS commands. There is no infrastructure framework.

## Resources

| Service | Resource | Status / configuration |
| --- | --- | --- |
| S3 frontend | `sevaro-frontend-033301207528-us-west-2` | Private, public access blocked, owner-enforced, AES256 encryption |
| S3 datasets | `sevaro-datasets-033301207528-us-west-2` | Same controls; versioning enabled |
| ECR | `sevaro-backend` | Immutable tags, scan on push, AES256 encryption; no image pushed |
| ECS | `sevaro` | Cluster active; backend service not deployed |
| ECS roles | `sevaro-ecs-execution`, `sevaro-ecs-infrastructure` | Created with service trust; execution permissions limited to image pulls and application logs |
| RDS | `sevaro-db` | Available: PostgreSQL 16.15, db.t4g.micro, encrypted 20 GiB gp3, Single-AZ, one-day backups |
| Secrets Manager | RDS-managed master secret | Active; password generated and retained by AWS, never copied locally |
| Cognito | `us-west-2_MWarCqgCU` | Lite pool, public client `5977dpqjhbn6o29kqjlsg8rq43`, login domain active; no users or self-registration |
| CloudFront | `E2PR7SZRAS3XQY` | Deployed: HTTPS endpoint and signed origin access for only the frontend bucket |
| CloudWatch | `/sevaro/backend`, `/aws/rds/instance/sevaro-db/postgresql` | 14-day retention |

Final readiness verified at 19:47 UTC on October 10: RDS **Available**, CloudFront **Deployed**, Cognito domain **ACTIVE**. The RDS-managed secret is active; enhanced monitoring and Performance Insights are disabled. No application schema or data has been installed in RDS.

Exact IDs and configuration are in [aws-resources.json](aws-resources.json). With AWS CLI and the workshop session, `make aws-preflight` checks this inventory without modifying resources or reading secret values. It stops if the active account differs.

The CloudFront address is `https://d3n5vdu0x0beh3.cloudfront.net`. **It is not the deployed app:** the frontend bucket is intentionally empty. An access-denied response is expected until the authenticated frontend is published. The working local app remains at http://localhost:5173.

## Network and access checks

- Reused workshop VPC `vpc-0c932c4cf3cbba883`.
- Created private subnets `subnet-07b686bb6c24e4da3` (`172.31.64.0/24`, us-west-2a) and `subnet-0df3a58595bf75172` (`172.31.65.0/24`, us-west-2b).
- Both use `rtb-0325e5280260e7395`, which has only the local VPC route. No NAT or internet route was added.
- RDS is not publicly accessible. `sg-0c22387dbc2ae9f11` allows TCP 5432 only from backend group `sg-08e9e186739cef485`.
- Both S3 public-access blocks and encryption were checked. The frontend bucket grants only this CloudFront distribution `s3:GetObject`; the dataset bucket has no public reader.
- The execution role can pull only `sevaro-backend` images and write `/sevaro/backend` streams. It has no database master-secret access. The infrastructure role uses AWS's [ECS Express infrastructure policy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonECSInfrastructureRoleforExpressGatewayServices.html).
- Cognito uses authorization-code flow with no client secret and exact callback `https://d3n5vdu0x0beh3.cloudfront.net/auth/callback`. Admin, dispatcher, physician and evaluator groups exist but have no users. No passwords were changed or user invitations sent.

The scoped IAM, database, identity and CloudFront access changes were explicitly approved in this session. No existing workshop infrastructure was deleted or repurposed.

## Remaining application deployment

App Runner is [closed to new customers](https://aws.amazon.com/apprunner/), so the foundation uses ECS. Before starting the API and publishing the frontend:

1. Implement the frontend Cognito login and trusted hospital/physician authorization mapping. The current frontend sends local demo headers; pool creation alone does not make it work with hosted authentication.
2. Supply the AWS RDS certificate bundle, create a restricted application database account, and securely inject its connection settings. The managed master secret is JSON and cannot be passed directly as `DATABASE_URL`.
3. Push the backend image to ECR, run the Alembic migration once through private database access, and start the backend service. Begin with one small task, port 8000 and `/ready`.
4. Build with the real API URL, upload the authenticated frontend, then test the complete workflow over HTTPS.

The backend's known public settings are:

```dotenv
APP_ENV=production
AUTH_MODE=cognito
AWS_REGION=us-west-2
COGNITO_USER_POOL_ID=us-west-2_MWarCqgCU
COGNITO_APP_CLIENT_ID=5977dpqjhbn6o29kqjlsg8rq43
CORS_ORIGINS=["https://d3n5vdu0x0beh3.cloudfront.net"]
DEMO_POLICY_PATH=/app/config/demo_policies.json
JEV_MODE=mock
```

`DATABASE_URL` remains a required server-side secret for the eventual app deployment. No application data or live Jev credentials have been uploaded. Private database and storage readiness do not establish a completed hosted application.

## Workshop lifetime

RDS incurs AWS usage charges while retained. The workshop lists a 72-hour event beginning October 9, 2026 at 6:43 PM without a displayed timezone. Preserve required source and exports before it ends. `make export` backs up local data under ignored `exports/`; it does not back up the new RDS database. Resource deletion was not part of this setup.
