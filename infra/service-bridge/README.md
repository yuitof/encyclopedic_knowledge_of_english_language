# Service bridge — Lambda server

The `service-bridge` branch owns the Lambda server. The previous source branch is retained as `archive/service-bridge`. The Cloud client lives on the repository's `vault` branch under `tools/youtube/`; deploy and update them separately. The worker image builds entirely from this directory and contains no collector code, history, transcripts, YouTube credentials, or client enrollment key.

## Connection

```text
vault client → loopback CONNECT relay → proxy:8088 (built-in Cloud VPN)
             → Lambda Tailscale IP:8443 → authenticated CONNECT proxy → YouTube:443
```

Cloud uses its scoped AWS identity to create a DynamoDB session and invoke Lambda asynchronously. Lambda claims that session once, retrieves its own enrollment key from Secrets Manager, and starts a userspace Tailscale node with memory-only state. `tailscale serve --bg --tcp=8443` forwards private TCP connections to a loopback CONNECT proxy. No exit route, public function URL, API Gateway, SSH service, or Funnel is created.

The proxy accepts the session's bearer token, checking its SHA-256 hash from the session record. Only `youtube.com:443`, `www.youtube.com:443`, and `checkip.amazonaws.com:443` are permitted. DNS resolution happens on Lambda, and nonpublic answers are rejected. The proxy forwards opaque bytes; the Cloud HTTP client verifies YouTube's TLS certificate and retains its own YouTube session. Proxy credentials never reach the origin.

## Tailnet configuration

Allow the built-in Cloud VPN identity (`tag:cloud-codex`) to reach `tag:service-bridge` on `tcp:8443`. This replaces the old exit-node permission to `autogroup:internet`; this implementation needs neither exit-node auto-approval nor port 53 grants. Inspect existing additive grants before changing them, and preserve unrelated devices' access.

Use separate preauthorized, reusable, ephemeral tagged enrollment keys. Store the worker's raw key in Secrets Manager (`service-bridge/tailscale`); configure the Cloud key in the environment's built-in Tailscale VPN settings. Cloud application code never retrieves or exports that key. Rotate before expiry. Renaming an existing secret does not change the key's tags: the previously documented tag/key migration must still be verified in the tailnet console.

Tailscale Serve's raw [TCP forwarding](https://tailscale.com/docs/reference/tailscale-cli/serve#use-a-tcp-forwarder) exposes only the private service. Cloud's [documented TCP interface](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-tcp-services) uses HTTP CONNECT at `proxy:8088`. Reconfigure and republish the Cloud environment, then test from a fresh task after any VPN change.

## Deployment

Run on the `service-bridge` branch using an authorized deployment identity:

```bash
export EXIT_AUTH_SECRET_ARN='arn:aws:secretsmanager:us-west-1:ACCOUNT:secret:service-bridge/tailscale'
export CLOUD_RUNTIME_ROLE_NAME='english-vault-youtube-cache-runtime'
bash infra/service-bridge/deploy.sh
```

The existing `EXIT_AUTH_SECRET_ARN` parameter name is retained for deployment compatibility; it now enrolls a private service rather than an exit node. There is no `CLIENT_AUTH_SECRET_ARN` parameter. Deploying the updated template removes this stack's grant for the Cloud application's enrollment-secret access; it does not delete the secret or revoke its key.

The script builds from `infra/service-bridge/`, publishes an immutable ECR image, and deploys by digest. The allowlisted build context excludes private runtime files. The worker uses Lambda's default internet-enabled network; VPC deployment would require outbound internet connectivity.

| Resource | Name / setting |
| --- | --- |
| Worker stack / function | `service-bridge` |
| Image stack / repository | `service-bridge-images` / `service-bridge` |
| DynamoDB session table | `service-bridge-sessions` |
| Worker role / Cloud inline policy | `service-bridge-worker` / `service-bridge-client` |
| Region / image architecture | `us-west-1` / Linux amd64 |
| Memory / hard timeout | 1 GiB / 900 seconds |
| Maximum session / concurrency | 720 seconds including startup / one invocation |
| Async queue age / retries | 60 seconds / zero function-error retries |
| Logs / session retention | seven days / DynamoDB TTL after one day |

