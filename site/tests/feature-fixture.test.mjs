import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { preparePublication, siteRoot } from "../scripts/publish.mjs";
import { auditOutput } from "../scripts/verify-output.mjs";
import { enrichSortRanks } from "../scripts/sort-ranks.mjs";
import { copyMathFonts } from "../scripts/trusted-static.mjs";

test("private temporary fixture preserves rich Obsidian rendering without public demo articles", async () => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "quartz-feature-fixture-"),
  );
  const input = path.join(root, "input"),
    output = path.join(root, "output");
  const sources = {
    "index.md": "---\ntitle: Fixture\n---\n[[math|Formula]] and [[code]].\n",
    "math.md":
      "---\ntitle: Formula\n---\n## Equation\n\n$E=mc^2$\n\n$$\\sum_{i=1}^{n}i=\\frac{n(n+1)}{2}$$\n\n> [!note] Reasoning\n> A test callout.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nA statement.[^one]\n\n[^one]: A test footnote.\n\n![[assets/pixel.png|Test image]]\n\n[[code#Example]]\n",
    "code.md":
      "---\ntitle: Code\n---\n## Example\n\n```python\nprint(42)\n```\n\n![[embedded]]\n\n[[math]]\n",
    "embedded.md":
      "---\ntitle: Embedded\n---\nA transcluded fixture paragraph.\n",
  };
  try {
    for (const [name, body] of Object.entries(sources)) {
      await fs.writeFile(path.join(root, name), body);
    }
    await fs.mkdir(path.join(root, "assets"));
    await fs.writeFile(
      path.join(root, "assets/pixel.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const manifestFile = path.join(root, "manifest.json");
    await fs.writeFile(
      manifestFile,
      JSON.stringify({
        version: 1,
        notes: Object.keys(sources).map((name) => ({
          source: name,
          target: name,
        })),
        assets: [{ source: "assets/pixel.png", target: "assets/pixel.png" }],
      }),
    );
    const publication = await preparePublication({
      root,
      manifestFile,
      output: input,
    });
    const result = spawnSync(
      process.execPath,
      ["quartz/bootstrap-cli.mjs", "build", "-d", input, "-o", output],
      {
        cwd: siteRoot,
        env: { ...process.env, SITE_BASE_URL: "example.invalid" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await enrichSortRanks(output, publication);
    await copyMathFonts(output);
    await auditOutput(output, publication);
    const math = await fs.readFile(path.join(output, "math.html"), "utf8"),
      code = await fs.readFile(path.join(output, "code.html"), "utf8");
    for (const pattern of [
      /<math[\s>]/u,
      /class="katex/u,
      /footnote/iu,
      /callout/u,
      /pixel\.png/u,
      /<table/u,
    ])
      assert.match(math, pattern);
    assert.match(code, /data-language="python"|language-python/u);
    assert.match(code, /A transcluded fixture paragraph/u);
    assert.match(code, /transclude/u);
    assert.match(math, /#example/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
