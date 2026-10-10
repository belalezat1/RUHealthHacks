#!/usr/bin/env bash
# Read-only account and basic service status. Creates no resources.
set -euo pipefail
command -v aws >/dev/null || { echo 'Install AWS CLI or run these checks in the existing AWS CloudShell session.' >&2; exit 2; }
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region || true)}}"
test -n "$region" || { echo 'Set AWS_REGION or configure a default AWS region.' >&2; exit 2; }
export AWS_PAGER=''
aws sts get-caller-identity --region "$region"
echo "Region: $region"
aws ecs list-clusters --region "$region"
aws rds describe-db-instances --region "$region" --query 'DBInstances[].{Name:DBInstanceIdentifier,Status:DBInstanceStatus,Engine:Engine}'
aws ecr describe-repositories --region "$region" --query 'repositories[].{Name:repositoryName,URI:repositoryUri}'
