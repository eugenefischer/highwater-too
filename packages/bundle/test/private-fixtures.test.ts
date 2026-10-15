import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HighlandBundle } from "../src/index.ts";

/** EJ's own Highland files stay outside the repo; set HIGHWATER_PRIVATE_FIXTURES to run these. */
const root = process.env.HIGHWATER_PRIVATE_FIXTURES;

function findHighland(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    // EJ's working copies for hands-on testing change as he tests: not fixtures.
    if (statSync(full).isDirectory()) return name.endsWith(".textbundle") || name === "Human Testing Files" ? [] : findHighland(full);
    return name.endsWith(".highland") ? [full] : [];
  });
}

describe.runIf(root)("private Highland fixtures", () => {
  const files = root ? findHighland(root) : [];
  it("finds some files", () => expect(files.length).toBeGreaterThan(0));
  for (const file of files) {
    it(`round-trips ${file.slice((root ?? "").length + 1)}`, () => {
      const original = HighlandBundle.fromZip(new Uint8Array(readFileSync(file)));
      const again = HighlandBundle.fromZip(original.toZip(file));
      expect(again.paths).toEqual(original.paths);
      for (const p of original.paths) expect(again.get(p), p).toEqual(original.get(p));
      expect(again.text).toBe(original.text);
    });
  }
});
