# Private Lambda CONNECT bridge

`service-bridge` contains the self-contained Lambda service, GOST proxy, Tailscale exposure, deployment infrastructure, and server tests. The `vault` branch owns the Cloud client, session orchestration, YouTube/X collectors, and S3 caches. Neither branch imports implementation code from the other. The earlier mixed branch remains under `archive/service-bridge`.

```text
YouTube HTTP client in vault
  → loopback HTTP CONNECT forwarder
  → proxy:8088 (Codex Cloud built-in Tailscale VPN)
  → Lambda Tailscale IPv4:8443
  → tailscale serve --tcp=8443 → loopback GOST
  → YouTube HTTPS:443
```

Cloud starts no Tailscale daemon and selects no exit node. Lambda runs its own userspace `tailscaled` with memory-only state. Serve exposes raw private TCP, without Funnel, a public proxy listener, Function URL, API Gateway, or SSH. This raw TCP path does not depend on Tailscale HTTPS certificates.

## Proxy selection and security

The data path uses [GOST 3.3.3](https://github.com/go-gost/gost/releases/tag/v3.3.3), pinned by container digest in the Dockerfile. Its [HTTP handler](https://gost.run/en/reference/handlers/http/) supplies CONNECT parsing and byte forwarding. The former Python CONNECT parser/relay is removed. A small Python loopback control service implements GOST's documented [authentication plugin](https://gost.run/en/concepts/auth/#http-plugin); it checks the session password against the existing SHA-256 hash. The raw password is never stored in DynamoDB, argv, or the generated configuration. GOST's license is included in the image.

GOST's service-level [destination whitelist](https://gost.run/en/concepts/bypass/#service-level-bypass) permits only `youtube.com:443`, `www.youtube.com:443`, and `checkip.amazonaws.com:443`. The last is used only for egress verification. These cover the existing collector's history/bootstrap, player, watch-page, and timedtext requests; no video-media CDN access is needed. Requests to IP literals, internal names, metadata addresses, other ports, and unrelated domains are denied.

Before launch, Lambda resolves approved hosts to global IPv4 addresses and pins them in GOST's [host mapper](https://gost.run/en/concepts/hosts/). Any nonpublic or multicast answer aborts startup. A fail-closed resolver callback returns no addresses for host-map misses, preventing unchecked DNS fallback/rebinding. Pins last only for the bounded session; restart if an origin address stops working.

The client uses `Proxy-Authorization: Basic base64(bridge:<random-session-token>)` inside the private tunnel. GOST forwards opaque origin TLS bytes; YouTube certificates remain verified by the existing client. No sniffing, MITM, traffic recording, UDP relay, or GOST management API is enabled. Daemon stdout/stderr are discarded, and worker failures use fixed categories. Temporary configuration is mode 0600 and removed on exit. Existing broader tailnet grants cannot bypass proxy authentication.

## Tailnet configuration

Use `tag:codex-cloud` for the built-in Cloud VPN and `tag:service-bridge` for Lambda. The minimal grant permits `tag:codex-cloud` → `tag:service-bridge` on `tcp:8443`. The [example policy fragment](tailscale-policy.example.json) is a merge reference, not a replacement for the existing policy. No exit-node advertisement, Internet grant, or port 53 grant is needed.

Review the actual current policy before editing it. Tailscale grants and ACLs are additive. Check all rules that can match this service, especially wildcard `src`/`dst`, `autogroup:member`, `autogroup:tagged`, personal identities/groups, destination tags, port ranges, and `*`/`tcp:*` grants. A narrow new rule does not cancel an existing broad rule. Use the policy editor's access tests to check the intended client/port and undesired client/port combinations. Record conflicting rules privately, and do not remove unrelated permissions to make the example appear exclusive.

Earlier environments used `tag:cloud-codex` (and older deployments used `tag:youtube-client`). Renaming source text does not retag an existing auth key or device. Configure the built-in VPN with a reusable, ephemeral key carrying `tag:codex-cloud`, and verify the resulting managed node's tag after publishing/replacing the environment. Lambda's existing `tag:service-bridge` enrollment secret can be reused. Keep enrollment keys private; Cloud application code never reads the VPN key. Rotate keys before expiry.

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

A connected Cloud VPN, successful Lambda invocation, local tailnet test, or synthetic managed-proxy test is not proof of the live Cloud path. Run `bash tools/youtube/run.sh bridge -- probe` in a fresh `vault` Cloud task with the configured built-in VPN and scoped AWS OIDC identity. Keep actual tailnet-policy review, client-tag migration, managed private TCP reachability, and full proxy/YouTube acceptance as separate checks. No account authentication or history collection is needed for this probe.

Deployment and live results for this revision will be recorded after verification. Until then, live Cloud acceptance and actual-policy review remain unverified.
