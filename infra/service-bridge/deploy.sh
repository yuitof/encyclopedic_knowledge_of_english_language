#!/usr/bin/env bash
# Deploy only after supplying the existing secret ARNs and scoped Cloud role name.
set -euo pipefail
umask 077
: "${EXIT_AUTH_SECRET_ARN:?Set the existing service-node auth secret ARN}"
: "${CLOUD_RUNTIME_ROLE_NAME:?Set the existing scoped Cloud runtime role name}"
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
region=us-west-1
image_stack=service-bridge-images
worker_stack=service-bridge
aws cloudformation deploy --region "$region" --stack-name "$image_stack" \
  --template-file "$root/infra/service-bridge/repository.yaml" --no-fail-on-empty-changeset
repository="$(aws cloudformation describe-stacks --region "$region" --stack-name "$image_stack" \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue | [0]' --output text)"
registry="${repository%%/*}"
docker build --platform linux/amd64 --provenance=false -f "$root/infra/service-bridge/Dockerfile" \
  -t service-bridge:build "$root/infra/service-bridge"
image_id="$(docker image inspect service-bridge:build --format '{{.Id}}')"
tag="${image_id#sha256:}"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"
docker tag service-bridge:build "$repository:$tag"
if ! aws ecr describe-images --region "$region" --repository-name "${repository#*/}" \
    --image-ids "imageTag=$tag" >/dev/null 2>&1; then
  docker push "$repository:$tag"
fi
digest="$(aws ecr describe-images --region "$region" --repository-name "${repository#*/}" \
  --image-ids "imageTag=$tag" --query 'imageDetails[0].imageDigest' --output text)"
aws cloudformation deploy --region "$region" --stack-name "$worker_stack" \
  --template-file "$root/infra/service-bridge/template.yaml" --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides "ImageUri=$repository@$digest" "ExitAuthSecretArn=$EXIT_AUTH_SECRET_ARN" \
  "CloudRuntimeRoleName=$CLOUD_RUNTIME_ROLE_NAME" \
  --no-fail-on-empty-changeset
aws cloudformation describe-stacks --region "$region" --stack-name "$worker_stack" \
  --query 'Stacks[0].Outputs' --output json
