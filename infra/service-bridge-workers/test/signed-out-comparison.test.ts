import { describe, expect, it, vi } from "vitest";
import worker from "../src/signed-out-comparison";
import { VIDEO_ID } from "../src/captions";

const root = "https://bridge.invalid/v1/signed-out-comparison/";
const OTHER_VIDEO_ID = "zyxWVU98765";
const watch = { headers: {}, search: "v=" + VIDEO_ID + "&hl=en", host: "www.youtube.com", body: null, videoId: VIDEO_ID };
const player = {
  headers: { "content-type": "application/json", cookie: "visitor=synthetic" },
  search: "key=synthetic",
  host: "www.youtube.com",
  body: JSON.stringify({ videoId: VIDEO_ID, context: {
    client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" },
  } }),
  videoId: VIDEO_ID,
};
const timedtext = { headers: {}, host: "youtube.com", search: "v=" + VIDEO_ID + "&sig=a%2Fb", body: null, videoId: VIDEO_ID };
function request(stage: string, input: unknown) {
  return new Request(root + stage, {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "content-type": "application/json", "cf-access-client-secret": "synthetic-access" },
  });
}
function environment(send: (url: string, init: RequestInit) => Promise<Response>) {
  return { COMPARISON_ENABLED: "true", EGRESS: { fetch: send } };
}

describe("signed-out comparison relay", () => {
  it("keeps comparison routes disabled unless explicitly enabled", async () => {
    const send = vi.fn();
    expect((await worker.fetch(request("watch", watch), { EGRESS: { fetch: send } })).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns the upstream body and preserves guest cookies for origin-scoped handling", async () => {
    const send = vi.fn(async () => new Response("watch HTML", { headers: [
      ["content-type", "text/html"], ["set-cookie", "visitor=one; Path=/"],
      ["set-cookie", "visitor=two; Path=/watch"],
    ] }));
    const response = await worker.fetch(request("watch", watch), environment(send));
    expect(await response.text()).toBe("watch HTML");
    expect(response.headers.get("x-origin-http")).toBe("200");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-origin-set-cookie")).toContain("visitor%3Done");
    expect(send).toHaveBeenCalledExactlyOnceWith("https://www.youtube.com/watch?" + watch.search,
      expect.objectContaining({ method: "GET", redirect: "manual", cache: "no-store" }));
    const init = send.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).has("cf-access-client-secret")).toBe(false);
  });

  it("forwards the client's player payload unchanged and suppresses redirect targets", async () => {
    const send = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: "http://127.0.0.1/unsafe" },
    }));
    const response = await worker.fetch(request("player", player), environment(send));
    expect(response.headers.get("x-origin-http")).toBe("302");
    expect(response.headers.get("location")).toBeNull();
    expect(send).toHaveBeenCalledExactlyOnceWith("https://www.youtube.com/youtubei/v1/player?key=synthetic",
      expect.objectContaining({ method: "POST", body: player.body, redirect: "manual" }));
  });

  it("preserves signed query bytes on the allowed timedtext path", async () => {
    const send = vi.fn(async () => new Response("captions"));
    await worker.fetch(request("timedtext", timedtext), environment(send));
    expect(send).toHaveBeenCalledExactlyOnceWith("https://youtube.com/api/timedtext?" + timedtext.search,
      expect.objectContaining({ method: "GET", redirect: "manual" }));
  });

  it("supports any valid public YouTube video ID across all stages", async () => {
    const otherWatch = { ...watch, search: "v=" + OTHER_VIDEO_ID + "&hl=en", videoId: OTHER_VIDEO_ID };
    const otherPlayer = { ...player, videoId: OTHER_VIDEO_ID, body: JSON.stringify({
      videoId: OTHER_VIDEO_ID,
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } },
    }) };
    const otherTimedtext = { ...timedtext, videoId: OTHER_VIDEO_ID,
      search: "v=" + OTHER_VIDEO_ID + "&sig=a%2Fb" };
    const send = vi.fn(async () => new Response("ok"));
    for (const [stage, input] of [["watch", otherWatch], ["player", otherPlayer], ["timedtext", otherTimedtext]]) {
      expect((await worker.fetch(request(stage, input), environment(send))).status).toBe(200);
    }
    expect(send.mock.calls.map(([url]) => url)).toEqual([
      "https://www.youtube.com/watch?v=" + OTHER_VIDEO_ID + "&hl=en",
      "https://www.youtube.com/youtubei/v1/player?key=synthetic",
      "https://youtube.com/api/timedtext?v=" + OTHER_VIDEO_ID + "&sig=a%2Fb",
    ]);
  });

  it.each([
    ["watch", { ...watch, videoId: "short" }],
    ["watch", { ...watch, search: "v=" + OTHER_VIDEO_ID + "&hl=en" }],
    ["timedtext", { ...timedtext, host: "127.0.0.1" }],
    ["timedtext", { ...timedtext, search: timedtext.search + "&v=AAAAAAAAAAA" }],
    ["timedtext", { ...timedtext, videoId: OTHER_VIDEO_ID }],
    ["watch", { ...watch, headers: { cookie: "preloaded=synthetic" } }],
    ["player", { ...player, headers: { authorization: "Bearer synthetic" } }],
    ["player", { ...player, headers: { "cf-access-client-secret": "synthetic" } }],
    ["player", { ...player, body: '{"videoId":"AAAAAAAAAAA"}' }],
    ["watch", { ...watch, unsupported: true }],
  ])("rejects forged %s envelopes before egress", async (stage, input) => {
    const send = vi.fn();
    expect((await worker.fetch(request(stage, input), environment(send))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a missing Gateway binding as an error", async () => {
    const response = await worker.fetch(request("watch", watch), { COMPARISON_ENABLED: "true" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "gateway_binding_unavailable" });
  });
});
