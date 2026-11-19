import { isIP } from "node:net";

const { SERVICE_BRIDGE_WORKER_URL, SERVICE_BRIDGE_WORKER_PREVIEW_URL,
  CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET } = process.env;
const run = process.argv[2];
if (!["access", "egress", "captions"].includes(run) ||
    !SERVICE_BRIDGE_WORKER_URL || !CF_ACCESS_CLIENT_ID || !CF_ACCESS_CLIENT_SECRET) {
  console.error("Use acceptance -- access|egress|captions with SERVICE_BRIDGE_WORKER_URL and private CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET.");
  process.exit(2);
}

function endpoint(raw, preview = false) {
  const url = new URL(raw);
  const prefix = preview ? "[a-z0-9-]+-" : "";
  const host = new RegExp(`^${prefix}service-bridge-workers\\.[a-z0-9-]+\\.workers\\.dev$`);
  if (url.protocol !== "https:" || !host.test(url.hostname) || url.port ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
  return url.origin;
}

async function get(base, path, headers) {
  return fetch(base + path, { headers, redirect: "manual", signal: AbortSignal.timeout(55_000) });
}

const valid = { "CF-Access-Client-Id": CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": CF_ACCESS_CLIENT_SECRET };
const invalid = { ...valid, "CF-Access-Client-Secret": "invalid-synthetic-service-token" };

function fromWorker(response) {
  return response.headers.get("x-bridge-version") === "1";
}

async function verifyAccess(base, label) {
  for (const [credentials, headers] of [["missing", {}], ["invalid", invalid], ["valid", valid]]) {
    const response = await get(base, "/v1/health", headers);
    const reachedWorker = fromWorker(response);
    const pass = credentials === "valid"
      ? reachedWorker && response.status === 200 && (await response.json()).ok === true
      : !reachedWorker && [302, 401, 403].includes(response.status);
    if (!response.bodyUsed) await response.body?.cancel();
    console.log(JSON.stringify({ label, credentials, http: response.status, reachedWorker, pass }));
    if (!pass) process.exitCode = 1;
  }
}

async function verifyProbe(base, route) {
  const response = await get(base, `/v1/diagnostics/${run}/${route}`, valid);
  if (!fromWorker(response) || response.status !== 200) {
    await response.body?.cancel();
    console.log(JSON.stringify({ probe: run, route, http: response.status, ok: false }));
    process.exitCode = 1;
    return;
  }
  // These endpoints return diagnostic summaries, never an upstream response body.
  const result = await response.json();
  const pass = result.route === route && result.ok === true && (run === "egress"
    ? Boolean(isIP(result.ip)) && result.upstreamStatus === 200
    : result.captionType === "manual" && /^en(?:-|$)/i.test(result.language) &&
      Number.isInteger(result.segments) && result.segments > 0 && result.playability?.status === "OK" &&
      ["watch", "player", "timedtext"].every(stage => result.statuses?.[stage] === 200));
  console.log(JSON.stringify({ probe: run, route, http: response.status, result, pass }));
  if (!pass) process.exitCode = 1;
}

try {
  const production = endpoint(SERVICE_BRIDGE_WORKER_URL);
  if (run === "access") {
    await verifyAccess(production, "production");
    if (SERVICE_BRIDGE_WORKER_PREVIEW_URL) {
      await verifyAccess(endpoint(SERVICE_BRIDGE_WORKER_PREVIEW_URL, true), "preview");
    } else {
      console.error("Preview Access test pending. Supply the exact approved preview URL.");
      process.exitCode = 1;
    }
  } else {
    for (const route of ["ordinary", "gateway"]) await verifyProbe(production, route);
  }
} catch {
  console.error("Acceptance stopped at URL validation, network/TLS, timeout, or response parsing. No response details logged.");
  process.exitCode = 1;
}
