#!/usr/bin/env bash
# Read-only status for the Sevaro resources recorded in docs/aws-resources.json.
set -euo pipefail
command -v aws >/dev/null || { echo 'Install AWS CLI or run these checks in the existing AWS CloudShell session.' >&2; exit 2; }
command -v python3 >/dev/null || { echo 'Python 3 is required to read the resource inventory.' >&2; exit 2; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AWS_PAGER=''
python3 - "$repo_root/docs/aws-resources.json" <<'PY'
import json
import subprocess
import sys

try:
    with open(sys.argv[1]) as inventory:
        resources = json.load(inventory)
    region = resources["region"]
except (OSError, ValueError, KeyError) as error:
    sys.exit(f"Cannot read the Sevaro resource inventory: {error}")


def status(label, arguments):
    result = subprocess.run(
        ["aws", *arguments, "--region", region, "--output", "json"],
        capture_output=True, text=True,
    )
    if result.returncode:
        detail = result.stderr.strip().splitlines()
        print(f"{label}: unavailable ({detail[-1] if detail else 'AWS CLI request failed'})")
        return None
    value = json.loads(result.stdout or "null")
    print(f"{label}: {json.dumps(value, separators=(',', ':')) if value is not None else 'available'}")
    return value


print(f"Region: {region}")
identity = status("Account", ["sts", "get-caller-identity", "--query", "{Account:Account,Arn:Arn}"])
if identity is None:
    sys.exit(1)
if resources.get("account_id") and identity["Account"] != resources["account_id"]:
    sys.exit("The active AWS account does not match the Sevaro resource inventory.")

checks = [
    ("Frontend bucket", "frontend_bucket", lambda value: ["s3api", "head-bucket", "--bucket", value]),
    ("Datasets bucket", "datasets_bucket", lambda value: ["s3api", "head-bucket", "--bucket", value]),
    ("ECR", "ecr_repository", lambda value: ["ecr", "describe-repositories", "--repository-names", value.split(".amazonaws.com/", 1)[-1], "--query", "repositories[].{Name:repositoryName,Tags:imageTagMutability}"]),
    ("ECS", "ecs_cluster", lambda value: ["ecs", "describe-clusters", "--clusters", value, "--query", "{Clusters:clusters[].{Name:clusterName,Status:status,Services:activeServicesCount,Tasks:runningTasksCount},Failures:failures}"]),
    ("RDS", "rds_instance", lambda value: ["rds", "describe-db-instances", "--db-instance-identifier", value, "--query", "DBInstances[].{Name:DBInstanceIdentifier,Status:DBInstanceStatus,Version:EngineVersion,Public:PubliclyAccessible}"]),
    ("Cognito", "cognito_user_pool_id", lambda value: ["cognito-idp", "describe-user-pool", "--user-pool-id", value, "--query", "UserPool.{Id:Id,Name:Name,Status:Status}"]),
    ("CloudFront", "cloudfront_distribution_id", lambda value: ["cloudfront", "get-distribution", "--id", value, "--query", "Distribution.{Id:Id,Status:Status,Domain:DomainName,Enabled:DistributionConfig.Enabled}"]),
    ("CloudWatch", "log_group", lambda value: ["logs", "describe-log-streams", "--log-group-name", value, "--limit", "1", "--no-paginate", "--query", "{LogGroupFound:`true`}"]),
]
for label, key, arguments in checks:
    identifier = resources.get(key)
    if identifier:
        status(label, arguments(identifier))
    else:
        print(f"{label}: not configured")
PY
