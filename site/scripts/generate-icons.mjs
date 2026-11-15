import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Keep the browser and iOS artwork identical; only the export format differs.
const site = new URL("../", import.meta.url);
const svg = new URL("custom/favicon.svg", site);
const png = new URL("custom/apple-touch-icon.png", site);
await sharp(await fs.readFile(svg), { density: 144 })
  .resize(180, 180)
  .flatten({ background: "#101418" })
  .png()
  .toFile(fileURLToPath(png));

const inventoryFile = new URL("trusted-site-assets.json", site);
const inventory = JSON.parse(await fs.readFile(inventoryFile, "utf8"));
for (const name of ["custom/favicon.svg", "custom/apple-touch-icon.png"])
  inventory[name] = createHash("sha256")
    .update(await fs.readFile(new URL(name, site)))
    .digest("hex");
await fs.writeFile(inventoryFile, JSON.stringify(inventory, null, 2) + "\n");
