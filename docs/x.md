# Private X collections and post cache

The X counterpart of `tools/youtube/` lives in `tools/x/`. It reads your own likes and bookmarks through X's authenticated website API, archives full post text privately, and searches that archive without contacting X. It also supports your posts, posts with replies, media, bookmark folders, and individual post URLs. No account name or account ID is hard-coded.

## Setup and authentication

```bash
bash tools/x/setup.sh
bash tools/x/run.sh login --profile Default
bash tools/x/run.sh doctor
```

Setup only installs workflow dependencies into ignored `.codex/tmp/x/.venv/`. It does not sign in or collect anything. On macOS, sign in normally at x.com in the intended Chrome profile first. `login` asks before reading that profile, saves only unexpired X/Twitter cookies with private permissions to `.codex/tmp/x/auth/storage-state.json`, and prints no cookie values. Approve macOS Keychain prompts yourself. An agent can use `--authorize-export` only after the user explicitly authorizes that profile's export. Other profile names use `--profile 'Profile 1'`, etc. This tool does not automate passwords, solve challenges, or modify likes/bookmarks.

Cloud/Linux sessions use a privately supplied `X_STORAGE_STATE_JSON` in the same storage-state format (`cookies`, with name/value/domain/path/expiry). Keep it out of chat, GitHub, S3, logs, and snapshots. GitHub/AWS access does not authorize X. A session requires X-domain `auth_token` and `ct0`; authentication is verified with the live `Viewer` query, not merely cookie presence. The discovered numeric account ID selects the account's archive. `--account ID` or `X_ACCOUNT_ID` can enforce the expected identity, and selects an existing archive without authenticating when doing cache-only work. No screen name is embedded in the source.

`doctor` reports configuration, not verified live connectivity. With S3 configured, it reports `s3`. Use `sync` and a restoration check to establish persistence.

## Codex Cloud transports

When direct X connections are blocked, select either explicit transport below. The Access-protected [Cloudflare Workers client](service-bridge-workers-client.md) sends fixed X home, GraphQL, and asset requests through Cloudflare Gateway. It needs `SERVICE_BRIDGE_WORKER_URL`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET`. Actual credential values stay in private local configuration or Codex Cloud HTTP secrets.

```bash
bash tools/x/run.sh workers -- probe
bash tools/x/run.sh workers -- refresh
bash tools/x/run.sh workers -- refresh --resume
bash tools/x/run.sh workers -- get POST_ID_OR_URL
bash tools/x/run.sh workers -- folders --refresh
```

The Workers wrapper starts the normal child collector, removes `X_PROXY`, and marks only that child process to use `tools/cloud_bridge/workers.py`. It does not contact Lambda or DynamoDB, hold the child workflow lock, or fall back to ordinary egress. Viewer verification, operation discovery, cookies, redirects, response parsing, account isolation, caches, and S3 behavior remain in the existing X implementation.

Keep the authorized [private Lambda bridge](service-bridge-client.md) as the fallback. It routes the same X hosts through the built-in Cloud Tailscale VPN after its X extension has been deployed. Run the entire command in the outer executor; no separate Tailscale daemon or exit node is used.

```bash
bash tools/x/run.sh bridge -- probe
bash tools/x/run.sh bridge -- refresh
bash tools/x/run.sh bridge -- refresh --resume
bash tools/x/run.sh bridge -- get POST_ID_OR_URL
bash tools/x/run.sh bridge -- folders --refresh
```

Set `SERVICE_BRIDGE_FUNCTION=service-bridge` and `SERVICE_BRIDGE_TABLE=service-bridge-sessions`. Update older environments that use the deprecated `YOUTUBE_BRIDGE_*` aliases. Keep the scoped AWS OIDC identity, private `X_STORAGE_STATE_JSON`, `X_ACCOUNT_ID`, and X cache settings separate. The probe uses no account session or cache. After it succeeds, run the authorized authenticated command to verify account access.

The wrapper sets a temporary `X_PROXY` for both API and asset requests, monitors the shared session, and requests shutdown on completion. TLS verification remains enabled, and a tunnel failure stops the command without direct fallback. Other hosts, ports, and media downloads remain unsupported. X challenges or authorization failures stay visible. This wrapper does not configure a browser's proxy.

Use plain search/list, `--offline` reads, and `sync` for cached work. They do not need Lambda. The bridge rejects `--offline`; network commands keep their existing checkpoint/resume and account-isolation rules. Only the child collector holds the workflow lock.

The X extension was deployed and passed a live unsigned built-in Cloud VPN probe on 2026-11-17: both required hosts returned 200, egress matched Lambda, authentication/407 was enforced, and cleanup was independently confirmed. Local validation also passed all 26 X tests, shared client tests, and real-GOST HTTPS checks. Authenticated account/API collection was not exercised by acceptance. Run setup in a new Cloud task if its snapshot lacks the X virtual environment; do not claim unsigned success proves account authorization.

## Collect and reuse

```bash
# Start at the newest page; paginate until X stops or an explicit failure occurs.
bash tools/x/run.sh refresh

