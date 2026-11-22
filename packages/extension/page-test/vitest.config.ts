import { defineConfig } from "vitest/config";

// The page tests: the Highwater Editor's page in Chromium (npm run test:page). Separate from the
// unit tests because they need the built page and a browser.
export default defineConfig({
  test: { include: ["page-test/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
