# Private Reddit collections and source cache

`tools/reddit/` is the Reddit counterpart of the YouTube and X collectors. It reads your own **upvoted posts and saved posts/comments** by default, plus optional downvoted posts, hidden posts, submissions and comments. Direct macOS mode uses cookie-authenticated Old Reddit JSON for identity and listings. It reads individual sources as HTML, as do the separate Chrome and proxy transports. All collector requests are read-only.

Reddit's [registration notice](https://developers.reddit.com/app-registration) says remaining public API access ends in March 2027. [Devvit excludes private voted/saved content](https://developers.reddit.com/docs/capabilities/server/reddit-api). The collector uses website routes and a private browser session. Their availability and response formats can change, and challenges or unexpected responses stop the live scan.

## Install and supply a private session

```bash
bash tools/reddit/setup.sh
bash tools/reddit/run.sh doctor
# On your Mac, sign in normally in the intended Chrome profile, then:
bash tools/reddit/run.sh login --profile Default
```

Setup only installs pinned dependencies into ignored `.codex/tmp/reddit/.venv/`; it does not read a browser, sign in, or collect sources. Local `login` asks for consent before reading the selected Chrome profile and saves only unexpired Reddit cookies in `.codex/tmp/reddit/auth/storage-state.json`, with private file permissions. Approve any macOS Keychain prompt yourself. Use `--profile 'Profile 1'` for that exact profile. Agents must obtain explicit authorization for the named profile before using `--authorize-export`. No cookie export is authorized merely by requesting tool development.

In Cloud, privately supply `REDDIT_STORAGE_STATE_JSON` in storage-state format with a `cookies` array containing name, value, domain, path and expires. An unexpired `reddit_session` cookie usable on `old.reddit.com` is required. Other Reddit cookies may also be needed. A live identity check verifies session access. Each HTML page must contain the expected signed-in header. Direct mode verifies the identity through `/api/me.json` and requires a signed-in marker on each JSON listing requested for that identity. Do not paste cookies in chat or put them in Git, S3, build artifacts, or published snapshots.

Account archives use the verified lowercase Reddit username. `--account USERNAME` or `REDDIT_ACCOUNT` selects an existing archive and enforces the expected identity on live reads. `doctor` reports configuration without contacting Reddit or AWS.

## Cloud transport

Direct Reddit access is blocked by the Cloud proxy before origin TLS. Cloud live commands require an explicit transport and have **no direct/ambient-proxy fallback**. The Access-protected [Cloudflare Workers client](service-bridge-workers-client.md) sends fixed identity, listing, and comments requests through Cloudflare Gateway. It needs `SERVICE_BRIDGE_WORKER_URL`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET`. Actual credential values stay in private local configuration or Codex Cloud HTTP secrets.

```bash
bash tools/reddit/run.sh workers -- probe
bash tools/reddit/run.sh workers -- refresh
bash tools/reddit/run.sh workers -- refresh --collections saved --resume
bash tools/reddit/run.sh workers -- verify --collections upvoted saved
bash tools/reddit/run.sh workers -- get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/'
```

The Workers wrapper starts the normal child collector, removes `REDDIT_PROXY`, and marks only that child process to use `tools/cloud_bridge/workers.py` and `tools/reddit/workers.py`. It does not contact Lambda or DynamoDB, hold the child workflow lock, or fall back to ordinary egress. The child still verifies `/api/me.json`, requires the signed-in listing marker, reads each source as Old Reddit HTML, and preserves the existing cache and S3 formats.

Keep the existing [private Lambda bridge](service-bridge-client.md) with the Reddit server extension as the fallback. The client needs only `old.reddit.com:443`; it never fetches website assets, media, or external links. Cookies remain in the collector, and origin TLS stays verified.

The Reddit server extension at `cd00fa2` was deployed on 2026-11-18. Lambda is Active with a successful update. Local tailnet testing verified private authentication, matched egress and origin TLS, but Old Reddit returned **HTTP 403**, both unsigned and with the separately authorized local session. This is an origin response through the bridge, not a CONNECT denial. That bridge test could not establish cookie validity or authenticated HTML parsing; the subsequent local Chrome test below verified the existing session and parsed live sources. Do not retry directly or switch to a browser after bridge failure.

Set `SERVICE_BRIDGE_FUNCTION=service-bridge` and `SERVICE_BRIDGE_TABLE=service-bridge-sessions`, or their matching stack outputs. Update older environments that use the deprecated `YOUTUBE_BRIDGE_*` aliases. Preserve scoped AWS permissions, built-in VPN configuration, normal AWS/S3 proxy and CA settings, and the private TCP 8443 grant.

Run the entire wrapper in the Cloud outer executor, sharing the network namespace with its relay. Run only one bridge session/workflow at a time:

```bash
# First in each new Cloud task; no account cookies/cache are loaded.
bash tools/reddit/run.sh bridge -- probe

