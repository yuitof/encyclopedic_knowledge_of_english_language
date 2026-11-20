import {
  cancel,
  type Env,
  failure,
  outbound,
  ProbeError,
  readText,
  upstreamRequest,
} from "./network";

interface RelayEnv extends Env {
  RELAY_ENABLED?: string;
}

const BASE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-bridge-version": "1",
  "x-bridge-response": "error",
  "x-content-type-options": "nosniff",
};

const X_OPERATIONS = new Set([
  "Viewer",
  "Likes",
  "Bookmarks",
  "BookmarkFoldersSlice",
  "BookmarkFolderTimeline",
  "UserTweets",
  "UserTweetsAndReplies",
  "UserMedia",
  "TweetResultByRestId",
]);

const X_HEADERS = new Set([
  "accept",
  "accept-language",
  "authorization",
  "cookie",
  "referer",
  "user-agent",
  "x-client-transaction-id",
  "x-csrf-token",
  "x-twitter-active-user",
  "x-twitter-auth-type",
  "x-twitter-client-language",
]);

const REDDIT_COLLECTIONS = new Set([
  "upvoted",
  "saved",
  "downvoted",
  "hidden",
  "submitted",
  "comments",
]);

const REDDIT_HEADERS = new Set(["accept", "cookie", "user-agent"]);
const ENVELOPE_KEYS = new Set(["parameters", "query", "headers", "body"]);
const GRAPHQL_QUERY_KEYS = new Set(["variables", "features", "fieldToggles"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: Iterable<string>): boolean {
  const names = new Set(allowed);
  return Object.keys(value).every((key) => names.has(key));
}

function encode(value: object): string {
  return JSON.stringify(value);
}

function validatedHeaders(raw: unknown, allowed: Set<string>): Headers {
  if (!isRecord(raw)) throw new ProbeError("invalid_relay_request");
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    const lower = name.toLowerCase();
    if (!allowed.has(lower) || typeof value !== "string" || value.length > 16_384 ||
        /[\r\n]/.test(value)) throw new ProbeError("invalid_relay_request");
    headers.set(lower, value);
  }
  return headers;
}

function graphqlQuery(value: unknown): string {
  if (typeof value !== "string" || value.length > 16_384 || value.startsWith("?") ||
      value.includes("#") || /[\s\\]/.test(value)) throw new ProbeError("invalid_relay_request");
  const parsed = new URLSearchParams(value);
  const names = [...parsed.keys()];
  if (new Set(names).size !== names.length || names.some((name) => !GRAPHQL_QUERY_KEYS.has(name))) {
    throw new ProbeError("invalid_relay_request");
  }
  return value;
}

