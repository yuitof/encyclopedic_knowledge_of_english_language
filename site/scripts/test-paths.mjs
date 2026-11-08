import { spawnSync } from "node:child_process";
import { siteRoot } from "./publish.mjs";
function run(script, env = {}) {
  const result = spawnSync(process.execPath, script, {
    cwd: siteRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`${script.join(" ")} failed`);
}
for (const [output, base] of [
  ["public-root", "example.invalid"],
  ["public-subpath", "example.invalid/knowledge"],
]) {
  const env = { SITE_OUTPUT: output, SITE_BASE_URL: base };
  run(["scripts/build.mjs"], env);
  run(["--test", "tests/output.test.mjs"], env);
}
run(["node_modules/@playwright/test/cli.js", "test"]);
