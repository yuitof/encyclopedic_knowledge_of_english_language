# Private Reddit collections and source cache

`tools/reddit/` is the Reddit counterpart of the YouTube and X collectors. It reads your own **upvoted posts and saved posts/comments** by default, plus optional downvoted posts, hidden posts, submissions and comments. It fetches cookie-authenticated Old Reddit HTML, not OAuth, PRAW, the public JSON API, or Devvit. All Reddit operations are reads.

Reddit's [registration notice](https://developers.reddit.com/app-registration) says remaining public API access ends in March 2027. [Devvit excludes private voted/saved content](https://developers.reddit.com/docs/capabilities/server/reddit-api). Using website HTML avoids a public API dependency, but cannot guarantee continued website access: Old Reddit, cookie requirements, account restrictions and HTML can change. Challenges and changed pages fail explicitly.

## Install and supply a private session

```bash
bash tools/reddit/setup.sh
bash tools/reddit/run.sh doctor
# On your Mac, sign in normally in the intended Chrome profile, then:
bash tools/reddit/run.sh login --profile Default
```

Setup only installs pinned dependencies into ignored `.codex/tmp/reddit/.venv/`; it does not read a browser, sign in, or collect sources. Local `login` asks for consent before reading the selected Chrome profile and saves only unexpired Reddit cookies in `.codex/tmp/reddit/auth/storage-state.json`, with private file permissions. Approve any macOS Keychain prompt yourself. Use `--profile 'Profile 1'` for that exact profile. Agents must obtain explicit authorization for the named profile before using `--authorize-export`. No cookie export is authorized merely by requesting tool development.

In Cloud, privately supply `REDDIT_STORAGE_STATE_JSON` in storage-state format: a `cookies` array containing name, value, domain, path and expires. An unexpired `reddit_session` cookie usable on `old.reddit.com` is required; other Reddit cookies may also be needed. Cookie presence is a configuration check, not proof of authentication. Every network page must contain a recognized signed-in header; the account is derived from that header and checked throughout collection. No passwords, automated login, challenge bypass, account creation, or browser-profile discovery is implemented. Do not paste cookies in chat or put them in Git, S3, build artifacts, or published snapshots.

Account archives use the lowercase Reddit username observed in the header. `--account USERNAME` or `REDDIT_ACCOUNT` selects an existing archive and enforces the expected identity on live reads. This differs from X's numeric account ID. No real username is hard-coded. `doctor` reports configuration without contacting Reddit or AWS.

## Cloud transport

Direct Reddit access is blocked by the Cloud proxy before origin TLS. Live commands require an explicit proxy and have **no direct/ambient-proxy fallback**. Use the existing [private Lambda bridge](service-bridge-client.md) with the Reddit server extension. The client needs only `old.reddit.com:443`; it never fetches website assets, media, or external links. Cookies remain in the collector, and origin TLS stays verified.

The Reddit server extension is implemented separately on `service-bridge`. Its local image and tests pass, but this task has **not deployed it or verified the live Cloud route**. Earlier YouTube/X acceptance does not establish Reddit support. Deploy the matching server before running the unsigned probe; a destination denial is a route/deployment failure, not evidence of an expired cookie. Do not retry directly or switch to a browser after bridge failure.

Set the existing `SERVICE_BRIDGE_FUNCTION=service-bridge` and `SERVICE_BRIDGE_TABLE=service-bridge-sessions`, or their matching stack outputs. Legacy `YOUTUBE_BRIDGE_FUNCTION` / `YOUTUBE_BRIDGE_TABLE` also work. Preserve scoped AWS permissions, built-in VPN configuration, normal AWS/S3 proxy/CA settings, and the private TCP 8443 grant. No new bridge credentials, private Tailscale daemon, or exit node are needed.

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

The bridge passes a temporary `REDDIT_PROXY` only to its child collector. It monitors expiry/heartbeat/tunnel health and requests worker shutdown on completion. Sessions last at most 720 seconds including startup. If terminated, complete source writes and page checkpoints survive; start a new session with `--resume`. Do not copy relay URLs to permanent settings. An independently supplied authorized HTTP proxy can be used through `REDDIT_PROXY`; credentials in that proxy URL are rejected. Plain live commands without an explicit proxy fail before making a request.

## Cached search and individual sources

```bash
bash tools/reddit/run.sh list --collection upvoted
bash tools/reddit/run.sh search 'phrase' --collection saved
bash tools/reddit/run.sh --offline search 'phrase'
bash tools/reddit/run.sh list --collection saved --latest

# Supply the full post/comment permalink; /s/ share links and short URLs are unsupported.
bash tools/reddit/run.sh bridge -- get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/'
bash tools/reddit/run.sh --offline get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/COMMENT/'
# Explicitly replace an archived source snapshot or retry an unavailable source:
bash tools/reddit/run.sh bridge -- get 'https://old.reddit.com/r/SUB/comments/POST/TITLE/' --refresh
```

