# Private YouTube cache in us-west-1

`template.yaml` creates a private S3 bucket, its TLS-only policy, a scoped IAM managed policy, and (when exact trust parameters are supplied) a Codex runtime role and an OIDC provider. No access keys or YouTube cookies are provisioned. The template and scripts contain no history or transcripts.

## Deploy or update

With your local AWS deployment identity configured:

```bash
aws sts get-caller-identity --region us-west-1
bash infra/youtube-cache/deploy.sh
bash tools/youtube/run.sh sync
```

The deployment script fixes the region to `us-west-1`, defaults the stack name to `english-vault-youtube-cache`, and can be rerun for updates. It initializes an empty manifest only when one does not exist, and writes the bucket/region into ignored `.codex/tmp/youtube/s3-config.json`. `YOUTUBE_CACHE_STACK` overrides the stack name. The sync command uploads the existing history index and readable referenced transcripts only; it neither collects fresh history nor downloads captions.

For Cloud tasks, set `YOUTUBE_CACHE_BUCKET` to the `BucketName` output and use standard AWS credential-provider configuration. The Python client always uses `us-west-1` with SigV4 signing. Prefer the Cloud environment's AWS OIDC connection; never transfer local administrator credentials. Allow the exact `BucketEndpoint` stack output and `sts.us-west-1.amazonaws.com` through the Cloud network controls. AWS SDK credentials must work with boto3; opaque network-secret placeholders are unsuitable for signing AWS requests.

## Scoped Cloud identity

The stack output `CacheAccessPolicyArn` permits `GetObject` and `PutObject` on:

- `cache/v1/history.json`
- `cache/v1/transcripts/*`

It grants no deletion, bucket configuration changes, or arbitrary-key access. The deployment script creates the manifest first so a runtime identity does not need `ListBucket` to distinguish an absent initial manifest from an access error. Access denied is an error, never treated as an empty cache.

Configure the environment's **Advanced → OIDC** connection with role ARN `arn:aws:iam::ACCOUNT:role/english-vault-youtube-cache-runtime` and region `us-west-1`. Read its actual issuer, audience, and subject before creating trust. Rerun the stack with the three trust parameters:

```bash
bash infra/youtube-cache/deploy.sh --parameter-overrides \
  OidcIssuerHostPath=ACTUAL_ISSUER \
  OidcAudience=ACTUAL_AUDIENCE \
  OidcSubject=ACTUAL_SUBJECT
```

This creates the stack-named runtime role, attaches the scoped policy, registers the verified issuer as an IAM OIDC provider, and trusts only exact audience/subject matches. The script acknowledges `CAPABILITY_NAMED_IAM`. If the account already has a provider for this exact issuer, also pass `OidcProviderArn=arn:aws:iam::ACCOUNT:oidc-provider/ACTUAL_ISSUER` to reuse it rather than registering a duplicate. Copy the `RuntimeRoleArn` output into the Cloud OIDC connection. These are configuration placeholders, not working credentials; do not guess claims or add wildcard trust. The bucket remains available even when no OIDC parameters have been supplied yet.

## Persistence and privacy

- The bucket blocks all public access, disables ACLs, uses SSE-S3 encryption and versioning, and denies non-TLS traffic. No static website or public access policy is created.
- Only the manifest and validated transcript JSON are uploaded. Sessions, Google/AWS credentials, browser profiles, helper scripts, and dependencies remain outside S3 and GitHub.
- Transcript objects include a SHA-256 digest in their key. Downloads verify it. The manifest uses ETag-based conditional writes with merge/retry to preserve concurrent tasks' additions.
- Each retrieval saves the local transcript first, uploads the transcript before its manifest reference, then updates the shared manifest. Interrupted uploads leave resumable local progress. Failures are reported, not silently downgraded to local-only mode.
- Existing readable cached transcripts are reused. S3 retrieval is not another YouTube API call. A new task initially downloads only the manifest; transcripts are fetched from S3 as searched.
- The code does not mirror deletions. It unions observed watch dates; Google-deleted history does not automatically erase the private archive. Explicit cache removal/retention changes require a separate request.

## Recreation and recovery

`DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` protect the bucket and TLS policy if the stack is deleted or replaced. Rerunning `deploy.sh` against the existing stack updates it idempotently. Deleting a stack does not delete the data or stop S3 storage charges. Recreating a deleted stack generates a **new bucket**; to keep the retained old bucket managed, use CloudFormation resource import rather than assuming a new stack adopts it. Alternatively configure the existing bucket for cache reads after explicitly reviewing its ownership/policy.

Versioning preserves older manifest/transcript versions. No automatic expiration is configured. If recovery is needed, inspect prior object versions with an administrative identity, restore the desired version, and rerun sync. Runtime credentials cannot delete versions. Storage and request charges follow normal S3 pricing; this stack creates no always-running compute.

## Validation

```bash
aws cloudformation validate-template --region us-west-1 \
  --template-body file://infra/youtube-cache/template.yaml
.codex/tmp/youtube/.venv/bin/python -m unittest discover -s tests/youtube -v
```

After deployment inspect encryption, public-access blocking, ownership controls, versioning, and bucket-policy public status with `aws s3api`. Run sync, then test restoration into an isolated empty cache using the same SDK configuration, with the YouTube API unavailable. Verify that S3 contains only the allowed manifest/transcript keys. Never validate by uploading real session cookies.

References: [CloudFormation S3 resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html), [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [Codex Cloud AWS/OIDC support](https://learn.chatgpt.com/docs/environments/cloud-environments#access-cloud-resources-with-oidc).
