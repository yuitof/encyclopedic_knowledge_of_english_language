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
      'unlisted: "true"',
    ]) {
      await fs.writeFile(
        path.join(root, "vault/public.md"),
        `---\ntitle: Public\n${flag}\n---\nText`,
      );
      await assert.rejects(build(), /boolean/);
    }
  }));

test("failed builds remove stale artifacts before publication", async () => {
  const { spawnSync } = await import("node:child_process");
  const { randomUUID } = await import("node:crypto");
  const { siteRoot } = await import("../scripts/publish.mjs");
  const outputName = `public-policy-${randomUUID()}`;
  const output = path.join(siteRoot, outputName);
  await fs.mkdir(output);
  await fs.writeFile(
    path.join(output, "stale-private.html"),
    "STALE_PRIVATE_CANARY",
  );
  try {
    const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
      cwd: siteRoot,
      env: {
        ...process.env,
        SITE_OUTPUT: outputName,
        SITE_BASE_URL: "https://invalid.example/",
      },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SITE_BASE_URL/);
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

test("output symlinks are rejected without altering their private target", async () => {
  const { spawnSync } = await import("node:child_process");
  const { randomUUID } = await import("node:crypto");
  const { siteRoot } = await import("../scripts/publish.mjs");
  const secret = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-output-secret-"),
  );
  const outputName = `public-policy-${randomUUID()}`;
  const output = path.join(siteRoot, outputName);
  await fs.writeFile(path.join(secret, "private.txt"), "PRIVATE_OUTPUT_CANARY");
  await fs.symlink(secret, output);
  try {
    const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
      cwd: siteRoot,
      env: { ...process.env, SITE_OUTPUT: outputName },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Output cannot be a symlink/);
    assert.equal(
      await fs.readFile(path.join(secret, "private.txt"), "utf8"),
      "PRIVATE_OUTPUT_CANARY",
    );
  } finally {
    await fs.unlink(output);
    await fs.rm(secret, { recursive: true, force: true });
  }
});

test("output audit rejects unexpected vendor-static files", async () => {
  const { auditOutput } = await import("../scripts/verify-output.mjs");
  const output = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-audit-output-"),
  );
  try {
    await fs.mkdir(path.join(output, "static"));
    await fs.writeFile(
      path.join(output, "static", "leaked.txt"),
      "PRIVATE_STATIC_OUTPUT_CANARY",
    );
    await assert.rejects(
      auditOutput(output, { files: ["index.md"] }),
      /Unexpected static output/,
    );
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

test("literal source punctuation is mapped safely and aliases survive only in staged copies", () =>
  fixture(async ({ root, manifest, build, output }) => {
    manifest.version = 2;
    manifest.notes[0].approvedUnresolved = [];
    for (const [source, target] of [
      ["Have you a pen?.md", "articles/question.md"],
      ["100%.md", "articles/100-percent.md"],
    ]) {
      await fs.writeFile(
        path.join(root, "vault", source),
        "Original source body.",
      );
      manifest.notes.push({
        source: "vault/" + source,
        target,
        approvedUnresolved: [],
      });
    }
    const before = "[[Have you a pen?|A question]] and [[100%]].";
    await fs.writeFile(path.join(root, "vault/public.md"), before);
    await build();
    const staged = await fs.readFile(path.join(output, "index.md"), "utf8");
    assert.match(staged, /\[\[articles\/question\|A question\]\]/u);
    assert.match(staged, /\[\[articles\/100-percent\|100%\]\]/u);
    assert.equal(
      await fs.readFile(path.join(root, "vault/public.md"), "utf8"),
      before,
    );
  }));
test("only explicitly frozen unresolved targets become labels; future/unapproved references fail", () =>
  fixture(async ({ root, manifest, build, output }) => {
    manifest.version = 2;
    manifest.notes[0].approvedUnresolved = ["Missing"];
    await fs.writeFile(
      path.join(root, "vault/public.md"),
      "[[Missing|Known label]]",
    );
    await build();
    const staged = await fs.readFile(path.join(output, "index.md"), "utf8");
    assert.match(staged, /Known label/u);
    assert.doesNotMatch(staged, /\[\[|PRIVATE_NOTE_CANARY/u);
    await fs.writeFile(
      path.join(root, "vault/future.md"),
      "PRIVATE_FUTURE_CANARY",
    );
    await fs.writeFile(path.join(root, "vault/public.md"), "[[future]]");
    await assert.rejects(build(), /not approved/u);
    await fs.writeFile(path.join(root, "vault/public.md"), "[[private]]");
    await assert.rejects(build(), /not approved/u);
  }));
test("v2 selection excludes future files and preserves literal code and footnote definitions", () =>
  fixture(async ({ root, manifest, build, output }) => {
    manifest.version = 2;
    manifest.notes[0].approvedUnresolved = [];
    const body = "`[[private]]`\n\nA fact.[^one]\n\n[^one]: 日本語の説明\n";
    await fs.writeFile(path.join(root, "vault/public.md"), body);
    await fs.writeFile(path.join(root, "vault/new.md"), "PRIVATE_NEW_CANARY");
    await build();
    assert.deepEqual(await fs.readdir(output), ["index.md"]);
    assert.ok(
      (await fs.readFile(path.join(output, "index.md"), "utf8")).endsWith(body),
    );
  }));