Global `--offline`/`--account` options precede the subcommand. Search/list never initialize a Reddit client. Get reuses a readable cached source without authenticating and fetches only if missing/invalid or explicitly refreshed. `--offline` forbids S3 as well as Reddit and cannot be combined with `bridge`. With S3 configured, ordinary cache commands restore the manifest and fetch missing sources lazily without calling Reddit.

Search matches literal, case-insensitive text with normalized whitespace across the title and body. Results are candidates, not finished quotations. Inspect the full sentence before adding a note. HTML entities are decoded and block boundaries preserved. HTML rendering cannot reconstruct original Markdown, hidden bodies, deleted text or text omitted by Reddit; `text_source` records `old_reddit_html`. Scripts, post instructions, external URLs and downloaded code are never executed.

## Coverage and checkpoints

A normal refresh starts at the newest page and follows the website's next link without an arbitrary page cap, including past already cached sources. It requests up to 100 listing entries per page and spaces **all** website requests at least two seconds apart by default (`--delay` may increase this, with a minimum of one second). Rate limits stop the whole live operation instead of triggering retries. `--max-pages N` explicitly limits each collection and records partial coverage. Select the incomplete collection(s) with `--collections ... --resume` to continue; a completed or never-started collection is not resumable.

The parser recognizes only top-level listing items; embedded comments/context do not create extra collection membership. Every new source is read through its individual permalink so collapsed listing previews are not mistaken for complete text. Saved comments retain `t1_` IDs and posts retain `t3_` IDs. The voted pages expose posts; this is **not** a claim to export all voted comments or Reddit viewing history. Media files, external articles, inbox/messages, subscriptions, moderation feeds and save categories/folders are outside this collector.

Observed membership is archived separately from retrieval success. Sources are atomically written before their index references; page continuations advance only after the page's sources have been saved. Interrupted pages are re-read and completed sources reused. An explicit source 404/410 is recorded as `unavailable` and does not block later items. Other access/schema/network failures remain `retry_needed`, stop live collection and preserve the failed request cursor. Confirmed unavailable sources are not retried on every refresh; use individual `get --refresh` when requested. Previously readable content survives a failed explicit refresh.

The archive keeps the union of observed memberships, even after an item is unsaved/unvoted. `--latest` selects the last scan to reach the website's end and requires `--collection`; it does not silently substitute a newer partial scan. Listings can be capped, filtered or change during pagination. `reachable_end` means there was no further recognized next link, **not lifetime completeness**. Creation/retrieval dates are not save/vote times. Missing items, challenges and partial coverage mean an empty search cannot prove absence.

## Private cache and S3

Everything private lives under ignored `.codex/tmp/reddit/`: the virtual environment, installed versions, session, selected account, workflow lock, `accounts/USERNAME/index.json`, and `accounts/USERNAME/posts/t1_OR_t3_ID.json`. The normalized source contains ID, canonical permalink, title/body, author, subreddit, source creation time when present, retrieval time, parent reference when available and outbound URL. It contains no raw HTML, request headers or cookies.

Optional [Reddit S3 infrastructure](../infra/reddit-cache/README.md) uses a separate private bucket in `us-west-1`. Configure `REDDIT_CACHE_BUCKET` or ignored `s3-config.json`; configure `REDDIT_ACCOUNT` for restoration without a session. Only validated account indexes and content-addressed normalized source JSON can sync. Source objects upload before their manifest references, and conditional manifest merges preserve concurrent archives. Cookies, account-selection files, raw responses, dependencies, locks and arbitrary files cannot sync. Local progress survives upload failure; durability is established only by successful sync/restoration.

```bash
bash tools/reddit/run.sh sync
```

The stack/template and optional shared-runtime policy are prepared, **not deployed**. This task's `doctor` reports local-only persistence, and no private session/account collection was performed. Do not infer working S3 persistence or authenticated access from synthetic tests.

## Validation and implementation references

```bash
.codex/tmp/reddit/.venv/bin/python -m unittest discover -s tests/reddit -v
bash -n tools/reddit/setup.sh tools/reddit/run.sh infra/reddit-cache/deploy.sh
```

Tests use synthetic HTML, cookies, sources and S3. They cover account isolation, source parsing, pagination, checkpoint/resume, unavailable sources, missing-cache reporting, proxy/TLS restrictions, consent, cache-only reads, upload order/integrity and bridge dispatch. Existing X/YouTube tests check the shared-client regression boundary. The server image tests exercise real GOST with networking disabled, including opaque Reddit CONNECT and destination denial. Authenticated Old Reddit HTML and live Cloud Reddit/S3 acceptance remain unverified.

Parser structure is based on Reddit's archived first-party [listing](https://github.com/reddit-archive/reddit/blob/master/r2/r2/templates/listing.html), [printable item](https://github.com/reddit-archive/reddit/blob/master/r2/r2/templates/printable.html), [link](https://github.com/reddit-archive/reddit/blob/master/r2/r2/templates/link.html), and [comment](https://github.com/reddit-archive/reddit/blob/master/r2/r2/templates/comment.html) templates. These historical references are not proof of today's authenticated markup; unexpected markup fails visibly. There is no GitHub Actions or website-build integration. Only requested short verified quotations may later enter notes under `AGENTS.md`.
