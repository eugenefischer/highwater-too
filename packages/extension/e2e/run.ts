/**
 * End-to-end tests: downloads VS Code (stable), installs this extension from source, and runs
 * e2e/suite.ts inside it. Run with `npm run test:e2e -w highwater-too`; on Linux CI, under
 * xvfb-run.
 */
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = fileURLToPath(new URL("..", import.meta.url));
const extensionTestsPath = fileURLToPath(new URL("../dist/e2e/suite.cjs", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "highwater-e2e-"));

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes"],
    extensionTestsEnv: {
      HIGHWATER_E2E_FIXTURE: fileURLToPath(new URL("../../../fixtures/generated/ScreenplayEdgeCases.highland", import.meta.url)),
      HIGHWATER_E2E_DIR: workspace,
    },
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
