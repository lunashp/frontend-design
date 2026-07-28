/**
 * The thumbnail renderer drives a small pool of Chromium pages: without a bound
 * on concurrency, a gallery-wide scroll would open a page per visible card at
 * once and thrash (or crash) the browser. This queue is that bound, and it is
 * pure — no browser here, just the concurrency invariant it must never violate.
 */

import { describe, it, expect } from 'vitest';
import { createBoundedQueue } from '../src/bounded-queue.js';

/** A task that stays in flight until `release()` is called, so overlap is observable. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('createBoundedQueue', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    const queue = createBoundedQueue(2);
    let active = 0;
    let peak = 0;
    const gate = deferred();

    const task = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await gate.promise;
      active -= 1;
    };

    const runs = [queue.run(task), queue.run(task), queue.run(task), queue.run(task)];
    // Let the queue admit as many as it will before any task completes.
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBeLessThanOrEqual(2);

    gate.release();
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it('returns each task’s resolved value to its own caller', async () => {
    const queue = createBoundedQueue(1);
    const results = await Promise.all([queue.run(async () => 'a'), queue.run(async () => 'b')]);
    expect(results).toEqual(['a', 'b']);
  });

  it('frees the slot when a task rejects, so a later task still runs', async () => {
    const queue = createBoundedQueue(1);
    await expect(queue.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // If the failed task had leaked its slot, this would hang forever.
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('clamps a nonsensical concurrency up to at least 1 instead of deadlocking', async () => {
    const queue = createBoundedQueue(0);
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });
});