function targetFor(service: string, operation: string, parameters: Record<string, unknown>, query: unknown) {
  if (isRecord(parameters) === false) throw new ProbeError("invalid_relay_request");
  if (service === "x") {
    if (operation === "home") {
      if (!hasExactKeys(parameters, []) || query !== "") throw new ProbeError("invalid_relay_request");
      return {url: "https://x.com/home", headers: X_HEADERS};
    }
    if (operation === "graphql") {
      if (!hasExactKeys(parameters, ["queryId", "operationName"]) ||
          typeof parameters.queryId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(parameters.queryId) ||
          typeof parameters.operationName !== "string" || !X_OPERATIONS.has(parameters.operationName)) {
        throw new ProbeError("invalid_relay_request");
      }
      return {
        url: `https://x.com/i/api/graphql/${parameters.queryId}/${parameters.operationName}?${graphqlQuery(query)}`,
        headers: X_HEADERS,
      };
    }
    if (operation === "asset") {
      if (!hasExactKeys(parameters, ["asset"]) || typeof parameters.asset !== "string" ||
          !/^(?:main|bundle|shared~|ondemand)[A-Za-z0-9._~-]{1,160}\.js$/.test(parameters.asset) ||
          query !== "") throw new ProbeError("invalid_relay_request");
      return {
        url: `https://abs.twimg.com/responsive-web/client-web/${parameters.asset}`,
        headers: X_HEADERS,
      };
    }
    throw new ProbeError("unsupported_operation");
  }

  if (service === "reddit") {
    if (operation === "home") {
      if (!hasExactKeys(parameters, []) || query !== "") throw new ProbeError("invalid_relay_request");
      return {url: "https://old.reddit.com/", headers: REDDIT_HEADERS};
    }
    if (operation === "identity") {
      if (!hasExactKeys(parameters, []) || query !== "") throw new ProbeError("invalid_relay_request");
      return {url: "https://old.reddit.com/api/me.json", headers: REDDIT_HEADERS};
    }
    if (operation === "listing") {
      if (!hasExactKeys(parameters, ["account", "collection", "after"]) ||
          typeof parameters.account !== "string" || !/^[A-Za-z0-9_-]{3,20}$/.test(parameters.account) ||
          typeof parameters.collection !== "string" || !REDDIT_COLLECTIONS.has(parameters.collection) ||
          (parameters.after !== null &&
            (typeof parameters.after !== "string" || !/^t[13]_[a-z0-9]{1,16}$/.test(parameters.after))) ||
          query !== "") throw new ProbeError("invalid_relay_request");
      const params = new URLSearchParams({limit: "100", raw_json: "1"});
      if (parameters.after) params.set("after", parameters.after);
      return {
        url: `https://old.reddit.com/user/${parameters.account}/${parameters.collection}.json?${params}`,
        headers: REDDIT_HEADERS,
      };
    }
    if (operation === "comments") {
      if (!hasExactKeys(parameters, ["permalink"]) || typeof parameters.permalink !== "string" ||
          parameters.permalink.length > 4096 || query !== "") throw new ProbeError("invalid_relay_request");
      let url: URL;
      try {
        url = new URL(parameters.permalink);
      } catch {
        throw new ProbeError("invalid_relay_request");
      }
      if (url.protocol !== "https:" || !["reddit.com", "www.reddit.com", "old.reddit.com"].includes(url.hostname) ||
          url.port || url.username || url.password || url.search || url.hash ||
          url.pathname.length > 3000 ||
          !/^\/(?:r\/[A-Za-z0-9_]+\/)?comments\/[a-z0-9]{1,16}(?:\/[A-Za-z0-9._~%+-]+(?:\/[a-z0-9]{1,16})?)?\/?$/
            .test(url.pathname)) {
        throw new ProbeError("invalid_relay_request");
      }
      return {
        url: `https://old.reddit.com${url.pathname.replace(/\/?$/, "/")}?context=0`,
        headers: REDDIT_HEADERS,
      };
    }
    throw new ProbeError("unsupported_operation");
  }
  throw new ProbeError("unsupported_operation");
}

export async function relay(request: Request, env: RelayEnv): Promise<Response> {
  const inbound = new URL(request.url);
  if (env.RELAY_ENABLED !== "true") {
    return Response.json({error: "not_found"}, {status: 404, headers: BASE_HEADERS});
  }
  if (request.method !== "POST" || inbound.search || inbound.hash || inbound.protocol !== "https:") {
    return Response.json({error: "method_or_url_not_allowed"}, {status: 405, headers: BASE_HEADERS});
  }
  const match = /^\/v1\/relay\/(x|reddit)\/(home|graphql|asset|identity|listing|comments)$/.exec(inbound.pathname);
  if (!match) return Response.json({error: "unsupported_operation"}, {status: 404, headers: BASE_HEADERS});

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]);
  let target: ReturnType<typeof targetFor>;
  let headers: Headers;
  try {
    if (!request.body) throw new ProbeError("invalid_relay_request");
    const envelope = JSON.parse(await readText(new Response(request.body), 262_144));
    if (!isRecord(envelope) || !hasExactKeys(envelope, ENVELOPE_KEYS) ||
        envelope.body !== null || !isRecord(envelope.parameters)) {
      throw new ProbeError("invalid_relay_request");
    }
    target = targetFor(match[1], match[2], envelope.parameters, envelope.query);
    headers = validatedHeaders(envelope.headers, target.headers);
  } catch {
    return Response.json({error: "invalid_relay_request"}, {status: 400, headers: BASE_HEADERS});
  }

  try {
    const send = upstreamRequest(outbound("gateway", env), signal);
    const response = await send(target.url, {method: "GET", headers});
    const output = new Headers(BASE_HEADERS);
    output.set("x-origin-http", String(response.status));
    output.set("x-bridge-response", "upstream");
    const contentType = response.headers.get("content-type");
    if (contentType) output.set("content-type", contentType);
    for (const value of response.headers.getSetCookie()) {
      output.append("x-origin-set-cookie", encodeURIComponent(value));
    }
    try {
      const body = await readText(response, 12_000_000);
      return new Response(body, {status: 200, headers: output});
    } catch (error) {
      cancel(response.body);
      throw error;
    }
  } catch (error) {
    return Response.json(failure(error, signal), {status: 502, headers: BASE_HEADERS});
  }
}
