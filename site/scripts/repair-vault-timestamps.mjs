import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { vaultFiles } from "./discover-vault.mjs";
import {
  splitNote,
  noteDates,
  addMissingTimestamps,
} from "./note-timestamps.mjs";
import { preparePublication, repositoryRoot } from "./publish.mjs";

export const repairSubject = "Repair missing note timestamps";
function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (!allowFailure && result.status !== 0)
    throw new Error(`Git ${args[0]} failed: ${result.stderr}`);
  return result;
}
export async function repairTimestamps(root) {
  if (
    git(root, ["rev-parse", "--is-shallow-repository"]).stdout.trim() !==
    "false"
  )
    throw new Error("Timestamp repair requires full Git history");
  const changes = [];
  for (const source of (await vaultFiles(root)).filter((name) =>
    name.endsWith(".md"),
  )) {
    const file = path.join(root, source);
    const text = await fs.readFile(file, "utf8");
    const { meta } = splitNote(text);
    const dates = await noteDates(root, source, meta, { requireHistory: true });
    const next = addMissingTimestamps(text, dates);
    if (next !== text) changes.push({ source, file, next });
  }
  // Validate every note before mutating any file.
  for (const { file, next } of changes) await fs.writeFile(file, next);
  return changes.map(({ source }) => source);
}

/** Only for a clean, disposable CI checkout; never reset a user's working tree. */
export async function repairAndPush(
  root,
  {
    remote = "origin",
    branch = "vault",
    attempts = 3,
    validate = async () => {},
  } = {},
) {
  if (
    git(root, ["status", "--porcelain", "--untracked-files=all"]).stdout.trim()
  )
    throw new Error("Repair/push requires a clean checkout");
  for (let attempt = 0; attempt < attempts; attempt++) {
    git(root, ["fetch", remote, `refs/heads/${branch}`]);
    const base = git(root, ["rev-parse", "FETCH_HEAD"]).stdout.trim();
    git(root, ["reset", "--hard", base]);
    const changed = await repairTimestamps(root);
    await validate();
    if (changed.length) {
      git(root, ["add", "--", ...changed]);
      git(root, [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit",
        "-m",
        repairSubject,
      ]);
    }
    // Push even if nothing changed: detect branch advancement before building.
    const pushed = git(root, ["push", remote, `HEAD:refs/heads/${branch}`], {
      allowFailure: true,
    });
    if (pushed.status === 0)
      return {
        changed,
        commit: git(root, ["rev-parse", "HEAD"]).stdout.trim(),
      };
    const own = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    git(root, ["fetch", remote, `refs/heads/${branch}`]);
    const latest = git(root, ["rev-parse", "FETCH_HEAD"]).stdout.trim();
    // Discard only this attempt's unpushed repairs, after checking the remote moved.
    git(root, ["reset", "--hard", base]);
    if (latest === base || latest === own)
      throw new Error(
        `Timestamp push failed (check write permission/branch protection): ${pushed.stderr}`,
      );
  }
  throw new Error(
    `Vault kept changing after ${attempts} attempts; no deployment performed`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.env.VAULT_ROOT)
    throw new Error("VAULT_ROOT must point to the data checkout");
  const root = path.resolve(process.env.VAULT_ROOT);
  const result = process.argv.includes("--push")
    ? await repairAndPush(root, {
        branch: process.env.CONTENT_BRANCH || "vault",
        validate: () =>
          preparePublication({ root: repositoryRoot, vaultRoot: root }),
      })
    : { changed: await repairTimestamps(root) };
  console.log(JSON.stringify(result, null, 2));
}
