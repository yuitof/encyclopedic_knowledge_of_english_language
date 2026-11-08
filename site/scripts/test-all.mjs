import { spawnSync } from "node:child_process";
for (const args of [
  ["--test", "tests/publication.test.mjs", "tests/sort-ranks.test.mjs"],
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  ["--test", "tests/feature-fixture.test.mjs"],
  ["scripts/test-paths.mjs"],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
