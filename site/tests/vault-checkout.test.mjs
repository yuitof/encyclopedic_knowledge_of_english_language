import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureVaultCheckout } from "../scripts/vault-checkout.mjs";

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_ALLOW_PROTOCOL: "file" },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function commit(root, stage = true) {
  if (stage) git(root, "add", ".");
  git(
    root,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "Fixture",
  );
  return git(root, "rev-parse", "HEAD");
}
test("build initializes the pinned vault once and preserves later local edits and revisions", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "vault-checkout-"));
  try {
    const data = path.join(temporary, "data"),
      website = path.join(temporary, "website");
    await fs.mkdir(path.join(data, "vault/notes"), { recursive: true });
    git(data, "init", "-qb", "vault");
    await fs.writeFile(path.join(data, "vault/notes/Example.md"), "Pinned");
    const pinned = commit(data);
    await fs.writeFile(path.join(data, "vault/notes/Example.md"), "Latest");
    const latest = commit(data);
    await fs.mkdir(website);
    git(website, "init", "-qb", "main");
    await fs.writeFile(
      path.join(website, ".gitmodules"),
      `[submodule ".vault-data"]\npath = .vault-data\nurl = ${data}\nbranch = vault\n`,
    );
    git(website, "add", ".gitmodules");
    git(
      website,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${pinned},.vault-data`,
    );
    commit(website, false);
    // Allow only the local fixture's transport in the subprocess initialization.
    const original = process.env.GIT_ALLOW_PROTOCOL;
    process.env.GIT_ALLOW_PROTOCOL = "file";
    try {
      const checkout = await ensureVaultCheckout(website);
      assert.equal(git(checkout, "rev-parse", "HEAD"), pinned);
      // Commits made in the separate live checkout do not move the sample pin.
      await fs.writeFile(
        path.join(data, "vault/notes/Example.md"),
        "Live edit",
      );
      commit(data);
      assert.equal(await ensureVaultCheckout(website, data), data);
      assert.equal(git(checkout, "rev-parse", "HEAD"), pinned);
      assert.equal(git(website, "status", "--porcelain"), "");
      git(checkout, "checkout", "--detach", latest);
      const note = path.join(checkout, "vault/notes/Example.md");
      await fs.writeFile(note, "Unsaved local work");
      await ensureVaultCheckout(website);
      assert.equal(git(checkout, "rev-parse", "HEAD"), latest);
      assert.equal(await fs.readFile(note, "utf8"), "Unsaved local work");
      assert.equal(await ensureVaultCheckout(website, data), data);
      await assert.rejects(
        ensureVaultCheckout(website, path.join(temporary, "absent")),
        /VAULT_ROOT must contain/,
      );
    } finally {
      if (original === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
      else process.env.GIT_ALLOW_PROTOCOL = original;
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("an incomplete populated vault is left intact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-incomplete-"));
  try {
    const directory = path.join(root, ".vault-data");
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "local.txt"), "Keep");
    await assert.rejects(
      ensureVaultCheckout(root),
      /Incomplete vault checkout/,
    );
    assert.equal(
      await fs.readFile(path.join(directory, "local.txt"), "utf8"),
      "Keep",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
