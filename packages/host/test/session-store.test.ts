import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger, ProgressEvent } from '@ce/core';
import { SessionStore } from '../src/session-store.js';

const FIXTURE = path.resolve(import.meta.dirname, '../../core/test/fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-store-ws');

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
