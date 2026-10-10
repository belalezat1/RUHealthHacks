<#
.SYNOPSIS
  Laptop-side helper for the Sevaro AWS demo (Windows PowerShell 5.1+). Requires the AWS CLI v2
  configured with credentials (aws configure / aws configure sso).

.EXAMPLE
  .\infra\aws\sevaro.ps1 check
  .\infra\aws\sevaro.ps1 create -AvailabilityZone us-east-1a
  .\infra\aws\sevaro.ps1 params
  .\infra\aws\sevaro.ps1 deploy -Ref origin/yassin
  .\infra\aws\sevaro.ps1 status
  .\infra\aws\sevaro.ps1 logs
  .\infra\aws\sevaro.ps1 backup
  .\infra\aws\sevaro.ps1 rollback -Ref <previous sha>
  .\infra\aws\sevaro.ps1 teardown
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("check", "create", "params", "deploy", "status", "logs", "backup", "rollback", "shell", "teardown")]
  [string]$Action,
  [string]$Region = "us-east-1",
  [string]$StackName = "sevaro-demo",
  [string]$AvailabilityZone = "",
  [string]$Ref = "origin/yassin"
)
$ErrorActionPreference = "Stop"
$Template = Join-Path $PSScriptRoot "sevaro-stack.yaml"

function Out-Stack([string]$Key) {
  aws cloudformation describe-stacks --region $Region --stack-name $StackName `
    --query "Stacks[0].Outputs[?OutputKey=='$Key'].OutputValue" --output text
}

function Invoke-Host([string]$Command, [int]$TimeoutSec = 900) {
  $id = Out-Stack "InstanceId"
  $paramFile = New-TemporaryFile
  @{ commands = @($Command); executionTimeout = @("$TimeoutSec") } | ConvertTo-Json -Compress |
    Set-Content -Encoding ascii $paramFile
  $cmdId = aws ssm send-command --region $Region --instance-ids $id --document-name AWS-RunShellScript `
    --comment "sevaro $Action" --parameters "file://$paramFile" --query "Command.CommandId" --output text
  Remove-Item $paramFile
  Write-Host "SSM command $cmdId sent to $id; waiting..."
  $deadline = (Get-Date).AddSeconds($TimeoutSec + 60)
  do {
    Start-Sleep -Seconds 5
    $status = aws ssm get-command-invocation --region $Region --command-id $cmdId --instance-id $id `
      --query "Status" --output text 2>$null
  } while (@("Pending", "InProgress", "Delayed", "") -contains $status -and (Get-Date) -lt $deadline)
  aws ssm get-command-invocation --region $Region --command-id $cmdId --instance-id $id `
    --query "[StandardOutputContent, StandardErrorContent]" --output text
  Write-Host "Status: $status"
  if ($status -ne "Success") { throw "remote command finished with status $status" }
}

switch ($Action) {
  "check" {
    Write-Host "== Caller identity"; aws sts get-caller-identity
    Write-Host "== Region $Region availability zones"
    aws ec2 describe-availability-zones --region $Region --query "AvailabilityZones[].[ZoneName,ZoneId]" --output table
    Write-Host "Check the CloudFront 'VPC origins' docs for unsupported AZ IDs, then pick a supported ZoneName."
    Write-Host "== Session Manager plugin (only needed for 'shell')"
    try { session-manager-plugin --version } catch { Write-Host "not installed (optional)" }
  }
  "create" {
    if (-not $AvailabilityZone) { throw "Pass -AvailabilityZone (run 'check' to list them)" }
    aws cloudformation deploy --region $Region --stack-name $StackName --template-file $Template `
      --capabilities CAPABILITY_IAM --parameter-overrides "AvailabilityZone=$AvailabilityZone"
    aws cloudformation describe-stacks --region $Region --stack-name $StackName --query "Stacks[0].Outputs" --output table
  }
  "params" {
    $url = Out-Stack "AppUrl"
    $pw = Read-Host -AsSecureString "Demo password for all accounts (12+ chars)"
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
    if ($plain.Length -lt 12) { throw "Password must be at least 12 characters" }
    aws ssm put-parameter --region $Region --name /sevaro/demo-password --type SecureString --value $plain --overwrite | Out-Null
    aws ssm put-parameter --region $Region --name /sevaro/allowed-origin --type String --value $url --overwrite | Out-Null
    Write-Host "Saved /sevaro/demo-password (SecureString) and /sevaro/allowed-origin = $url"
  }
  "deploy" {
    $cmd = "set -e; test -f /opt/sevaro/bootstrap.done || { echo 'host bootstrap not finished yet; wait a few minutes'; exit 1; }; " +
           "cd /opt/sevaro/repo && git fetch --all --prune --quiet && git checkout --quiet --detach '$Ref' && bash infra/scripts/deploy.sh '$Ref'"
    Invoke-Host $cmd 1500
    Write-Host "App: $(Out-Stack 'AppUrl')"
  }
  "status" {
    $url = Out-Stack "AppUrl"
    Write-Host "App URL: $url"
    try { (Invoke-WebRequest -UseBasicParsing "$url/health/ready").Content } catch { Write-Host "not ready: $($_.Exception.Message)" }
  }
  "logs" { aws logs tail /sevaro/app --region $Region --since 30m --follow }
  "backup" { Invoke-Host "bash /opt/sevaro/repo/infra/scripts/backup-to-s3.sh" 600 }
  "rollback" { Invoke-Host "cd /opt/sevaro/repo && bash infra/scripts/rollback.sh '$Ref'" 900 }
  "shell" { aws ssm start-session --region $Region --target (Out-Stack "InstanceId") }
  "teardown" {
    $bucket = Out-Stack "BackupBucketName"
    $ok = Read-Host "Delete stack $StackName in $Region? The S3 bucket $bucket and an EBS snapshot are KEPT. Type yes"
    if ($ok -ne "yes") { return }
    aws cloudformation delete-stack --region $Region --stack-name $StackName
    aws cloudformation wait stack-delete-complete --region $Region --stack-name $StackName
    Write-Host "Stack deleted. To remove everything else (irreversible):"
    Write-Host "  aws s3 rm s3://$bucket --recursive ; then delete all object versions and the bucket in the S3 console"
    Write-Host "  aws ec2 describe-snapshots --owner-ids self --filters Name=tag:Name,Values=sevaro-state  (then delete-snapshot)"
    Write-Host "  aws ssm delete-parameters --names /sevaro/demo-password /sevaro/allowed-origin"
  }
}
