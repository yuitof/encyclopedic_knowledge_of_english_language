#!/usr/bin/env bash
# Deploy only after supplying the existing secret ARNs and scoped Cloud role name.
set -euo pipefail
umask 077
: "${EXIT_AUTH_SECRET_ARN:?Set the existing exit-node auth secret ARN}"
: "${CLIENT_AUTH_SECRET_ARN:?Set the existing separate Cloud client auth secret ARN}"
: "${CLOUD_RUNTIME_ROLE_NAME:?Set the existing scoped Cloud runtime role name}"
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
region=us-west-1
image_stack=english-vault-youtube-exit-images
worker_stack=english-vault-youtube-exit
aws cloudformation deploy --region "$region" --stack-name "$image_stack" \
  --template-file "$root/infra/youtube-exit-node/repository.yaml" --no-fail-on-empty-changeset
repository="$(aws cloudformation describe-stacks --region "$region" --stack-name "$image_stack" \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue | [0]' --output text)"
registry="${repository%%/*}"
docker build --platform linux/amd64 --provenance=false -f "$root/infra/youtube-exit-node/Dockerfile" \
  -t youtube-exit-node:build "$root"
image_id="$(docker image inspect youtube-exit-node:build --format '{{.Id}}')"
tag="${image_id#sha256:}"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"
docker tag youtube-exit-node:build "$repository:$tag"
if ! aws ecr describe-images --region "$region" --repository-name "${repository#*/}" \
    --image-ids "imageTag=$tag" >/dev/null 2>&1; then
  docker push "$repository:$tag"
fi
digest="$(aws ecr describe-images --region "$region" --repository-name "${repository#*/}" \
  --image-ids "imageTag=$tag" --query 'imageDetails[0].imageDigest' --output text)"
aws cloudformation deploy --region "$region" --stack-name "$worker_stack" \
  --template-file "$root/infra/youtube-exit-node/template.yaml" --capabilities CAPABILITY_IAM \
  --parameter-overrides "ImageUri=$repository@$digest" "ExitAuthSecretArn=$EXIT_AUTH_SECRET_ARN" \
  "ClientAuthSecretArn=$CLIENT_AUTH_SECRET_ARN" "CloudRuntimeRoleName=$CLOUD_RUNTIME_ROLE_NAME" \
  --no-fail-on-empty-changeset
aws cloudformation describe-stacks --region "$region" --stack-name "$worker_stack" \
  --query 'Stacks[0].Outputs' --output json
