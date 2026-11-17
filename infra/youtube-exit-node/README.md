# Temporary Lambda exit node

This implementation keeps the YouTube history collector, signed-out transcript retrieval, and cache writes in the Cloud VM. An active Lambda invocation runs a userspace Tailscale exit node in `us-west-1`. The wrapper starts a private session, selects its exact node, verifies the public exit address, and runs the existing collector through a loopback HTTP proxy.

The implementation requires an end-to-end Cloud acceptance check. An offline test pass, a local container launch, or a node appearing in Tailscale establishes only that particular step. Cloud's managed proxy must permit the Tailscale control and relay connections, and YouTube must accept the AWS-origin requests.

Validation on 2026-11-17 deployed the worker and confirmed that a separate Linux userspace client could select the Lambda exit node, observe the same public egress address, and receive HTTP 200 from both unsigned YouTube probe URLs. The Cloud VM successfully read its enrollment secret, created a session, invoked Lambda, and observed readiness. Its own Tailscale enrollment timed out while connecting through the managed proxy, so Cloud acceptance remains incomplete.

The next credential-free diagnostic is `TS_FORCE_NOISE_443=true tailscale debug ts2021 --host=controlplane.tailscale.com`, bounded by an external timeout and using the existing managed proxy. Capture diagnostics privately because they can include proxy configuration. Avoid the diagnostic's `--force-port=443` option for this comparison because it also restricts the proxy connection's port. A successful public HTTPS GET alone does not verify the control protocol handshake.

## Resources and access

`repository.yaml` creates an immutable private ECR repository. `template.yaml` creates the Lambda, a private DynamoDB session table, seven-day operational logs, a worker role, and an inline policy on the existing scoped Cloud role. The existing source-cache bucket continues to contain history and validated transcripts. Session records are stored in DynamoDB.

| Setting | Value |
| --- | --- |
| Region and architecture | `us-west-1`, Linux amd64 |
| Tailscale | 1.104.7, pinned image digest and static archive checksums |
| Runtime | Python 3.12 Lambda base, pinned image digest |
| Memory | 1 GiB |
| Lambda hard timeout | 900 seconds |
| Default session lifetime | 720 seconds from request creation, including startup |
| Reserved concurrency | One worker invocation |
| Queue age / function-error retries | 60 seconds / zero |
| Session retention | DynamoDB TTL after one day |

Lambda reads only its Tailscale enrollment secret and its session records. Cloud reads the separate client enrollment secret, creates and stops sessions, and invokes this function. The new role policy is separate from the existing scoped S3 cache policy. Customer-managed KMS keys on enrollment secrets require an additional, narrowly scoped decrypt grant.

YouTube credentials stay in the Cloud task's existing private session configuration. HTTPS certificate verification remains enabled. The exit node forwards encrypted YouTube TLS traffic. Tailscale identity and connection metadata, session IDs, the public exit IP, and operational status are private runtime data. The worker discards daemon output and publishes fixed error categories.

## Prepare the existing tailnet

Create distinct tags `tag:cloud-codex` and `tag:service-bridge`, owned by administrators. Permit exit advertisements from `tag:service-bridge` with `autoApprovers.exitNode`. Permit the client identity to reach `autogroup:internet` on `tcp:443` and `tcp:53`. Tailscale 1.104.7 checks TCP port 53 access before accepting a peer's DNS queries through the exit node. A grant containing only HTTPS causes DNS resolution to fail with a 403 response. Tailscale grants are additive, so inspect existing wildcard rules before claiming these identities are isolated. Account for existing personal and tagged-device connectivity when adjusting broad rules.

Generate separate **preauthorized, reusable, ephemeral, tagged auth keys** for the two roles. Store each raw key as its own Secrets Manager SecretString, using the AWS-managed encryption key. Each runtime obtains its key through its own IAM role. Auth keys expire after at most 90 days, so rotate the stored values before their chosen expiration. Runtime node state is memory-only and each session enrolls a fresh ephemeral node. Normal cleanup runs `tailscale logout`; abrupt termination relies on ephemeral-node removal.

When migrating the earlier tag names, update the policy's tag owners, exit-node auto-approval, and client grants together. Replace the two enrollment keys with keys carrying `tag:cloud-codex` and `tag:service-bridge`, and update the corresponding existing Secrets Manager values. Existing auth keys retain their original tags. After verifying enrollment with the replacement keys, revoke the superseded keys and retire the earlier policy entries. The live tag/key migration is pending console access.

The console policy and credential changes require reviewing the actual existing tailnet. Keys and private policy backups belong in private runtime storage. The container build uses an explicit file allowlist to exclude local caches and credentials.

## Deploy

Configure these shell variables with the existing secret ARNs and scoped role name. ARN values identify resources; secret values belong in Secrets Manager.

```bash
export EXIT_AUTH_SECRET_ARN='arn:aws:secretsmanager:us-west-1:ACCOUNT:secret:EXIT-SECRET'
export CLIENT_AUTH_SECRET_ARN='arn:aws:secretsmanager:us-west-1:ACCOUNT:secret:CLIENT-SECRET'
export CLOUD_RUNTIME_ROLE_NAME='english-vault-youtube-cache-runtime'
bash infra/youtube-exit-node/deploy.sh
```

