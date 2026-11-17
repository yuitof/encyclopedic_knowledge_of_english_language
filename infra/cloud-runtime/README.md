# Shared Cloud runtime role

`template.yaml` manages `english-vault-cloud-runtime` separately from the two cache stacks. It attaches their existing managed policies and grants invocation of the existing bridge function plus read/write coordination of its session table. It creates no buckets, OIDC providers, static credentials, or compute.

Deploy stack `english-vault-cloud-runtime` in `us-west-1` with `CAPABILITY_NAMED_IAM`. Supply the two cache stacks' `CacheAccessPolicyArn` outputs, the existing bridge function/table ARNs, and the verified OIDC provider, issuer, audience, and subject from the current Cloud connection. Keep exact trust conditions; do not guess claims or add wildcard trust.

Create a replacement AWS OIDC connection targeting the `RuntimeRoleArn` output in `us-west-1`; the Cloud UI fixes an existing connection's target role. Read the new connection's actual issuer, audience, and subject, then update this stack's trust parameters to those exact values. Replace the legacy connection attachment in the environment draft and save it. Publish only after checking that the environment snapshot excludes private runtime data. Renew the Cloud AWS session, confirm its STS identity, then verify both cache workflows and the bridge. Role names cannot be changed in place: keep the previous YouTube-stack role during migration until the replacement is verified. Do not delete the YouTube stack or its OIDC provider to retire that legacy role.

During migration the legacy role may also have the X cache policy attached so existing tasks can sync. That attachment is outside the original YouTube template; if retained long term, manage it explicitly rather than assuming a YouTube stack redeployment preserves it. After verified cutover, retire legacy access as a separate reviewed change.

The role permits only the cache object paths defined by the attached policies; it grants no S3 listing/deletion, bucket administration, IAM inspection, or CloudFormation access. The X policy currently covers all account archives within its private bucket. Cookies and private cache contents remain outside Git and environment snapshots.
