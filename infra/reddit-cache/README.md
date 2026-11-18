# Private Reddit cache in S3

This optional stack creates a separate encrypted, versioned bucket in **us-west-1**, with public access blocked, TLS required and retained data on stack deletion. It does not deploy a collector, collect account data, change the bridge or connect to the website build.

```bash
bash infra/reddit-cache/deploy.sh
```

Deployment requires the user's AWS deployment authorization. The script saves noncredential outputs only to ignored `.codex/tmp/reddit/s3-config.json`. The stack was deployed on 2026-11-18; local conditional empty-manifest write/read passed. The initial HTTP route was blocked by Reddit; the subsequent explicitly authorized local Chrome workflow successfully uploaded validated real source snapshots. Account membership, exact source counts and validation evidence remain private. Use `REDDIT_CACHE_BUCKET` in Cloud instead of copying local AWS credentials.

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

Deployment status on 2026-11-18: the bucket stack is CREATE_COMPLETE and the Reddit policy is attached through the UPDATE_COMPLETE shared-runtime stack. The measured Cloud STS role was `english-vault-cloud-runtime`; local empty validation-manifest write/read passed. At that initial acceptance, Cloud S3 I/O and real-source durability were untested because the Cloud task hit its usage limit and local bridge requests returned HTTP 403. No account archive was uploaded during that initial check. The later local Chrome acceptance below establishes real-source persistence; Cloud I/O remains untested. Cookies and raw pages are never uploaded.

The later local Chrome fix verified signed-in HTML, source parsing and content-addressed source uploads using the existing authorized session. Browser profiles, raw page diagnostics and all authentication data remain local and outside the S3 upload allowlist. Cloud route/storage testing remains separate.

The subsequent real Cloud S3 test used the active `english-vault-cloud-runtime` role and attempted only the isolated empty validation manifest. It failed with proxy CONNECT HTTP 403 before AWS responded. The exact bucket regional hostname (`${REDDIT_CACHE_BUCKET}.s3.us-west-1.amazonaws.com`) was absent from both startup and live network rules. Add that single hostname to the Cloud network allowlist, preserving existing grants, before a fresh S3 validation. This is distinct from IAM AccessDenied; no credentials, role grants or Reddit session were changed and no Cloud S3 roundtrip is claimed.
