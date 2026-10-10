import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { describe, expect, it } from "vitest";
import { parse, type Mode } from "../src/index.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;

/** A document's text repeated (title page dropped) to exactly 200 KB. */
function sample(path: string): string {
  let text = HighlandBundle.fromZip(new Uint8Array(readFileSync(path))).text;
  const body = text.replace(/^(?:[^\n]+\n)+\n/, "");
  while (text.length < 200_000) text += "\n\n" + body;
  return text.slice(0, 200_000);
}

/** Fastest of 15 runs after warm-up, so other test files running in parallel don't skew it. */
function fastest(source: string, mode: Mode): number {
  for (let i = 0; i < 5; i++) parse(source, { mode });
  let best = Infinity;
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    parse(source, { mode });
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("parser speed, 200 KB", () => {
  // The generated samples pack about four times as many elements per KB as a real script, so this
  // is a stress test for CI: it catches anything quadratic, not the spec target.
  it.each([
    ["ScreenplayEdgeCases.highland", "fountain"],
    ["ManuscriptEdgeCases.highland", "markdown"],
  ] as const)("stress: %s", (name, mode) => {
    const ms = fastest(sample(join(generated, name)), mode);
    console.log(`parse 200 KB stress ${mode}: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(60);
  });

  // Spec target: 10 ms for 200 KB of a real document.
  it.runIf(priv).each([
    ["Astounding_date_EJ draft 2 copy.highland", "fountain"],
    ["SweetBetty_HighlandTest.highland", "markdown"],
  ] as const)("real document: %s", (name, mode) => {
    const ms = fastest(sample(join(priv!, "Files with exports", name)), mode);
    console.log(`parse 200 KB real ${mode}: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(10);
  });
});
