import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { siteRoot, preparePublication } from "../scripts/publish.mjs";
import { auditOutput } from "../scripts/verify-output.mjs";
const output = path.join(siteRoot, process.env.SITE_OUTPUT ?? "public");
test("output contains exactly the approved articles and assets plus Quartz generated pages", async () => {
  const result = await auditOutput(output, await preparePublication());
  assert.ok(result.indexEntries >= 5);
  assert.ok(result.indexBytes > 0);
});
test("Obsidian features render: links, math, highlighted code, embeds, footnotes, callouts, image", async () => {
  const math = await fs.readFile(
      path.join(output, "mathematics/linear-algebra.html"),
      "utf8",
    ),
    code = await fs.readFile(
      path.join(output, "programming/binary-search.html"),
      "utf8",
    );
  for (const expression of [
    /katex/u,
    /<math[\s>]/u,
    /coordinate-plane\.png/u,
    /footnote/iu,
    /callout/u,
    /academic\/study-notes/u,
  ])
    assert.match(math, expression);
  assert.match(code, /data-language="python"|language-python/u);
  assert.match(code, /transclude/u);
  assert.match(code, /Questions before conclusions/u);
});
test("indexes and generated output do not disclose root vault or Obsidian configuration", async () => {
  const index = await fs.readFile(
    path.join(output, "static/contentIndex.json"),
    "utf8",
  );
  assert.doesNotMatch(
    index,
    /PRIVATE_NOTE_CANARY|PRIVATE_ATTACHMENT_CANARY|\.obsidian|Crossing from Guangdong|CPTSD/u,
  );
  const sitemap = await fs.readFile(path.join(output, "sitemap.xml"), "utf8");
  assert.doesNotMatch(sitemap, /\.obsidian|PRIVATE_|Crossing/u);
  const files = [];
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(path.join(dir, e.name));
      else files.push(path.relative(output, path.join(dir, e.name)));
    }
  }
  await walk(output);
  assert.ok(
    !files.some((file) =>
      /\.md$|\.HEIC$|\.obsidian|publish-manifest|package-lock/u.test(file),
    ),
  );
});
test("production JavaScript contains no live reload connection", async () => {
  const files = await fs.readdir(output);
  let js = "";
  for (const file of files.filter((name) => name.endsWith(".js")))
    js += await fs.readFile(path.join(output, file), "utf8");
  assert.doesNotMatch(js, /new WebSocket|ws:\/\/localhost|wss:\/\//u);
});
