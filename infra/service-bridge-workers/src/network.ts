export type Outbound = (url: string, init: RequestInit) => Promise<Response>;
export type Route = "ordinary" | "gateway";

export interface Env {
  DIAGNOSTICS_ENABLED?: string;
  EGRESS?: { fetch: Outbound };
}

export class ProbeError extends Error {
  constructor(
    readonly code: string,
    readonly upstreamStatus?: number,
  ) {
    super(code);
  }
}

export function outbound(route: Route, env: Env): Outbound {
  if (route === "ordinary") return (url, init) => fetch(url, init);
  const binding = env.EGRESS;
  if (!binding) throw new ProbeError("gateway_binding_unavailable");
  return (url, init) => binding.fetch(url, init);
}

export function cancel(body: ReadableStream | null): void {
  if (body) void body.cancel().catch(() => {});
}

export async function readText(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) {
    cancel(response.body);
    throw new ProbeError("response_too_large", response.status);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) throw new ProbeError("response_too_large", response.status);
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function upstreamRequest(send: Outbound, signal: AbortSignal): Outbound {
  return (url, init) => send(url, {
    ...init,
    signal,
    redirect: "manual",
    cache: "no-store",
  });
}

export function failure(error: unknown, signal: AbortSignal) {
  return {
    error: signal.aborted ? "upstream_deadline" :
      error instanceof ProbeError ? error.code : "upstream_failure",
    ...(error instanceof ProbeError && error.upstreamStatus !== undefined
      ? { upstreamStatus: error.upstreamStatus } : {}),
  };
}
