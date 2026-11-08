import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import YAML from "yaml";
import {
  slugifyFilePath,
  simplifySlug,
  transformLink,
} from "@quartz-community/utils";

export const siteRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryRoot = path.dirname(siteRoot);
const allowedMetadata = new Set([
  "title",
  "description",
  "publish",
  "draft",
  "tags",
  "aliases",
  "created",
  "modified",
  "lang",
]);
const rasterExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
]);

export function safeRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.normalize("NFC") ||
    /[\\\x00-\x1f?#%:]/u.test(value)
  )
    throw new Error(
      "Publication paths must be plain NFC relative paths, without encoded characters or URL syntax",
    );
  if (
    path.posix.isAbsolute(value) ||
    value
      .split("/")
      .some((part) => !part || part === ".." || part.startsWith("."))
  )
    throw new Error(
      "Hidden files, traversal, and absolute paths are not publishable",
    );
  return value;
}

/** Check every ancestor, including the repository root itself. Never follow a symlink. */
export async function regularFile(root, relative) {
  safeRelative(relative);
  const absoluteRoot = path.resolve(root);
  const absolute = path.join(absoluteRoot, relative);
  let cursor = path.parse(absoluteRoot).root;
  for (const part of path.relative(cursor, absolute).split(path.sep)) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink())
      throw new Error("Symlink sources and ancestors are not publishable");
    if (cursor === absolute && !stat.isFile())
      throw new Error("Only individual regular files can be approved");
    if (cursor !== absolute && !stat.isDirectory())
      throw new Error("Publication ancestor must be a directory");
  }
  return absolute;
}

function walk(node, fn) {
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
}
function withoutCode(body) {
  const tree = unified().use(remarkParse).parse(body);
  const ranges = [];
  walk(tree, (node) => {
    if (["code", "inlineCode"].includes(node.type))
      ranges.push([node.position.start.offset, node.position.end.offset]);
  });
  let result = body;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0]))
    result =
      result.slice(0, start) + " ".repeat(end - start) + result.slice(end);
  return { tree, text: result };
}

function decodeReference(raw) {
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    throw new Error("Malformed percent encoding in content link");
  }
  if (/[\x00-\x1f\\]/u.test(value)) throw new Error("Unsafe content link");
  return value;
}

