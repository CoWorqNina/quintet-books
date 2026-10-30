import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the Cloudflare plugin starts a dev runtime that tests don't need.
export default defineConfig({
  test: { include: ["worker/**/*.test.ts", "shared/**/*.test.ts", "src/**/*.test.ts"] },
});
