import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { regularFile } from "./publish.mjs";
import {
  splitNote,
  noteDates,
  addMissingTimestamps,
} from "./note-timestamps.mjs";

export async function lintTimestamps(
  root,
  { fix = false, vaultRoot = root } = {},
) {
  const files = [];
  async function scan(relative, sourceRoot) {
    let entries;
    try {
      entries = await fs.readdir(path.join(sourceRoot, relative), {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Symlink note is not supported: ${name}`);
      if (entry.isDirectory()) await scan(name, sourceRoot);
      else if (entry.name.endsWith(".md"))
        files.push({ source: name, sourceRoot });
    }
  }
  await scan("vault/notes", vaultRoot);
  await scan("site/content", root);
  const missing = [];
  const changes = [];
  for (const { source, sourceRoot } of files) {
    const file = await regularFile(sourceRoot, source),
      text = await fs.readFile(file, "utf8"),
      { meta } = splitNote(text);
    const dates = await noteDates(sourceRoot, source, meta, {
      filesystemForUntrackedOnly: true,
    });
    const next = addMissingTimestamps(text, dates);
    if (next !== text) {
      missing.push(sourceRoot === root ? source : path.relative(root, file));
      changes.push({ file, next });
    }
  }
  // Validate the entire collection before changing any source files.
  if (fix)
    for (const { file, next } of changes) {
      const stat = await fs.stat(file);
      await fs.writeFile(file, next);
      await fs.utimes(file, stat.atime, stat.mtime);
    }
  return { checked: files.length, missing };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  try {
    const vaultRoot = path.resolve(
      process.env.VAULT_ROOT ?? path.join(root, ".vault-data"),
    );
    if (!(await fs.stat(path.join(vaultRoot, "vault/notes"))).isDirectory())
      throw new Error("Vault checkout must contain vault/notes");
    const result = await lintTimestamps(root, {
      fix: process.argv.includes("--fix"),
      vaultRoot,
    });
    console.log(
      `Timestamp check: ${result.checked} notes; ${result.missing.length} ${process.argv.includes("--fix") ? "filled" : "missing"} timestamp records.`,
    );
    if (result.missing.length) {
      console.log(result.missing.join("\n"));
      if (
        !process.argv.includes("--fix") ||
        process.argv.includes("--pre-commit")
      ) {
        console.error(
          "Review and stage the timestamp additions, then commit again.",
        );
        process.exitCode = 1;
      }
    }
    if (process.argv.includes("--pre-commit")) {
      for (const sourceRoot of [root, vaultRoot]) {
        const changed = spawnSync(
          "git",
          ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
          { cwd: sourceRoot, encoding: "utf8" },
        );
        if (changed.status !== 0)
          throw new Error("Cannot inspect staged notes");
        for (const source of changed.stdout
          .split("\0")
          .filter((name) =>
            /^(?:vault\/notes|site\/content)\/.*\.md$/u.test(name),
          )) {
          const staged = spawnSync("git", ["show", `:${source}`], {
            cwd: sourceRoot,
            encoding: "utf8",
          });
          if (staged.status !== 0)
            throw new Error("Cannot inspect staged note");
          const { meta } = splitNote(staged.stdout);
          if (meta.created === undefined || meta.modified === undefined)
            throw new Error(
              `Stage timestamp fields before committing: ${source}`,
            );
          await noteDates(sourceRoot, source, meta);
        }
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
