import type { Element, Root, RootContent } from "hast";
import type { QuartzComponentProps } from "../quartz/components/types";
import { resolveRelative, simplifySlug } from "../quartz/util/path";

type BacklinkData = Pick<
  QuartzComponentProps,
  "fileData" | "allFiles" | "tree"
>;

/** Match Quartz's published-source backlink semantics; never include unlisted pages. */
export function articleBacklinks({ fileData, allFiles, tree }: BacklinkData) {
  const slug = fileData.slug;
  if (
    !slug ||
    slug === "index" ||
    slug === "404" ||
    slug.endsWith("/index") ||
    slug.startsWith("tags/")
  )
    return null;
  const target = simplifySlug(slug);
  const sources = allFiles.filter(
    (file) =>
      file.unlisted !== true && file.slug && file.links?.includes(target),
  );
  if (sources.length === 0) return null;

  const ids = new Set<string>();
  function collect(node: Root | RootContent) {
    if (node.type === "element" && node.properties.id !== undefined)
      ids.add(String(node.properties.id));
    if ("children" in node)
      for (const child of node.children) collect(child as RootContent);
  }
  collect(tree as Root);
  let id = "backlinks",
    suffix = 1;
  while (ids.has(id) || ids.has(`${id}-heading`)) id = `backlinks-${suffix++}`;
  return { id, sources };
}

/** Append to the render-only HAST copy, so Markdown, indexed content and transclusions stay unchanged. */
export function withArticleBacklinks(
  data: QuartzComponentProps,
): QuartzComponentProps {
  const backlinks = articleBacklinks(data);
  if (!backlinks) return data;
  const section: Element = {
    type: "element",
    tagName: "section",
    properties: {
      id: backlinks.id,
      className: ["article-backlinks"],
      ariaLabelledBy: [`${backlinks.id}-heading`],
    },
    children: [
      {
        type: "element",
        tagName: "h2",
        properties: { id: `${backlinks.id}-heading` },
        children: [{ type: "text", value: "Backlinks" }],
      },
      {
        type: "element",
        tagName: "ul",
        properties: {},
        children: backlinks.sources.map((source) => ({
          type: "element",
          tagName: "li",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "a",
              properties: {
                className: ["internal"],
                href: resolveRelative(data.fileData.slug!, source.slug!),
              },
              children: [
                {
                  type: "text",
                  value: String(source.frontmatter?.title ?? source.slug),
                },
              ],
            },
          ],
        })),
      },
    ],
  };
  const tree = data.tree as Root;
  const renderedTree: Root = { ...tree, children: [...tree.children, section] };
  return { ...data, tree: renderedTree };
}
