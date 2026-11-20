import worker from "./index";
import { captionUrl, validVideoId } from "./captions";
import { cancel, type Env, failure, outbound, readText, upstreamRequest } from "./network";
import { relay } from "./relay";

const headersAllowed = new Set(["user-agent", "accept-language", "accept", "content-type", "cookie"]);
const base = { "cache-control": "no-store", "x-bridge-version": "1" };
const path = "/v1/signed-out-comparison/";
const origin = "https://www.youtube.com";
const envelopeKeys = new Set(["headers", "search", "host", "body", "videoId"]);

interface ComparisonEnv extends Env {
  COMPARISON_ENABLED?: string;
  RELAY_ENABLED?: string;
}

export default {
  async fetch(request: Request, env: ComparisonEnv): Promise<Response> {
    const inbound = new URL(request.url);
    if (inbound.pathname.startsWith("/v1/relay/")) return relay(request, env);
    if (env.COMPARISON_ENABLED !== "true" || !inbound.pathname.startsWith(path)) {
      return worker.fetch(request, env);
    }
    const stage = inbound.pathname.slice(path.length);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(35000)]);
    if (inbound.protocol !== "https:" || inbound.search) {
      return Response.json({error: "invalid_request"}, {status: 400, headers: base});
    }

    const send = () => upstreamRequest(outbound("gateway", env), signal);
    if (stage === "ip" && request.method === "GET") {
      try {
        const response = await send()("https://checkip.amazonaws.com/", {method: "GET"});
        return Response.json({status: response.status, ip: (await readText(response, 128)).trim()},
          {headers:base});
      } catch (error) {
        return Response.json(failure(error, signal), {status:502,headers:base});
      }
    }
    if (request.method !== "POST" || !["watch", "player", "timedtext"].includes(stage)) {
      return Response.json({error: "invalid_request"}, {status: 400, headers:base});
    }

    let target: string;
    let payload: string | undefined;
    let headers: Headers;
    try {
      const source = await readText(new Response(request.body, {
        headers: { "content-length": request.headers.get("content-length") ?? "" },
      }), 65536);
      const data = JSON.parse(source);
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          Object.keys(data).some((name) => !envelopeKeys.has(name)) ||
          !validVideoId(data.videoId)) throw new Error();
      headers = new Headers(data.headers);
      for (const name of headers.keys()) if (!headersAllowed.has(name)) throw new Error();
      if (stage === "watch") {
        if (headers.has("cookie")) throw new Error();
        if (data.search !== `v=${data.videoId}&hl=en` || data.body !== null) throw new Error();
        target = origin + "/watch?" + data.search;
      } else if (stage === "player") {
        if (!/^key=[A-Za-z0-9_-]{1,128}$/.test(data.search)) throw new Error();
        const body = JSON.parse(data.body);
        if (body.videoId !== data.videoId || body.context?.client?.clientName !== "ANDROID" ||
            body.context.client.clientVersion !== "20.10.38" || body.context.client.hl !== "en") throw new Error();
        target = origin + "/youtubei/v1/player?" + data.search;
        payload = data.body;
      } else {
        if (data.host !== "www.youtube.com" && data.host !== "youtube.com") throw new Error();
        if (data.body !== null) throw new Error();
        target = captionUrl("https://" + data.host + "/api/timedtext?" + data.search, data.videoId);
      }
    } catch {
      return Response.json({error: "invalid_envelope"}, {status:400,headers:base});
    }

    try {
      const response = await send()(target, {method:stage === "player" ? "POST" : "GET", headers, body:payload});
      const responseHeaders = new Headers({...base,"x-origin-http":String(response.status)});
      const contentType = response.headers.get("content-type");
      if (contentType) responseHeaders.set("content-type", contentType);
      for (const value of response.headers.getSetCookie()) responseHeaders.append("x-origin-set-cookie", encodeURIComponent(value));
      if (response.status !== 200) {
        cancel(response.body);
        return new Response(null,{status:200,headers:responseHeaders});
      }
      const text = await readText(response, stage === "watch" ? 8_000_000 : 4_000_000);
      return new Response(text,{status:200,headers:responseHeaders});
    } catch (error) {
      return Response.json(failure(error,signal),{status:502,headers:base});
    }
  },
};
