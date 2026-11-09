import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveContentSource } from "../scripts/content-source.mjs";
import { dispatchWebsite } from "../scripts/dispatch-website.mjs";
import { repairAndPush } from "../scripts/repair-vault-timestamps.mjs";
import { preparePublication, siteRoot } from "../scripts/publish.mjs";

function git(root, ...args) {
  const result = spawnSync(
    "git",
    ["-C", root, "-c", "core.hooksPath=/dev/null", ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_COMMITTER_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(run) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "content-sources-"),
  );
  try {
    const website = path.join(root, "website");
    await fs.mkdir(path.join(website, "site/content"), { recursive: true });
    git(website, "init", "-qb", "main");
    for (const name of ["index", "graph", "privacy", "license"])
      await fs.writeFile(
        path.join(website, `site/content/${name}.md`),
        `---\ncreated: "2000-01-01"\nmodified: "2000-01-01"\n---\n${name}`,
      );
    const repositories = {};
    for (const [name, branch, note] of [
      ["same", "vault", "Same repository"],
      ["external", "notes/live", "External repository"],
      ["sample", "starter", "Starter"],
    ]) {
      const directory = path.join(root, name);
      await fs.mkdir(path.join(directory, "vault/notes"), { recursive: true });
      git(directory, "init", "-qb", branch);
      await fs.writeFile(
        path.join(directory, "vault/notes/Example.md"),
        `---\n${name === "sample" ? 'created: "1999-01-01"\n' : ""}modified: "2000-01-01"\n---\n${note}`,
      );
      git(directory, "add", ".");
      git(directory, "commit", "-qm", "Initial notes");
      repositories[name] = {
        directory,
        branch,
        commit: git(directory, "rev-parse", "HEAD"),
      };
    }
    await fs.writeFile(
      path.join(website, ".gitmodules"),
      '[submodule ".vault-data"]\npath = .vault-data\nurl = https://github.com/example/starter.git\nbranch = starter\n',
    );
    git(website, "add", ".");
    git(
      website,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${repositories.sample.commit},.vault-data`,
    );
    git(website, "commit", "-qm", "Website with pinned starter");
    await run({ root, website, repositories });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
const response = (status) => new Response(null, { status });
test("same-repository, external custom-branch and missing-branch sources build independently; repair pushes only their own remote", () =>
  fixture(async ({ root, website, repositories }) => {
    const api = async (url) =>
      response(url.endsWith("/branches/absent") ? 404 : 200);
    const same = await resolveContentSource({
      root: website,
      websiteRepository: "example/site",
      request: api,
    });
    assert.deepEqual(same, {
      mode: "production",
      repository: "example/site",
      branch: "vault",
      ref: "vault",
      same_repository: true,
    });
    const external = await resolveContentSource({
      root: website,
      websiteRepository: "example/site",
      contentRepository: "example/content",
      contentBranch: "notes/live",
      request: async (url) => {
        assert.ok(
          url.endsWith("/repos/example/content") ||
            url.endsWith("/branches/notes%2Flive"),
        );
        return response(200);
      },
    });
    assert.equal(external.same_repository, false);
    assert.equal(external.branch, "notes/live");
    const sample = await resolveContentSource({
      root: website,
      websiteRepository: "example/site",
      contentBranch: "absent",
      request: api,
    });
    assert.deepEqual(sample, {
      mode: "sample",
      repository: "example/starter",
      branch: "starter",
      ref: repositories.sample.commit,
      same_repository: false,
    });
    for (const [name, source] of [
      ["same", same],
      ["external", external],
      ["sample", sample],
    ]) {
      const remote = path.join(root, `${name}.git`),
        clone = path.join(root, `${name}-build`),
        repo = repositories[name];
      git(root, "clone", "--bare", repo.directory, remote);
      git(root, "clone", remote, clone);
      if (source.mode === "sample")
        git(clone, "checkout", "--detach", source.ref);
      else {
        // The external notifier repairs in the content repository using its token.
        const repaired = await repairAndPush(clone, {
          branch: source.branch,
          validate: () =>
            preparePublication({ root: website, vaultRoot: clone }),
        });
        assert.equal(
          git(remote, "rev-parse", `refs/heads/${source.branch}`),
          repaired.commit,
        );
        assert.match(
          git(remote, "show", `${source.branch}:vault/notes/Example.md`),
          /created:/,
        );
        assert.match(
          git(remote, "show", `${source.branch}:vault/notes/Example.md`),
          /modified: "2000-01-01"/,
        );
      }
      const publication = await preparePublication({
        root: website,
        vaultRoot: clone,
      });
      assert.equal(publication.notes, 5);
      if (name === "sample")
        assert.equal(git(remote, "rev-parse", "HEAD"), repo.commit);
      // Build each selected checkout through the real production builder as well.
      const outputName = `public-source-integration-${name}`;
      try {
        const built = spawnSync(process.execPath, ["scripts/build.mjs"], {
          cwd: siteRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            VAULT_ROOT: clone,
            SITE_OUTPUT: outputName,
            SITE_BASE_URL: "example.invalid/collection",
          },
        });
        assert.equal(built.status, 0, built.stdout + built.stderr);
        const index = JSON.parse(
          await fs.readFile(
            path.join(siteRoot, outputName, "static/contentIndex.json"),
            "utf8",
          ),
        );
        assert.equal(index["articles/example"].title, "Example");
        assert.ok(
          Object.keys(index).filter(
            (slug) => slug.startsWith("articles/") && index[slug].sortRanks,
          ).length === 1,
        );
      } finally {
        await fs.rm(path.join(siteRoot, outputName), {
          recursive: true,
          force: true,
        });
      }
    }
  }));
test("only a confirmed missing branch falls back; inaccessible repos and API errors fail", () =>
  fixture(async ({ website }) => {
    for (const status of [401, 403, 404, 429, 500]) {
      await assert.rejects(
        resolveContentSource({
          root: website,
          websiteRepository: "example/site",
          request: async () => response(status),
        }),
        /Cannot access content repository/,
      );
    }
    for (const status of [401, 403, 429, 500]) {
      await assert.rejects(
        resolveContentSource({
          root: website,
          websiteRepository: "example/site",
          request: async (url) =>
            response(url.includes("/branches/") ? status : 200),
        }),
        /refusing sample fallback/,
      );
    }
    for (const status of [401, 403, 404, 429, 500]) {
      await assert.rejects(
        resolveContentSource({
          root: website,
          websiteRepository: "example/site",
          request: async (url) =>
            response(
              url.includes("/branches?")
                ? status
                : url.includes("/branches/")
                  ? 404
                  : 200,
            ),
        }),
        /Cannot verify content branch access/,
      );
    }
    await assert.rejects(
      resolveContentSource({
        root: website,
        websiteRepository: "example/site",
        request: async () => {
          throw new Error("Network unavailable");
        },
      }),
      /Network unavailable/,
    );
    await assert.rejects(
      resolveContentSource({
        root: website,
        websiteRepository: "https://github.com/example/site",
      }),
      /owner\/repository/,
    );
    await assert.rejects(
      resolveContentSource({
        root: website,
        websiteRepository: "example/site",
        contentBranch: "bad\nbranch",
      }),
      /Invalid content branch/,
    );
  }));
test("timestamp repair CLI pushes to CONTENT_BRANCH rather than a hard-coded vault branch", () =>
  fixture(async ({ root, repositories }) => {
    const remote = path.join(root, "custom.git");
    const clone = path.join(root, "custom-build");
    git(root, "clone", "--bare", repositories.external.directory, remote);
    git(root, "clone", remote, clone);
    const repaired = spawnSync(
      process.execPath,
      ["scripts/repair-vault-timestamps.mjs", "--push"],
      {
        cwd: siteRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          VAULT_ROOT: clone,
          CONTENT_BRANCH: "notes/live",
        },
      },
    );
    assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
    assert.match(
      git(remote, "show", "notes/live:vault/notes/Example.md"),
      /created:/,
    );
    assert.equal(git(remote, "branch", "--list", "vault"), "");
  }));
test("external notifier sends only an authenticated workflow dispatch to the website; failures are reported", async () => {
  const result = await dispatchWebsite({
    repository: "example/website",
    token: "fixture-only-token",
    request: async (url, options) => {
      assert.equal(
        url,
        "https://api.github.com/repos/example/website/actions/workflows/pages.yml/dispatches",
      );
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer fixture-only-token");
      assert.deepEqual(JSON.parse(options.body), { ref: "main" });
      return response(204);
    },
  });
  assert.equal(result.repository, "example/website");
  await assert.rejects(
    dispatchWebsite({ repository: "example/website" }),
    /WEBSITE_DISPATCH_TOKEN/,
  );
  await assert.rejects(
    dispatchWebsite({
      repository: "example/website",
      token: "fixture",
      request: async () => response(403),
    }),
    /Actions write permission/,
  );
});

test("same-repository access uses the website token; external access uses its scoped content token", async () => {
  for (const [repository, expected] of [
    ["EXAMPLE/site", "website-token"],
    ["example/content", "content-token"],
  ]) {
    await resolveContentSource({
      websiteRepository: "example/site",
      contentRepository: repository,
      websiteToken: "website-token",
      token: "content-token",
      request: async (_url, options) => {
        assert.equal(options.headers.Authorization, `Bearer ${expected}`);
        return response(200);
      },
    });
  }
});