export function validateReferences(body, target, entries) {
  const { tree, text } = withoutCode(body);
  const refs = [];
  const definitions = new Map();
  walk(tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    if (node.type === "html")
      throw new Error(
        "Raw HTML is not accepted by the publication policy; use Markdown",
      );
    if (["link", "image"].includes(node.type)) refs.push(node.url);
    if (["linkReference", "imageReference"].includes(node.type)) {
      if (!definitions.has(node.identifier))
        throw new Error("Unresolved Markdown reference link");
      refs.push(definitions.get(node.identifier));
    }
  });
  for (const match of text.matchAll(/!?\[\[([^\]\n]+)\]\]/gu))
    refs.push(match[1].split("|")[0]);
  for (const raw of refs) {
    const reference = decodeReference(raw);
    if (/^(?:https?:|mailto:)/iu.test(reference)) continue;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(reference))
      throw new Error("Unsupported link protocol");
    const pathname = reference.split("#")[0].split("?")[0];
    if (!pathname) continue; // Same-article heading/block link.
    if (
      pathname.startsWith("/") ||
      pathname
        .split("/")
        .some((part) => part === ".." || (part.startsWith(".") && part !== "."))
    )
      throw new Error("Absolute or hidden content link is not allowed");
    const candidate = pathname.replace(/^\.\//u, "");
    const canonical = slugifyFilePath(candidate);
    const allSlugs = entries.map((entry) => slugifyFilePath(entry.target));
    const matches = allSlugs.filter(
      (slug) => slug === canonical || slug.endsWith("/" + canonical),
    );
    const resolved = transformLink(slugifyFilePath(target), candidate, {
      strategy: "shortest",
      allSlugs,
    }).split("#")[0];
    const resolvedPath = path.posix.normalize(
      path.posix.join(path.posix.dirname(slugifyFilePath(target)), resolved),
    );
    if (
      matches.length === 1 &&
      resolvedPath !==
        path.posix.normalize(simplifySlug(matches[0]).replace(/^\//u, ""))
    )
      throw new Error(
        "Link does not resolve to its approved target under the configured Quartz strategy",
      );
    if (matches.length !== 1)
      throw new Error(
        "Link or embed refers to an unpublished or ambiguous file; approve the target separately or remove the reference",
      );
  }
}

function validRaster(bytes, extension) {
  if (extension === ".png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === ".jpg" || extension === ".jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (extension === ".gif")
    return /^GIF8[79]a/u.test(bytes.subarray(0, 6).toString("ascii"));
  if (extension === ".webp")
    return (
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP"
    );
  return (
    bytes.subarray(4, 8).toString() === "ftyp" &&
    /avif|avis/u.test(bytes.subarray(8, 32).toString())
  );
}

/** Fully validate in memory before writing a single staged file. */
export async function preparePublication({
  root = repositoryRoot,
  manifestFile = path.join(siteRoot, "publish-manifest.json"),
  output,
} = {}) {
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.notes) ||
    !Array.isArray(manifest.assets) ||
    manifest.notes.length === 0
  )
    throw new Error("Invalid publication manifest");
  const entries = [
    ...manifest.notes.map((e) => ({ ...e, kind: "note" })),
    ...manifest.assets.map((e) => ({ ...e, kind: "asset" })),
  ];
  const targets = new Set(),
    slugs = new Set(),
    staged = [];
  for (const entry of entries) {
    safeRelative(entry.source);
    safeRelative(entry.target);
    const slug = slugifyFilePath(entry.target);
    if (
      targets.has(entry.target) ||
      slugs.has(slug) ||
      /^(?:static|tags)(?:\/|$)/u.test(slug) ||
      /^404(?:\.|\/|$)/u.test(slug)
    )
      throw new Error("Duplicate or reserved publication target");
    targets.add(entry.target);
    slugs.add(slug);
    const source = await regularFile(root, entry.source);
    let bytes = await fs.readFile(source);
    if (entry.kind === "note") {
      if (!entry.source.endsWith(".md") || !entry.target.endsWith(".md"))
        throw new Error("Notes must be Markdown files");
      const text = bytes.toString("utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
      const meta = front ? (YAML.parse(front[1]) ?? {}) : {};
      if (typeof meta !== "object" || Array.isArray(meta))
        throw new Error("Frontmatter must be a mapping");
      if (meta.publish === false || meta.draft === true)
        throw new Error(
          "Explicitly private notes and drafts cannot be approved",
        );
      if (meta.publish !== undefined && typeof meta.publish !== "boolean")
        throw new Error("publish must be a boolean");
      if (meta.draft !== undefined && typeof meta.draft !== "boolean")
        throw new Error("draft must be a boolean");
      if (Object.keys(meta).some((key) => !allowedMetadata.has(key)))
        throw new Error(
          "Unsupported frontmatter property: review metadata before publication (social images and HTML are not enabled)",
        );
      if (
        meta.title !== undefined &&
        (typeof meta.title !== "string" || !meta.title.trim())
      )
        throw new Error("A public title must be nonempty text");
      if (meta.aliases !== undefined)
        throw new Error(
          "Frontmatter alias redirects are not enabled; wikilink aliases are supported",
        );
      const body = front ? text.slice(front[0].length) : text;
      validateReferences(body, entry.target, entries);
      // The manifest authorizes publication; transform only the temporary copy.
      const publicMeta = {
        ...meta,
        title: meta.title ?? path.posix.basename(entry.source, ".md"),
        publish: true,
      };
      bytes = Buffer.from(`---\n${YAML.stringify(publicMeta)}---\n${body}`);
    } else {
      const extension = path.extname(entry.target).toLowerCase();
      if (
        !rasterExtensions.has(extension) ||
        path.extname(entry.source).toLowerCase() !== extension ||
        !validRaster(bytes, extension)
      )
        throw new Error(
          "Only explicitly approved raster image attachments with matching signatures are supported",
        );
    }
    staged.push({ target: entry.target, bytes });
  }
  if (!targets.has("index.md"))
    throw new Error("The public collection requires index.md");
  if (output) {
    for (const item of staged) {
      const dest = path.join(output, item.target);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, item.bytes);
    }
  }
  return {
    notes: manifest.notes.length,
    assets: manifest.assets.length,
    files: staged.map((item) => item.target),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // This command validates only. The production builder owns staging.
  console.log(JSON.stringify(await preparePublication(), null, 2));
}
