# Cloud client — built-in Tailscale VPN

Use the `vault` branch for Cloud tasks. Lambda's self-contained server and deployment templates live on the separate [`service-bridge` branch](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/tree/service-bridge/infra/service-bridge). The client does not import server code, install or launch Tailscale, read enrollment secrets, or select an exit node.

The client reaches Lambda's private CONNECT proxy through Codex Cloud's built-in VPN. Its [documented TCP transport](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-tcp-services) is HTTP CONNECT at `proxy:8088`; it is separate from the ambient HTTPS proxy. A small loopback relay chains the collector's HTTPS tunnels through that endpoint to the Lambda Tailscale IP on port 8443. No direct-network fallback is implemented. AWS and S3 keep their existing Cloud connection path.

## Setup

1. Deploy the matching `connect-v1` server from the `service-bridge` branch. It publishes private session readiness in DynamoDB.
2. Configure the environment's built-in Tailscale VPN with a reusable, ephemeral key carrying `tag:cloud-codex`. Keep this credential in the private VPN settings, outside application variables and files. Permit this identity to reach `tag:service-bridge` on `tcp:8443`. The old exit-node/Internet/DNS grants are not required by this client.
3. Set `YOUTUBE_BRIDGE_FUNCTION` to the stack's `FunctionArn` and `YOUTUBE_BRIDGE_TABLE` to `SessionTableName`. The old `YOUTUBE_EXIT_*` names are replaced; `YOUTUBE_TAILSCALE_AUTH_SECRET_ARN` is no longer read. Remove `setup-tailscale.sh` and manual daemon startup from any environment setup instructions. Install only `bash tools/youtube/setup.sh` for this workflow.
4. Attach the existing scoped AWS identity with permission to invoke that function and create/read/update that session table. Allow `lambda.us-west-1.amazonaws.com` and `dynamodb.us-west-1.amazonaws.com` on the ordinary Cloud network, preserving existing S3/dictionary destinations. Client application access to Secrets Manager and Tailscale enrollment/control hosts is no longer needed for this bridge; preserve any permissions needed by other workflows.
5. Save and republish the environment, then use a fresh task on `vault`. A connected VPN status alone does not establish private service reachability.

## Acceptance and use

Start with an unsigned probe, which reads no YouTube credentials or history/cache:

```bash
bash tools/youtube/run.sh bridge -- probe
```

The client creates a bounded DynamoDB session, invokes Lambda, and waits for `connect-v1` readiness. A random bearer token stays in client memory; only its SHA-256 hash goes into the session record. The client checks the private endpoint, opens the built-in VPN tunnel, authenticates to Lambda's proxy, and checks the public IP against Lambda's own observation before contacting YouTube. Certificate verification remains enabled end to end. The server permits only YouTube and the public-IP check on HTTPS.

A successful probe reports `bridge: verified` and successful statuses for both unsigned YouTube URLs. An egress-address mismatch stops startup; AWS egress changes may cause a conservative false negative. A proxy CONNECT error can indicate a disconnected VPN, a missing tailnet port grant, an unreachable service, or a protocol/deployment mismatch. Do not fall back to a private daemon.

After acceptance, run the usual authorized workflow:

```bash
bash tools/youtube/run.sh bridge -- refresh
bash tools/youtube/run.sh bridge -- search 'PHRASE' --day yesterday --fetch
```

One wrapper runs one command. Optional `--session-seconds` (120–720, default 720) and `--ready-timeout` (10–120, default 60) precede `--`. The session includes startup time. The client terminates collection on stale heartbeat, session stop/expiry, or observed tunnel failure, and requests worker shutdown in cleanup. Network loss cannot switch the collector to an ambient proxy. The existing collector preserves completed atomic checkpoints; retry an incomplete command in a new session. Concurrent commands against the same local history cache remain unsupported.

The session wire contract is documented in the server README. The client recognizes only `connect-v1`, so it will reject readiness from the previous exit-node implementation. That previous implementation's Linux acceptance and the existing built-in VPN's connected status do not validate the new path. Deploy the new server, apply the private-service grant, and run this probe from a fresh Cloud task before collecting history.
