const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!/^[a-f0-9]{32}$/.test(account ?? "") || !token) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and an account-scoped read-only CLOUDFLARE_API_TOKEN.");
  process.exit(2);
}

const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function read(path) {
  const response = await fetch(base + path, {
    headers: { authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("HTTP " + response.status);
  }
  const payload = await response.json();
  if (!payload.success || payload.result == null) throw new Error("Invalid API result");
  return payload;
}

async function all(path) {
  const rows = [];
  for (let page = 1; ; page++) {
    const { result, result_info: info } = await read(`${path}?page=${page}&per_page=100`);
    if (!Array.isArray(result)) throw new Error("Invalid listing");
    rows.push(...result);
    if (result.length === 0 || (info?.total_pages ? page >= info.total_pages : result.length < 100)) return rows;
  }
}

const workerName = "service-bridge-workers";
const sections = {
  worker: async () => {
    const row = (await all("/workers/workers")).find(item => item.name === workerName);
    return row ? { id: row.id, subdomain: row.subdomain } : { found: false };
  },
  access: async () => {
    const apps = await all("/access/apps");
    return apps.flatMap(app => {
      const types = (app.destinations ?? []).map(item => item.type);
      const accountWide = types.includes("all_workers") || types.includes("all_preview_workers");
      const namedBridge = (app.name ?? "").includes(workerName);
      return accountWide || namedBridge ? [{ id: app.id, namedBridge, types }] : [];
    });
  },
  gateway: async () => {
    const { result } = await read("/gateway/configuration");
    return {
      tlsDecryption: result.settings?.tls_decrypt?.enabled ?? null,
      regionalTlsDecryption: Object.fromEntries(Object.entries(result.settings?.regions ?? {})
        .map(([region, value]) => [region, value.tls_decrypt?.enabled ?? null])),
    };
  },
  gatewayLogging: async () => {
    const { result } = await read("/gateway/logging");
    return { redactPII: result.redact_pii ?? null,
      http: result.settings_by_rule_type?.http, network: result.settings_by_rule_type?.l4 };
  },
  gatewayRules: async () => {
    const { result } = await read("/gateway/rules");
    if (!Array.isArray(result)) throw new Error("Invalid rule listing");
    return result.filter(rule => rule.enabled).map(({ action, filters, precedence }) => ({
      action, filters, precedence,
    }));
  },
};

for (const [name, inspect] of Object.entries(sections)) {
  try {
    console.log(JSON.stringify({ section: name, result: await inspect() }));
  } catch (error) {
    const message = /^HTTP \d{3}$/.test(error?.message) ? error.message : "request or schema failure";
    console.error(`${name}: ${message}`);
    process.exitCode = 1;
  }
}
