import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { regularFile, siteRoot } from "./publish.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function trustedStatic(
  root = siteRoot,
  inventoryFile = path.join(siteRoot, "trusted-static.json"),
) {
  const inventory = JSON.parse(await fs.readFile(inventoryFile, "utf8"));
  const seen = [];
  async function scan(relative) {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink())
      throw new Error("Symlink in trusted static source");
    if (stat.isDirectory())
      for (const name of await fs.readdir(absolute))
        await scan(path.posix.join(relative, name));
    else {
      const file = await regularFile(root, relative);
      const key = relative.slice("quartz/static/".length);
      if (
        !Object.hasOwn(inventory, key) ||
        digest(await fs.readFile(file)) !== inventory[key]
      )
        throw new Error("Unexpected or modified trusted static source");
      seen.push(key);
    }
  }
  await scan("quartz/static");
  if (seen.length !== Object.keys(inventory).length)
    throw new Error("Trusted static source is incomplete");
  return inventory;
}
export async function verifyStaticOutput(output, names) {
  const inventory = await trustedStatic();
  const generated = JSON.parse(
    await fs.readFile(
      path.join(siteRoot, "trusted-generated-static.json"),
      "utf8",
    ),
  );
  const approved = { ...inventory, ...generated };
  const siteAssets = await checkedSiteAssets();
  const graphAssets = await checkedGraphAssets();
  const allowed = new Set([
    ...Object.values(graphAssets).map((asset) => "static/graph/" + asset.name),
    ...Object.keys(approved).map((name) => "static/" + name),
    "static/contentIndex.json",
    ...Object.keys(siteAssets).map(
      (source) => "static/" + path.basename(source),
    ),
  ]);
  for (const name of names.filter((name) => name.startsWith("static/"))) {
    if (!allowed.has(name))
      throw new Error("Unexpected static output; refusing publication");
    if (
      name !== "static/contentIndex.json" &&
      digest(await fs.readFile(path.join(output, name))) !==
        (approved[name.slice(7)] ??
          siteAssets["custom/" + name.slice(7)] ??
          Object.values(graphAssets).find(
            (asset) => "static/graph/" + asset.name === name,
          )?.sha256)
    )
      throw new Error("Trusted static output bytes changed");
  }
}
export async function trustedMath(root = siteRoot) {
  const inventory = JSON.parse(
    await fs.readFile(path.join(siteRoot, "trusted-math.json"), "utf8"),
  );
  const fontNames = await fs.readdir(
    path.join(root, "node_modules/katex/dist/fonts"),
  );
  if (
    fontNames.length !==
    Object.keys(inventory).filter((name) => name.startsWith("fonts/")).length
  )
    throw new Error("Unexpected math runtime resource");
  for (const [name, hash] of Object.entries(inventory)) {
    const source = await regularFile(root, `node_modules/katex/dist/${name}`);
    if (digest(await fs.readFile(source)) !== hash)
      throw new Error("Modified math runtime resource");
  }
  return inventory;
}
export async function copyMathFonts(output) {
  const inventory = await trustedMath();
  for (const name of Object.keys(inventory).filter((name) =>
    name.startsWith("fonts/"),
  )) {
    const source = await regularFile(
      siteRoot,
      `node_modules/katex/dist/${name}`,
    );
    await fs.mkdir(path.dirname(path.join(output, name)), { recursive: true });
    await fs.copyFile(source, path.join(output, name));
  }
}
export async function verifyMathOutput(output, names) {
  const inventory = await trustedMath();
  for (const name of names.filter((name) => name.startsWith("fonts/"))) {
    if (
      !Object.hasOwn(inventory, name) ||
      digest(await fs.readFile(path.join(output, name))) !== inventory[name]
    )
      throw new Error("Unexpected math output resource");
  }
}

export async function checkedSiteAssets() {
  const inventory = JSON.parse(
    await fs.readFile(path.join(siteRoot, "trusted-site-assets.json"), "utf8"),
  );
  for (const [source, hash] of Object.entries(inventory)) {
    const file = await regularFile(siteRoot, source);
    if (digest(await fs.readFile(file)) !== hash)
      throw new Error("Modified site static asset");
  }
  return inventory;
}
export async function copySiteAssets(output) {
  for (const source of Object.keys(await checkedSiteAssets())) {
    await fs.copyFile(
      path.join(siteRoot, source),
      path.join(output, "static", path.basename(source)),
    );
  }
}

export async function checkedGraphAssets() {
  const inventory = JSON.parse(
    await fs.readFile(path.join(siteRoot, "trusted-graph.json"), "utf8"),
  );
  for (const [source, asset] of Object.entries(inventory)) {
    const file = await regularFile(siteRoot, source);
    if (
      !/^[a-zA-Z0-9.-]+$/u.test(asset.name) ||
      digest(await fs.readFile(file)) !== asset.sha256
    )
      throw new Error("Modified graph runtime resource");
  }
  return inventory;
}
export async function copyGraphAssets(output) {
  await fs.mkdir(path.join(output, "static/graph"), { recursive: true });
  for (const [source, asset] of Object.entries(await checkedGraphAssets()))
    await fs.copyFile(
      path.join(siteRoot, source),
      path.join(output, "static/graph", asset.name),
    );
}
