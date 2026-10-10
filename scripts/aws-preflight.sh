#!/usr/bin/env bash
# Read-only discovery. Does not infer creation permissions from a successful identity lookup.
set -euo pipefail
command -v aws >/dev/null || { echo 'BLOCKED: aws CLI is not installed; no AWS identity or action has been verified.' >&2; exit 2; }
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
test -n "$region" || { echo 'BLOCKED: set the organizer-approved AWS_REGION; the workshop URL is not a region authorization.' >&2; exit 2; }
export AWS_PAGER=''
aws sts get-caller-identity --region "$region"
echo 'Identity is verified. Creation permissions, event expiration, and permitted roles still require workshop evidence.'
aws ec2 describe-vpcs --region "$region" --query 'Vpcs[].{VpcId:VpcId,IsDefault:IsDefault}'
aws ec2 describe-subnets --region "$region" --query 'Subnets[].{SubnetId:SubnetId,VpcId:VpcId,AZ:AvailabilityZone,PublicIP:MapPublicIpOnLaunch}'
aws ecs list-clusters --region "$region"
aws rds describe-db-instances --region "$region" --query 'DBInstances[].{Identifier:DBInstanceIdentifier,Status:DBInstanceStatus,Engine:Engine,Public:PubliclyAccessible,Vpc:DBSubnetGroup.VpcId}'
aws ecr describe-repositories --region "$region" --query 'repositories[].{Name:repositoryName,URI:repositoryUri}'
aws cognito-idp list-user-pools --max-results 20 --region "$region" --query 'UserPools[].{Id:Id,Name:Name}'
aws s3api list-buckets --query 'Buckets[].Name'
aws iam list-roles --query 'Roles[].{Name:RoleName,Arn:Arn}'
aws service-quotas list-service-quotas --service-code fargate --region "$region" --query 'Quotas[].{Name:QuotaName,Value:Value}'
echo 'Record event expiration, allowed actions, PassRole ARNs, approved networking, and Cognito access in docs/deployment.md before deployment.'
