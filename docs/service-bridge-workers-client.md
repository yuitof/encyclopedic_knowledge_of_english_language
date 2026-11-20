# Cloudflare Workers client

The explicit `workers` commands send supported collector traffic to the [Cloudflare Access-protected Worker](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/blob/service-bridge-workers/infra/service-bridge-workers/API.md). The Worker forwards each request through its Workers VPC Network and Cloudflare Gateway binding. The existing Lambda `bridge` commands remain available as the fallback and retain their previous behavior.

| Collector | Workers commands | Current scope |
| --- | --- | --- |
| YouTube | `workers probe`, `workers captions VIDEO_ID` | Signed-out manual English captions with automatic English fallback. Authenticated history remains on Lambda `bridge`. |
| X | `workers -- probe`, `refresh`, `get`, `folders --refresh` | Fixed, read-only X home, GraphQL, and asset operations. |
| Reddit | `workers -- probe`, `refresh`, `verify`, `get` | Fixed, read-only Old Reddit identity, listing, and comments operations. |

The Workers client does not create a Lambda session, call AWS Lambda or DynamoDB, use Tailscale, or import server implementation code. It does not fall back to direct origin requests, ordinary Workers egress, or Lambda. X and Reddit S3 caches remain application-side and continue through their ordinary AWS configuration.

## Prepare the client

Install the collector you use and set the Worker endpoint.

```bash
bash tools/youtube/setup.sh
bash tools/x/setup.sh
bash tools/reddit/setup.sh

export SERVICE_BRIDGE_WORKER_URL=https://service-bridge-workers.english-vault-bridge.workers.dev
```

