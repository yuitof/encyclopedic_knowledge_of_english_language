import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  repairTimestamps,
  repairAndPush,
} from "../scripts/repair-vault-timestamps.mjs";
import { preparePublication } from "../scripts/publish.mjs";
import { splitNote } from "../scripts/note-timestamps.mjs";

function git(root, args, date) {
  const result = spawnSync(
    "git",
    ["-C", root, "-c", "core.hooksPath=/dev/null", ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(run) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "vault-workflow-"),
  );
  try {
    git(root, ["init", "-qb", "vault"]);
    await fs.mkdir(path.join(root, "vault/notes"), { recursive: true });
    await fs.mkdir(path.join(root, "site/content"), { recursive: true });
    for (const name of ["index", "privacy", "license", "graph"])
      await fs.writeFile(
        path.join(root, `site/content/${name}.md`),
        `---\ncreated: 2000-01-01\nmodified: 2000-01-01\n${name === "index" ? "" : "unlisted: true\n"}---\n${name}`,
      );
    const note = path.join(root, "vault/notes/First.md");
    await fs.writeFile(note, "Initial body");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "Initial"], "2001-01-01T12:00:00Z");
    await run({ root, note });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("automatic discovery publishes future notes, generates blank Markdown pages and retains missing image references", () =>
  fixture(async ({ root, note }) => {
    await fs.writeFile(
      note,
      "[[Absent|label]] ![[Absent]] [note](Absent.md) ![[lost.png]] ![lost](lost.png)\n`[[not-a-page]]`",
    );
    await fs.writeFile(path.join(root, "vault/notes/New.md"), "New note");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "Notes"], "2002-01-02T12:00:00Z");
    const output = path.join(root, "out");
    const publication = await preparePublication({ root, output });
    assert.ok(publication.files.includes("articles/new.md"));
    assert.equal(publication.generatedNotes.length, 1);
    const page = await fs.readFile(
      path.join(output, "articles/first.md"),
      "utf8",
    );
    assert.match(page, /!\[\[lost.png\]\]/);
    assert.match(page, /!\[lost\]\(lost.png\)/);
    assert.match(page, /\[\[missing\/note-/);
    const blank = splitNote(
      await fs.readFile(
        path.join(output, publication.generatedNotes[0]),
        "utf8",
      ),
    );
    assert.equal(blank.body, "");
    assert.ok(blank.meta.created);
    assert.ok(blank.meta.modified);
    assert.ok(
      !(await fs.readdir(path.join(root, "vault/notes"))).includes("Absent.md"),
    );
    assert.equal(
      publication.sortDetails["articles/first"].created,
      "2001-01-01",
    );
  }));
test("repair preserves explicit values and bodies, follows renames and is idempotent", () =>
  fixture(async ({ root, note }) => {
    const renamed = path.join(root, "vault/notes/Renamed.md");
    git(root, ["mv", "vault/notes/First.md", "vault/notes/Renamed.md"]);
    git(root, ["commit", "-qm", "Rename"], "2002-01-01T12:00:00Z");
    await fs.writeFile(
      renamed,
      '---\nmodified: "1999-01-01" # keep\n---\nInitial body',
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "Explicit date"], "2003-01-01T12:00:00Z");
    assert.deepEqual(await repairTimestamps(root), ["vault/notes/Renamed.md"]);
    const text = await fs.readFile(renamed, "utf8"),
      parsed = splitNote(text);
    assert.equal(
      Date.parse(parsed.meta.created),
      Date.parse("2001-01-01T12:00:00Z"),
    );
    assert.equal(parsed.meta.modified, "1999-01-01");
    assert.equal(parsed.body, "Initial body");
    assert.match(text, /# keep/);
    assert.deepEqual(await repairTimestamps(root), []);
  }));
test("bot push retries a concurrent edit without overwriting it; subsequent runs make no commit", () =>
  fixture(async ({ root, note }) => {
    const remote = path.join(root, "remote.git"),
      bot = path.join(root, "bot"),
      writer = path.join(root, "writer");
    git(root, ["clone", "--bare", ".", remote]);
    git(root, ["clone", remote, bot]);
    git(root, ["clone", remote, writer]);
    let checks = 0;
    const result = await repairAndPush(bot, {
      validate: async () => {
        if (checks++ === 0) {
          await fs.writeFile(
            path.join(writer, "vault/notes/First.md"),
            "Newer user edit\n",
          );
          git(writer, ["add", "."]);
          git(
            writer,
            ["commit", "-qm", "Concurrent edit"],
            "2004-01-01T12:00:00Z",
          );
          git(writer, ["push", "origin", "vault"]);
        }
      },
    });
    assert.equal(checks, 2);
    const parsed = splitNote(
      await fs.readFile(path.join(bot, "vault/notes/First.md"), "utf8"),
    );
    assert.equal(parsed.body, "Newer user edit\n");
    assert.equal(
      Date.parse(parsed.meta.modified),
      Date.parse("2004-01-01T12:00:00Z"),
    );
    const again = await repairAndPush(bot);
    assert.deepEqual(again.changed, []);
    assert.equal(again.commit, result.commit);
    // If a timestamp is removed later, repair-only commits must not replace its historical date.
    await fs.writeFile(
      path.join(bot, "vault/notes/First.md"),
      "Newer user edit\n",
    );
    const repaired = await repairTimestamps(bot);
    assert.equal(repaired.length, 1);
    assert.equal(
      Date.parse(
        splitNote(
          await fs.readFile(path.join(bot, "vault/notes/First.md"), "utf8"),
        ).meta.modified,
      ),
      Date.parse("2004-01-01T12:00:00Z"),
    );
  }));
test("repair rejects malformed dates and shallow history without source writes", () =>
  fixture(async ({ root, note }) => {
    await fs.writeFile(note, "---\ncreated: wrong\n---\nBody");
    await assert.rejects(repairTimestamps(root), /valid date/);
    assert.equal(
      await fs.readFile(note, "utf8"),
      "---\ncreated: wrong\n---\nBody",
    );
  }));

test("a rejected bot push stops safely without publishing or retaining its attempted commit", () =>
  fixture(async ({ root }) => {
    const remote = path.join(root, "remote.git"),
      bot = path.join(root, "bot");
    git(root, ["clone", "--bare", ".", remote]);
    git(root, ["clone", remote, bot]);
    const original = git(bot, ["rev-parse", "HEAD"]);
    const hook = path.join(remote, "hooks/pre-receive");
    await fs.writeFile(hook, "#!/bin/sh\nexit 1\n");
    await fs.chmod(hook, 0o755);
    await assert.rejects(
      repairAndPush(bot),
      /write permission\/branch protection/,
    );
    assert.equal(git(remote, ["rev-parse", "HEAD"]), original);
    assert.equal(git(bot, ["rev-parse", "HEAD"]), original);
    assert.equal(
      await fs.readFile(path.join(bot, "vault/notes/First.md"), "utf8"),
      "Initial body",
    );
  }));
test("shallow data checkout cannot invent dates from checkout metadata", () =>
  fixture(async ({ root }) => {
    const shallow = path.join(root, "shallow");
    git(root, ["clone", "--depth=1", `file://${root}`, shallow]);
    await assert.rejects(repairTimestamps(shallow), /full Git history/);
    assert.equal(
      await fs.readFile(path.join(shallow, "vault/notes/First.md"), "utf8"),
      "Initial body",
    );
  }));