# Then, with your separately supplied private session:
bash tools/reddit/run.sh bridge -- refresh
# Resume only the incomplete collection(s), including a failure on the first page.
bash tools/reddit/run.sh bridge -- refresh --collections saved --resume

# Other collections are opt-in.
bash tools/reddit/run.sh bridge -- refresh --collections downvoted hidden submitted comments

# Enforce/select a specific account without embedding it in source code.
bash tools/reddit/run.sh --account YOUR_USERNAME bridge -- refresh
```

The probe verifies session readiness, unauthenticated private-proxy rejection, matched egress and verified HTTPS to Old Reddit. It does not follow redirects. A login redirect demonstrates transport only; a 403/429 fails acceptance, and a 200 challenge page still does not prove account access. The client must subsequently verify a real authenticated page. A CONNECT 403 before origin TLS is distinct from a Reddit response through a working bridge.

The bridge passes a temporary `REDDIT_PROXY` only to its child collector. It monitors expiry/heartbeat/tunnel health and requests worker shutdown on completion. Sessions last at most 720 seconds including startup. If terminated, complete source writes and page checkpoints survive; start a new session with `--resume`. Do not copy relay URLs to permanent settings. An independently supplied authorized HTTP proxy can be used through `REDDIT_PROXY`; credentials in that proxy URL are rejected. Plain live commands without an explicit transport fail before making a request. Local origin modes require `--browser-local` or `--direct-local` and macOS; neither is selected automatically after a proxy failure.

## Direct macOS transport

Use the existing authorized Reddit session with `--direct-local`:

```bash
bash tools/reddit/run.sh --direct-local verify
bash tools/reddit/run.sh --direct-local refresh
bash tools/reddit/run.sh --direct-local refresh --collections saved --resume
```

This mode uses Python's HTTPS client with the tested descriptive User-Agent. It verifies the account with `GET /api/me.json` and reads `GET /user/USERNAME/COLLECTION.json`. The collector follows the `data.after` cursor and keeps listing order. Individual post and comment sources still use signed-in HTML and the same normalized cache format. Request paths stay on `old.reddit.com`. The transport requires macOS, refuses `REDDIT_PROXY` and keeps TLS verification enabled. See [Reddit's legacy listing format](https://github.com/reddit-archive/reddit/wiki/JSON#listing) for the response structure.

`verify` reads one page and at most one source per selected collection. It caches verified source content without recording collection coverage. Use `refresh` for a complete scan, or add `--max-pages N` to record bounded partial coverage. The transport flag is global and can also precede `get`.

## Local Chrome transport

If explicitly authorized, the Mac can use Playwright with installed Google Chrome:

```bash
bash tools/reddit/setup.sh --browser
bash tools/reddit/run.sh --browser-local verify
bash tools/reddit/run.sh --browser-local refresh
# Continue only an incomplete collection when needed:
bash tools/reddit/run.sh --browser-local refresh --collections upvoted --resume
```

This mode launches a separate visible Chrome profile under ignored `.codex/tmp/reddit/browser/profile/` using `playwright==1.58.0`. It imports only the already authorized Reddit cookies, does not open or control the original Chrome Default profile, and closes the collector browser on completion or error. Install the browser dependency with `setup.sh --browser`; Chrome itself is installed separately. Browser state, temporary files and diagnostic HTML stay private and never sync to S3 or Git.

Chrome's normal sandbox and TLS validation remain enabled. There are no stealth patches, custom browser identity/fingerprint flags, password automation, challenge solvers or automatic retries. Main-frame navigation is restricted to the requested Old Reddit document. Percent-encoding or canonical title-slug changes are accepted only on Old Reddit for the same post/comment ID with the same read-only query scope; login, challenge, different-source and different-origin navigation stops the command. Only necessary GET assets on Old Reddit and `www.redditstatic.com` are allowed, with external embeds, fetch/analytics, mutations and media downloads blocked. The collector does not click spoiler, age, quarantine, login or moderation gates, and does not allow website API calls. A recognized spoiler gate withholds a post body; its visible title is cached with empty body text and `body_status: spoiler_hidden`. Historical self-posts that expose neither body markup nor any expansion control are similarly recorded with `body_status: not_exposed`. This does not invent or infer missing text. Search reports `hidden_bodies` and total `unread_bodies` so an empty result cannot imply those bodies were searched. Other unexpected missing-body structures still fail visibly. Static browser assets are part of normal rendering, not extra collection scans.

The implementation follows Playwright's first-party [authenticated-state](https://playwright.dev/python/docs/auth), [installed Chrome](https://playwright.dev/python/docs/browsers#google-chrome--microsoft-edge), and [isolated persistent-context](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context) interfaces. No Chrome Default cookie re-export was needed for this fix.

## Explicit local tailnet testing

On a Mac with an existing, signed-in Tailscale connection, use the explicit local transport:

```bash
SERVICE_BRIDGE_FUNCTION=service-bridge SERVICE_BRIDGE_TABLE=service-bridge-sessions \
  bash tools/reddit/run.sh bridge --local --session-seconds 180 -- probe
