import { test } from "node:test";
import assert from "node:assert/strict";
import type { Root } from "hast";
import type { QuartzComponentProps } from "../quartz/components/types";
import {
  articleBacklinks,
  withArticleBacklinks,
} from "../custom/article-backlinks";

function data(
  slug = "articles/target",
  sources: object[] = [],
): QuartzComponentProps {
  return {
    fileData: { slug },
    allFiles: sources,
    tree: {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "text", value: "Original article" }],
        },
      ],
    },
  } as unknown as QuartzComponentProps;
}
const source = {
  slug: "articles/source",
  links: ["articles/target"],
  frontmatter: { title: "Source <literal>" },
};

test("no inbound published links means no generated section or contents entry", () => {
  for (const sources of [
    [],
    [{ ...source, unlisted: true }],
    [{ ...source, links: ["articles/other"] }],
  ]) {
    const original = data("articles/target", sources);
    assert.equal(articleBacklinks(original), null);
    assert.equal(withArticleBacklinks(original), original);
  }
});
test("renders normal heading and list after the body without mutating indexed/source trees", () => {
  const original = data("articles/target", [
    source,
    { ...source, slug: "articles/unlisted", unlisted: true },
  ]);
  const snapshot = JSON.stringify(original);
  const rendered = withArticleBacklinks(original);
  const root = rendered.tree as Root;
  assert.notEqual(rendered.tree, original.tree);
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(root.children.length, 2);
  const section = root.children[1];
  assert.equal(section.type, "element");
  if (section.type !== "element") return;
  assert.equal(section.tagName, "section");
  assert.deepEqual(section.properties.className, ["article-backlinks"]);
  assert.equal(section.children[0].type, "element");
  const list = section.children[1];
  assert.equal(list.type, "element");
  if (list.type !== "element") return;
  assert.equal(list.tagName, "ul");
  assert.equal(list.children.length, 1);
  assert.match(JSON.stringify(list), /Source <literal>/);
  assert.match(JSON.stringify(list), /\.\.\/articles\/source/);
  assert.equal(articleBacklinks(original)?.id, section.properties.id);
});
test("avoids collisions with existing section and heading anchors", () => {
  const original = data("articles/target", [source]);
  (original.tree as Root).children.push(
    {
      type: "element",
      tagName: "h2",
      properties: { id: "backlinks" },
      children: [],
    },
    {
      type: "element",
      tagName: "h3",
      properties: { id: "backlinks-1-heading" },
      children: [],
    },
  );
  const snapshot = JSON.stringify(original);
  assert.equal(articleBacklinks(original)?.id, "backlinks-2");
  assert.equal(JSON.stringify(original), snapshot);
});
test("folder, tag, home and missing pages keep their own page renderers", () => {
  for (const slug of ["articles/index", "tags/subject", "index", "404"]) {
    const original = data(slug, [{ ...source, links: [slug] }]);
    assert.equal(articleBacklinks(original), null);
    assert.equal(withArticleBacklinks(original), original);
  }
});