The script deploys the image repository, builds a Linux amd64 image, pushes an immutable image tag, resolves its digest, and deploys the worker by digest. Run it using an authorized local deployment identity. Cloud tasks use their existing scoped AWS identity. Installation and deployment use official vendor sources and do not collect history or transcripts.

The worker runs in Lambda's default internet-enabled networking. Adding a VPC would require separately providing outbound internet connectivity. No function URL, API Gateway, public SSH service, or SSH key is created. IAM-authenticated Lambda invocation supplies the start request.

Lambda bills the whole active session, including waiting. ECR, Secrets Manager, DynamoDB, logs, data transfer, and applicable Tailscale plan usage can also incur charges. The stop request ends a normal session early. The worker's own deadline bounds a session after a lost client.

## Configure the Cloud task

Install the binaries in the ignored workflow runtime during environment preparation.

```bash
bash tools/youtube/setup.sh
bash tools/youtube/setup-tailscale.sh
```

Set `YOUTUBE_EXIT_FUNCTION` to the stack's `FunctionArn`, `YOUTUBE_EXIT_TABLE` to `SessionTableName`, and `YOUTUBE_TAILSCALE_AUTH_SECRET_ARN` to `ClientAuthSecretArn`. Allow the AWS regional endpoints `lambda.us-west-1.amazonaws.com`, `dynamodb.us-west-1.amazonaws.com`, and `secretsmanager.us-west-1.amazonaws.com`, plus the Tailscale enrollment/control/DERP hosts actually needed by the selected connection path. Preserve the existing AWS/S3 and dictionary destinations. Test the scoped AWS identity's signing support for each newly used service.

The client runs official `tailscaled` in userspace mode and selects the per-session exit node explicitly. This path requires no TUN device or network-administration capability. Daemon connections inherit the Cloud network configuration. Application proxy settings are applied explicitly to the YouTube HTTP clients. AWS SDK requests use the existing Cloud connection path.

Run the unsigned acceptance check first. It performs no history/cache restoration and uses no YouTube session.

```bash
bash tools/youtube/run.sh exit-node -- probe
```

Acceptance requires an online, approved peer with the reported node ID and IP, the same public address observed by Lambda and the proxied Cloud request, and a YouTube origin response. The public-address comparison is deliberately conservative; an AWS egress address change can fail this check even with correct routing. An address mismatch stops collection for investigation.

Then run the existing authorized collection commands.

```bash
bash tools/youtube/run.sh exit-node -- refresh
bash tools/youtube/run.sh exit-node -- search 'PHRASE' --day yesterday --fetch
```

Use `--session-seconds` (120–720) and `--ready-timeout` (10–120) before `--` if needed. One wrapper runs one collector command. The wrapper sends stop on completion or interruption. If a session nears expiry, loses its heartbeat, or changes/disconnects its selected exit node, it terminates the collector. The collector retains its last completed atomic checkpoint, and an incomplete operation exits unsuccessfully. Resume using the same command in another session. Explicit local proxy settings prevent an ambient HTTPS proxy from replacing the selected transport.

Concurrent commands against the same local history cache remain unsupported. Duplicate Lambda delivery is deduplicated by an atomic claim on the session record. Expired or canceled requests cannot claim a session. Queue admission is distinct from readiness, and failure or a missing heartbeat never counts as successful collection.

## Validation and rollback

```bash
.codex/tmp/youtube/.venv/bin/python -m unittest discover -s tests/youtube -v
bash -n tools/youtube/run.sh tools/youtube/setup-tailscale.sh infra/youtube-exit-node/deploy.sh
aws cloudformation validate-template --region us-west-1 --template-body file://infra/youtube-exit-node/template.yaml
docker build --platform linux/amd64 --provenance=false -f infra/youtube-exit-node/Dockerfile -t youtube-exit-node:test .
```

Synthetic tests cover duplicate delivery, canceled/expired/stale sessions, node identity checks, process termination on route loss, credential cleanup, transport precedence, and preventing collection on an egress mismatch. A container smoke check can start the daemon as UID 1000 with a read-only filesystem and networking disabled. Live Cloud testing additionally needs the scoped tailnet keys and deployed AWS resources.

To retire the feature, stop active sessions, revoke the two enrollment keys and their registered nodes, remove the dedicated tailnet grants/approval entries, and remove the stack's scoped client policy. Delete the worker stack using the authorized deployment identity when ready. The table and logs are retained for explicit review/removal, and the image repository is retained separately. Removing the wrapper configuration returns commands to their previous explicitly configured transport.

References include [Tailscale on Lambda](https://tailscale.com/docs/install/cloud/aws/aws-lambda), [userspace exit nodes](https://tailscale.com/docs/reference/kernel-vs-userspace-routers), [ephemeral nodes](https://tailscale.com/docs/features/ephemeral-nodes), [exit-node approval](https://tailscale.com/docs/reference/syntax/policy-file#auto-approvers), and [AWS invocation semantics](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html).
