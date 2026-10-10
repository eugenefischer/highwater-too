import type { PdfLine, PdfPage } from "./extract.ts";

export type LineDiff =
  | { kind: "text"; page: number; index: number; expected: PdfLine; actual: PdfLine }
  | { kind: "position"; page: number; index: number; expected: PdfLine; actual: PdfLine; dx: number; dy: number }
  | { kind: "missing"; page: number; index: number; expected: PdfLine }
  | { kind: "extra"; page: number; index: number; actual: PdfLine };

export interface CompareResult {
  ok: boolean;
  expectedPages: number;
  actualPages: number;
  diffs: LineDiff[];
}

export interface CompareOptions {
  /** Largest allowed x or y difference, in points. The MVP target is 1 pt. */
  tolerance?: number;
}

/** Compares line by line, page by page. Lines are matched in reading order. */
export function comparePages(expected: PdfPage[], actual: PdfPage[], options: CompareOptions = {}): CompareResult {
  const tolerance = options.tolerance ?? 1;
  const diffs: LineDiff[] = [];
  const pageCount = Math.max(expected.length, actual.length);
  for (let p = 0; p < pageCount; p++) {
    const exp = expected[p]?.lines ?? [];
    const act = actual[p]?.lines ?? [];
    const lineCount = Math.max(exp.length, act.length);
    for (let i = 0; i < lineCount; i++) {
      const e = exp[i];
      const a = act[i];
      if (e && !a) diffs.push({ kind: "missing", page: p + 1, index: i, expected: e });
      else if (a && !e) diffs.push({ kind: "extra", page: p + 1, index: i, actual: a });
      else if (e && a) {
        if (e.text !== a.text) {
          diffs.push({ kind: "text", page: p + 1, index: i, expected: e, actual: a });
          continue;
        }
        const dx = a.x - e.x;
        const dy = a.y - e.y;
        if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
          diffs.push({ kind: "position", page: p + 1, index: i, expected: e, actual: a, dx, dy });
        }
      }
    }
  }
  return { ok: diffs.length === 0 && expected.length === actual.length, expectedPages: expected.length, actualPages: actual.length, diffs };
}

/** A short human-readable report, at most `limit` differences. */
export function formatReport(result: CompareResult, limit = 40): string {
  const out: string[] = [];
  out.push(result.ok ? "MATCH" : "DIFFERENT");
  out.push(`pages: expected ${result.expectedPages}, actual ${result.actualPages}`);
  out.push(`line differences: ${result.diffs.length}`);
  for (const d of result.diffs.slice(0, limit)) {
    const where = `p${d.page} #${d.index + 1}`;
    switch (d.kind) {
      case "text":
        out.push(`${where} text: ${JSON.stringify(d.expected.text)} -> ${JSON.stringify(d.actual.text)}`);
        break;
      case "position":
        out.push(`${where} moved dx=${d.dx.toFixed(1)} dy=${d.dy.toFixed(1)}: ${JSON.stringify(d.expected.text)}`);
        break;
      case "missing":
        out.push(`${where} missing: ${JSON.stringify(d.expected.text)}`);
        break;
      case "extra":
        out.push(`${where} extra: ${JSON.stringify(d.actual.text)}`);
        break;
    }
  }
  if (result.diffs.length > limit) out.push(`… ${result.diffs.length - limit} more`);
  return out.join("\n");
}
