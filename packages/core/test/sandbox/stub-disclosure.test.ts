import { describe, it, expect } from 'vitest';
import {
  STUBBABLE_SPECIFIERS,
  isStubbableModule,
  stubbedCapabilityLost,
} from '../../src/sandbox/next-stubs.js';

const FALLBACK = stubbedCapabilityLost('a-specifier-that-is-not-stubbed');

describe('stubbed capability disclosure', () => {
  it('has a real entry for every stubbable specifier', () => {
    expect(STUBBABLE_SPECIFIERS.length).toBeGreaterThan(8);
    for (const spec of STUBBABLE_SPECIFIERS) {
      expect(isStubbableModule(spec)).toBe(true);
      // A new stub added without a LOST entry would silently ship the generic
      // fallback, which is exactly the "told nothing" bug this table prevents.
      expect(stubbedCapabilityLost(spec), spec).not.toBe(FALLBACK);
    }
  });

  it('describes the concrete capability given up, not just "stubbed"', () => {
    for (const spec of STUBBABLE_SPECIFIERS) {
      const lost = stubbedCapabilityLost(spec);
      expect(lost.length, spec).toBeGreaterThan(40);
      expect(lost, spec).toMatch(/\.$/);
    }
    expect(stubbedCapabilityLost('next/link')).toMatch(/plain <a>/);
    expect(stubbedCapabilityLost('next/image')).toMatch(/srcset|lazy loading/);
    expect(stubbedCapabilityLost('next/navigation')).toMatch(/no-ops/);
    expect(stubbedCapabilityLost('@sentry/nextjs')).toMatch(/neither reported nor caught/);
  });
});
