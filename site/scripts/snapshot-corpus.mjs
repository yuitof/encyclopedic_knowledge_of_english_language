// Explicit approval snapshot operation. Normal builds never discover vault files.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { slugifyFilePath } from "@quartz-community/utils";
import { repositoryRoot, siteRoot, regularFile } from "./publish.mjs";
import { contentReferences, referenceLookup } from "./corpus-references.mjs";
const tracked = execFileSync(
  "git",
  ["ls-files", "-z", "vault/notes", "vault/assets"],
  { cwd: repositoryRoot },
)
  .toString()
  .split("\0")
  .filter(Boolean);
const sources = tracked
  .filter(
    (source) => source.startsWith("vault/notes/") && source.endsWith(".md"),
  )
  .sort();
const raster = tracked.filter(
  (source) =>
    source.startsWith("vault/assets/") &&
    /\.(?:png|jpe?g|gif|webp|avif)$/iu.test(source),
);
const hash = (source) =>
  createHash("sha256").update(source).digest("hex").slice(0, 8);
const groups = new Map();
for (const source of sources) {
  const slug = slugifyFilePath(path.posix.basename(source));
  groups.set(slug, [...(groups.get(slug) ?? []), source]);
}
const notes = sources.map((source) => {
  const title = path.posix.basename(source, ".md"),
    base = slugifyFilePath(path.posix.basename(source));
  return {
    source,
    target: `articles/${base}${groups.get(base).length > 1 || ["index", "articles"].includes(base) ? "--" + hash(source) : ""}.md`,
    title,
    approvedUnresolved: [],
  };
});
const allAssets = raster.map((source) => ({
  source,
  target: `assets/${slugifyFilePath(path.posix.basename(source))}`,
}));
const lookup = referenceLookup([...notes, ...allAssets]),
  usedAssets = new Set();
let unresolved = 0,
  resolved = 0;
for (const note of notes) {
  const body = await fs.readFile(
    await regularFile(repositoryRoot, note.source),
    "utf8",
  );
  for (const ref of contentReferences(body).wiki) {
    if (!ref.raw || ref.raw.startsWith("#")) continue;
    const match = lookup(ref.raw);
    if (match) {
      resolved++;
      if (match.entry.source.startsWith("vault/assets/"))
        usedAssets.add(match.entry.source);
    } else {
      note.approvedUnresolved.push(ref.raw);
      unresolved++;
    }
  }
  note.approvedUnresolved = [...new Set(note.approvedUnresolved)];
}
const assets = allAssets.filter((asset) => usedAssets.has(asset.source));
const manifest = {
  version: 2,
  approval:
    "Current tracked English-language collection approved by the user on 2026-11-08; new files require a reviewed snapshot update.",
  notes: [
    {
      source: "site/content/index.md",
      target: "index.md",
      title: "Encyclopedic Knowledge of English Language",
      approvedUnresolved: [],
    },
    ...notes,
  ],
  assets,
};
for (const name of ["privacy", "license"])
  manifest.notes.push({
    source: `site/content/${name}.md`,
    target: `${name}.md`,
    approvedUnresolved: [],
  });
await fs.writeFile(
  path.join(siteRoot, "publish-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      notes: notes.length,
      referencedAssets: assets.length,
      resolvedReferences: resolved,
      approvedUnresolvedReferences: unresolved,
      collisionGroups: [...groups.values()].filter((group) => group.length > 1)
        .length,
    },
    null,
    2,
  ),
);
