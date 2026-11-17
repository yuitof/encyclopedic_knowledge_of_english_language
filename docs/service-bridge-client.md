# Cloud client — built-in Tailscale VPN

Use the `vault` branch for Cloud tasks. Lambda's self-contained server and deployment templates live on the separate [`service-bridge` branch](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/tree/service-bridge/infra/service-bridge). The client does not import server code, install or launch Tailscale, read enrollment secrets, or select an exit node.

Run the whole wrapper command in the Cloud **outer executor** (using the command tool's approved outer-execution path where required). The raw `proxy:8088` listener is not reachable directly from a separate inner command sandbox, and loopback relays/collector processes must share the same network namespace. Keep the inherited AWS proxy/CA configuration.

The client reaches Lambda's private CONNECT proxy through Codex Cloud's built-in VPN. Its [documented TCP transport](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-tcp-services) is HTTP CONNECT at `proxy:8088`; it is separate from the ambient HTTPS proxy. A small loopback relay chains the collector's HTTPS tunnels through that endpoint to the Lambda Tailscale IP on port 8443. No direct-network fallback is implemented. AWS and S3 keep their existing Cloud connection path.

## Setup

1. Deploy the matching `connect-v2` server from the `service-bridge` branch. It publishes private session readiness in DynamoDB.
2. Configure the environment's built-in Tailscale VPN with a reusable, ephemeral key carrying `tag:codex-cloud`. Keep this credential in the private VPN settings, outside application variables and files. Permit this identity to reach `tag:service-bridge` on `tcp:8443`. The old exit-node/Internet/DNS grants are not required by this client.
3. Set `SERVICE_BRIDGE_FUNCTION=service-bridge` and `SERVICE_BRIDGE_TABLE=service-bridge-sessions` (or the matching stack's function ARN/table outputs). Both clients also accept the existing `YOUTUBE_BRIDGE_FUNCTION` and `YOUTUBE_BRIDGE_TABLE` variables; shared names take precedence. Install `bash tools/youtube/setup.sh` and/or `bash tools/x/setup.sh` for the workflows you use. The old `YOUTUBE_EXIT_*` names are replaced; `YOUTUBE_TAILSCALE_AUTH_SECRET_ARN` is no longer read. Remove `setup-tailscale.sh` and manual daemon startup from environment setup instructions.
4. Attach the existing scoped AWS identity with permission to invoke that function and create/read/update that session table. Allow `lambda.us-west-1.amazonaws.com` and `dynamodb.us-west-1.amazonaws.com` on the ordinary Cloud network, preserving existing S3/dictionary destinations. Client application access to Secrets Manager and Tailscale enrollment/control hosts is no longer needed for this bridge; preserve any permissions needed by other workflows.
5. Save and republish the environment, then use a fresh task on `vault`. A connected VPN status alone does not establish private service reachability.

## Acceptance and use

Start with an unsigned probe, which reads no YouTube credentials or history/cache:

```bash
bash tools/youtube/run.sh bridge -- probe
```

The client creates a bounded DynamoDB session, invokes Lambda, and waits for `connect-v2` readiness. A random session password stays in client memory; only its SHA-256 hash goes into the session record. The client checks the private endpoint, opens the built-in VPN tunnel, verifies a 407 response without credentials, authenticates to Lambda's GOST proxy using HTTP Basic authentication (`bridge` and the session password), and checks the public IP against Lambda's own observation before contacting YouTube. Certificate verification remains enabled end to end. The server permits only YouTube and the public-IP check on HTTPS.

The probe reports separate Lambda invocation, session readiness, and private TCP/407 checks. A successful probe then reports `bridge: verified` and successful statuses for both unsigned YouTube URLs. An egress-address mismatch stops startup; AWS egress changes may cause a conservative false negative. A proxy CONNECT error can indicate a disconnected VPN, a missing tailnet port grant, an unreachable service, or a protocol/deployment mismatch. Do not fall back to a private daemon.

After acceptance, run the usual authorized workflow:

```bash
bash tools/youtube/run.sh bridge -- refresh
bash tools/youtube/run.sh bridge -- search 'PHRASE' --day yesterday --fetch
```

One wrapper runs one command. Optional `--session-seconds` (120–720, default 720) and `--ready-timeout` (10–120, default 60) precede `--`. The session includes startup time. The client terminates collection on stale heartbeat, session stop/expiry, or observed tunnel failure, and requests worker shutdown in cleanup. Network loss cannot switch the collector to an ambient proxy. The existing collector preserves completed atomic checkpoints; retry an incomplete command in a new session. Concurrent commands against the same local history cache remain unsupported.

The session wire contract is documented in the server README. The client recognizes only `connect-v2`, so it rejects the previous custom-proxy `connect-v1` protocol as well as the exit-node implementation. Update the client and server together. That previous implementation's Linux acceptance and the existing built-in VPN's connected status do not validate the new path. Deploy the new server, apply the private-service grant, and run this probe from a fresh Cloud task before collecting history.


The minimal tailnet grant is maintained in the server's [policy example](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/blob/service-bridge/infra/service-bridge/tailscale-policy.example.json). Merge it into the actual policy after reviewing additive ACLs/grants; do not overwrite unrelated permissions. Earlier keys/devices using `tag:cloud-codex` or `tag:youtube-client` must be migrated explicitly to `tag:codex-cloud`. Changing documentation does not retag them. Republish the environment and verify the new managed node's tag before the live probe.

GOST runs only on Lambda. With the X extension deployed, it permits the two YouTube hosts, `x.com`, `abs.twimg.com`, and the egress-check host, all on TCP 443, with pinned public DNS addresses and no unchecked fallback. The clients retain normal origin TLS verification and existing authentication. S3 cache behavior is unchanged. Session coordination, forwarding, and probes are shared under `tools/cloud_bridge/`; neither collector imports Lambda code.

For a legacy VPN configuration, inspect the current managed policy: `automatic_tailscale_access: true` permits routed tailnet TCP destinations without a separate CIDR grant. Older configurations may need a `tcp_network_access` private IPv4 grant for the selected endpoint and a replacement runtime. Do not weaken platform-protected-destination rules or substitute a private daemon after a denial.

## Verified deployment

On 2026-11-17, the GOST server at `f7a3431` and this client at `807339d` passed the unsigned probe from the refreshed Cloud environment's outer executor through the built-in VPN. Lambda invocation was accepted, `connect-v2` became ready, the private proxy returned 407 without authentication, authenticated public egress matched Lambda, both unsigned YouTube URLs returned 200 with certificate verification enabled, and the command exited 0. Independent session/peer checks subsequently confirmed `stopped` / `StopRequested` and the Lambda peer offline. This verifies the full managed VPN path, in addition to the separate local tailnet acceptance.

The environment's private VPN key now enrolls `tag:codex-cloud`; its function/table variables and client-only setup were published before the probe. No private daemon, exit node, enrollment-key retrieval, account cookies, history collection, captions, or S3-cache reads were used for this acceptance. No snapshot containing probe evidence was published. Existing broad member/gateway tailnet rules were preserved and also permit TCP access to the bridge; session authentication remains mandatory. An unauthorized tailnet identity was not separately enrolled for a live denial test.

Local validation passed all 74 YouTube-client tests and all 20 X tests. The matching server passed all 17 tests inside its Lambda image, plus deployed local authentication/destination-denial and expired-session checks. Existing collector authentication and cache behavior are preserved; authenticated collection itself was not exercised by this unsigned acceptance.

## X through the same bridge

The X extension requires deployment of the matching server destination list. The previous YouTube-only image rejects X. It uses the same function/table, `connect-v2` protocol, AWS invocation/session permissions, built-in VPN identity, and private TCP 8443 grant. Existing `YOUTUBE_BRIDGE_*` settings work for both clients; no X-specific bridge credential is needed.

Run these commands in the Cloud outer executor after deployment:

```bash
bash tools/x/run.sh bridge -- probe
bash tools/x/run.sh bridge -- refresh
bash tools/x/run.sh bridge -- get POST_ID
bash tools/x/run.sh bridge -- folders --refresh
```

The unsigned X probe checks readiness, private authentication/407, egress equality, and verified HTTPS to `x.com/robots.txt` and a small `abs.twimg.com` favicon. It reads no X session or cache and does not call the authenticated API. A denial/challenge or non-success HTTP status fails the probe. Successful connectivity does not establish account authorization.

For authenticated reads, supply your existing private `X_STORAGE_STATE_JSON` and preserve normal `Viewer` identity verification. The wrapper passes a temporary `X_PROXY` only to the X collector, covering API and required asset requests; it never replaces ambient AWS/S3 proxy/CA settings or falls back to direct X after tunnel loss. Cookies stay in the client and remain scoped to X, including when assets are fetched. Account selection works as `bash tools/x/run.sh --account ID bridge -- refresh --resume`, or `bridge -- --account ID refresh --resume`.

Cache-only search/list, offline reads, and S3 sync keep their ordinary commands; `--offline bridge` is rejected before AWS access. Use one session at a time because Lambda concurrency remains one. The collector owns its local workflow lock and preserves page checkpoints if a bounded session expires. Resume an incomplete scan in a new session.

Local X-extension validation passed 78 YouTube/shared-bridge tests, 26 X tests, and 18 server tests in the Lambda image. A full local chain using the actual client relay, a synthetic managed TCP proxy, and the new production GOST build returned HTTP 200 with origin TLS verification for both X probe resources and the two YouTube URLs. Separate deployed local tailnet acceptance passed authentication/destination denial, matched egress, all four origin checks, and shutdown.

The X-enabled server `98ba4d0` was deployed on 2026-11-17. The existing Cloud task at client `21aa8e8` then passed one 180-second unsigned probe in the outer executor through its built-in VPN: invocation accepted, `connect-v2` ready, private TCP/407, matched egress, both X resources 200, exit 0. The local coordinator independently confirmed that same session as `stopped` / `StopRequested` with its exact Lambda peer offline. The scoped Cloud role cannot Scan the table; no new permission was granted for diagnostics. No account session, collection, history API, or S3 cache was accessed, and no snapshot containing probe evidence was published.

Authenticated X account/API reads remain separately unverified. Install `bash tools/x/setup.sh` when a new task's snapshot lacks the X virtual environment; existing YouTube-only installation scripts do not install X dependencies automatically. Keep credentials private and use normal Viewer verification for collection. A successful unsigned probe establishes the network route, not account acceptance.