Lambda reads only its enrollment secret and session table. Cloud's bridge policy permits only this function's invocation and session-table operations, separately from its existing S3 cache policy. Customer-managed secret encryption keys require a scoped decrypt grant. Lambda bills the whole active session, including waiting; associated AWS and Tailscale resources may incur charges.

## Session contract: `connect-v1`

The two branches communicate through this contract, not shared Python imports:

- Cloud creates a random 32-hex `session_id`, `protocol: connect-v1`, `state: requested`, `proxy_token_hash` (SHA-256 of a random 64-hex token), `created_at`, `expires_at`, `purge_at`, and `stop_requested: false`. Timestamps are Unix seconds. The raw token remains in client memory.
- Cloud invokes the function with only `{"session_id": "..."}`. Lambda atomically claims an unexpired, uncanceled `requested` record of the supported protocol and records an invocation owner. Duplicate deliveries cannot claim it again.
- Lambda publishes `state: ready`, `node_id`, `ipv4` (its Tailscale IPv4), `proxy_port: 8443`, `egress_ip`, effective `expires_at`, and `heartbeat`. It refreshes the heartbeat every five seconds.
- Cloud rejects old protocol records, invalid endpoints, stopped/stale sessions, and a public egress-IP mismatch. It connects through the managed VPN, then authenticates the inner CONNECT with `Proxy-Authorization: Bearer <token>`.
- Cloud sets `stop_requested: true` on completion or interruption. Lambda closes the proxy and logs out on stop or deadline; its hard timeout bounds abrupt failures. Terminal states are `stopped` or `failed`, with fixed error categories. Session hashes and network metadata remain private runtime data.

## Validation status

The previous exit-node implementation was tested on 2026-11-17 using a separate Linux client. Cloud invoked it successfully but its manually launched daemon failed enrollment. The built-in Cloud VPN subsequently reported connected; a private SSH-port probe returned CONNECT 503. Those observations do not validate this new private CONNECT service.

The `connect-v1` server from commit `6237702` was deployed on 2026-11-17. CloudFormation completed successfully, and Lambda reported `Active` with `LastUpdateStatus: Successful` for image digest `sha256:c6d55c410b2de84b20b47bca3d35133cf824313859e19bea25dd06f759c9af29`. A synchronous empty-event smoke invocation loaded the handler and returned the expected `{"state": "rejected"}` without starting a session. The bridge client policy was checked and no longer grants Secrets Manager access.

Local acceptance passed on 2026-11-17 using the Mac's existing Tailscale connection. The worker joined with `tag:service-bridge`, and its exact node identity was confirmed online. Authenticated CONNECT requests through its private port 8443 preserved origin TLS verification, matched Lambda's public egress address, and returned HTTP 200 from both unsigned YouTube probe URLs (`/` and `/feed/history?hl=en`). Unauthenticated requests returned 407, and a disallowed destination returned 403. Cleanup reported `stopped` / `StopRequested`, and the temporary peer was confirmed disconnected. No YouTube authentication, history collection, or transcript retrieval was performed.

Access from the built-in Cloud VPN identity on `tcp:8443` and a successful `bridge -- probe` from a fresh `vault` Cloud task still require verification before history collection. The successful local test validates the deployed server and local Tailscale path; it does not validate Cloud's managed CONNECT transport. No history or transcript retrieval is needed for acceptance.

```bash
python -m unittest discover -s tests/service_bridge -v
bash -n infra/service-bridge/deploy.sh
aws cloudformation validate-template --region us-west-1 --template-body file://infra/service-bridge/template.yaml
docker build --platform linux/amd64 --provenance=false -f infra/service-bridge/Dockerfile -t service-bridge:test infra/service-bridge
```

To retire the service, stop active sessions, revoke its enrollment key, remove its dedicated tailnet grant and scoped Cloud policy, then remove the stack using the deployment identity. The table, logs, and image repository are retained for explicit review/removal. Do not revoke the Cloud environment's VPN identity if other private services depend on it.
