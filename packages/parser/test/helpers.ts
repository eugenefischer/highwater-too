import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { expect } from "vitest";
import type { Document, Mode } from "../src/index.ts";

export interface SourceFixture {
  name: string;
  text: string;
  mode: Mode;
}

const generatedDir = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));

function load(path: string, name: string): SourceFixture | null {
  if (path.endsWith(".highland")) {
    const bundle = HighlandBundle.fromZip(new Uint8Array(readFileSync(path)));
    return { name, text: bundle.text, mode: bundle.mode };
  }
  if (path.endsWith(".fountain")) return { name, text: readFileSync(path, "utf8"), mode: "fountain" };
  if (path.endsWith(".md")) return { name, text: readFileSync(path, "utf8"), mode: "markdown" };
  return null;
}

function walk(dir: string, root: string): SourceFixture[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry.endsWith(".textbundle") ? [] : walk(full, root);
    const f = load(full, full.slice(root.length));
    return f ? [f] : [];
  });
}

/** Generated fixtures (always) plus EJ's private files when HIGHWATER_PRIVATE_FIXTURES is set. */
export function allFixtures(): SourceFixture[] {
  const out = walk(generatedDir, generatedDir);
  const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;
  if (priv) out.push(...walk(priv, priv).map((f) => ({ ...f, name: `private:${f.name}` })));
  return out;
}

/** The structural invariants every parse must satisfy. */
export function expectTiling(doc: Document): void {
  let at = 0;
  for (const node of doc.nodes) {
    expect(node.span.start, `${node.kind} starts where the previous node ended`).toBe(at);
    expect(node.span.end).toBeGreaterThanOrEqual(node.span.start);
    at = node.span.end;
  }
  expect(at, "nodes cover the whole source").toBe(doc.source.length);
  expect(doc.nodes.map((n) => doc.source.slice(n.span.start, n.span.end)).join("")).toBe(doc.source);
}
