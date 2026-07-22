import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger, ProgressEvent } from '@ce/core';
import { SessionStore } from '../src/session-store.js';

const FIXTURE = path.resolve(import.meta.dirname, '../../core/test/fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-store-ws');
/** Extra distinct projects, so eviction has something to evict for. */
const FIXTURE_B = path.join(os.tmpdir(), 'ce-store-fixture-b');
const FIXTURE_C = path.join(os.tmpdir(), 'ce-store-fixture-c');

/**
 * A scan that actually runs emits engine progress ('load' → 'program' → 'classify').
 * A cache hit does no engine work, so it emits nothing — that is the observable
 * we assert on, rather than timing.
 */
function recordingLogger(): { logger: Logger; phases: string[] } {
  const phases: string[] = [];
  const logger: Logger = {
    log() {},
    progress(e: ProgressEvent) {
      phases.push(e.phase);
    },
  };
  return { logger, phases };
}

/** A clock the test drives, so TTL expiry needs no real waiting. */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

beforeAll(async () => {
  for (const dir of [FIXTURE_B, FIXTURE_C]) {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.cp(FIXTURE, dir, { recursive: true });
  }
});

afterAll(async () => {
  for (const dir of [FIXTURE_B, FIXTURE_C]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

afterEach(async () => {
  await fs.rm(WS, { recursive: true, force: true });
});

describe('SessionStore scan caching', () => {
  it('reuses the cached result instead of re-running the engine', async () => {
    const store = new SessionStore(WS);

    const first = recordingLogger();
    const a = await store.scan(FIXTURE, first.logger);
    expect(first.phases).toContain('program');
    expect(a.components.length).toBeGreaterThan(0);

    const second = recordingLogger();
    const b = await store.scan(FIXTURE, second.logger);
    expect(second.phases).toEqual([]);
    expect(b).toEqual(a);
  });

  it('re-runs the engine when force is set', async () => {
    const store = new SessionStore(WS);
    await store.scan(FIXTURE, recordingLogger().logger);

    const forced = recordingLogger();
    const b = await store.scan(FIXTURE, forced.logger, { force: true });
    expect(forced.phases).toContain('program');
    expect(b.components.length).toBeGreaterThan(0);
  });

  it('caches per resolved project path', async () => {
    const store = new SessionStore(WS);
    await store.scan(FIXTURE, recordingLogger().logger);

    // Same project reached by a non-normalized path must hit the same entry.
    const alias = path.join(FIXTURE, '..', path.basename(FIXTURE));
    const again = recordingLogger();
    await store.scan(alias, again.logger);
    expect(again.phases).toEqual([]);
  });

  it('does not cache a failed scan', async () => {
    const store = new SessionStore(WS);
    await expect(store.scan('/no/such/project', recordingLogger().logger)).rejects.toBeTruthy();
    expect(store.get('/no/such/project')).toBeUndefined();
  });

  it('serves artifacts from the cached session without re-scanning', async () => {
    const store = new SessionStore(WS);
    const scan = await store.scan(FIXTURE, recordingLogger().logger);
    const id = scan.components[0]?.descriptor.id as string;

    const after = recordingLogger();
    const artifact = await store.getArtifact(FIXTURE, id, after.logger);
    expect(artifact.descriptor.id).toBe(id);
    expect(after.phases).toEqual([]);
  });
});

describe('SessionStore in-flight runs', () => {
  it('shares one engine run between concurrent unforced scans', async () => {
    const store = new SessionStore(WS);
    const a = recordingLogger();
    const b = recordingLogger();

    const [first, second] = await Promise.all([
      store.scan(FIXTURE, a.logger),
      store.scan(FIXTURE, b.logger),
    ]);

    expect(first).toBe(second);
    // Only the run that actually started the engine sees progress.
    expect(b.phases).toEqual([]);
    expect(a.phases).toContain('program');
  });

  it('does not attach a forced re-scan to the in-flight run it is replacing', async () => {
    const store = new SessionStore(WS);

    const stale = recordingLogger();
    const inFlight = store.scan(FIXTURE, stale.logger);

    // Issued while the first scan is still running: joining it would hand back
    // exactly the result the caller asked to redo.
    const forced = recordingLogger();
    const forcedResult = await store.scan(FIXTURE, forced.logger, { force: true });
    await inFlight;

    expect(forced.phases).toContain('program');
    expect(forcedResult.components.length).toBeGreaterThan(0);
  });

  it('keeps the forced result cached even though the superseded run finishes too', async () => {
    const store = new SessionStore(WS);

    const inFlight = store.scan(FIXTURE, recordingLogger().logger);
    await store.scan(FIXTURE, recordingLogger().logger, { force: true });
    const forcedSession = store.get(FIXTURE);
    await inFlight;

    expect(store.get(FIXTURE)).toBe(forcedSession);
    expect(store.size).toBe(1);
  });
});

describe('SessionStore bounding', () => {
  it('evicts the least-recently-used session past the cap', async () => {
    const store = new SessionStore(WS, { maxSessions: 1 });

    await store.scan(FIXTURE, recordingLogger().logger);
    await store.scan(FIXTURE_B, recordingLogger().logger);

    // An EngineSession pins a whole ts-morph program, so the first one must be
    // gone, not merely shadowed.
    expect(store.size).toBe(1);
    expect(store.get(FIXTURE)).toBeUndefined();
    expect(store.get(FIXTURE_B)).toBeDefined();

    const back = recordingLogger();
    await store.scan(FIXTURE, back.logger);
    expect(back.phases).toContain('program');
  });

  it('evicts by recency of use, not of insertion', async () => {
    const store = new SessionStore(WS, { maxSessions: 2 });

    await store.scan(FIXTURE, recordingLogger().logger);
    await store.scan(FIXTURE_B, recordingLogger().logger);
    // Touch the older entry so the newer one becomes the eviction candidate.
    await store.scan(FIXTURE, recordingLogger().logger);
    await store.scan(FIXTURE_C, recordingLogger().logger);

    expect(store.size).toBe(2);
    expect(store.get(FIXTURE)).toBeDefined();
    expect(store.get(FIXTURE_C)).toBeDefined();
    expect(store.get(FIXTURE_B)).toBeUndefined();
  });

  it('releases the previous session on a forced re-scan', async () => {
    const store = new SessionStore(WS);
    await store.scan(FIXTURE, recordingLogger().logger);
    const before = store.get(FIXTURE);

    await store.scan(FIXTURE, recordingLogger().logger, { force: true });

    expect(store.get(FIXTURE)).toBeDefined();
    expect(store.get(FIXTURE)).not.toBe(before);
    expect(store.size).toBe(1);
  });

  it('drops an idle session once its TTL has passed', async () => {
    const clock = fakeClock();
    const store = new SessionStore(WS, { ttlMs: 60_000, now: clock.now });

    await store.scan(FIXTURE, recordingLogger().logger);
    expect(store.size).toBe(1);

    clock.advance(60_001);
    expect(store.size).toBe(0);

    const after = recordingLogger();
    await store.scan(FIXTURE, after.logger);
    expect(after.phases).toContain('program');
  });

  it('keeps a session alive while it is still being used', async () => {
    const clock = fakeClock();
    const store = new SessionStore(WS, { ttlMs: 60_000, now: clock.now });

    await store.scan(FIXTURE, recordingLogger().logger);
    clock.advance(50_000);
    const touched = recordingLogger();
    await store.scan(FIXTURE, touched.logger);
    expect(touched.phases).toEqual([]);

    clock.advance(50_000);
    expect(store.size).toBe(1);
  });

  it('never expires entries when ttlMs is 0', async () => {
    const clock = fakeClock();
    const store = new SessionStore(WS, { ttlMs: 0, now: clock.now });

    await store.scan(FIXTURE, recordingLogger().logger);
    clock.advance(365 * 24 * 60 * 60 * 1000);
    expect(store.size).toBe(1);
  });

  it('clear() drops every cached session', async () => {
    const store = new SessionStore(WS);
    await store.scan(FIXTURE, recordingLogger().logger);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get(FIXTURE)).toBeUndefined();
  });
});
