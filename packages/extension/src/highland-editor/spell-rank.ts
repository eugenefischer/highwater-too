/** Ordering the spelling dictionary's guesses (in the worker, so kept apart from the parser). */
/**
 * Orders the dictionary's guesses by how close they are, a swap of two letters counting half (the
 * commonest slip: "teh", whose guesses otherwise put "the" ninth); ties keep the dictionary's order.
 */
export function rankGuesses(word: string, guesses: string[]): string[] {
  const w = word.toLowerCase();
  return guesses
    .map((g, i) => ({ g, i, d: distance(w, g.toLowerCase()) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.g);
}

/** Edit distance with adjacent swaps costing half. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 0.5);
      d[i]![j] = v;
    }
  return d[a.length]![b.length]!;
}
