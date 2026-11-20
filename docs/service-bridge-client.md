# Cloud client — built-in Tailscale VPN

> **Deprecated:** The Lambda `service-bridge` `bridge` transport is retained only for reference and emergency fallback. Every invocation prints a deprecation warning and directs collectors to the Cloudflare Workers `workers` transport. The current Codex Cloud environment does not provide the Lambda function/table settings, so new tasks fail closed before AWS.

Use the `vault` branch for Cloud tasks. Lambda's self-contained server and deployment templates live on the separate [`service-bridge` branch](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/tree/service-bridge/infra/service-bridge). The client does not import server code, install or launch Tailscale, read enrollment secrets, or select an exit node.

Run the whole wrapper command in the Cloud **outer executor** (using the command tool's approved outer-execution path where required). The raw `proxy:8088` listener is not reachable directly from a separate inner command sandbox, and loopback relays/collector processes must share the same network namespace. Keep the inherited AWS proxy/CA configuration.

The client reaches Lambda's private CONNECT proxy through Codex Cloud's built-in VPN. Its [documented TCP transport](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-tcp-services) is HTTP CONNECT at `proxy:8088`; it is separate from the ambient HTTPS proxy. A small loopback relay chains the collector's HTTPS tunnels through that endpoint to the Lambda Tailscale IP on port 8443. No direct-network fallback is implemented. AWS and S3 keep their existing Cloud connection path.

## Setup

1. Deploy the matching `connect-v2` server from the `service-bridge` branch. It publishes private session readiness in DynamoDB.
2. Configure the environment's built-in Tailscale VPN with a reusable, ephemeral key carrying `tag:codex-cloud`. Keep this credential in the private VPN settings, outside application variables and files. Permit this identity to reach `tag:service-bridge` on `tcp:8443`. The old exit-node/Internet/DNS grants are not required by this client.
3. Set `SERVICE_BRIDGE_FUNCTION=service-bridge` and `SERVICE_BRIDGE_TABLE=service-bridge-sessions` (or the matching stack's function ARN and table outputs). Migrate existing `YOUTUBE_BRIDGE_FUNCTION` and `YOUTUBE_BRIDGE_TABLE` settings to the shared names. The client reads each legacy alias only when its shared counterpart is absent and prints a deprecation warning. Run the setup script for each collector you use. The shared bridge also replaces the old `YOUTUBE_EXIT_*` settings and no longer reads `YOUTUBE_TAILSCALE_AUTH_SECRET_ARN`. Remove `setup-tailscale.sh` and manual daemon startup from environment setup instructions.
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

The X extension requires deployment of the matching server destination list. The previous YouTube-only image rejects X. It uses the shared `SERVICE_BRIDGE_*` settings, `connect-v2` protocol, AWS invocation and session permissions, built-in VPN identity, and private TCP 8443 grant.

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

## Reddit through the same bridge

The [Reddit collector](reddit.md) adds `bridge -- probe`, `bridge -- refresh`, and `bridge -- get PERMALINK` to the shared client. It uses the same function/table variables, bounded `connect-v2` lifecycle, AWS permissions and built-in VPN. The wrapper sets a temporary `REDDIT_PROXY` only for the child; AWS/S3 retain their ordinary route. Cookies remain in the collector, and redirects, TLS failures and tunnel loss cannot trigger direct fallback.

The matching server on `service-bridge` adds only `old.reddit.com:443`, with public DNS pinning and existing authentication/denial checks. It must be deployed separately: the earlier X/YouTube image does not permit Reddit. The Reddit extension was deployed on 2026-11-18 from `cd00fa2`. Local tailnet checks verified private authentication, matching egress and origin TLS, but Reddit returned HTTP 403 both unsigned and with the authorized local session. Authenticated HTML parsing remains unverified. The Reddit CLI also supports explicit `bridge --local` for an existing local tailnet route; Cloud must keep its default built-in VPN transport.

In the Cloud outer executor, run `bash tools/reddit/run.sh bridge -- probe` before authenticated operations in each new task. It checks Old Reddit over verified HTTPS without cookies/cache and does not follow redirects. A login redirect proves only transport; an HTTP 403/429 fails acceptance. A CONNECT denial before origin TLS is a route/deployment failure. Do not attempt direct HTTP or browser fallback. Then separately supply `REDDIT_STORAGE_STATE_JSON` and use the authorized collector; `--account USERNAME` can enforce the expected account. See the collector guide for cache-only/offline commands and resume semantics.

On 2026-11-18 the real Cloud outer-executor probe at `aeb8ce2` passed Lambda invocation/readiness, private 407 and matching egress, then exited 1 at the bridge health check without emitting an origin status. The active STS role was `english-vault-cloud-runtime`. The relay now avoids marking an established bridge unhealthy for normal post-CONNECT client disconnects, with regression tests for both late disconnect and pre-CONNECT failure. Cloud's account usage limit prevented testing that correction there. Local unsigned and authorized-session requests reached Reddit but returned origin HTTP 403. All acceptance sessions were independently confirmed stopped with their Lambda peers offline. See the measured results in [the Reddit guide](reddit.md); this is not successful Cloud Reddit acceptance.

The subsequent explicitly authorized Mac fix uses `run.sh --browser-local refresh` with standard installed Chrome, a separate ignored profile and the existing cookie export. It verified identity, refreshed the default feeds, uploaded validated source snapshots and passed offline/fresh-S3-restoration checks. It does not use Lambda or claim Cloud route acceptance. Local browser/direct options cannot be combined with the bridge. The wrapper also accepts the read-only `verify` diagnostic for supported proxied use.

The corrected-client Cloud retest on 2026-11-18 reached Reddit using `df1d4e8`: invocation accepted, `connect-v2` ready, private 407 enforced, egress matched and origin TLS verified. Reddit returned HTTP 403 and the probe exited 1. Exact-session GetItem confirmed `stopped` / `StopRequested`. All 80 shared/YouTube and 47 Reddit tests passed in Cloud. This supersedes the earlier unverified transport status; authenticated Reddit reads were not attempted. An earlier same-task connection failure before private 407 remains unexplained. The new client reports safe connection-failure stages without request values or automatic fallback.

The independent S3 validation-manifest request was denied by the Cloud proxy before AWS because the Reddit bucket's exact regional S3 hostname was missing from startup and live allowed rules. Preserve existing rules and add only that bucket hostname when authorizing a configuration correction; Cloud S3 access is not yet accepted. Neither the VPN route nor Reddit cookies can fix the S3 hostname denial. See [the Reddit guide](reddit.md) for measured scope.
