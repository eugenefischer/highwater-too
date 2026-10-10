import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  displayName: string;
  main: string;
  contributes: { commands: { command: string }[] };
};

describe("extension manifest", () => {
  it("is named Highwater Too", () => {
    expect(manifest.displayName).toBe("Highwater Too");
  });
  it("declares the bundled entry point", () => {
    expect(manifest.main).toBe("./dist/extension.cjs");
  });
  it("registers its commands", () => {
    expect(manifest.contributes.commands.map((c) => c.command)).toContain("highwater.hello");
  });
});
