import { defineConfig } from "@playwright/test";
import fs from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (fs.existsSync(chrome) ? chrome : undefined);
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    headless: true,
    launchOptions: { executablePath },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node scripts/serve.mjs --port 4173 --prefix /knowledge/",
      url: "http://127.0.0.1:4173/knowledge/",
      reuseExistingServer: false,
      env: { SITE_OUTPUT: "public-subpath" },
    },
    {
      command: "node scripts/serve.mjs --port 4174",
      url: "http://127.0.0.1:4174/",
      reuseExistingServer: false,
      env: { SITE_OUTPUT: "public-root" },
    },
  ],
  projects: [
    {
      name: "desktop-root",
      use: {
        viewport: { width: 1440, height: 1000 },
        baseURL: "http://127.0.0.1:4174/",
      },
    },
    {
      name: "tablet-subpath",
      use: {
        viewport: { width: 900, height: 1000 },
        baseURL: "http://127.0.0.1:4173/knowledge/",
      },
    },
    {
      name: "small-mobile-subpath",
      use: {
        viewport: { width: 320, height: 740 },
        baseURL: "http://127.0.0.1:4173/knowledge/",
      },
    },
    {
      name: "mobile-subpath",
      use: {
        viewport: { width: 390, height: 844 },
        baseURL: "http://127.0.0.1:4173/knowledge/",
      },
    },
  ],
});