# Continue the cursor saved by an interrupted/limited scan.
bash tools/x/run.sh refresh --resume

# Additional feeds, collected only when requested.
bash tools/x/run.sh refresh --collections posts replies media

# Cached lists and text search; these commands never initialize an X client.
bash tools/x/run.sh list --collection likes
bash tools/x/run.sh search 'phrase' --collection bookmarks
bash tools/x/run.sh --offline search 'phrase'

# Numeric post ID or an X/Twitter status URL. Read the cache first.
bash tools/x/run.sh get POST_ID_OR_URL
bash tools/x/run.sh --offline get POST_ID_OR_URL
# Explicitly refresh an existing post snapshot, or retry an unavailable post.
bash tools/x/run.sh get POST_ID_OR_URL --refresh

# Folder inventory is cached; use --refresh to contact X.
bash tools/x/run.sh folders --refresh
bash tools/x/run.sh refresh --collections bookmarks --folder FOLDER_ID
bash tools/x/run.sh search 'phrase' --collection folder-FOLDER_ID
```

Global options (`--offline`, `--account`) go **before** the subcommand. `--offline` forbids both X and S3 access. Without it, cache commands may restore the S3 index and download missing post objects lazily, but still never call X. `get` contacts X only when its source is missing/invalid or `--refresh` was requested. A fresh session or account verification is unnecessary for readable cached posts.

`refresh` defaults to likes and bookmarks, with one second between pages. There is no arbitrary candidate/page cap. An explicit `--max-pages N` stops each requested collection after N pages and records partial coverage; use `--resume` to continue. A new refresh starts at the top to discover new likes/bookmarks; it does not stop merely because an already cached post appears. Repeated cursors on nonempty pages, expired sessions, schema changes, access restrictions, rate limits, and upload errors retain local progress and incomplete coverage. Rate limits stop collection instead of triggering a request loop. Use one workflow command at a time; a local file lock enforces this.

A collection retains the union of previously observed post IDs. Removing a like/bookmark does not delete its source from the archive. `list --collection likes --latest` selects the last scan that reached X's reachable end. While a newer scan is incomplete, that completed snapshot remains separately identified. Feed order is observation order, not an exact like/bookmark timestamp. `replies` is X's **posts and replies** feed, not replies alone; `media` is its user-media feed. These are not account browsing/watch history. There is no claim that X exposes every historical item. `reachable_end` means the endpoint returned no further bottom continuation or a recognized cursor-only page with no post items, not that lifetime completeness was established. Search failures/empty results cannot prove absence outside cached coverage.

## Cache contents and persistence

All private runtime data is ignored under `.codex/tmp/x/`:

- `auth/storage-state.json`: local X session, never uploaded.
- `account.json`: last verified account, private and local.
- `api/operations.json`: discovered operation IDs and feature names, local only.
- `accounts/ACCOUNT_ID/index.json`: post retrieval state, collection membership, per-scan coverage/cursors, and folder inventory.
- `accounts/ACCOUNT_ID/posts/POST_ID.json`: structured source content and retrieval time, including full long-post text, author, creation time, entities, media URLs, reply reference, and embedded quote/repost references. Available embedded posts are cached separately. HTML entities are decoded for readable text; source wording is otherwise preserved. Media **files** and linked external pages are not downloaded. Long articles retain content fields returned by X; omitted source fields cannot be reconstructed.
- `.venv/`, installed versions, locks, and private setup results: local runtime only.

A post is atomically saved before its index entry, and each page checkpoints its continuation only after its sources. Normal refreshes reuse existing valid source snapshots. Explicit post refresh replaces the local snapshot; S3 content addressing and bucket versioning retain old remote bytes. Cached content remains usable if the source is later unavailable. Failed retrievals distinguish retryable access/schema/network failures from explicit unavailable-post responses.

Deploy the private [S3 stack](../infra/x-cache/README.md) for reuse across tasks. Configure `X_CACHE_BUCKET` or ignored `.codex/tmp/x/s3-config.json`; use a scoped AWS identity in `us-west-1`. This uses a separate X cache bucket, leaving the YouTube cache unchanged. Only account indexes and validated post JSON are synced, with immutable SHA-256 post keys and conditional index merges. Remote indexes use gzip content encoding to keep large archive refreshes efficient; local indexes remain readable JSON. Posts upload before their index references. Sessions, HTML, JS assets, dependency folders, and arbitrary cache files never sync. Local progress survives sync failure; it is durable only after successful sync. `--offline` is local-only regardless of S3 configuration.

```bash
bash tools/x/run.sh sync
```

On a fresh Cloud task, set `X_CACHE_BUCKET`, `X_ACCOUNT_ID`, and a scoped AWS identity; cached search/get works without an X session. The S3 client conditionally initializes an empty account manifest if necessary without overwriting an existing one. This avoids treating a scoped `AccessDenied` response as an empty archive and needs no bucket-list permission. Account IDs isolate archives; they are runtime configuration, never code constants.

## Website API analysis

Verified against the authenticated X web build during implementation on 2026-11-17. These are unsupported website operations and can change independently of the official paid API.

| Source | Read operation | Principal variables |
| --- | --- | --- |
| Account identity | `Viewer` | `withCommunitiesMemberships` |
| Own likes | `Likes` | `userId`, `count`, `cursor` |
| Bookmarks | `Bookmarks` | `count`, `cursor` |
| Own posts | `UserTweets` | `userId`, `count`, `cursor` |
| Posts and replies | `UserTweetsAndReplies` | `userId`, `count`, `cursor` |
| User media | `UserMedia` | `userId`, `count`, `cursor` |
| Bookmark folders | `BookmarkFoldersSlice` | optional `cursor` |
| Folder posts | `BookmarkFolderTimeline` | `bookmark_collection_id`, `count`, `cursor` |
| Individual source | `TweetResultByRestId` | `tweetId` |

Requests are `GET https://x.com/i/api/graphql/QUERY_ID/OPERATION`, with JSON-encoded `variables`, `features`, and `fieldToggles`. They carry the site's public application bearer, the authenticated X cookies, the `ct0` value as `x-csrf-token`, `OAuth2Session` auth type, and a per-request `x-client-transaction-id`. The client discovers query IDs and required feature names from X's current authenticated main bundle and bookmark chunks. Boolean feature values come from the account's initial web configuration. It never evaluates downloaded JavaScript or executes post/page content. No stale hard-coded query IDs are used.

