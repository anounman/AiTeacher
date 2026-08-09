// Tiny completion bus between board items (which know when their write-on
// animation finished) and the TeachPanel orchestrator (which must not start
// speaking the next segment until the board caught up). Timeout fallback so a
// lost signal can never wedge the lesson.
const waiters = new Map<string, () => void>();

export function signalDone(key: string): void {
  const w = waiters.get(key);
  waiters.delete(key);
  w?.();
}

export function waitForDone(key: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      waiters.delete(key);
      resolve();
    }, timeoutMs);
    waiters.set(key, () => {
      clearTimeout(t);
      resolve();
    });
  });
}
