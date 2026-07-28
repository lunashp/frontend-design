/**
 * A minimal FIFO concurrency limiter (a counting semaphore around async tasks).
 *
 * The thumbnail renderer owns ONE Chromium instance and must not open an
 * unbounded number of pages: a virtualized gallery can mount ~30 cards at once,
 * and 30 simultaneous `newPage()` renders would exhaust the browser's memory
 * and starve every render of CPU, turning a nicety into a hang. This queue caps
 * how many run concurrently and lets the rest wait their turn. It is pure — no
 * browser, no I/O — so the invariant it guarantees is unit-testable on its own.
 */

export interface BoundedQueue {
  /** Run `task` once a slot is free; resolves/rejects with the task's outcome. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks currently executing (for observability/tests). */
  readonly active: number;
  /** Tasks admitted but still waiting for a slot. */
  readonly pending: number;
}

export function createBoundedQueue(concurrency: number): BoundedQueue {
  // Clamp to at least 1: a queue with concurrency 0 would admit nothing and hang
  // every caller forever — a far worse failure than simply running one at a time.
  const limit = Math.max(1, Math.floor(concurrency));
  const waiters: Array<() => void> = [];
  let active = 0;

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiters.push(resolve));
  };

  const release = (): void => {
    const next = waiters.shift();
    if (next) {
      // Hand the just-freed slot straight to the next waiter — `active` stays put
      // (one out, one in) so the count can never momentarily exceed the limit.
      next();
      return;
    }
    active -= 1;
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        // Always release, even on rejection: a task that throws must not strand
        // its slot, or the pool leaks capacity until it deadlocks.
        release();
      }
    },
    get active() {
      return active;
    },
    get pending() {
      return waiters.length;
    },
  };
}