Both environments pass `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` unchanged in the HTTP headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`.

- **Mac.** Supply the dedicated Access service-token values privately. They can be loaded from the private Terraform state without printing them. Substitute the state path if different.

  ```bash
  worker_project=/Users/owner/english-vault-service-bridge-workers/infra/service-bridge-workers
  worker_state="$worker_project/../../.codex/tmp/workers-acceptance/terraform.tfstate"
  CF_ACCESS_CLIENT_ID="$(terraform -chdir="$worker_project/terraform" output -state="$worker_state" -raw service_token_client_id)"
  CF_ACCESS_CLIENT_SECRET="$(terraform -chdir="$worker_project/terraform" output -state="$worker_state" -raw service_token_client_secret)"
  export CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
  ```

  If Terraform provider plugins are not installed in this checkout, read only the two private outputs from the same local state without printing them. Python is sufficient:

  ```bash
  CF_ACCESS_CLIENT_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outputs"]["service_token_client_id"]["value"], end="")' "$worker_state")"
  CF_ACCESS_CLIENT_SECRET="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outputs"]["service_token_client_secret"]["value"], end="")' "$worker_state")"
  export CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
  ```

- **Codex Cloud.** Use environment-owned HTTP secrets named `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`, bound to the exact Worker hostname. Set `SERVICE_BRIDGE_WORKER_URL` as an ordinary environment variable. Preserve the configured HTTPS proxy and CA settings. Publish configuration changes and start a fresh task. [Codex Cloud network secrets](https://learn.chatgpt.com/docs/environments/cloud-environments#configure-environment-variables-and-network-secrets)

## Run commands

Run the complete command in Codex Cloud's outer executor.

### YouTube

```bash
bash tools/youtube/run.sh workers probe
bash tools/youtube/run.sh workers captions VIDEO_ID
```

The caption test starts with an empty YouTube cookie jar and requests the watch page, InnerTube player, and caption track for the supplied public video ID. It prefers a manual English track and falls back to automatic English captions when no manual track exists. Omitting the ID uses `aircAruvnKk`.

### X

```bash
bash tools/x/run.sh workers -- probe
bash tools/x/run.sh workers -- refresh
bash tools/x/run.sh workers -- refresh --resume
bash tools/x/run.sh workers -- get POST_ID_OR_URL
bash tools/x/run.sh workers -- folders --refresh
```

The child collector keeps its existing Viewer identity verification, operation discovery, source normalization, cache checkpoints, account isolation, and S3 persistence. The wrapper removes `X_PROXY`, marks only the child process with the Workers transport, and does not hold the child's workflow lock.

### Reddit

```bash
bash tools/reddit/run.sh workers -- probe
bash tools/reddit/run.sh workers -- refresh
bash tools/reddit/run.sh workers -- refresh --collections saved --resume
bash tools/reddit/run.sh workers -- verify --collections upvoted saved
bash tools/reddit/run.sh workers -- get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/'
```

The Workers route verifies identity through `/api/me.json`, reads listings through typed `/user/{account}/{collection}.json` requests, and reads individual sources as Old Reddit HTML. The child collector keeps its existing identity checks, signed-in response markers, source parsing, checkpoints, and S3 behavior. The wrapper removes `REDDIT_PROXY` and rejects local transport flags.

Place a global account selector before `workers`, for example:

```bash
bash tools/x/run.sh --account NUMERIC_ID workers -- refresh --resume
bash tools/reddit/run.sh --account USERNAME workers -- refresh --resume
```

Cache-only operations such as search, list, doctor, and S3 sync remain unwrapped because they make no live origin request. `--offline` cannot be combined with `workers`.

## Interface and security behavior

The shared client under `tools/cloud_bridge/workers.py` posts a bounded JSON envelope only to fixed Worker operations. Access headers remain on the Worker connection and are never included in the origin envelope. Collector headers are filtered before dispatch and again by the Worker. Origin redirects are not followed. The client preserves the upstream status and bounded textual body, applies only scoped upstream cookies, and reports fixed Access, Gateway, size, and timeout failures.

The Worker API currently permits these read operations:

- X `home`, allowlisted GraphQL `graphql`, and validated client `asset`.
- Reddit `home`, `identity`, typed account `listing`, and validated comments `comments`.
- YouTube signed-out `watch`, `player`, and `timedtext`.

The client never sends an arbitrary URL or method. X and Reddit account cookies are transmitted through the Access-protected Worker and then to the fixed origin. They are not written to Worker state, Worker logs, diagnostics, or the Access header set.

All three setup scripts install `truststore==0.10.5`. The Workers client injects the operating system certificate store before making requests, so a locally installed Cloudflare Gateway inspection root is verified normally on macOS and Linux. Certificate verification remains enabled. An explicitly configured `REQUESTS_CA_BUNDLE` or `CURL_CA_BUNDLE` remains authoritative.

## Acceptance status

Worker deployment `bfa3714e-c1f9-419e-bc95-57135c0bb434` passed Access authentication and live fixed read operations for X home, Viewer GraphQL, X main JavaScript, Reddit identity, upvoted and saved listings, and a comments page. An earlier YouTube route test returned manual English captions with 286 segments for the established test video.

On 2026-11-20, the new `vault` client passed the unsigned X and Reddit probes and the YouTube Access/Gateway-IP probe. Authenticated X passed a live cached-post refresh through home-page discovery, main-bundle relay, Viewer verification, and `TweetResultByRestId`. Authenticated Reddit passed `verify` for upvoted and saved collections, reading 45 and 17 page items respectively. X bookmark-folder discovery reached GraphQL but the account returned the documented authorization error 37.

The current YouTube caption retry was not successful at its final stage. The watch and player stages completed, but `/api/timedtext` returned HTTP 429 on two spaced attempts for `aircAruvnKk`. This is an origin-rate-limit result through the verified Access and Gateway path, not an authentication or routing success claim for caption retrieval. Retry later or use the Lambda fallback while preserving this measured status.

The `vault` client integration also has synthetic unit coverage for Access denial, Gateway error propagation, fixed operation routing, cookie scoping, response size and status handling, wrapper isolation, and no direct fallback. Do not infer account authorization from an unsigned probe.

## Interpret failures

| Diagnostic | Meaning |
| --- | --- |
| HTTPS proxy connection failed before the Worker responded | Check the Cloud HTTPS proxy and the exact allowed Worker hostname. |
| HTTPS certificate verification failed | Compare the Cloud trust bundle with the CA used by Requests. |
| HTTP 401, 403, or redirect before the Worker ran | Check Access credentials, secret substitution, token expiry, and hostname binding. |
| Worker relay failed with `gateway_binding_unavailable` | Access succeeded but the Gateway binding is absent or unavailable. |
| Worker relay failed with `upstream_deadline` or `upstream_failure` | The Worker reached its Gateway path but the origin request failed. |
| Origin HTTP 403, 429, or redirect | Access and Worker egress succeeded. The collector reports the origin status and does not retry directly. |
| Collector identity or schema failure | The origin response was unacceptable. Renew or verify the private session, and preserve cached progress. |

### Check TLS from Codex Cloud

From the same executor, send an unsigned request with the configured proxy and certificate verification.

```bash
curl -sS --max-time 15 -o /dev/null \
  -w 'CONNECT=%{http_connect} HTTP=%{http_code}\n' \
  "${SERVICE_BRIDGE_WORKER_URL%/}/v1/health"
```

A successful CONNECT followed by HTTP 403 means the unsigned request reached Access over HTTPS. The client honors `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE`, then uses `SSL_CERT_FILE` or the Linux system CA bundle when available. Keep TLS verification enabled.
