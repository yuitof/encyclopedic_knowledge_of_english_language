import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { repositoryRoot } from "./publish.mjs";
const baseline = "c785417a697c3fcf69c450b7c96d65bb0f73b4e5";
const tree = execFileSync("git", ["ls-tree", "-rz", baseline], {
  cwd: repositoryRoot,
})
  .toString()
  .split("\0")
  .filter(Boolean);
const counts = {
  notes: 0,
  assets: 0,
  configuration: 0,
  bytePreserved: 0,
  settingsUpdated: 0,
};
const maps = new Map();
for (const record of tree) {
  const [metadata, source] = record.split("\t"),
    hash = metadata.split(" ")[2];
  let target, kind;
  if (source === "README.md" || source === ".gitignore") continue;
  if (source.startsWith(".obsidian/")) {
    target = `vault/${source}`;
    kind = "configuration";
  } else if (source.endsWith(".md")) {
    target = `vault/notes/${source}`;
    kind = "notes";
  } else if (/\.(?:png|webp)$/iu.test(source)) {
    target = `vault/assets/${source}`;
    kind = "assets";
  } else throw new Error("Unclassified baseline file");
  maps.set(source, target);
  counts[kind]++;
  const bytes = await fs.readFile(path.join(repositoryRoot, target));
  if ([".obsidian/app.json", ".obsidian/workspace.json"].includes(source)) {
    counts.settingsUpdated++;
    continue;
  }
  const actual = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  if (actual !== hash) throw new Error(`Vault bytes changed: ${target}`);
  counts.bytePreserved++;
}
const oldApp = JSON.parse(
  execFileSync("git", ["show", `${baseline}:.obsidian/app.json`], {
    cwd: repositoryRoot,
  }),
);
const app = JSON.parse(
  await fs.readFile(
    path.join(repositoryRoot, "vault/.obsidian/app.json"),
    "utf8",
  ),
);
if (
  JSON.stringify(app) !==
  JSON.stringify({
    ...oldApp,
    attachmentFolderPath: "assets",
    newFileLocation: "folder",
    newFileFolderPath: "notes",
  })
)
  throw new Error("Unexpected Obsidian settings change");
const oldWorkspace = JSON.parse(
  execFileSync("git", ["show", `${baseline}:.obsidian/workspace.json`], {
    cwd: repositoryRoot,
  }),
);
function rewrite(value) {
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewrite(item)]),
    );
  return typeof value === "string" && maps.has(value)
    ? maps.get(value).slice("vault/".length)
    : value;
}
const workspace = JSON.parse(
  await fs.readFile(
    path.join(repositoryRoot, "vault/.obsidian/workspace.json"),
    "utf8",
  ),
);
if (JSON.stringify(workspace) !== JSON.stringify(rewrite(oldWorkspace)))
  throw new Error("Unexpected workspace change");
// Bare Obsidian filenames resolve across folders; there were no local Markdown path references.
let wikiReferences = 0,
  unresolved = 0,
  localMarkdownPaths = 0;
const names = new Set(
  [...maps.keys()].map((name) => path.posix.basename(name)),
);
for (const [source, target] of maps) {
  if (!source.endsWith(".md")) continue;
  const body = await fs.readFile(path.join(repositoryRoot, target), "utf8");
  for (const match of body.matchAll(/!?\[\[([^\]\n]+)\]\]/gu)) {
    const reference = match[1].split("|")[0].split("#")[0];
    if (!reference) continue;
    wikiReferences++;
    if (reference.includes("/") || reference.includes("\\"))
      throw new Error("Unexpected path-dependent wikilink in migrated note");
    if (!names.has(reference) && !names.has(reference + ".md")) unresolved++;
  }
  for (const match of body.matchAll(/!?\[[^\]\n]*\]\(([^\n)]*)\)/gu))
    if (!/^(?:\w+:\/\/|mailto:|#)/iu.test(match[1])) localMarkdownPaths++;
}
if (localMarkdownPaths)
  throw new Error("Relative Markdown paths require migration review");
console.log(
  JSON.stringify(
    {
      ...counts,
      wikiReferences,
      preExistingUnresolvedWikilinks: unresolved,
      localMarkdownPaths,
    },
    null,
    2,
  ),
);
