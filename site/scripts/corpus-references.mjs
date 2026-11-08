import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";

export function escapeLabel(value) {
  return value.replaceAll("&", "&amp;").replace(/[\\`*_{}\[\]<>|]/gu, "\\$&");
}
export function referenceLookup(entries) {
  const exact = new Map(),
    folded = new Map();
  for (const entry of entries) {
    const basename = path.posix.basename(entry.source);
    for (const key of new Set([
      ...(entry.referenceKeys ?? []),
      entry.source,
      basename,
      basename.replace(/\.md$/u, ""),
      entry.target,
      entry.target.replace(/\.md$/u, ""),
    ])) {
      exact.set(key, [...(exact.get(key) ?? []), entry]);
      const lower = key.normalize("NFC").toLowerCase();
      folded.set(lower, [...(folded.get(lower) ?? []), entry]);
    }
  }
  return (raw, urlEncoded = false) => {
    let value = raw.trim();
    // Wikilink filenames are literal: 100% and question marks are not URL syntax.
    let matches = exact.get(value);
    if (!matches && urlEncoded) {
      try {
        value = decodeURIComponent(value);
        matches = exact.get(value);
      } catch {
        throw new Error("Malformed encoded link");
      }
    }
    let fragment = "";
    if (!matches && value.includes("#")) {
      const index = value.indexOf("#");
      fragment = value.slice(index);
      value = value.slice(0, index);
      matches = exact.get(value);
    }
    matches ??= folded.get(value.normalize("NFC").toLowerCase());
    const unique = [...new Set(matches ?? [])];
    if (unique.length > 1)
      throw new Error("Ambiguous approved content reference");
    return unique.length ? { entry: unique[0], fragment } : null;
  };
}
export function contentReferences(body) {
  const tree = unified().use(remarkParse).parse(body),
    codeRanges = [],
    links = [];
  function walk(node) {
    if (node.type === "html")
      throw new Error("Raw HTML is not accepted by the publication policy");
    if (["code", "inlineCode"].includes(node.type))
      codeRanges.push([node.position.start.offset, node.position.end.offset]);
    if (
      ["link", "image", "definition"].includes(node.type) &&
      !(node.type === "definition" && node.identifier.startsWith("^"))
    )
      links.push(node);
    for (const child of node.children ?? []) walk(child);
  }
  walk(tree);
  const wiki = [];
  for (const match of body.matchAll(/(!?)\[\[([^\]\n]+)\]\]/gu)) {
    if (
      codeRanges.some(
        ([start, end]) => match.index >= start && match.index < end,
      )
    )
      continue;
    const separator = match[2].indexOf("|");
    wiki.push({
      start: match.index,
      end: match.index + match[0].length,
      embed: !!match[1],
      raw: separator < 0 ? match[2] : match[2].slice(0, separator),
      label: separator < 0 ? null : match[2].slice(separator + 1),
    });
  }
  return { wiki, links };
}
export function rejectUnsafeReference(raw) {
  if (
    /[\\\x00-\x1f]/u.test(raw) ||
    raw.startsWith("/") ||
    raw.split("/").some((part) => part.startsWith("."))
  )
    throw new Error("Unsafe local content reference");
}
export function rewriteCorpusReferences(
  body,
  note,
  lookup,
  { automatic = false } = {},
) {
  const { wiki, links } = contentReferences(body),
    changes = [];
  let resolved = 0,
    unresolved = 0;
  const approved = new Set(note.approvedUnresolved ?? []);
  for (const ref of wiki) {
    if (!ref.raw.trim() || ref.raw.startsWith("#")) continue;
    rejectUnsafeReference(ref.raw);
    const match = lookup(ref.raw);
    if (match) {
      const destination =
        match.entry.target.replace(/\.md$/u, "") + match.fragment;
      const label = ref.label ?? ref.raw;
      changes.push({
        start: ref.start,
        end: ref.end,
        value: `${ref.embed ? "!" : ""}[[${destination}|${label}]]`,
      });
      resolved++;
    } else {
      if (
        automatic &&
        /\.(?:png|jpe?g|gif|webp|avif|svg)$/iu.test(ref.raw.split("#")[0])
      ) {
        unresolved++;
        continue;
      }
      if (!approved.has(ref.raw))
        throw new Error(
          "Reference is not approved: select its target or explicitly review this unresolved reference",
        );
      changes.push({
        start: ref.start,
        end: ref.end,
        value:
          escapeLabel(ref.label ?? ref.raw) +
          (ref.embed ? " (attachment unavailable)" : ""),
      });
      unresolved++;
    }
  }
  for (const node of links) {
    const raw = node.url;
    if (/^(?:https?:|mailto:)/iu.test(raw) || raw.startsWith("#")) continue;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(raw))
      throw new Error("Unsupported link protocol");
    const match = lookup(raw, true);
    if (
      !match &&
      automatic &&
      /\.(?:png|jpe?g|gif|webp|avif|svg)$/iu.test(raw.split("#")[0])
    ) {
      rejectUnsafeReference(decodeURIComponent(raw));
      unresolved++;
      continue;
    }
    if (!match) throw new Error(`Unapproved local Markdown reference: ${raw}`);
    rejectUnsafeReference(raw);
    const start = node.position.start.offset,
      end = node.position.end.offset,
      original = body.slice(start, end);
    // Definitions and inline links both contain the destination as a literal substring.
    const offset = original.lastIndexOf(raw);
    if (offset < 0)
      throw new Error("Cannot safely transform Markdown link destination");
    changes.push({
      start: start + offset,
      end: start + offset + raw.length,
      value: match.entry.target + match.fragment,
    });
    resolved++;
  }
  let rewritten = body;
  for (const change of changes.sort((a, b) => b.start - a.start))
    rewritten =
      rewritten.slice(0, change.start) +
      change.value +
      rewritten.slice(change.end);
  return { body: rewritten, resolved, unresolved };
}
