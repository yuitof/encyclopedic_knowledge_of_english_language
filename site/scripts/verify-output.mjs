import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { slugifyFilePath } from "@quartz-community/utils";
import { verifyStaticOutput, verifyMathOutput } from "./trusted-static.mjs";

export async function auditOutput(output, publication) {
  const names = [];
  async function scan(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Symlink found in generated output");
      if (entry.isDirectory()) await scan(full);
      else names.push(path.relative(output, full));
    }
  }
  await scan(output);
  if (
    names.some((name) =>
      name
        .split("/")
        .some((part) => part.startsWith(".") && part !== ".nojekyll"),
    )
  )
    throw new Error("Hidden configuration in output");
  await verifyStaticOutput(output, names);
  await verifyMathOutput(output, names);
  const expectedAssets = publication.files
    .filter((name) => !name.endsWith(".md"))
    .map((name) => slugifyFilePath(name));
  for (const name of names.filter(
    (name) =>
      /\.(?:png|jpe?g|gif|webp|avif)$/iu.test(name) &&
      !name.startsWith("static/"),
  )) {
    if (!expectedAssets.includes(name))
      throw new Error("Unapproved attachment in output");
  }
  const bytes = await fs.readFile(
    path.join(output, "static/contentIndex.json"),
  );
  const index = JSON.parse(bytes);
  const expectedNotes = publication.files
    .filter((name) => name.endsWith(".md"))
    .map((name) => slugifyFilePath(name));
  for (const slug of Object.keys(index))
    if (
      !expectedNotes.includes(slug) &&
      !slug.startsWith("tags/") &&
      !expectedNotes.some((note) =>
        note.startsWith(slug.replace(/\/index$/u, "") + "/"),
      )
    )
      throw new Error("Unexpected article in search index");
  for (const [slug, ranks] of Object.entries(publication.sortRanks ?? {})) {
    if (!Object.hasOwn(index, slug)) continue;
    if (
      JSON.stringify(index[slug].sortDetails) !==
      JSON.stringify(publication.sortDetails[slug])
    )
      throw new Error(
        "Public calendar details differ from approved source details",
      );
    if (JSON.stringify(index[slug].sortRanks) !== JSON.stringify(ranks))
      throw new Error("Public sort ranks differ from approved source ranks");
    if (
      Object.keys(index[slug].sortRanks).some(
        (key) => !["name", "created", "modified"].includes(key),
      )
    )
      throw new Error("Unexpected sort metadata");
  }
  if (!names.includes("index.html")) throw new Error("Missing home page");
  return {
    files: names.length,
    indexEntries: Object.keys(index).length,
    indexBytes: bytes.length,
    indexGzipBytes: zlib.gzipSync(bytes).length,
  };
}
