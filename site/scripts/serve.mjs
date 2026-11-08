import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { siteRoot } from "./publish.mjs";
const args = process.argv.slice(2),
  option = (name, fallback) => args[args.indexOf(name) + 1] ?? fallback;
const prefix = args.includes("--prefix") ? option("--prefix", "/") : "/";
const port = Number(
  args.includes("--port") ? option("--port", "4173") : "4173",
);
const root = path.join(siteRoot, process.env.SITE_OUTPUT ?? "public");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".xml": "application/xml",
};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (!pathname.startsWith(prefix)) {
      res.writeHead(404);
      res.end();
      return;
    }
    let relative = pathname.slice(prefix.length);
    if (relative.split("/").includes("..") || relative.includes("\\"))
      throw new Error("Invalid path");
    if (!relative || relative.endsWith("/")) relative += "index.html";
    let file = path.join(root, relative);
    try {
      await fs.access(file);
    } catch {
      if (!path.extname(file)) file += ".html";
      else throw new Error("Missing");
    }
    const data = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": mime[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Static preview http://127.0.0.1:${port}${prefix}`),
);
