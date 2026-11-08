import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { slugifyFilePath } from "@quartz-community/utils";
import { regularFile } from "./publish.mjs";
import { contentReferences, referenceLookup } from "./corpus-references.mjs";
import { splitNote } from "./note-timestamps.mjs";

export async function vaultFiles(root, relative = "vault/notes") {
  const directory = path.join(root, relative);
  if ((await fs.lstat(directory)).isSymbolicLink())
    throw new Error(`Symlink directory is not supported: ${relative}`);
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const source = path.posix.join(relative, item.name);
    if (item.isSymbolicLink()) throw new Error(`Symlink source: ${source}`);
    if (item.isDirectory()) files.push(...(await vaultFiles(root, source)));
    else if (item.isFile()) {
      await regularFile(root, source);
      files.push(source);
    } else throw new Error(`Unsupported file: ${source}`);
  }
  return files.sort();
}

/** Every vault note is public. Assets are copied only when referenced. */
export async function discoverVault(root, vaultRoot) {
  const sources = (await vaultFiles(vaultRoot)).filter((s) =>
    s.endsWith(".md"),
  );
  const groups = new Map();
  for (const source of sources) {
    const base = slugifyFilePath(path.posix.basename(source));
    groups.set(base, [...(groups.get(base) ?? []), source]);
  }
  const notes = sources.map((source) => {
    const base = slugifyFilePath(path.posix.basename(source));
    const suffix =
      groups.get(base).length > 1 || ["index", "articles"].includes(base)
        ? "--" + createHash("sha256").update(source).digest("hex").slice(0, 8)
        : "";
    return {
      source,
      sourceRoot: vaultRoot,
      target: `articles/${base}${suffix}.md`,
      title: path.posix.basename(source, ".md"),
      referenceKeys: [
        source.slice("vault/notes/".length),
        source.slice("vault/notes/".length).replace(/\.md$/u, ""),
      ],
    };
  });
  let assets = [];
  try {
    assets = (await vaultFiles(vaultRoot, "vault/assets"))
      .filter((source) => /\.(?:png|jpe?g|gif|webp|avif)$/iu.test(source))
      .map((source) => ({
        source,
        sourceRoot: vaultRoot,
        target: `assets/${slugifyFilePath(source.slice("vault/assets/".length))}`,
      }));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lookup = referenceLookup([...notes, ...assets]);
  const used = new Set();
  for (const note of notes) {
    const { body } = splitNote(
      await fs.readFile(await regularFile(vaultRoot, note.source), "utf8"),
    );
    const refs = contentReferences(body);
    for (const [raw, encoded] of [
      ...refs.wiki.map((r) => [r.raw, false]),
      ...refs.links.map((r) => [r.url, true]),
    ]) {
      if (!raw || raw.startsWith("#") || /^(?:https?:|mailto:)/iu.test(raw))
        continue;
      const match = lookup(raw, encoded);
      if (match?.entry.source.startsWith("vault/assets/"))
        used.add(match.entry.source);
    }
  }
  return {
    version: 3,
    notes: [
      ...["index", "privacy", "license", "graph"].map((name) => ({
        source: `site/content/${name}.md`,
        sourceRoot: root,
        target: `${name}.md`,
      })),
      ...notes,
    ],
    assets: assets.filter((entry) => used.has(entry.source)),
  };
}
