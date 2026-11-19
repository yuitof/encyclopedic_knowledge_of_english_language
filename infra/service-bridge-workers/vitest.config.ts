import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    main: "./src/index.ts",
    remoteBindings: false,
    miniflare: { compatibilityDate: "2026-11-19" },
  })],
});
