import { test } from "node:test";
import { fromHtml } from "hast-util-from-html";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { slugifyFilePath } from "@quartz-community/utils";
import { siteRoot, preparePublication } from "../scripts/publish.mjs";
import { auditOutput } from "../scripts/verify-output.mjs";
const output = path.join(siteRoot, process.env.SITE_OUTPUT ?? "public");
const manifest = JSON.parse(
  await fs.readFile(path.join(siteRoot, "publish-manifest.json"), "utf8"),
);
const note = (title) => manifest.notes.find((entry) => entry.title === title);
const html = async (title) =>
  fs.readFile(
    path.join(output, slugifyFilePath(note(title).target) + ".html"),
    "utf8",
  );
test("all approved existing notes including empty notes are indexed; samples are absent", async () => {
  const publication = await preparePublication();
  const report = await auditOutput(output, publication);
  const index = JSON.parse(
    await fs.readFile(path.join(output, "static/contentIndex.json"), "utf8"),
  );
  for (const entry of manifest.notes.filter((entry) =>
    entry.target.startsWith("articles/"),
  ))
    assert.ok(
      Object.hasOwn(index, slugifyFilePath(entry.target)),
      `Missing note ${entry.title}`,
    );
  assert.equal(
    publication.notes,
    manifest.notes.length + publication.generatedNotes.length,
  );
  assert.equal(publication.assets, manifest.assets.length);
  assert.ok(report.indexBytes > 0);
  assert.doesNotMatch(
    JSON.stringify(index),
    /intervalhalving|Welcome to Knowledge Commons|A transcluded fixture paragraph/u,
  );
});
test("real notes retain Unicode titles, images, aliases, links and collision-separated routes", async () => {
  assert.match(await html("caimans"), /<img[^>]+assets\//u);
  assert.match(await html("CPTSD"), /第一次世界大戦/u);
  assert.match(
    await html("三単現の s を飛ばすことで非標準な位言い方ができる"),
    /三単現/u,
  );
  const a = note("head on"),
    b = note("head-on");
  assert.notEqual(a.target, b.target);
  assert.match(await html("head on"), /head on/u);
  assert.match(await html("head-on"), /head-on/u);
  assert.match(await html("100%"), /100%/u);
  assert.match(await html("Have you a pen?"), /Have you a pen\?/u);
});
test("only approved assets/content are emitted, with no Obsidian settings, source maps or temporary fixtures", async () => {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files.push(path.relative(output, file));
    }
  }
  await walk(output);
  assert.ok(
    !files.some((file) =>
      /\.md$|\.obsidian|publish-manifest|package-lock|feature-fixture|coordinate-plane/u.test(
        file,
      ),
    ),
  );
  const index = await fs.readFile(
    path.join(output, "static/contentIndex.json"),
    "utf8",
  );
  assert.doesNotMatch(
    index,
    /PRIVATE_NOTE_CANARY|PRIVATE_ATTACHMENT_CANARY|\.obsidian|site\/samples/u,
  );
  assert.ok(!files.includes("mathematics/linear-algebra.html"));
});
test("production client has no live reload WebSocket connection", async () => {
  let script = "";
  for (const file of (await fs.readdir(output)).filter((name) =>
    name.endsWith(".js"),
  ))
    script += await fs.readFile(path.join(output, file), "utf8");
  assert.doesNotMatch(script, /new WebSocket|ws:\/\/localhost|wss:\/\//u);
});

test("project pages, sort ranks and favicon are public without source filesystem metadata", async () => {
  const publication = await preparePublication();
  const index = JSON.parse(
    await fs.readFile(path.join(output, "static/contentIndex.json"), "utf8"),
  );
  for (const [slug, ranks] of Object.entries(publication.sortRanks)) {
    assert.deepEqual(index[slug].sortRanks, ranks);
    assert.deepEqual(index[slug].sortDetails, publication.sortDetails[slug]);
    assert.ok(
      Object.values(index[slug].sortDetails).every(
        (value) =>
          value === null ||
          /^(?:[A-Z]|symbols|other|\d{4}-\d{2}-\d{2})$/.test(value),
      ),
    );
    assert.ok(
      Object.values(ranks).every(
        (rank) => rank === null || Number.isInteger(rank),
      ),
    );
  }
  assert.equal(
    Object.keys(publication.sortRanks).length,
    manifest.notes.filter((entry) => entry.target.startsWith("articles/"))
      .length,
  );
  const listing = await fs.readFile(
    path.join(output, "articles/index.html"),
    "utf8",
  );
  const articleCount = Object.keys(publication.sortRanks).length;
  assert.ok(
    listing.includes(
      `<div class="page-listing"><p>${articleCount.toLocaleString("en-US")} `,
    ),
  );
  const homepage = await fs.readFile(path.join(output, "index.html"), "utf8");
  assert.ok(
    homepage.includes(
      `<p class="collection-note-count">${articleCount.toLocaleString("en-US")} notes in the collection.</p>`,
    ),
  );
  for (const name of ["privacy", "license"])
    assert.ok((await fs.stat(path.join(output, name + ".html"))).isFile());
  assert.ok(
    (
      await fs.readFile(path.join(output, "static/favicon.svg"), "utf8")
    ).includes(">E</text>"),
  );
  assert.doesNotMatch(
    JSON.stringify(index),
    /birthtime|mtimeMs|vault\/notes|fileName/u,
  );
});

test("removed catalogue is absent from output and generated navigation", async () => {
  await assert.rejects(fs.stat(path.join(output, "catalogue.html")), {
    code: "ENOENT",
  });
  for (const entry of manifest.notes) {
    const page = await fs.readFile(
      path.join(output, slugifyFilePath(entry.target) + ".html"),
      "utf8",
    );
    assert.doesNotMatch(page, /href=["'][^"']*\/catalogue(?:[.#?"']|$)/u);
  }
});

