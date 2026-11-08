import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  preparePublication,
  safeRelative,
  validateReferences,
} from "../scripts/publish.mjs";

async function fixture(run) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-publication-"),
  );
  const manifest = {
    version: 1,
    notes: [{ source: "vault/public.md", target: "index.md" }],
    assets: [],
  };
  await fs.mkdir(path.join(root, "vault"));
  await fs.writeFile(
    path.join(root, "vault/public.md"),
    "---\ntitle: Public\npublish: true\n---\nApproved sample.",
  );
  await fs.writeFile(
    path.join(root, "vault/private.md"),
    "PRIVATE_NOTE_CANARY_83f07",
  );
  await fs.writeFile(
    path.join(root, "vault/private.png"),
    "PRIVATE_ATTACHMENT_CANARY_120a5",
  );
  const manifestFile = path.join(root, "manifest.json"),
    output = path.join(root, "out");
  const save = () => fs.writeFile(manifestFile, JSON.stringify(manifest));
  const build = async () => {
    await save();
    return preparePublication({ root, manifestFile, output });
  };
  try {
    await run({ root, manifest, build, output });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("copies only separately approved files, excluding private notes and attachments", () =>
  fixture(async ({ build, output }) => {
    assert.equal((await build()).notes, 1);
    assert.deepEqual(await fs.readdir(output), ["index.md"]);
    assert.doesNotMatch(
      await fs.readFile(path.join(output, "index.md"), "utf8"),
      /CANARY/,
    );
  }));
test("blocks traversal, hidden files, absolute paths and encoded manifest paths", () => {
  for (const value of [
    "../private.md",
    "/etc/passwd",
    ".obsidian/config.json",
    "safe/../private.md",
    "notes/%2e%2e/private.md",
    "C:/secret",
    "a\\b",
    "a//b",
    "a/./b",
    "e\u0301.md",
  ])
    assert.throws(() => safeRelative(value));
});
test("refuses explicitly private frontmatter and drafts", () =>
  fixture(async ({ root, build }) => {
    for (const front of [
      "title: Public\npublish: false",
      "title: Public\npublish: true\ndraft: true",
    ]) {
      await fs.writeFile(
        path.join(root, "vault/public.md"),
        `---\n${front}\n---\nText`,
      );
      await assert.rejects(build());
    }
  }));
test("checks symlink files and symlink ancestors", () =>
  fixture(async ({ root, manifest, build }) => {
    await fs.symlink(
      path.join(root, "vault/private.md"),
      path.join(root, "link.md"),
    );
    manifest.notes[0].source = "link.md";
    await assert.rejects(build(), /Symlink/);
    await fs.symlink(path.join(root, "vault"), path.join(root, "linked"));
    manifest.notes[0].source = "linked/public.md";
    await assert.rejects(build(), /Symlink/);
  }));
test("rejects unapproved local links in every supported syntax", () => {
  const entries = [{ target: "index.md" }];
  for (const body of [
    "[[private]]",
    "![[private.png]]",
    "[private](private.md)",
    "![private](private.png)",
    "[private][secret]\n\n[secret]: private.md",
    "![private][secret]\n\n[secret]: private.png",
    "[[%70rivate]]",
    "[[../private]]",
    '<img src="private.png">',
    '<a href="private.md">a</a>',
  ])
    assert.throws(() => validateReferences(body, "index.md", entries));
});
test("permits approved wikilink aliases, headings, references, Unicode and code examples", () => {
  const entries = [
    { target: "index.md" },
    { target: "academic/日本語.md" },
    { target: "assets/plot.png" },
  ];
  for (const body of [
    "[[academic/日本語|学習]]",
    "![[assets/plot.png]]",
    "[plot][p]\n\n[p]: assets/plot.png",
    "[a](academic/%E6%97%A5%E6%9C%AC%E8%AA%9E.md#section)",
    "[[#Heading]]",
    "`[[private]]`",
    "```md\n[[private]]\n```",
    "[external](https://example.org/)",
  ])
    assert.doesNotThrow(() => validateReferences(body, "index.md", entries));
});
test("rejects unsupported metadata and disguised or unapproved attachments", () =>
  fixture(async ({ root, manifest, build }) => {
    await fs.writeFile(
      path.join(root, "vault/public.md"),
      "---\ntitle: Public\npublish: true\nsocialImage: private.png\n---\nText",
    );
    await assert.rejects(build(), /frontmatter/);
    await fs.writeFile(
      path.join(root, "vault/public.md"),
      "---\ntitle: Public\npublish: true\n---\nText",
    );
    manifest.assets.push({
      source: "vault/private.png",
      target: "assets/image.png",
    });
    await assert.rejects(build(), /signatures/);
  }));
test("rejects destinations that collide with generated pages or each other", () =>
  fixture(async ({ manifest, build }) => {
    manifest.notes.push({ source: "vault/public.md", target: "tags/index.md" });
    await assert.rejects(build(), /reserved/);
    manifest.notes[1].target = "index.md";
    await assert.rejects(build(), /Duplicate/);
  }));
test("validates the whole manifest before staging any content", () =>
  fixture(async ({ manifest, build, output }) => {
    manifest.notes.push({ source: "vault/missing.md", target: "private.md" });
    await assert.rejects(build());
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
  }));

test("uses official Quartz slug rules to reject index, symbol and folder collisions", () =>
  fixture(async ({ manifest, build }) => {
    for (const [a, b] of [
      ["index.md", "_index.md"],
      ["a&b.md", "a-and-b.md"],
      ["foo/foo.md", "foo/index.md"],
    ]) {
      manifest.notes = [
        { source: "vault/public.md", target: "index.md" },
        ...[a, b]
          .filter((x) => x !== "index.md")
          .map((target) => ({ source: "vault/public.md", target })),
      ];
      await assert.rejects(build(), /Duplicate/);
    }
  }));

test("trusted static preflight rejects symlinks, unexpected files, and changed bytes", async () => {
  const { trustedStatic } = await import("../scripts/trusted-static.mjs");
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-static-test-"),
  );
  const directory = path.join(root, "quartz/static");
  await fs.mkdir(directory, { recursive: true });
  const { createHash } = await import("node:crypto");
  const bytes = "trusted";
  const inventory = path.join(root, "inventory.json");
  await fs.writeFile(
    inventory,
    JSON.stringify({
      "icon.txt": createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  try {
    await fs.writeFile(path.join(directory, "icon.txt"), bytes);
    await trustedStatic(root, inventory);
    await fs.writeFile(
      path.join(directory, "extra.txt"),
      "PRIVATE_STATIC_CANARY",
    );
    await assert.rejects(trustedStatic(root, inventory), /Unexpected/);
    await fs.unlink(path.join(directory, "extra.txt"));
    await fs.writeFile(path.join(directory, "icon.txt"), "changed");
    await assert.rejects(trustedStatic(root, inventory), /modified/);
    await fs.unlink(path.join(directory, "icon.txt"));
    await fs.writeFile(path.join(root, "secret.txt"), "PRIVATE_STATIC_CANARY");
    await fs.symlink(
      path.join(root, "secret.txt"),
      path.join(directory, "icon.txt"),
    );
    await assert.rejects(trustedStatic(root, inventory), /Symlink/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("manifest approval supports plain Markdown and transforms staged metadata without editing source", () =>
  fixture(async ({ root, build, output }) => {
    const source = path.join(root, "vault/public.md");
    const before = "A plain Markdown note with **no frontmatter**.";
    await fs.writeFile(source, before);
    await build();
    assert.equal(await fs.readFile(source, "utf8"), before);
    const staged = await fs.readFile(path.join(output, "index.md"), "utf8");
    assert.match(staged, /publish: true/);
    assert.match(staged, /title: public/);
    assert.ok(staged.endsWith(before));
  }));

test("requires boolean privacy flags so Quartz cannot silently filter approved notes", () =>
  fixture(async ({ root, build }) => {
    for (const flag of [
      'draft: "true"',
      "draft: yes",
      "draft: 1",
      'publish: "true"',
    ]) {
      await fs.writeFile(
        path.join(root, "vault/public.md"),
        `---\ntitle: Public\n${flag}\n---\nText`,
      );
      await assert.rejects(build(), /boolean/);
    }
  }));
