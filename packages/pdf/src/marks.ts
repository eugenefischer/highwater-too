import type { Layout, PlacedText, PrintMarks } from "./types.ts";

/** Paragraph numbers (ScreenplayPrintProbe, ManuscriptPrintProbe): Helvetica 9 pt in blue, right edge 36 pt from the page's left edge, 3 pt above the line's baseline. */
export const NUMBER = { font: "Helvetica", size: 9, color: "#000CCC", right: 36, rise: 3 } as const;

/**
 * Adds paragraph numbers and revision stars to a laid-out document.
 * A number goes beside the first printed line of its source line. A star goes 36 pt from the
 * page's right edge on every line with revised text; its baseline is 1 pt above the line's at
 * 12 pt spacing and 6.32 pt below it at the Manuscript's 28.32 pt (measured), so in between it
 * moves with the spacing.
 */
export function addPrintMarks(layout: Layout, marks: PrintMarks | undefined, pitch: number): void {
  if (!marks) return;
  if (marks.numbers?.size) addNumbers(layout, marks.numbers);
  if (marks.revisionStars) {
    const dy = -1 + (pitch - 12) * (7.32 / 16.32);
    for (const page of layout.pages) {
      if (page.number === null) continue;
      const ys = new Set<number>();
      for (const it of page.items) if (it.runs.some((r) => r.style.revised)) ys.add(it.y);
      for (const y of ys) page.items.push({ x: layout.width - 36, y: y + dy, runs: [{ text: "*", style: {} }] });
    }
  }
}

function addNumbers(layout: Layout, numbers: Map<number, number>): void {
  // Source lines in order, with where each ends (the next one's start bounds it).
  const starts = [...numbers.keys()].sort((a, b) => a - b);
  const lineOf = (src: number): number | undefined => {
    let lo = 0;
    let hi = starts.length - 1;
    let found: number | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid]! <= src) {
        found = starts[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  const done = new Set<number>();
  for (const page of layout.pages) {
    if (page.number === null) continue;
    const add: PlacedText[] = [];
    const rowsDone = new Set<number>();
    for (const it of page.items) {
      for (const r of it.runs) {
        if (r.style.src === undefined) continue;
        const line = lineOf(r.style.src);
        if (line === undefined || done.has(line)) continue;
        done.add(line);
        if (rowsDone.has(it.y) || it.unnumbered) continue; // two source lines on one printed line: the first one's number
        rowsDone.add(it.y);
        const text = String(numbers.get(line));
        // Helvetica's digits are 0.556 em wide.
        add.push({ x: NUMBER.right - text.length * 0.556 * NUMBER.size, y: it.y - NUMBER.rise, runs: [{ text, style: { font: NUMBER.font, size: NUMBER.size, color: NUMBER.color } }] });
      }
    }
    page.items.push(...add);
  }
}