test("backlinks are emitted inside article HTML and omitted entirely when absent", async () => {
  const index = JSON.parse(
    await fs.readFile(path.join(output, "static/contentIndex.json"), "utf8"),
  );
  const notes = Object.entries(index).filter(
    ([slug, note]) => slug.startsWith("articles/") && note.sortRanks,
  );
  const incoming = (slug) =>
    notes.filter(([, note]) => note.links?.includes(slug));
  const positive = notes.find(([slug]) => incoming(slug).length > 0);
  const negative = notes.find(([slug]) => incoming(slug).length === 0);
  function find(node, predicate) {
    return [
      ...(predicate(node) ? [node] : []),
      ...(node.children ?? []).flatMap((child) => find(child, predicate)),
    ];
  }
  for (const entry of [positive, negative].filter(Boolean)) {
    const [slug] = entry;
    const tree = fromHtml(
      await fs.readFile(path.join(output, slug + ".html"), "utf8"),
    );
    const sections = find(
      tree,
      (node) =>
        node.tagName === "section" &&
        node.properties?.className?.includes("article-backlinks"),
    );
    const shortcuts = find(
      tree,
      (node) =>
        node.tagName === "a" && node.properties?.dataBacklinks === "true",
    );
    const expected = incoming(slug);
    assert.equal(sections.length, expected.length ? 1 : 0);
    assert.equal(shortcuts.length, expected.length ? 1 : 0);
    if (expected.length) {
      const section = sections[0];
      assert.equal(shortcuts[0].properties.href, "#" + section.properties.id);
      assert.equal(section.children[0].tagName, "h2");
      const article = find(tree, (node) => node.tagName === "article").find(
        (node) => find(node, (candidate) => candidate === section).length > 0,
      );
      assert.ok(article, "Backlinks must be inside the article");
      assert.equal(
        find(section, (node) => node.tagName === "a").length,
        expected.length,
      );
    }
    const right = find(
      tree,
      (node) =>
        node.tagName === "aside" &&
        node.properties?.className?.includes("right"),
    );
    assert.ok(
      right.every(
        (node) =>
          find(
            node,
            (candidate) =>
              candidate.properties?.className?.includes("backlinks") ||
              candidate.properties?.className?.includes("article-backlinks"),
          ).length === 0,
      ),
    );
  }
});