Bookmark collections require account authorization from X. A folder query rejected with GraphQL error 37 is reported as an access limitation, never as an empty folder inventory.

The public logged-out frontend can differ from the authenticated frontend. Discovery requires a supported authenticated build; an unexpected frontend produces a visible error. The transaction-header adapter is pinned to `xclienttransaction==1.0.3`. It consumes the site's current home metadata and `ondemand.s` asset; a changed algorithm or challenge fails explicitly. All network destinations are restricted to X and its asset host, redirects are rejected, and only the read-operation allowlist is callable. Requests do not increment view counters through separate impression/analytics APIs.

Timelines use instructions (`TimelineAddEntries`, modules, replacement entries), timeline items containing tweet results, and a bottom cursor. UserMedia can keep advancing a cursor on empty pages; a recognized cursor-only response ends the scan. A repeated cursor on a nonempty page remains a partial result. Quoted posts are source context rather than extra likes/bookmarks. Promoted items are excluded. Normalization unwraps visibility results and prefers `note_tweet` text over the truncated legacy text. Account identity is verified before collection; account-scoped caches prevent accidental session mixing. There are no endpoints for posting, liking, removing bookmarks, direct messages, or changing settings in this client.

Primary implementation references: X's authenticated website bundles (discovered per run and recorded privately), [Twikit read-query implementation](https://github.com/d60/twikit/blob/main/twikit/client/gql.py), and the [XClientTransaction source and adapter interface](https://github.com/iSarabjitDhiman/XClientTransaction). Live discovery is the authority for query IDs; third-party endpoint constants are not used.

## Checks

```bash
.codex/tmp/x/.venv/bin/python -m unittest discover -s tests/x -v
bash -n tools/x/setup.sh tools/x/run.sh infra/x-cache/deploy.sh
```

Tests use synthetic sources only. Do not commit posts, account membership, cookie values, private source responses, or S3 manifests as fixtures. The workflow has no GitHub Actions or website-build integration. Only requested short verified quotations may later enter published notes, following `AGENTS.md`.
