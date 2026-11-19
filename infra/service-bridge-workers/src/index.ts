import { captionProbe } from "./captions";
import { cancel, type Env, failure, outbound, ProbeError, readText, type Route, upstreamRequest } from "./network";

const IP_ENDPOINT = "https://checkip.amazonaws.com/";
const DIAGNOSTIC_PATH = /^\/v1\/diagnostics\/(egress|captions)\/(ordinary|gateway)$/;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("x-bridge-version", "1");
  return Response.json(data, { status, headers: responseHeaders });
}

function observedIp(value: string): string {
  const input = value.trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(input) &&
      input.split(".").every(part => Number(part) < 256 && String(Number(part)) === part)) return input;
  if (input.includes(":") && /^[0-9a-f:.]+$/i.test(input)) {
    try {
      return new URL(`https://[${input}]/`).hostname.slice(1, -1);
    } catch {
      // Treat malformed observation bodies as unverified.
    }
  }
  throw new ProbeError("invalid_ip_observation");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const diagnostic = DIAGNOSTIC_PATH.exec(url.pathname);
    const health = url.pathname === "/v1/health";
    if (url.protocol !== "https:" || url.search || url.hash ||
        (!health && (!diagnostic || env.DIAGNOSTICS_ENABLED !== "true"))) {
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
    if (health) return json({ ok: true, diagnostics: env.DIAGNOSTICS_ENABLED === "true" });

    const [, kind, name] = diagnostic!;
    const route = name as Route;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(kind === "egress" ? 10_000 : 45_000)]);
    const startedAt = new Date().toISOString();
    try {
      const send = upstreamRequest(outbound(route, env), signal);
      if (kind === "captions") return json({ route, startedAt, ...await captionProbe(send, signal) });
      const response = await send(IP_ENDPOINT, { method: "GET" });
      if (response.status !== 200) {
        cancel(response.body);
        throw new ProbeError(response.status >= 300 && response.status < 400
          ? "redirect_rejected" : "upstream_http", response.status);
      }
      const ip = observedIp(await readText(response, 128));
      return json({ ok: true, route, startedAt, upstreamStatus: response.status, ip });
    } catch (error) {
      return json({ ok: false, route, startedAt, ...failure(error, signal) });
    }
  },
} satisfies ExportedHandler<Env>;
