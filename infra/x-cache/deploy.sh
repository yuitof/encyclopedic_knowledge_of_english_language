#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
stack="${X_CACHE_STACK:-english-vault-x-cache}"
aws cloudformation deploy --region us-west-1 --stack-name "$stack" \
  --template-file "$root/infra/x-cache/template.yaml" --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset "$@"
aws cloudformation describe-stacks --region us-west-1 --stack-name "$stack" \
  --query 'Stacks[0].Outputs' --output json
python3 "$root/infra/x-cache/bootstrap.py" "$stack"
