import type { SaveKind } from "./history.ts";

/**
 * When to commit: explicit saves at once; autosaves at most once every `interval` ms (a pending
 * autosave commit fires when the interval is up, with the text as it is then); closing flushes.
 */
export class CommitBatcher {
  #last = new Map<string, number>();
  #pending = new Map<string, ReturnType<typeof setTimeout>>();

  readonly #commit: (key: string, kind: SaveKind) => Promise<void>;
  readonly #interval: number;
  readonly #now: () => number;

  constructor(commit: (key: string, kind: SaveKind) => Promise<void>, interval = 5 * 60_000, now: () => number = Date.now) {
    this.#commit = commit;
    this.#interval = interval;
    this.#now = now;
  }

  saved(key: string, kind: SaveKind): Promise<void> | null {
    if (kind === "autosave") {
      const last = this.#last.get(key);
      const wait = last === undefined ? 0 : last + this.#interval - this.#now();
      if (wait <= 0) return this.#run(key, "autosave");
      if (!this.#pending.has(key)) this.#pending.set(key, setTimeout(() => void this.#run(key, "autosave"), wait));
      return null;
    }
    if (kind === "close" && !this.#pending.has(key)) return null;
    return this.#run(key, kind);
  }

  dispose(): void {
    for (const t of this.#pending.values()) clearTimeout(t);
    this.#pending.clear();
  }

  #run(key: string, kind: SaveKind): Promise<void> {
    clearTimeout(this.#pending.get(key));
    this.#pending.delete(key);
    this.#last.set(key, this.#now());
    return this.#commit(key, kind);
  }
}
