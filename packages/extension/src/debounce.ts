/**
 * Runs `run` once, `ms` after the last call; calling again before then starts the wait over.
 * `cancel()` drops a run still waiting. No imports: the extension and its pages both use it.
 */
export function debounce(ms: number, run: () => void): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  later.cancel = () => clearTimeout(timer);
  return later;
}
