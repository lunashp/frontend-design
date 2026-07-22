import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_VERSION,
  ENGINE_VERSION,
  AdapterRegistry,
  createReadOnlyFs,
  createWorkspace,
  EMPTY_CUSTOMIZATION,
} from '@ce/core';

describe('@ce/core public surface', () => {
  it('exposes the versioned artifact contract and core exports', () => {
    expect(ARTIFACT_VERSION).toBe(2);
    expect(typeof ENGINE_VERSION).toBe('string');
    expect(new AdapterRegistry().list()).toHaveLength(0);
    expect(typeof createReadOnlyFs).toBe('function');
    expect(typeof createWorkspace).toBe('function');
    expect(EMPTY_CUSTOMIZATION.tokenOverrides).toEqual({});
  });
});
