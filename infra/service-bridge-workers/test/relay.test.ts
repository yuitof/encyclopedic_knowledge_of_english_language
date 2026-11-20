import { describe, expect, it, vi } from "vitest";
import { relay } from "../src/relay";

const endpoint = "https://bridge.invalid/v1/relay/";

function request(path: string, envelope: unknown) {
  return new Request(endpoint + path, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-access-client-secret": "inbound-only" },
    body: JSON.stringify(envelope),
  });
}

function envelope(parameters: object, query = "", headers: object = {}) {
  return { parameters, query, headers, body: null };
}

function environment(send: (url: string, init: RequestInit) => Promise<Response>) {
  return { RELAY_ENABLED: "true", EGRESS: { fetch: send } };
}

describe("X and Reddit relay", () => {
  it("is disabled by default", async () => {
    const send = vi.fn();
    expect((await relay(request("x/home", envelope({})), { EGRESS: { fetch: send } })).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("relays the X home page with an allowlisted cookie session", async () => {
    const send = vi.fn(async () => new Response("x home", {
      headers: { "content-type": "text/html", "set-cookie": "auth_token=synthetic; Path=/; Secure" },
    }));
    const response = await relay(request("x/home", envelope({}, "", {
      "User-Agent": "synthetic", Cookie: "auth_token=synthetic; ct0=synthetic",
    })), environment(send));
    expect(await response.text()).toBe("x home");
    expect(response.headers.get("x-origin-http")).toBe("200");
    expect(response.headers.get("x-origin-set-cookie")).toContain("auth_token%3Dsynthetic");
    const init = send.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("cookie")).toContain("auth_token=synthetic");
    expect(headers.has("cf-access-client-secret")).toBe(false);
  });

  it("allows only documented X GraphQL read operations and query keys", async () => {
    const send = vi.fn(async () => Response.json({data: {ok: true}}, {
      headers: { "content-type": "application/json" },
    }));
    const query = "variables=%7B%7D&features=%7B%7D&fieldToggles=%7B%7D";
    expect((await relay(request("x/graphql", envelope({
      queryId: "abc_123", operationName: "Bookmarks",
    }, query, { Authorization: "Bearer synthetic", "x-csrf-token": "synthetic" })), environment(send))).status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toContain("/i/api/graphql/abc_123/Bookmarks?");
  });

  it("builds Reddit listing paths from typed parameters", async () => {
    const send = vi.fn(async () => Response.json({kind: "Listing", data: {children: [], after: null}}));
    await relay(request("reddit/listing", envelope({
      account: "synthetic_user", collection: "upvoted", after: "t3_abc",
    }, "", { "User-Agent": "synthetic", Cookie: "reddit_session=synthetic" })), environment(send));
    expect(send.mock.calls[0][0]).toBe(
      "https://old.reddit.com/user/synthetic_user/upvoted.json?limit=100&raw_json=1&after=t3_abc",
    );
  });

  it("normalizes an allowed Reddit comments permalink to Old Reddit", async () => {
    const send = vi.fn(async () => new Response("<html>source</html>", {
      headers: { "content-type": "text/html" },
    }));
    await relay(request("reddit/comments", envelope({
      permalink: "https://www.reddit.com/r/Example/comments/abc123/example-title/",
    }, "", { Cookie: "reddit_session=synthetic", "User-Agent": "synthetic" })), environment(send));
    expect(send.mock.calls[0][0]).toBe(
      "https://old.reddit.com/r/Example/comments/abc123/example-title/?context=0",
    );
  });

  it.each([
    ["x/graphql", envelope({ queryId: "abc", operationName: "MUTATION" }, "variables=%7B%7D")],
    ["x/graphql", envelope({ queryId: "abc", operationName: "Viewer" }, "variables=%7B%7D&url=http%3A%2F%2Fevil")],
    ["x/asset", envelope({ asset: "../../secrets.js" })],
    ["reddit/listing", envelope({ account: "../other", collection: "saved", after: null })],
    ["reddit/listing", envelope({ account: "valid_user", collection: "private", after: null })],
    ["reddit/comments", envelope({ permalink: "http://old.reddit.com/r/x/comments/abc/title/" })],
    ["reddit/comments", envelope({ permalink: "https://old.reddit.com/api/me.json" })],
  ])("rejects unsafe or unsupported %s envelopes", async (path, input) => {
    const send = vi.fn();
    const response = await relay(request(path, input), environment(send));
    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed without the Gateway binding", async () => {
    const response = await relay(request("reddit/home", envelope({})), { RELAY_ENABLED: "true" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "gateway_binding_unavailable" });
  });
});
