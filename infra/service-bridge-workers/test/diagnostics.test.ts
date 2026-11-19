import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { captionUrl, countSegments, VIDEO_ID } from "../src/captions";
import { cancel, failure, upstreamRequest } from "../src/network";

const environment = { DIAGNOSTICS_ENABLED: "true" };
const request = (path: string, init?: RequestInit) => new Request("https://bridge.invalid" + path, init);
const egress = "/v1/diagnostics/egress/";
const captions = "/v1/diagnostics/captions/";
const trackUrl = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&sig=synthetic-signed-url`;
const signedOutHtml = '{"INNERTUBE_API_KEY":"synthetic-key"}';
const xml = '<timedtext><head/><body><w/><p t="0" d="200"><s>English &amp; text</s></p></body></timedtext>';
const player = (tracks: object[]) => ({
  playabilityStatus: { status: "OK" },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
});
const manualTrack = { languageCode: "en", baseUrl: trackUrl };

afterEach(() => vi.unstubAllGlobals());

describe("Worker HTTP surface", () => {
  it("serves only inert health in the default runtime configuration", async () => {
    const response = await exports.default.fetch(request("/v1/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-bridge-version")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, diagnostics: false });
    expect((await exports.default.fetch(request(egress + "ordinary"))).status).toBe(404);
  });

  it.each(["/v1/relay", "/v1/diagnostics/egress/private", egress + "ordinary?url=http://127.0.0.1",
    captions + "gateway?v=other", egress + "gateway%2F", "/v1/diagnostics//egress/gateway"])(
    "denies unsupported target %s without egress", async path => {
      const send = vi.fn();
      vi.stubGlobal("fetch", send);
      const response = await worker.fetch(request(path), { ...environment, EGRESS: { fetch: send } });
      expect(response.status).toBe(404);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(["POST", "HEAD", "PUT", "OPTIONS"])("rejects inbound %s", async method => {
    const result = await worker.fetch(request(egress + "gateway", { method }), environment);
    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toBe("GET");
  });

  it("does not call the VPC binding on the ordinary control route", async () => {
    const ordinary = vi.fn(async () => new Response("8.8.8.8\n"));
    const gateway = vi.fn();
    vi.stubGlobal("fetch", ordinary);
    const result = await worker.fetch(request(egress + "ordinary", {
      headers: { cookie: "synthetic", "cf-access-client-id": "synthetic" },
    }), { ...environment, EGRESS: { fetch: gateway } });
    expect(await result.json()).toMatchObject({ ok: true, route: "ordinary", ip: "8.8.8.8", upstreamStatus: 200 });
    expect(ordinary).toHaveBeenCalledExactlyOnceWith("https://checkip.amazonaws.com/", {
      method: "GET", redirect: "manual", cache: "no-store", signal: expect.anything(),
    });
    expect(gateway).not.toHaveBeenCalled();
  });

  it("fails closed with missing or failing Gateway binding", async () => {
    const ordinary = vi.fn();
    vi.stubGlobal("fetch", ordinary);
    const send = vi.fn(async () => { throw new Error("private details"); });
    const missing = await worker.fetch(request(egress + "gateway"), environment);
    expect(await missing.json()).toMatchObject({ ok: false, error: "gateway_binding_unavailable" });
    const failed = await worker.fetch(request(egress + "gateway"), { ...environment, EGRESS: { fetch: send } });
    const data = await failed.text();
    expect(JSON.parse(data)).toMatchObject({ ok: false, error: "upstream_failure" });
    expect(data).not.toContain("private details");
    expect(send).toHaveBeenCalledTimes(1);
    expect(ordinary).not.toHaveBeenCalled();
  });

  it.each([302, 403, 429])("reports only an error code and HTTP %s from upstream", async status => {
    const send = vi.fn(async () => new Response("private body", {
      status, headers: { location: "https://other.invalid/leak", "set-cookie": "private=value" },
    }));
    const failed = await worker.fetch(request(egress + "gateway"), { ...environment, EGRESS: { fetch: send } });
    const data = await failed.text();
    expect(JSON.parse(data)).toMatchObject({ ok: false, upstreamStatus: status,
      error: status === 302 ? "redirect_rejected" : "upstream_http" });
    expect(data).not.toMatch(/private|leak/);
    expect(failed.headers.get("location")).toBeNull();
    expect(failed.headers.get("set-cookie")).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("bounds an upstream response without a content-length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1".repeat(129)));
        controller.close();
      },
    });
    const result = await worker.fetch(request(egress + "gateway"), { ...environment,
      EGRESS: { fetch: async () => new Response(stream) } });
    expect(await result.json()).toMatchObject({ ok: false, error: "response_too_large", upstreamStatus: 200 });
  });

  it("passes a deadline signal to the transport and sanitizes timeout errors", async () => {
    const signal = AbortSignal.timeout(5);
    const send = upstreamRequest(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("private timeout details")));
    }), signal);
    await expect(send("https://test.invalid", {})).rejects.toThrow();
    expect(failure(new Error("private timeout details"), signal)).toEqual({ error: "upstream_deadline" });
    cancel(null);
  });
});

describe("signed-out caption flow", () => {
  it("uses the same route for all three stages and forwards only scoped guest cookies", async () => {
    const start = new Response(signedOutHtml, { headers: [
      ["set-cookie", "visitor=synthetic; Domain=.youtube.com; Secure; Path=/"],
      ["set-cookie", "watchOnly=synthetic; Secure; Path=/watch"],
      ["set-cookie", "foreign=synthetic; Domain=.other.invalid; Secure; Path=/"],
    ] });
    const send = vi.fn()
      .mockResolvedValueOnce(start)
      .mockResolvedValueOnce(Response.json(player([
        { ...manualTrack, kind: "asr" }, { ...manualTrack, languageCode: "de" }, manualTrack,
      ])))
      .mockResolvedValueOnce(new Response(xml));
    const ordinary = vi.fn();
    vi.stubGlobal("fetch", ordinary);
    const response = await worker.fetch(request(captions + "gateway", { headers: {
      "cf-access-client-id": "access-id", "cf-access-client-secret": "access-secret",
      "cf-access-jwt-assertion": "access-jwt", cookie: "personal=synthetic", authorization: "Bearer synthetic",
      host: "dangerous.invalid", "x-forwarded-for": "192.0.2.1",
    } }), { ...environment, EGRESS: { fetch: send } });

    expect(await response.json()).toMatchObject({ ok: true, route: "gateway", segments: 1,
      captionType: "manual", language: "en", statuses: { watch: 200, player: 200, timedtext: 200 } });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(ordinary).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([url]) => url)).toEqual([
      `https://www.youtube.com/watch?v=${VIDEO_ID}&hl=en`,
      "https://www.youtube.com/youtubei/v1/player?key=synthetic-key", trackUrl,
    ]);
    expect(send.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "POST", "GET"]);
    expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } }, videoId: VIDEO_ID,
    });
    for (const [, init] of send.mock.calls) {
      expect(init.redirect).toBe("manual");
      expect(init.cache).toBe("no-store");
      expect([...init.headers.keys()].every(name =>
        ["cookie", "user-agent", "accept", "accept-language", "content-type"].includes(name))).toBe(true);
    }
    expect(send.mock.calls.map(([, init]) => init.headers.get("cookie"))).toEqual([null, "visitor=synthetic", "visitor=synthetic"]);
  });

  it("stops a Gateway caption request when its player fetch fails", async () => {
    const send = vi.fn().mockResolvedValueOnce(new Response(signedOutHtml))
      .mockRejectedValueOnce(new Error("private network details"));
    const ordinary = vi.fn();
    vi.stubGlobal("fetch", ordinary);
    const response = await worker.fetch(request(captions + "gateway"), { ...environment, EGRESS: { fetch: send } });
    expect(await response.json()).toMatchObject({
      ok: false, stage: "player", statuses: { watch: 200 }, error: "upstream_failure",
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(ordinary).not.toHaveBeenCalled();
  });

  it("preserves safe player errors and omits untrusted diagnostics", async () => {
    const send = vi.fn().mockResolvedValueOnce(new Response(signedOutHtml))
      .mockResolvedValueOnce(Response.json({ playabilityStatus: {
        status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot",
        messages: ["This video is unavailable", trackUrl],
      } }));
    const response = await worker.fetch(request(captions + "gateway"), { ...environment, EGRESS: { fetch: send } });
    const data = await response.text();
    expect(JSON.parse(data)).toMatchObject({ ok: false, stage: "player", error: "video_access_restricted",
      playability: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot",
        messages: ["This video is unavailable", "[redacted]"] } });
    expect(data).not.toContain(trackUrl);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps playability from a bounded non-200 player JSON response", async () => {
    const send = vi.fn().mockResolvedValueOnce(new Response(signedOutHtml))
      .mockResolvedValueOnce(Response.json({
        playabilityStatus: { status: "UNPLAYABLE", reason: "This video is unavailable" },
      }, { status: 403 }));
    const response = await worker.fetch(request(captions + "gateway"), { ...environment, EGRESS: { fetch: send } });
    expect(await response.json()).toMatchObject({ ok: false, stage: "player", error: "upstream_http",
      upstreamStatus: 403, playability: { status: "UNPLAYABLE", reason: "This video is unavailable" } });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://www.youtube.com/api/timedtext?v=" + VIDEO_ID,
    trackUrl.replace("www.youtube.com", "169.254.169.254"),
    trackUrl.replace("www.youtube.com", "localhost"),
    trackUrl.replace("www.youtube.com", "[::1]"),
    trackUrl.replace("www.youtube.com", "www.youtube.com@other.invalid"),
    trackUrl.replace("www.youtube.com", "www.youtube.com:8443"),
    trackUrl.replace("www.youtube.com", "www.youtube.com\\@other.invalid"),
    trackUrl.replace("timedtext", "%74imedtext"),
    trackUrl + "#secret",
    trackUrl.replace(VIDEO_ID, "AAAAAAAAAAA"),
    trackUrl + "&exp=xpe",
    trackUrl + "&v=AAAAAAAAAAA",
  ])("rejects unexpected signed caption URL %s before timedtext fetch", async (baseUrl) => {
    const send = vi.fn().mockResolvedValueOnce(new Response(signedOutHtml))
      .mockResolvedValueOnce(Response.json(player([{ ...manualTrack, baseUrl }])));
    const response = await worker.fetch(request(captions + "gateway"), { ...environment, EGRESS: { fetch: send } });
    expect(await response.json()).toMatchObject({ ok: false, stage: "timedtext" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("preserves exact signed query bytes and supports the apex hostname", () => {
    const url = trackUrl.replace("www.youtube.com", "youtube.com") + "&a=%2f&b=x+y&a=%2F";
    expect(captionUrl(url)).toBe(url);
  });

  it("does not count automatic captions as a manual English success", async () => {
    const send = vi.fn().mockResolvedValueOnce(new Response(signedOutHtml))
      .mockResolvedValueOnce(Response.json(player([{ ...manualTrack, kind: "asr" }])));
    const response = await worker.fetch(request(captions + "gateway"), { ...environment, EGRESS: { fetch: send } });
    expect(await response.json()).toMatchObject({ ok: false, stage: "player", error: "manual_english_track_missing" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("counts JSON3, legacy XML and SRV3 captions", () => {
    expect(countSegments(xml)).toBe(1);
    expect(countSegments('<transcript><text start="1.2">Caption</text></transcript>')).toBe(1);
    expect(countSegments('{"events":[{"tStartMs":1,"segs":[{"utf8":"Caption"}]},{"tStartMs":2}]}')).toBe(1);
  });

  it.each(["", "<html>blocked</html>", "<transcript><text>missing timestamp</text></transcript>",
    "<!DOCTYPE transcript><transcript><text start='0'>Caption</text></transcript>",
    '{"events":[{"tStartMs":-3,"segs":[{"utf8":"Caption"}]}]}',
  ])("does not accept non-caption data", (input) => {
    expect(() => countSegments(input)).toThrow("invalid_caption_response");
  });
});
