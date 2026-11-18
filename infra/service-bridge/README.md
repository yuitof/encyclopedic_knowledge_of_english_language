# Private Lambda CONNECT bridge

`service-bridge` contains the self-contained Lambda service, GOST proxy, Tailscale exposure, deployment infrastructure, and server tests. The `vault` branch owns the Cloud client, session orchestration, YouTube/X collectors, and S3 caches. Neither branch imports implementation code from the other. The earlier mixed branch remains under `archive/service-bridge`.

```text
YouTube or X HTTP client in vault
  → loopback HTTP CONNECT forwarder
  → proxy:8088 (Codex Cloud built-in Tailscale VPN)
  → Lambda Tailscale IPv4:8443
  → tailscale serve --tcp=8443 → loopback GOST
  → approved YouTube/X HTTPS:443
```

Cloud starts no Tailscale daemon and selects no exit node. Lambda runs its own userspace `tailscaled` with memory-only state. Serve exposes raw private TCP, without Funnel, a public proxy listener, Function URL, API Gateway, or SSH. This raw TCP path does not depend on Tailscale HTTPS certificates.

## Proxy selection and security

The data path uses [GOST 3.3.3](https://github.com/go-gost/gost/releases/tag/v3.3.3), pinned by container digest in the Dockerfile. Its [HTTP handler](https://gost.run/en/reference/handlers/http/) supplies CONNECT parsing and byte forwarding. The former Python CONNECT parser/relay is removed. A small Python loopback control service implements GOST's documented [authentication plugin](https://gost.run/en/concepts/auth/#http-plugin); it checks the session password against the existing SHA-256 hash. The raw password is never stored in DynamoDB, argv, or the generated configuration. GOST's license is included in the image.

GOST's service-level [destination whitelist](https://gost.run/en/concepts/bypass/#service-level-bypass) permits only `youtube.com:443`, `www.youtube.com:443`, `x.com:443`, `abs.twimg.com:443`, `old.reddit.com:443`, and `checkip.amazonaws.com:443`. The last is used only for egress verification. The YouTube hosts cover the existing collector's history/bootstrap, player, watch-page, and timedtext requests. X uses `x.com` for home/API reads and `abs.twimg.com` for its web-bundle/transaction assets. Reddit uses only Old Reddit HTML; no OAuth/API, asset or media hosts are needed. Media files are not downloaded. Requests to IP literals, internal names, metadata addresses, other ports, and unrelated domains are denied.

Before launch, Lambda resolves approved hosts to global IPv4 addresses and pins them in GOST's [host mapper](https://gost.run/en/concepts/hosts/). Any nonpublic or multicast answer aborts startup. A fail-closed resolver callback returns no addresses for host-map misses, preventing unchecked DNS fallback/rebinding. Pins last only for the bounded session; restart if an origin address stops working.

The client uses `Proxy-Authorization: Basic base64(bridge:<random-session-token>)` inside the private tunnel. GOST forwards opaque origin TLS bytes; origin certificates remain verified by the existing clients. No sniffing, MITM, traffic recording, UDP relay, or GOST management API is enabled. Daemon stdout/stderr are discarded, and worker failures use fixed categories. Temporary configuration is mode 0600 and removed on exit. Existing broader tailnet grants cannot bypass proxy authentication.

## Tailnet configuration

Use `tag:codex-cloud` for the built-in Cloud VPN and `tag:service-bridge` for Lambda. The minimal grant permits `tag:codex-cloud` → `tag:service-bridge` on `tcp:8443`. The [example policy fragment](tailscale-policy.example.json) is a merge reference, not a replacement for the existing policy. No exit-node advertisement, Internet grant, or port 53 grant is needed.

Review the actual current policy before editing it. Tailscale grants and ACLs are additive. Check all rules that can match this service, especially wildcard `src`/`dst`, `autogroup:member`, `autogroup:tagged`, personal identities/groups, destination tags, port ranges, and `*`/`tcp:*` grants. A narrow new rule does not cancel an existing broad rule. Use the policy editor's access tests to check the intended client/port and undesired client/port combinations. Record conflicting rules privately, and do not remove unrelated permissions to make the example appear exclusive.

The stale Cloud tag and its old Internet grant have been replaced in the live policy with `tag:codex-cloud` and the private TCP 8443 grant. Existing member/gateway grants, SSH rules, and other settings were preserved. Those broad member/gateway rules also permit reaching this private port; proxy authentication still applies. A new reusable, ephemeral key restricted to the new tag was saved in the private Cloud VPN setting. Existing devices and keys are not retagged by a policy edit; verify the new managed node after environment replacement. Lambda's existing service enrollment key remains unchanged. Keep enrollment keys private and rotate before expiry.

## AWS and deployment

Reuse the existing function, DynamoDB table, IAM roles, and Secrets Manager enrollment secret in `us-west-1`. Cloud's scoped OIDC role needs this function's `lambda:InvokeFunction` and the session table's `PutItem`, `GetItem`, and `UpdateItem`. It needs no enrollment-secret access. The separate S3 cache policy is unchanged. Lambda reads only its own enrollment secret and session table, plus operational log writes. Customer-managed secret KMS encryption requires an existing scoped decrypt grant.

```bash
export EXIT_AUTH_SECRET_ARN='arn:aws:secretsmanager:us-west-1:ACCOUNT:secret:service-bridge/tailscale'
export CLOUD_RUNTIME_ROLE_NAME='english-vault-youtube-cache-runtime'
bash infra/service-bridge/deploy.sh
```

`EXIT_AUTH_SECRET_ARN` is retained as a deployment-compatible parameter name; this key now enrolls a private service, not an exit node. Deployment builds only this directory, pushes an immutable ECR image, and deploys by digest. No runtime `vault` checkout is needed. The allowlisted Docker context excludes private runtime files. Lambda uses its default outbound-internet network; VPC placement would require outbound connectivity.

| Resource / limit | Value |
| --- | --- |
| Function / worker stack | `service-bridge` |
| Image stack / ECR repository | `service-bridge-images` / `service-bridge` |
| Session table | `service-bridge-sessions` |
| Worker role / Cloud client policy | `service-bridge-worker` / `service-bridge-client` |
| Region / architecture / memory | `us-west-1` / Linux amd64 / 1 GiB |
| Lambda timeout / reserved concurrency | 900 seconds / one invocation |
| Session duration | 120–720 seconds, including startup |
| Async queue age / function-error retries | 60 seconds / zero |
| Heartbeat / stale threshold | five seconds / twenty seconds |
| Operational logs / session TTL | seven days / one day |

Lambda bills the active invocation, including waiting; normal completion requests shutdown early. A lost client remains bounded by the session deadline and the Lambda limit. No new AWS privileges are needed for GOST.

## Session contract: `connect-v2`

- Cloud creates a random 32-hex `session_id`, `protocol: connect-v2`, `state: requested`, a `proxy_token_hash` of a random 64-hex token, Unix-second `created_at`/`expires_at`/`purge_at`, and `stop_requested: false`. Only the client retains the raw token.
- Cloud invokes Lambda asynchronously with only `{"session_id":"..."}`. Lambda atomically claims an unexpired, uncanceled `requested` record of this protocol, recording the invocation owner. Duplicate delivery and stale/old-protocol requests cannot claim it again.
- Lambda starts Tailscale, the authentication/resolver control callbacks, and GOST. It checks GOST readiness before exposing the port and publishing `state: ready`, `node_id`, `ipv4`, `proxy_port: 8443`, `egress_ip`, the effective expiry, and a heartbeat.
- Cloud validates this endpoint and session. The unsigned probe first checks that the private endpoint returns 407 without credentials, independently proving managed private TCP reachability and authentication enforcement. It then verifies authenticated CONNECT, origin TLS, the public egress address, and unsigned YouTube responses.
- The collector uses explicit loopback proxy settings; AWS/S3 use their existing Cloud connection. A stale/stopped/near-expiry session or observed transport failure terminates collection without fallback to an ambient proxy or private Cloud daemon.
- Cloud requests stop on completion/interruption. Lambda closes GOST, removes temporary configuration, logs out its ephemeral node, and publishes `stopped` or `failed`. The worker checks daemon health and expiry throughout its loop, retaining a sixty-second margin before Lambda's hard timeout. Abrupt termination relies on ephemeral-node cleanup.

`connect-v1` used the custom proxy's Bearer authentication and is intentionally rejected. Update both branches together. The collector and cache formats do not change.

## Verification and current limits

Before this redesign, a fresh local test of the deployed userspace Serve endpoint passed registration, private CONNECT, egress equality, unsigned YouTube HTTPS, denial, and cleanup. A separate GOST container prototype also passed authentication, exact host/port restrictions, metadata-address rejection, and verified HTTPS to both unsigned YouTube probe URLs.

The automated suite includes real GOST integration inside the Lambda image with networking disabled, a read-only root filesystem, and UID 1000. It tests authentication, host/port restrictions, DNS fallback, process failure, expiry, opaque forwarding, and active-connection shutdown. Host-side tests explicitly skip GOST tests when its Linux binary is unavailable; container tests must not skip them.

```bash
python -m unittest discover -s tests/service_bridge -v
bash -n infra/service-bridge/deploy.sh
aws cloudformation validate-template --region us-west-1 --template-body file://infra/service-bridge/template.yaml
docker build --platform linux/amd64 --provenance=false -f infra/service-bridge/Dockerfile -t service-bridge:test infra/service-bridge
docker run --rm --platform linux/amd64 --network none --read-only --tmpfs /tmp:rw,mode=1777 --user 1000:1000 --entrypoint python --mount type=bind,source="$PWD/tests/service_bridge",target=/validation/tests/service_bridge,readonly service-bridge:test -m unittest discover -s /validation/tests/service_bridge -v
```

A connected Cloud VPN, successful Lambda invocation, local tailnet test, or synthetic managed-proxy test is not proof of the live Cloud path. Run `bash tools/youtube/run.sh bridge -- probe` in the outer executor of a fresh `vault` Cloud task with the configured built-in VPN and scoped AWS OIDC identity. The raw `proxy:8088` listener and the client's loopback relay must be reachable in that executor's network namespace. Keep actual tailnet-policy review, client-tag migration, managed private TCP reachability, and full proxy/YouTube acceptance as separate checks. No account authentication or history collection is needed for this probe.

The GOST revision was deployed on 2026-11-17 from server commit `f7a3431`, with `connect-v2` client commit `807339d`. AWS reports the function Active with a successful update and image digest `sha256:20c1e318920d6f243e57ef0f619c52ff566b1a8772b0f2c669ece83750e12fa7`. CloudFormation completed and the Function URL absence was checked.

Local tailnet acceptance of the deployed GOST version passed: exact Lambda peer online with `tag:service-bridge`, 407 without authentication, 403 for a disallowed destination, matched public egress, and HTTP 200 from both unsigned YouTube URLs with origin certificate verification enabled. Stop was acknowledged and the peer disconnected. A separate live expired-session invocation returned `ignored` without claiming the record or starting a node. A separate full-chain test using the actual `vault` forwarder, a synthetic `proxy:8088` endpoint, and the production GOST supervisor also passed verified origin HTTPS. This is a local component test, not live Cloud acceptance.

All 17 server tests passed inside the read-only, network-disabled Lambda image as UID 1000; all 74 YouTube-client tests and 20 X tests passed locally. No account history, transcripts, or cookies were accessed for verification.

The actual live tailnet policy was inspected. Its member/gateway wildcard access conflicts with claiming Cloud-only port access and was preserved as requested. The stale Cloud identity/Internet rule was replaced by the requested identity and TCP service grant. The private Cloud environment was published with the replacement VPN key, bridge function/table variables, and client-only setup. A live preflight confirmed managed Tailscale Running, routing ready, reachable `proxy:8088`, and no local tailscaled process.

Live built-in Cloud VPN acceptance passed on 2026-11-17 in the refreshed environment's outer executor, using a clean `vault` checkout at `807339d` and a 180-second session. Lambda invocation was accepted; `connect-v2` became ready; the private endpoint returned 407 without credentials; authenticated egress matched Lambda; both unsigned YouTube URLs returned 200 with origin TLS verification; and the probe exited 0. The new managed client tag was observed in the tailnet. A separate consistent DynamoDB read confirmed that same latest session reached `stopped` / `StopRequested`, and its Lambda peer was offline. No snapshot containing probe evidence was published.

The live Cloud probe exercised unauthenticated rejection, but did not enroll an unauthorized tailnet identity to test policy denial. Local deployed acceptance and automated GOST tests covered disallowed destinations/ports, including metadata addresses. Existing broad member/gateway grants remain a documented permission limitation; proxy session authentication is still enforced. No core connectivity blocker remains. Keep the private VPN enrollment key rotated before its configured expiry.

## X extension

The X extension adds only the two exact HTTPS destinations above. It keeps `connect-v2`, the existing function/table/IAM roles, and the private TCP 8443 grant. The shared client implementation lives in `vault` under `tools/cloud_bridge/`; Lambda imports none of it. No server-side account cookies or new public endpoints are needed.

From the Cloud outer executor on the matching `vault` revision, run `bash tools/x/run.sh bridge -- probe` for unsigned checks of `x.com/robots.txt` and a small `abs.twimg.com` favicon. The client verifies Lambda readiness, private proxy authentication, egress equality, and origin TLS before returning the two HTTP statuses. HTTP denial/challenges remain failures; unsigned success does not establish X account/API authorization. Then use `bridge -- refresh`, `bridge -- get POST_ID`, or `bridge -- folders --refresh` for an authorized account workflow. Cache-only search/list and S3 sync retain their existing path.

Local validation for this extension: all 18 server tests passed in the network-disabled, read-only Lambda image, and the image built successfully. The matching client passed 78 YouTube/shared-bridge tests and 26 X tests. A local full-chain component test using the actual client relay, a synthetic managed TCP proxy, and this GOST build returned verified HTTPS 200 for both X probe resources, checkip, and both unsigned YouTube URLs.

The X extension was deployed on 2026-11-17 from server commit `98ba4d0`, paired with client commit `21aa8e8`. CloudFormation completed; Lambda reports Active / successful update with digest `sha256:8912036dfe0817ccf056e57667be7d8083650dc1fdc9f83c9bc42c9e2cdb7a0e`. Function URL absence was checked again. The existing IAM roles, session table, and Tailscale grant were reused.

Deployed local tailnet acceptance passed: matching service peer online, unauthenticated 407, disallowed destination 403, matched egress, and verified HTTPS 200 for both X resources and both YouTube URLs. Shutdown reached `stopped` / `StopRequested`.

Live built-in Cloud VPN acceptance also passed on 2026-11-17 from the existing refreshed task's outer executor at client `21aa8e8`, using a 180-second session. The client accepted invocation, observed `connect-v2` readiness and private TCP/407, verified egress equality, received 200 from `x.com/robots.txt` and the `abs.twimg.com` favicon, and exited 0. The local coordinator independently confirmed the same session through consistent GetItem and observed its exact Lambda peer offline. The Cloud role intentionally has no table Scan permission; do not expand IAM to discover sessions for diagnostics. No X/YouTube session, account data, history API, collection, or S3 cache was accessed by this acceptance, and no snapshot containing probe evidence was published.

X's authenticated website API and account authorization were not exercised by the unsigned probe. Supply the private X session and run the separately authorized collector to establish that behavior; challenge or API-denial responses must remain visible. New Cloud tasks need `bash tools/x/setup.sh` if their snapshot has only the YouTube environment installed. Existing legacy `YOUTUBE_BRIDGE_*` variables work for either client, so no configuration migration is required.

## Reddit extension

The Reddit collector on `vault` uses cookie-authenticated Old Reddit HTML. This server extension adds only `old.reddit.com:443` to the destination allowlist and DNS pins. `reddit.com`, `www.reddit.com`, `oauth.reddit.com`, asset/media hosts, other ports and lookalike domains remain denied. The existing session protocol, authentication, TLS tunneling, bounded lifetime and cleanup are unchanged. Account cookies remain in the collector.

The Lambda image built successfully and all 18 server tests passed inside it with external networking disabled, a read-only filesystem and UID 1000. The real GOST tests include opaque forwarding for the new host and denial of the other Reddit destinations. These are local component checks, not live origin or Cloud acceptance.

The extension was deployed on 2026-11-18 from `cd00fa2`, with image digest `sha256:4736921516d9bd2db09b1e0577fe47678214148da860edc16b699870af56988e`. CloudFormation is UPDATE_COMPLETE and Lambda is Active / Successful. No enrollment secret value, existing session permissions, or public exposure changed.

Local acceptance using the Mac's existing tailnet verified private 407, matching egress and origin TLS, but unsigned Old Reddit returned HTTP 403. A separate user-authorized local cookie check through the same route also returned origin HTTP 403; no account identity or source content was collected. This is an origin rejection, not proof of expired credentials.

A real built-in Cloud VPN probe at client `aeb8ce2` passed invocation, `connect-v2` readiness, private 407 and egress equality, then failed the client's bridge health check before it emitted an origin status. The client now confines normal post-CONNECT disconnects to their own tunnel; that possible false-health-failure correction has local regression coverage but could not be retested in Cloud because the account hit its usage limit. Cloud origin acceptance remains unverified. The local coordinator confirmed all acceptance sessions stopped with `StopRequested` and their Lambda peers offline. No Cloud cookies, account collection or published snapshot were used.

## Cloudflare egress feasibility

A separate AWS Lambda ran the official WARP client and enrolled a Cloudflare Zero Trust device on 2026-11-18. The tunnel and proxied HTTPS acceptance gate did not pass. See the [feasibility report, probe and persistent gateway assessment](experiments/warp/README.md).
