/**
 * What changed between a save and the text now, word by word, for comparing in the page. Lines are
 * compared first (Myers), then each changed block word by word, so a long document with a few edits
 * stays quick. Pure, for tests.
 */

/** One change: the text now has `from`–`to` added there (possibly nothing), and `deleted` was removed. */
export interface Change {
  from: number;
  to: number;
  deleted: string;
}

type Op = { kind: "same" | "del" | "add"; a: number; b: number; n: number };

/** Myers's shortest edit script as runs of same / deleted / added items; null past `maxD` edits. */
export function myers(a: readonly string[], b: readonly string[], maxD: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // Only the diagonals in reach at each step are kept (−d…d), so memory grows with the edits, not the text.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // Walk back through the trace, one edit per step.
  const steps: { kind: Op["kind"]; a: number; b: number }[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    // The diagonals as they were before step d (kept as −d…d, so diagonal k is at k + d).
    const vd = trace[d]!;
    const at = (k: number) => vd[k + d]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) steps.push({ kind: "same", a: --x, b: --y });
    if (down) steps.push({ kind: "add", a: x, b: --y });
    else steps.push({ kind: "del", a: --x, b: y });
  }
  while (x > 0 && y > 0) steps.push({ kind: "same", a: --x, b: --y });
  steps.reverse();
  const ops: Op[] = [];
  for (const s of steps) {
    const last = ops.at(-1);
    if (last && last.kind === s.kind && last.a + (s.kind === "add" ? 0 : last.n) === s.a && last.b + (s.kind === "del" ? 0 : last.n) === s.b) last.n++;
    else ops.push({ ...s, n: 1 });
  }
  return ops;
}

/** Words, runs of spaces, and single other characters, with where each starts. */
function tokens(text: string): { s: string; at: number }[] {
  const out: { s: string; at: number }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\S\n]+|\n|./gu)) out.push({ s: m[0], at: m.index! });
  return out;
}

function lines(text: string): { s: string; at: number }[] {
  const out: { s: string; at: number }[] = [];
  let at = 0;
  for (const s of text.split(/(?<=\n)/)) {
    out.push({ s, at });
    at += s.length;
  }
  return out;
}

/** The changes from `before` to `after`, in order; a run of changes with nothing in common between them is one. */
export function wordDiff(before: string, after: string): Change[] {
  // Word by word over the whole text, after setting aside what the two share at each end. Comparing
  // lines first (below) lines up blank lines wrongly (they all look alike), so that is only for a
  // rewrite too big to compare word by word.
  const ta = tokens(before);
  const tb = tokens(after);
  let start = 0;
  while (start < ta.length && start < tb.length && ta[start]!.s === tb[start]!.s) start++;
  let end = 0;
  while (end < ta.length - start && end < tb.length - start && ta[ta.length - 1 - end]!.s === tb[tb.length - 1 - end]!.s) end++;
  const ma = ta.slice(start, ta.length - end);
  const mb = tb.slice(start, tb.length - end);
  const ops = myers(
    ma.map((t) => t.s),
    mb.map((t) => t.s),
    3000,
  );
  if (ops) return grouped(ops, ma, mb, mb.length ? mb[0]!.at : start < tb.length ? tb[start]!.at : after.length);
  return byLines(before, after);
}

function byLines(before: string, after: string): Change[] {
  const changes: Change[] = [];
  const la = lines(before);
  const lb = lines(after);
  const lineOps = myers(
    la.map((l) => l.s),
    lb.map((l) => l.s),
    3000,
  ) ?? [{ kind: "del", a: 0, b: 0, n: la.length }, { kind: "add", a: la.length, b: 0, n: lb.length }];
  // Each changed block of lines: what it held then and now, compared word by word.
  for (let i = 0; i < lineOps.length; i++) {
    if (lineOps[i]!.kind === "same") continue;
    let delA = -1, delN = 0, addB = -1, addN = 0;
    let atA = lineOps[i]!.a, atB = lineOps[i]!.b;
    while (i < lineOps.length && lineOps[i]!.kind !== "same") {
      const o = lineOps[i]!;
      if (o.kind === "del") ((delA = delA < 0 ? o.a : delA), (delN += o.n));
      else ((addB = addB < 0 ? o.b : addB), (addN += o.n));
      i++;
    }
    const fromA = delN ? la[delA]!.at : (la[atA]?.at ?? before.length);
    const toA = delN ? la[delA + delN - 1]!.at + la[delA + delN - 1]!.s.length : fromA;
    const fromB = addN ? lb[addB]!.at : (lb[atB]?.at ?? after.length);
    const toB = addN ? lb[addB + addN - 1]!.at + lb[addB + addN - 1]!.s.length : fromB;
    changes.push(...blockChanges(before.slice(fromA, toA), after.slice(fromB, toB), fromB));
  }
  return changes;
}

function blockChanges(was: string, now: string, base: number): Change[] {
  const ta = tokens(was).map((t) => ({ s: t.s, at: base + t.at }));
  const tb = tokens(now).map((t) => ({ s: t.s, at: base + t.at }));
  const ops =
    myers(
      ta.map((t) => t.s),
      tb.map((t) => t.s),
      4000,
    ) ?? [{ kind: "del" as const, a: 0, b: 0, n: ta.length }, { kind: "add" as const, a: ta.length, b: 0, n: tb.length }];
  return grouped(ops, ta, tb, base + now.length);
}

/** Runs of edits with nothing shared between them, as changes; `end` is where the text after `tb` begins. */
function grouped(ops: Op[], ta: { s: string; at: number }[], tb: { s: string; at: number }[], end: number): Change[] {
  const out: Change[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]!.kind === "same") continue;
    let deleted = "";
    let from = -1, to = -1;
    const startB = ops[i]!.b;
    while (i < ops.length && ops[i]!.kind !== "same") {
      const o = ops[i]!;
      if (o.kind === "del") deleted += ta.slice(o.a, o.a + o.n).map((t) => t.s).join("");
      else {
        from = from < 0 ? o.b : from;
        to = o.b + o.n;
      }
      i++;
    }
    i--;
    const at = (j: number) => (j < tb.length ? tb[j]!.at : tb.length ? tb.at(-1)!.at + tb.at(-1)!.s.length : end);
    const f = from < 0 ? at(startB) : at(from);
    const t = from < 0 ? f : at(to);
    out.push({ from: f, to: t, deleted });
  }
  return out;
}
