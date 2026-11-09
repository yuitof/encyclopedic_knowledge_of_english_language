import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  addMissingTimestamps,
  noteDates,
  splitNote,
} from "../scripts/note-timestamps.mjs";
import { lintTimestamps } from "../scripts/lint-timestamps.mjs";
const dates = {
  created: "2001-02-03T04:05:06Z",
  modified: "2002-03-04T05:06:07Z",
};
test("timestamp additions preserve existing fields, comments, line endings and body", () => {
  const text =
    '---\r\ncreated: "1999-01-01" # keep this comment\r\ntitle: Example\r\n---\r\nBody with [[links]].\r\n';
  const next = addMissingTimestamps(text, dates);
  assert.equal(
    next,
    text.replace("---\r\nBody", `modified: "${dates.modified}"\r\n---\r\nBody`),
  );
  assert.equal(addMissingTimestamps(next, dates), next);
  assert.throws(
    () => addMissingTimestamps("---\ncreated: invalid\n---\n", dates),
    /valid date/u,
  );
});
test("build date fallback uses first/latest commits and leaves explicit dates unchanged", async () => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-date-test-"),
  );
  const git = (args, date) => {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Timestamp test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Timestamp test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git(["init", "-q"]);
    await fs.writeFile(path.join(root, "note.md"), "First");
    git(["add", "note.md"]);
    git(
      ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "First"],
      dates.created,
    );
    await fs.writeFile(path.join(root, "note.md"), "Second");
    git(["add", "note.md"]);
    git(
      ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "Second"],
      dates.modified,
    );
    const actual = await noteDates(root, "note.md", {});
    assert.equal(Date.parse(actual.created), Date.parse(dates.created));
    assert.equal(Date.parse(actual.modified), Date.parse(dates.modified));
    const explicit = { created: "1999-01-01", modified: "2020-01-01" };
    assert.deepEqual(await noteDates(root, "note.md", explicit), explicit);
    assert.equal(
      await fs.readFile(path.join(root, "note.md"), "utf8"),
      "Second",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("untracked note uses filesystem fallback and preserves existing fields and modification time", async () => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-lint-test-"),
  );
  try {
    await fs.mkdir(path.join(root, "vault/notes"), { recursive: true });
    const name = "vault/notes/日本語.md",
      file = path.join(root, name);
    await fs.writeFile(file, "---\ncreated: 2000-01-01\n---\nUnchanged body\n");
    await fs.utimes(file, new Date(dates.modified), new Date(dates.modified));
    assert.deepEqual((await lintTimestamps(root)).missing, [name]);
    await lintTimestamps(root, { fix: true });
    const result = splitNote(await fs.readFile(file, "utf8"));
    assert.equal(result.meta.created, "2000-01-01");
    assert.equal(result.meta.modified, new Date(dates.modified).toISOString());
    assert.equal(result.body, "Unchanged body\n");
    assert.equal(
      (await fs.stat(file)).mtime.toISOString(),
      new Date(dates.modified).toISOString(),
    );
    assert.deepEqual((await lintTimestamps(root)).missing, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("formatter uses the data checkout's Git history and preserves complete notes byte-for-byte", async () => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "timestamp-data-root-"),
  );
  const data = path.join(root, ".vault-data");
  const git = (args, date) => {
    const result = spawnSync("git", ["-C", data, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    await fs.mkdir(path.join(data, "vault/notes"), { recursive: true });
    git(["init", "-qb", "vault"]);
    const first = path.join(data, "vault/notes/first.md");
    const partial = path.join(data, "vault/notes/partial.md");
    const complete = path.join(data, "vault/notes/complete.md");
    const original =
      '---\r\ncreated: "1999-01-01" # preserve\r\nmodified: "2000-01-01"\r\n---\r\nBody\r\n';
    await fs.writeFile(first, "Initial body");
    await fs.writeFile(partial, '---\ncreated: "1998-01-01"\n---\nBody');
    await fs.writeFile(complete, original);
    git(["add", "."]);
    git(
      ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "First"],
      dates.created,
    );
    await fs.appendFile(first, "\nEdit");
    await fs.appendFile(partial, "\nEdit");
    git(["add", "."]);
    git(
      ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "Second"],
      dates.modified,
    );
    await fs.utimes(first, new Date("2026-01-01"), new Date("2026-01-01"));
    const checked = await lintTimestamps(root, { vaultRoot: data });
    assert.equal(checked.checked, 3);
    assert.equal(checked.missing.length, 2);
    assert.equal(await fs.readFile(first, "utf8"), "Initial body\nEdit");
    await lintTimestamps(root, { vaultRoot: data, fix: true });
    const actual = splitNote(await fs.readFile(first, "utf8"));
    assert.equal(Date.parse(actual.meta.created), Date.parse(dates.created));
    assert.equal(Date.parse(actual.meta.modified), Date.parse(dates.modified));
    assert.equal(actual.body, "Initial body\nEdit");
    const existing = splitNote(await fs.readFile(partial, "utf8"));
    assert.equal(existing.meta.created, "1998-01-01");
    assert.equal(
      Date.parse(existing.meta.modified),
      Date.parse(dates.modified),
    );
    assert.equal(await fs.readFile(complete, "utf8"), original);
    assert.deepEqual(
      (await lintTimestamps(root, { vaultRoot: data, fix: true })).missing,
      [],
    );
    // Staged files are tracked, but have no commit dates yet: never invent dates.
    await fs.writeFile(path.join(data, "vault/notes/staged.md"), "New");
    git(["add", "vault/notes/staged.md"]);
    await assert.rejects(
      lintTimestamps(root, { vaultRoot: data, fix: true }),
      /No commit history/,
    );
    assert.equal(
      await fs.readFile(path.join(data, "vault/notes/staged.md"), "utf8"),
      "New",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("formatter rejects shallow tracked history without falling back to checkout dates", async () => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "timestamp-shallow-"),
  );
  try {
    const source = path.join(root, "source"),
      clone = path.join(root, "clone");
    await fs.mkdir(path.join(source, "vault/notes"), { recursive: true });
    const git = (...args) => {
      const result = spawnSync("git", ["-C", source, ...args], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
    };
    git("init", "-qb", "vault");
    await fs.writeFile(path.join(source, "vault/notes/note.md"), "Body");
    git("add", ".");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "First",
    );
    git("clone", "--depth=1", `file://${source}`, clone);
    await assert.rejects(
      lintTimestamps(clone, { fix: true }),
      /Full Git history/,
    );
    assert.equal(
      await fs.readFile(path.join(clone, "vault/notes/note.md"), "utf8"),
      "Body",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("timestamp fixes reject symlink ancestors without editing their targets", async () => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-lint-symlink-"),
  );
  try {
    await fs.mkdir(path.join(root, "private"));
    await fs.mkdir(path.join(root, "vault"));
    const file = path.join(root, "private/note.md");
    await fs.writeFile(file, "Private body");
    await fs.symlink(
      path.join(root, "private"),
      path.join(root, "vault/notes"),
    );
    await assert.rejects(lintTimestamps(root, { fix: true }), /Symlink/u);
    assert.equal(await fs.readFile(file, "utf8"), "Private body");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
