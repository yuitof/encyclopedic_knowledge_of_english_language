import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { preparePublication, siteRoot, repositoryRoot } from "./publish.mjs";
import { ensureVaultCheckout } from "./vault-checkout.mjs";
import { enrichSortRanks } from "./sort-ranks.mjs";
import {
  checkedGraphAssets,
  copyGraphAssets,
  trustedStatic,
  trustedMath,
  copyMathFonts,
  copySiteAssets,
} from "./trusted-static.mjs";

process.chdir(siteRoot);
const outputName = process.env.SITE_OUTPUT ?? "public";
if (!/^public(?:-[a-z\d-]+)?$/u.test(outputName))
  throw new Error("SITE_OUTPUT must be public or public-<name> within site/");
const output = path.join(siteRoot, outputName);
try {
  if ((await fs.lstat(output)).isSymbolicLink())
    throw new Error("Output cannot be a symlink");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
// Generated output is intentionally cleared before validation, so a failed build cannot leave a stale publishable artifact.
await fs.rm(output, { recursive: true, force: true });
const temporaryRoot = await fs.realpath(os.tmpdir());
const staging = await fs.mkdtemp(
  path.join(temporaryRoot, "quartz-publication-"),
);
try {
  await trustedStatic();
  await trustedMath();
  await checkedGraphAssets();
  const vaultRoot = await ensureVaultCheckout(
    repositoryRoot,
    process.env.VAULT_ROOT,
  );
  console.log(
    `Building content from ${vaultRoot}${process.env.VAULT_ROOT === undefined ? " (default .vault-data)" : " (VAULT_ROOT)"}`,
  );
  const publication = await preparePublication({ output: staging, vaultRoot });
  const baseUrl = process.env.SITE_BASE_URL ?? "example.invalid";
  if (!/^[a-z\d.-]+(?::\d+)?(?:\/[\w.-]+)*\/?$/iu.test(baseUrl))
    throw new Error(
      "SITE_BASE_URL must be a host and optional path, without scheme, credentials, or query",
    );
  console.log(
    `Approved ${publication.notes} notes and ${publication.assets} assets; base URL: ${baseUrl}`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "quartz/bootstrap-cli.mjs",
      "build",
      "--directory",
      staging,
      "--output",
      output,
    ],
    { stdio: "inherit", env: { ...process.env, SITE_BASE_URL: baseUrl } },
  );
  if (result.error || result.status !== 0)
    throw (
      result.error ?? new Error(`Quartz exited with status ${result.status}`)
    );
  await enrichSortRanks(output, publication);
  // Format Quartz's generated folder count in the static HTML, including without JS.
  const articleListFile = path.join(output, "articles/index.html");
  const articleList = await fs.readFile(articleListFile, "utf8");
  await fs.writeFile(
    articleListFile,
    articleList.replace(
      /(<div class="page-listing"><p>)(\d+)(\s)/u,
      (_, before, count, after) =>
        `${before}${Number(count).toLocaleString("en-US")}${after}`,
    ),
  );
  await copyMathFonts(output);
  await copySiteAssets(output);
  await copyGraphAssets(output);
  await fs.writeFile(path.join(output, ".nojekyll"), "");
  const { auditOutput } = await import("./verify-output.mjs");
  console.log(JSON.stringify(await auditOutput(output, publication), null, 2));
} catch (error) {
  await fs.rm(output, { recursive: true, force: true });
  throw error;
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
