import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import {
  contentReferences,
  referenceLookup,
  rejectUnsafeReference,
} from "./corpus-references.mjs";
import { splitNote, noteDates } from "./note-timestamps.mjs";

const key = (value) => value.normalize("NFC").toLowerCase();
// Inventory names only. Never open, follow, or publish an unapproved file.
async function existingNames(root, entries) {
  const names = new Set();
  async function scan(relative) {
    const directory = path.join(root, relative);
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.posix.join(relative, item.name);
      for (const value of [name, item.name, item.name.replace(/\.md$/iu, "")])
        names.add(key(value));
      if (
        item.name.startsWith(".") ||
        item.name === "node_modules" ||
        item.isSymbolicLink()
      )
        continue;
      if (
        relative === "site" &&
        /^(?:quartz|public(?:-|$)|test-results|playwright-report)/u.test(
          item.name,
        )
      )
        continue;
      if (item.isDirectory()) await scan(name);
    }
  }
  await scan("");
  // Explicit sources are already represented even if their directory was excluded above.
  for (const entry of entries) names.add(key(entry.source));
  return names;
}

/** Resolve genuinely absent Markdown notes into blank, temporary publication pages. */
export async function missingNotes(root, entries, regularFile) {
  const lookup = referenceLookup(entries),
    existing = await existingNames(root, entries),
    generated = new Map();
  for (const entry of entries.filter((item) => item.kind === "note")) {
    const source = await regularFile(entry.sourceRoot ?? root, entry.source);
    const { body, meta } = splitNote(await fs.readFile(source, "utf8"));
    const { wiki, links } = contentReferences(body);
    for (const ref of [
      ...wiki.map((item) => ({ raw: item.raw, encoded: false, image: false })),
      ...links.map((item) => ({
        raw: item.url,
        encoded: true,
        image: item.type === "image",
      })),
    ]) {
      if (
        !ref.raw.trim() ||
        ref.raw.startsWith("#") ||
        /^(?:https?:|mailto:)/iu.test(ref.raw)
      )
        continue;
      if (lookup(ref.raw, ref.encoded)) continue;
      let name = ref.raw.trim();
      if (ref.encoded) name = decodeURIComponent(name);
      name = name.split("#")[0];
      rejectUnsafeReference(name);
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(name))
        throw new Error("Unsupported link protocol");
      if (
        !name ||
        ref.image ||
        /\.(?:png|jpe?g|gif|webp|avif|svg|pdf|mp[34]|wav|zip|canvas|base)$/iu.test(
          name,
        )
      )
        continue;
      // Existing unapproved/private files stay subject to the original strict policy.
      const candidates = [
        name,
        name.replace(/\.md$/iu, ""),
        name.endsWith(".md") ? name : name + ".md",
      ];
      if (
        candidates.some(
          (value) =>
            existing.has(key(value)) ||
            existing.has(
              key(path.posix.join(path.posix.dirname(entry.source), value)),
            ),
        )
      )
        continue;
      const canonical = key(name.replace(/\.md$/iu, ""));
      const dates = await noteDates(
        entry.sourceRoot ?? root,
        entry.source,
        meta,
      );
      if (!generated.has(canonical)) {
        const hash = createHash("sha256")
          .update(canonical)
          .digest("hex")
          .slice(0, 16);
        generated.set(canonical, {
          source: name.endsWith(".md") ? name : name + ".md",
          target: `missing/note-${hash}.md`,
          kind: "note",
          generated: true,
          referenceKeys: new Set(),
          title: path.posix.basename(name).replace(/\.md$/iu, ""),
          dates,
        });
      }
      const item = generated.get(canonical);
      item.referenceKeys.add(name);
      item.referenceKeys.add(name.replace(/\.md$/iu, ""));
      item.referenceKeys.add(name.replace(/\.md$/iu, "") + ".md");
      for (const field of ["created", "modified"]) {
        const comparison =
          Date.parse(dates[field]) - Date.parse(item.dates[field]);
        if (
          (field === "created" && comparison < 0) ||
          (field === "modified" && comparison > 0)
        )
          item.dates[field] = dates[field];
      }
    }
  }
  return [...generated.values()].map((item) => ({
    ...item,
    referenceKeys: [...item.referenceKeys],
    bytes: Buffer.from(
      `---\n${YAML.stringify({ title: item.title, ...item.dates, publish: true })}---\n`,
    ),
  }));
}
