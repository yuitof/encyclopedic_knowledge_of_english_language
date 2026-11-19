# Cloudflare Workers client

The opt-in `workers` command exercises the [fixed-video comparison API](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/blob/service-bridge-workers/infra/service-bridge-workers/API.md#fixed-video-comparison-relay). The command sends requests to the Cloudflare Access-protected Worker over HTTPS. The Worker sends YouTube traffic through Gateway. The existing `bridge`, `refresh`, `search`, and S3 workflows continue to use their current configuration. The published comparison API supports the single public video `aircAruvnKk`. It does not cover authenticated history, arbitrary video IDs, X, Reddit, or ordinary phrase collection.

The Worker operator needs to enable the HTTPS route and `COMPARISON_ENABLED` behind the dedicated Access policy during the test. The comparison route is disabled by default.

## Prepare the client

Use the existing YouTube setup on the Mac or in the published Cloud checkout.

```bash
bash tools/youtube/setup.sh
export SERVICE_BRIDGE_WORKER_URL=https://service-bridge-workers.english-vault-bridge.workers.dev
```

Both environments pass the values of `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` unchanged in the HTTP headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`.

- **Mac**. Supply the actual dedicated Access service-token values privately. In a local terminal, the two values can be loaded from the private Terraform state without printing them. Substitute the path to the private state file if different.

  ```bash
  worker_project=/Users/owner/english-vault-service-bridge-workers/infra/service-bridge-workers
  worker_state="$worker_project/../../.codex/tmp/workers-acceptance/terraform.tfstate"
  CF_ACCESS_CLIENT_ID="$(terraform -chdir="$worker_project/terraform" output -state="$worker_state" -raw service_token_client_id)"
  CF_ACCESS_CLIENT_SECRET="$(terraform -chdir="$worker_project/terraform" output -state="$worker_state" -raw service_token_client_secret)"
  export CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
  ```

- **Codex Cloud**. Check out a revision of `vault` that includes this client. In the published environment, use environment-owned HTTP secrets named `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` and bind both to the exact Worker hostname. Set `SERVICE_BRIDGE_WORKER_URL` as an ordinary environment variable or export it in the task. The Cloud proxy substitutes the stored credential values for the placeholders on requests to the authorized hostname. Preserve the configured HTTPS proxy and its CA settings. Publish any environment configuration changes and start a fresh Cloud task. [Codex Cloud network secrets](https://learn.chatgpt.com/docs/environments/cloud-environments#configure-environment-variables-and-network-secrets)

## Run the acceptance commands

In Codex Cloud, run these from the environment's outer executor.

```bash
bash tools/youtube/run.sh workers probe
bash tools/youtube/run.sh workers captions
```

The probe checks the Worker version marker and requests a public IP observation over Gateway. The caption test starts with an empty YouTube cookie jar and requests the watch page, InnerTube player, and caption track. It reports the verified segment count with no transcript output or cache write. Run either command only while the test route is enabled.

## Acceptance status

The Mac test of this client against Worker server revision `bc6a9f1` verified that missing and invalid credentials return HTTP 403 and the valid token reaches the Worker. The Gateway egress probe succeeded and the caption command retrieved 286 manual English segments. The test route was disabled afterward. The new client still needs a run in the published Codex Cloud environment.

## Interpret failures

| Diagnostic | Meaning |
| --- | --- |
| HTTPS proxy connection failed before the Worker responded | Check the Cloud HTTPS proxy and the allowed hostname. A rejected CONNECT never reaches Cloudflare Access. |
| HTTPS certificate verification failed | Try the unsigned HTTPS check below. Compare the Cloud runtime CA with the bundle used by Requests. |
| HTTP 401, 403 or redirect before the Worker ran | Check Access and secret delivery. A key can be present in Cloud while substitution or the saved credential still fails. A direct Mac test verifies the actual token separately. |
| Access verified, then Gateway IP probe failed | The Worker handler was reached. Check the comparison switch and Gateway binding. |
| YouTube HTTP status or caption error | Access already accepted the request. The failure is at the indicated upstream stage or during caption validation. |

The client sends neither YouTube account credentials nor Access secrets in the YouTube request envelope. It does not fall back to direct YouTube requests. Cloud acceptance remains separate from Mac acceptance. The most recent Cloud test of the earlier standalone harness reached Cloudflare but received HTTP 403 with the configured HTTP secrets. The new client uses the same documented HTTP headers and cannot guarantee successful secret substitution.

### Check a TLS failure in Codex Cloud

From the same executor, send an unsigned request with the configured proxy and certificate verification:

```bash
curl -sS --max-time 15 -o /dev/null \
  -w 'CONNECT=%{http_connect} HTTP=%{http_code}\n' \
  "${SERVICE_BRIDGE_WORKER_URL%/}/v1/health"
```

A successful CONNECT followed by HTTP 403 means the unsigned request reached Access over HTTPS. If curl reaches Access but an older client fails certificate verification, set `REQUESTS_CA_BUNDLE` for the command to the trusted bundle that curl uses. On Linux, if that bundle is `/etc/ssl/certs/ca-certificates.crt`:

```bash
REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt bash tools/youtube/run.sh workers probe
```

The client honors `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE`, then uses `SSL_CERT_FILE` or the Linux system CA bundle when available. Keep TLS verification enabled.
