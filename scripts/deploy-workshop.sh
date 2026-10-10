#!/usr/bin/env bash
# Execute through an existing permitted workshop session; no stored workshop keys.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/aws-preflight.sh
command -v terraform >/dev/null || { echo 'BLOCKED: Terraform is unavailable.' >&2; exit 2; }
variables="${1:?Usage: deploy-workshop.sh /absolute/path/to/approved.tfvars [--apply]}"
[[ "$variables" = /* ]] || { echo 'Use an absolute tfvars path.' >&2; exit 2; }
test -f "$variables"
terraform -chdir=infra/terraform init -lockfile=readonly
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -var-file="$variables" -out=workshop.tfplan
if [[ "${2:-}" == '--apply' ]]; then
  terraform -chdir=infra/terraform apply workshop.tfplan
else
  echo 'Plan created. Review it, verify the one-off release migration, then rerun with --apply when workshop permissions are established.'
fi
