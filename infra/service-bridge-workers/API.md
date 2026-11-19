# HTTPS API

## Implemented diagnostics

Use HTTPS to the approved Worker hostname. Send both service-token headers on every request.

```http
CF-Access-Client-Id: <client id>
CF-Access-Client-Secret: <client secret>
```

The edge may return an Access denial or a login redirect before the Worker runs. Clients use manual redirect handling for all API calls. Worker responses carry `X-Bridge-Version: 1`, `Cache-Control: no-store`, and JSON. A valid service-token test verifies the version header and expected body. Worker-local tests exercise the handler behind the edge enforcement.

| Request | Successful JSON body |
| --- | --- |
| `GET /v1/health` | `{"ok":true,"diagnostics":false}` (or `true` when explicitly enabled). No upstream traffic. |
| `GET /v1/diagnostics/egress/ordinary` | `{"ok":true,"route":"ordinary","startedAt":"<UTC ISO 8601>","upstreamStatus":200,"ip":"<observed IP>"}`. Ordinary Worker fetch to `https://checkip.amazonaws.com/`. |
| `GET /v1/diagnostics/egress/gateway` | Same schema with `route: "gateway"` and the VPC Network binding. |
| `GET /v1/diagnostics/captions/ordinary` | `{"ok":true,"route":"ordinary","startedAt":"<UTC ISO 8601>","statuses":{"watch":200,"player":200,"timedtext":200},"playability":{"status":"OK"},"captionType":"manual","language":"en","segments":286}`. The count shown is illustrative. The video is fixed to `aircAruvnKk`. |
| `GET /v1/diagnostics/captions/gateway` | Same schema with `route: "gateway"` and the VPC Network binding for all steps. |

Requests have no body or query parameters. Unsupported or disabled routes return 404 and an enabled route with the wrong method returns 405. A probe returning a result uses HTTP 200 and `ok: false` for failed measurements. The result includes `error`, `route`, `startedAt`, `upstreamStatus` when known, and caption-stage fields when available. Common codes are `gateway_binding_unavailable`, `upstream_failure`, `upstream_deadline`, `upstream_http`, `redirect_rejected`, `response_too_large`, `invalid_ip_observation`, `player_configuration_missing`, `invalid_player_response`, `video_access_restricted`, `manual_english_track_missing`, `invalid_caption_url`, `proof_token_required`, and `invalid_caption_response`. `playability` may contain known safe `reason` and `messages` or redacted values. The timestamps identify probe start, not IP stability.

Egress budget is ten seconds and 128 bytes. Caption budget is 45 seconds total, with limits of 8 MB watch HTML, 4 MB player JSON, and 4 MB timedtext. The Worker never automatically retries or follows redirects. Caption flow starts with an empty in-memory cookie jar for upstream-issued guest cookies. No client headers are copied into subrequests. Signed caption URLs are used only after validating authority, scheme, port, path and video ID and are omitted from output. No signed URL, response body, cookie, or credential is logged by the Worker.

## Proposed collector relay

The following interface is reserved for the next phase and may be revised using acceptance evidence. `POST /v1/relay/{operation}` uses the same Access headers and a UTF-8 `application/json` envelope. The public URL path carries only an operation name, so the signed query and upstream credentials can be kept in the HTTPS body.

```json
{
  "parameters": {"videoId": "aircAruvnKk"},
  "query": "v=aircAruvnKk&hl=en",
  "headers": {"accept-language": "en-US,en;q=0.9"},
  "body": null
}
```

Operations set the HTTPS hostname, port 443, method and path. Parameters are narrowly typed path components or closed enums. Query is the exact percent-encoded query string with no leading `?`. Use an empty string when absent. Validate permitted keys per operation (including duplicate and fragment handling) and preserve accepted encoded bytes for signed timedtext. `body` is null for GET. For POST it is the raw JSON document as a string. Validate its operation-specific shape before forwarding it unchanged. Unknown fields, operations, extra paths, percent escapes in path parameters, ambiguous authorities, IP literals, arbitrary origins and methods are rejected. Verify the account's Gateway DNS and private-route configuration and enforce permitted public destinations at the routing boundary before allowing general relay traffic.

