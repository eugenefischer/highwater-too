// Writes themes/*.json, the Highland themes as VS Code colour themes, from src/highland-editor/themes.ts.
// Run: node --experimental-strip-types scripts/gen-themes.ts (a test checks the files are up to date).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { colorTheme, colorThemeFile, HIGHLAND_THEMES } from "../src/highland-editor/themes.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(root, "themes"), { recursive: true });
for (const [id, t] of Object.entries(HIGHLAND_THEMES)) writeFileSync(join(root, colorThemeFile(id)), `${JSON.stringify(colorTheme(t), null, 2)}\n`);
