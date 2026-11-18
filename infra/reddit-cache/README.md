# Private Reddit cache in S3

This optional stack creates a separate encrypted, versioned bucket in **us-west-1**, with public access blocked, TLS required and retained data on stack deletion. It does not deploy a collector, collect account data, change the bridge or connect to the website build.

```bash
bash infra/reddit-cache/deploy.sh
```

Deployment requires the user's AWS deployment authorization. The script saves noncredential outputs only to ignored `.codex/tmp/reddit/s3-config.json`. This task prepares the infrastructure without deploying it. Use `REDDIT_CACHE_BUCKET` in Cloud instead of copying local AWS credentials.

`CacheAccessPolicyArn` grants only `s3:GetObject`/`s3:PutObject` under:

```text
cache/reddit/v1/accounts/*/index.json
cache/reddit/v1/accounts/*/posts/*
```

There is no bucket listing, delete, credential storage or whole-directory sync. Indexes are compressed JSON. Sources use immutable SHA-256 keys, validated content and digest checks. The collector uploads sources before conditionally merging the remote manifest; local progress survives a failed upload. Cookies, session files, raw HTML and runtime dependencies never sync.

Attach this managed policy to the existing scoped runtime role through the optional `RedditCacheAccessPolicyArn` parameter in [the shared role template](../cloud-runtime/template.yaml). Existing YouTube/X policies and bridge grants remain separate. The optional standalone OIDC role requires exact issuer/audience/subject bindings like the X cache stack; it has no bridge permissions by itself. Save/apply the Cloud connection and verify its STS identity before claiming it uses an updated role.

Configure `REDDIT_CACHE_BUCKET` and `REDDIT_ACCOUNT` (the lowercase username) in a new task for cache-only reuse; a Reddit session is not needed for existing sources. Supply `REDDIT_STORAGE_STATE_JSON` separately for live collection through the bridge. Preserve ordinary S3 proxy/CA settings; S3 does not go through the Reddit proxy.

```bash
bash tools/reddit/run.sh doctor
bash tools/reddit/run.sh sync
bash tools/reddit/run.sh search 'phrase'
```

`doctor` checks configuration, not permissions or durability. Confirm successful sync and restoration using the same private bucket/identity. AccessDenied is an AWS policy failure; do not renew Reddit cookies in response. See [the collector guide](../../docs/reddit.md) for coverage, transport and privacy boundaries.
