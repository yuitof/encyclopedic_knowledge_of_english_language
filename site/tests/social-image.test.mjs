import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { fromHtml } from "hast-util-from-html";
import { siteRoot } from "../scripts/publish.mjs";

function elements(node, tag) {
  return [
    ...(node.tagName === tag ? [node] : []),
    ...(node.children ?? []).flatMap((child) => elements(child, tag)),
  ];
}

test("social image is an opaque 1200 × 630 PNG and is pinned as a site asset", async () => {
  const source = "custom/english-encyclopedia-og.png";
  const metadata = await sharp(path.join(siteRoot, source)).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  assert.equal(metadata.hasAlpha, false);
  const { checkedSiteAssets } = await import("../scripts/trusted-static.mjs");
  assert.ok(Object.hasOwn(await checkedSiteAssets(), source));
});

test("root and repository builds publish one shared image with correct social tags on every page type", async () => {
  const fixture = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-social-fixture-"),
  );
  const note =
    "---\ntitle: Social fixture 日本語\ncreated: 2026-01-01\nmodified: 2026-01-02\n---\nAn isolated public article.\n";
  const asset = await fs.readFile(
    path.join(siteRoot, "custom/english-encyclopedia-og.png"),
  );
  try {
    await fs.mkdir(path.join(fixture, "vault/notes"), { recursive: true });
    await fs.writeFile(path.join(fixture, "vault/notes/social-test.md"), note);
    for (const [name, base] of [
      ["root", "example.invalid"],
      ["subpath", "example.invalid/knowledge/"],
    ]) {
      const outputName = `public-og-test-${process.pid}-${name}`;
      const output = path.join(siteRoot, outputName);
      try {
        const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
          cwd: siteRoot,
          env: {
            ...process.env,
            VAULT_ROOT: fixture,
            SITE_OUTPUT: outputName,
            SITE_BASE_URL: base,
          },
          encoding: "utf8",
          timeout: 60000,
        });
        assert.equal(build.status, 0, build.stdout + build.stderr);
        const expected = `https://${base.replace(/\/+$/u, "")}/static/english-encyclopedia-og.png`;
        assert.deepEqual(
          await fs.readFile(
            path.join(output, "static/english-encyclopedia-og.png"),
          ),
          asset,
        );
        for (const page of [
          "index",
          "articles/index",
          "articles/social-test",
          "graph",
          "404",
        ]) {
          const html = await fs.readFile(
            path.join(output, page + ".html"),
            "utf8",
          );
          const tree = fromHtml(html);
          const head = elements(tree, "head")[0];
          const tags = elements(head, "meta");
          const value = (key) => {
            const matches = tags.filter(
              (tag) => (tag.properties.property ?? tag.properties.name) === key,
            );
            assert.equal(
              matches.length,
              1,
              `${name}/${page}: duplicate/missing ${key}`,
            );
            return matches[0].properties.content;
          };
          for (const key of [
            "og:image",
            "og:image:url",
            "og:image:secure_url",
            "twitter:image",
          ])
            assert.equal(value(key), expected);
          assert.equal(value("og:image:width"), "1200");
          assert.equal(value("og:image:height"), "630");
          assert.equal(value("og:image:type"), "image/png");
          assert.equal(value("twitter:card"), "summary_large_image");
          assert.equal(
            value("og:image:alt"),
            "English Encyclopedia — Words, usage, and connections",
          );
          assert.equal(value("twitter:image:alt"), value("og:image:alt"));
          assert.doesNotMatch(
            html.slice(0, html.indexOf("</head>")),
            /content="[^"]*\/static\/og-image\.png"/u,
          );
          if (page === "articles/social-test")
            assert.match(value("og:title"), /Social fixture 日本語/u);
          assert.equal(
            elements(head, "link").filter((tag) =>
              tag.properties.rel?.includes("icon"),
            ).length,
            1,
          );
        }
      } finally {
        await fs.rm(output, { recursive: true, force: true });
      }
    }
    assert.equal(
      await fs.readFile(
        path.join(fixture, "vault/notes/social-test.md"),
        "utf8",
      ),
      note,
    );
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
