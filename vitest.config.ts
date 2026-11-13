import { defineConfig } from "vitest/config";

import { fileURLToPath } from "node:url";

export default defineConfig({
  // Code that imports VS Code is tested against a small stand-in for it.
  resolve: { alias: { vscode: fileURLToPath(new URL("./packages/extension/test/support/vscode.ts", import.meta.url)) } },
  test: {
    include: ["packages/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
