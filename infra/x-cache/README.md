# Private X cache in us-west-1

This CloudFormation stack creates a separate private bucket for X collection indexes and post sources. It uses the YouTube cache's established design: SSE-S3 encryption, versioning, public-access blocking, bucket-owner enforcement, TLS-only access, and retained data on stack deletion/replacement. It does not create compute, X sessions, or static AWS access keys. S3 storage/request charges apply.

```bash
aws cloudformation validate-template --region us-west-1 --template-body file://infra/x-cache/template.yaml
bash infra/x-cache/deploy.sh
bash tools/x/run.sh sync
```

`deploy.sh` defaults to stack `english-vault-x-cache` (`X_CACHE_STACK` overrides it), prints stack outputs, and saves ignored `.codex/tmp/x/s3-config.json`. Runtime manifests initialize with a conditional create on first use. The X stack leaves the YouTube stack unchanged.

The scoped managed policy permits only `s3:GetObject`/`s3:PutObject` on:

- `cache/x/v1/accounts/*/index.json`
- `cache/x/v1/accounts/*/posts/*`

No bucket listing, deletes, session objects, arbitrary paths, or bucket configuration changes are granted to the runtime. The client validates account IDs, object keys, JSON schema, and SHA-256 digests, and uploads post objects before publishing their manifest references. Conditional writes merge concurrent task observations; source or upload failures preserve the local archive. Cache syncing never walks the runtime directory wholesale.

Set `X_CACHE_BUCKET`, `X_ACCOUNT_ID`, and a **scoped** AWS identity in fresh Cloud tasks; use the Cloud environment's AWS/OIDC connection rather than copying a local administrator's credentials. Permit the exact bucket endpoint and `sts.us-west-1.amazonaws.com` in network controls. Session provisioning (`X_STORAGE_STATE_JSON`) is separate and unnecessary for cached searches. Run `doctor` to inspect configuration and `sync` to verify live AWS access. Keep private caches out of published environment snapshots.

The optional OIDC parameters mirror the YouTube stack: `OidcIssuerHostPath`, `OidcAudience`, and `OidcSubject` create a role with exact audience/subject trust. Supply `OidcProviderArn` to reuse an existing provider. Read actual connection claims; never guess or use wildcard trust. Without these parameters no runtime role/provider is created; the bucket and managed access policy are still deployed. The policy covers accounts within this private bucket; narrow its account wildcard to a specific runtime account if different users are granted access.

Before calling persistence verified, sync successfully and test lazy restoration into an isolated empty cache with X access disabled. Inspect public-access blocking, encryption, versioning, ownership and public policy status. Errors are not silently downgraded to local-only mode. The normal runtime cannot list objects; any administrative inspection must use a separately authorized local identity.

Deleting the stack retains the bucket and its data; versioning has no expiration policy. Recreating the stack creates a new bucket unless the retained bucket is explicitly imported. Runtime commands archive observations and do not mirror removed likes/bookmarks or delete old source versions.

See [the X workflow guide](../../docs/x.md) for commands, API analysis, authentication, coverage limitations and cache schemas. References: [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [CloudFormation S3 bucket resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html).