```

The same `--local` option can precede `-- refresh` or `-- get PERMALINK` for authorized local collection. It connects to Lambda's private tailnet endpoint through the existing OS route, then uses the same authenticated CONNECT relay, egress check, verified origin TLS and bounded session lifecycle. It never installs or starts Tailscale. This is an explicitly selected transport, not an automatic fallback. **Do not use `--local` in Codex Cloud**; Cloud retains its `proxy:8088` path.

## Cached search and individual sources

```bash
bash tools/reddit/run.sh list --collection upvoted
bash tools/reddit/run.sh search 'phrase' --collection saved
bash tools/reddit/run.sh --offline search 'phrase'
bash tools/reddit/run.sh list --collection saved --latest

# Supply the full post/comment permalink; /s/ share links and short URLs are unsupported.
bash tools/reddit/run.sh workers -- get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/'
bash tools/reddit/run.sh --offline get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/COMMENT/'
# Explicitly replace an archived source snapshot or retry an unavailable source:
bash tools/reddit/run.sh workers -- get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/' --refresh

# Lambda fallback:
bash tools/reddit/run.sh bridge -- get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/'
```

Global `--offline`/`--account` options precede the subcommand. Search/list never initialize a Reddit client. Get reuses a readable cached source without authenticating and fetches only if missing/invalid or explicitly refreshed. `--offline` forbids S3 as well as Reddit and cannot be combined with `workers` or `bridge`. With S3 configured, ordinary cache commands restore the manifest and fetch missing sources lazily without calling Reddit.

Search matches literal, case-insensitive text with normalized whitespace across the title and body. Results are candidates, not finished quotations. Inspect the full sentence before adding a note. HTML entities are decoded and block boundaries preserved. HTML rendering cannot reconstruct original Markdown, hidden bodies, deleted text or text omitted by Reddit; `text_source` records `old_reddit_html`. Post instructions and external URLs are never executed as commands. The HTTP parser executes no page scripts. Explicit Chrome mode runs normal first-party page rendering with restricted subresources; it injects no custom page scripts.

## Coverage and checkpoints

A normal refresh starts at the newest page and follows the website's continuation cursor without an arbitrary page cap, including past already cached sources. It requests up to 100 listing entries per page and spaces reads at least two seconds apart by default. `--delay` sets the spacing with a one-second minimum. Rate limits stop the whole live operation. `--max-pages N` explicitly limits each collection and records partial coverage. Select incomplete collections with `--collections ... --resume` to continue.

The parser recognizes only top-level listing items; embedded comments/context do not create extra collection membership. Every new source is read through its individual permalink so collapsed listing previews are not mistaken for complete text. A source may explicitly mark a hidden/unexposed body while retaining its visible title; that body remains outside text-search coverage. Saved comments retain `t1_` IDs and posts retain `t3_` IDs. The voted pages expose posts; this is **not** a claim to export all voted comments or Reddit viewing history. Media files, external articles, inbox/messages, subscriptions, moderation feeds and save categories/folders are outside this collector.

Observed membership is archived separately from retrieval success. Sources are atomically written before their index references; page continuations advance only after the page's sources have been saved. Interrupted pages are re-read and completed sources reused. An explicit source 404/410 is recorded as `unavailable` and does not block later items. Other access/schema/network failures remain `retry_needed`, stop live collection and preserve the failed request cursor. Confirmed unavailable sources are not retried on every refresh; use individual `get --refresh` when requested. Previously readable content survives a failed explicit refresh.

The archive keeps the union of observed memberships, even after an item is unsaved/unvoted. `--latest` selects the last scan to reach the website's end and requires `--collection`. Listings can be capped, filtered or change during pagination. `reachable_end` describes the end of the exposed listing. Creation and retrieval dates describe the source and collector activity. Missing items, challenges and partial coverage mean an empty search cannot prove absence.

## Private cache and S3

Everything private lives under ignored `.codex/tmp/reddit/`: the virtual environment, installed versions, session, selected account, workflow lock, `accounts/USERNAME/index.json`, and `accounts/USERNAME/posts/t1_OR_t3_ID.json`. The normalized source contains ID, canonical permalink, title/body, author, subreddit, source creation time when present, retrieval time, parent reference when available and outbound URL. It may also contain a validated `body_status` for unexposed text. It contains no raw HTML, request headers or cookies.

Optional [Reddit S3 infrastructure](../infra/reddit-cache/README.md) uses a separate private bucket in `us-west-1`. Configure `REDDIT_CACHE_BUCKET` or ignored `s3-config.json`; configure `REDDIT_ACCOUNT` for restoration without a session. Only validated account indexes and content-addressed normalized source JSON can sync. Source objects upload before their manifest references, and conditional manifest merges preserve concurrent archives. Cookies, account-selection files, raw responses, dependencies, locks and arbitrary files cannot sync. Local progress survives upload failure; durability is established only by successful sync/restoration.

```bash
bash tools/reddit/run.sh sync
```

The private Reddit S3 stack and optional shared-runtime cache policy were deployed on 2026-11-18. Local conditional manifest write/read passed using an isolated empty validation archive; no real account sources were collected. Local `doctor` reports S3 and an available private session, but those configuration checks do not establish account access. Cloud persistence requires the actual active scoped role and a separately verified bucket route.

## Validation and implementation references

```bash
.codex/tmp/reddit/.venv/bin/python -m unittest discover -s tests/reddit -v
bash -n tools/reddit/setup.sh tools/reddit/run.sh infra/reddit-cache/deploy.sh
```

Tests use synthetic HTML, JSON, cookies, sources and S3. They cover account isolation, source parsing, pagination, checkpoint/resume, unavailable sources, missing-cache reporting, proxy/TLS restrictions, consent, cache-only reads, upload order/integrity and bridge dispatch. Existing X/YouTube tests check the shared-client regression boundary. The server image tests exercise real GOST with networking disabled, including opaque Reddit CONNECT and destination denial. Live results for direct macOS, Chrome and Cloud are recorded below.

Parser structure is based on Reddit's archived first-party [listing](https://github.com/reddit-archive/reddit/blob/master/r2/r2/templates/listing.html), [printable item](https://github.com/reddit-archive/reddit/blob/master/r2/r2/templates/printable.html), [link](https://github.com/reddit-archive/reddit/blob/master/r2/r2/templates/link.html), and [comment](https://github.com/reddit-archive/reddit/blob/master/r2/r2/templates/comment.html) templates. These historical references are not proof of today's authenticated markup; unexpected markup fails visibly. There is no GitHub Actions or website-build integration. Only requested short verified quotations may later enter notes under `AGENTS.md`.

## Deployment and measured acceptance — 2026-11-18

- Server `cd00fa2` is deployed with Lambda image digest `sha256:4736921516d9bd2db09b1e0577fe47678214148da860edc16b699870af56988e`; the stack is UPDATE_COMPLETE and Lambda is Active / Successful.
- The private Reddit bucket is CREATE_COMPLETE and the optional cache-policy attachment on `english-vault-cloud-runtime` is UPDATE_COMPLETE. Local conditional write/read of an isolated empty validation manifest passed. No personal Reddit sources were uploaded. Cloud S3 I/O was not exercised.
- Local acceptance through the existing Mac tailnet passed private 407 enforcement and matching Lambda egress. The unsigned origin request returned HTTP 403. A separate authorized Chrome Default cookie export was tested once through the same deployed route; Reddit again returned HTTP 403 before an account header could be verified. This does not establish that the cookie is expired or invalid. No direct-origin or browser fallback was used.
- A real Cloud runtime prepared an isolated detached worktree at client `aeb8ce2` and passed all 30 tests then present. Its actual STS role was `english-vault-cloud-runtime`. The one live outer-executor probe accepted Lambda invocation, observed `connect-v2` readiness and private 407, and matched egress. It then exited 1 with `Built-in VPN bridge connection failed; collection stopped`. No origin status was emitted, so Cloud origin acceptance is **not established**.
- Review found that the relay could mark itself unhealthy on a normal post-CONNECT client disconnect. The client now confines those late disconnects to their tunnel; truncated HTTPS responses still fail in the collector, and pre-CONNECT failures still mark the bridge unhealthy. Synthetic regression tests pass. This is a possible explanation of the Cloud result, not a confirmed diagnosis. The Cloud task then hit its account usage limit, preventing a rerun of the corrected client or Cloud S3 tests.
- Local coordinator checks confirmed all three acceptance sessions reached `stopped` / `StopRequested` and their exact Lambda peers were offline. No Cloud cookies were supplied and no environment snapshot was published. Local tests pass: 33 Reddit, 78 YouTube/shared-bridge, 26 X; the unchanged deployed server image passed all 18 tests.

The original Lambda/HTTP route remains blocked; corrected-client Cloud acceptance is still pending after the usage limit. The later explicit local Chrome acceptance below supersedes the initial local-collection limitation. No automatic route fallback is implemented.

## Local Chrome acceptance — 2026-11-18

The user explicitly authorized Playwright with installed Chrome and the existing exported Reddit session. A new isolated local profile received HTTP 200 from Old Reddit and verified the account header. The same cookie export had received a network-security HTTP 403 through the standalone HTTP client. No cookie refresh, password automation, identity override or challenge handling was needed.

The normal collector then refreshed both default feeds to the end exposed by the website, using existing checkpoints through parser fixes for canonical/encoded permalinks and known unexposed bodies. Every observed item has a validated source snapshot and remote content-addressed reference. Some snapshots explicitly mark spoiler-hidden or otherwise unexposed bodies; those bodies were not read or inferred. Exact account, membership, counts, source contents and runtime evidence remain in the ignored cache and private S3 only. Reaching the website end does not establish lifetime completeness.

Live-source uploads completed successfully. A fresh local cache restored the S3 index and downloaded source objects with matching normalized bytes/digests, including the partial-body metadata. Real offline list/get/search checks passed. The collector browser closed at command completion. No new Cloud task or Lambda session was used for this local fix; Cloud access and scoped-role S3 I/O remain separate acceptance items.

Local checks passed 47 Reddit tests, 78 YouTube/shared-bridge tests and 26 X tests, plus shell syntax. New tests cover isolated Chrome state, preserved sandbox/TLS, request restrictions, same-ID URL canonicalization, cleanup, local-only guards and explicit unread-body coverage. The optional browser dependency is not part of the base Cloud installation or website build.

## Corrected-client Cloud retest — 2026-11-18

A real Cloud runtime at `1dd9549` passed all 47 Reddit tests and shell checks. STS confirmed `english-vault-cloud-runtime`. Its first unsigned outer-executor probe reached Lambda readiness but failed before reporting private-proxy authentication. Exact-session GetItem confirmed `stopped` / `StopRequested`. Live proxy and startup-policy checks agreed that the VPN was Running with routing ready, automatic Tailscale access enabled and an accepted route for the exact private endpoint. These policy observations did not explain the initial connection failure.

Client `df1d4e8` adds fixed, credential-free failure categories for the Cloud TCP route and private-proxy response. Cloud passed all 80 YouTube/shared-bridge tests and 47 Reddit tests at that revision. One diagnostic rerun then passed Lambda invocation, `connect-v2` readiness, unauthenticated proxy rejection with HTTP 407, matching egress and verified origin TLS. **Old Reddit returned HTTP 403**, so the probe correctly exited 1. Exact-session GetItem again confirmed `stopped`, `stop_requested=true`, `reason=StopRequested`. The latest run establishes working Cloud-to-bridge transport but not Reddit origin or authenticated collection acceptance. No Cloud Reddit cookies or account reads were used; no local/browser/direct fallback or published snapshot was used. The first connection failure remains unexplained rather than being attributed to the diagnostic change.

The separate empty-manifest S3 test failed with proxy CONNECT HTTP 403 before AWS responded. The bucket's exact regional hostname (`${REDDIT_CACHE_BUCKET}.s3.us-west-1.amazonaws.com`) was absent from both startup and live allowed rules. Conditional manifest initialization/read therefore remains unverified in Cloud. This is a network-policy denial, not S3 AccessDenied or evidence of an IAM/session problem. The required network correction is to add that exact bucket hostname while preserving existing grants and normal AWS routing; do not route S3 through Lambda or broaden to all Internet access. No policy was changed or S3 retry performed during this validation.

The working local Chrome collector remains separate. Cloud live Reddit collection is still blocked by the origin's 403, while Cloud cache reuse additionally needs the bucket hostname grant and a fresh successful S3 test. Local cache/source durability checks remain valid.

## Direct macOS acceptance — 2026-11-19

With an existing authorized session, `--direct-local verify` authenticated and read all six collection routes. It parsed individual upvoted and saved posts and a comment source. A bounded live refresh and resume in an isolated local cache used one item per page to exercise each default feed's continuation and source writes. These checks cover local access and continuation, with separate results above for Cloud and private S3.