| Operation | HTTPS request fixed by the Worker |
| --- | --- |
| `youtube.history` | `GET www.youtube.com/feed/history?hl=en`. |
| `youtube.browse` | `POST www.youtube.com/youtubei/v1/browse`, optional `key` and `prettyPrint=false`. Validate read-only `FEhistory` bootstrap or a continuation with client context. |
| `youtube.watch` | `GET www.youtube.com/watch` with exact validated `v` and `hl=en`. |
| `youtube.player` | `POST www.youtube.com/youtubei/v1/player` with public `key`, Android context and validated `videoId`. |
| `youtube.timedtext` | `GET /api/timedtext`. Host enum of `www.youtube.com` (default) or `youtube.com`. Signed query passed unchanged after validation. |
| `x.home` | `GET x.com/home`. |
| `x.graphql` | `GET x.com/i/api/graphql/{queryId}/{operationName}`. Bounded query ID and closed read-operation list. Query keys `variables`, `features`, `fieldToggles`. |
| `x.asset` | `GET abs.twimg.com/responsive-web/client-web/{bundle}.js` for a validated single component and expected bundle forms. No upstream cookies or authorization. |
| `reddit.home` | `GET old.reddit.com/`. |
| `reddit.listing` | `GET old.reddit.com/user/{account}/{collection}/` with validated account, allowed collection, `limit=100`, optional cursor `after`. |
| `reddit.comments` | `GET old.reddit.com/[r/{subreddit}/]comments/{postId}/…?context=0` with validated permalink components. |

X read operation names are `Viewer`, `Likes`, `Bookmarks`, `BookmarkFoldersSlice`, `BookmarkFolderTimeline`, `UserTweets`, `UserTweetsAndReplies`, `UserMedia`, and `TweetResultByRestId`. Reddit HTML collections are `upvoted`, `saved`, `downvoted`, `hidden`, `submitted`, and `comments`.

Forward an explicit per-operation request-header allowlist under `headers`. User-agent and accept headers, content type, and validated Origin and Referer may be required. YouTube history/browse needs scoped `Cookie`, `Authorization: SAPISIDHASH …`, `X-Origin`, `X-Goog-Authuser`, `X-Goog-PageId`, `X-Goog-Visitor-Id`, `X-Youtube-Client-Name` and `X-Youtube-Client-Version` as applicable. X home/API needs scoped `Cookie`, API `Authorization: Bearer …`, CSRF, transaction ID and X client headers. Old Reddit HTML needs a scoped `Cookie` and the existing user-agent. Never copy connection headers, host, arbitrary metadata, Access settings or inbound cookies into upstream requests.

Response proposal is a streamed HTTP body with allowed metadata and actual upstream status, marked by `X-Bridge-Version: 1` and `X-Bridge-Response: upstream`. Preserve the decoded entity bytes and matching `Content-Type`. Forward allowlisted rate-limit/retry headers. Report upstream redirects by status while suppressing `Location`, with no fetch of the redirect target. Strip upstream `Set-Cookie` at the Worker hostname. If existing collectors rely on upstream cookie rotation, agree on scoped cookie metadata for the client cookie jar before integration. Clear stale encoding and length metadata whenever decoding or transforming. Force no-store and attachment semantics for HTML/script data.

Bridge-generated failures use `X-Bridge-Response: error` and `{"error":"<fixed code>"}`. Proposed statuses are 400 for malformed requests, 404 for unknown operation, 405 for wrong relay method, 413 for excess request size, 502 for egress or response-limit failure, and 504 for upstream wall timeout. Access denials lack the Worker response marker. An upstream or Gateway-generated HTTP 403 may be an ordinary upstream-shaped response. Attribute it to Gateway only with matching policy evidence. A size or timeout breach after stream headers have been sent aborts the stream and is a read failure. Never persist partial bodies.

Initial budgets to validate with fixtures are 256 KiB envelope, 16 KiB query, 32 KiB combined upstream request headers, 12,000,000 decoded response bytes, 50 seconds including streaming, and one outbound attempt via Gateway. The client may retain its existing bounded retry behavior for read-only operations and recognized transient failures. Never retry Access denials, unsafe redirects, policy denials, or invalid requests automatically. Keep cache storage and synchronization in the application.
