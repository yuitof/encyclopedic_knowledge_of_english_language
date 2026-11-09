import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Initialize only an absent default checkout; never update an editor's data. */
export async function ensureVaultCheckout(root, override) {
  const directory = path.resolve(override ?? path.join(root, ".vault-data"));
  const notes = path.join(directory, "vault/notes");
  try {
    if ((await fs.stat(notes)).isDirectory()) return directory;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (override !== undefined)
    throw new Error(`VAULT_ROOT must contain vault/notes: ${directory}`);
  // A populated but incomplete checkout may contain valuable local files.
  const contents = await fs.readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (contents.length)
    throw new Error(
      `Incomplete vault checkout at ${directory}; restore vault/notes before building`,
    );
  const result = spawnSync(
    "git",
    ["-C", root, "submodule", "update", "--init", "--", ".vault-data"],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `Cannot initialize .vault-data. Run git submodule update --init .vault-data from the repository root. ${result.error?.message ?? result.stderr}`,
    );
  if (!(await fs.stat(notes)).isDirectory())
    throw new Error("Initialized .vault-data does not contain vault/notes");
  return directory;
}
