import { describe, it, expect } from 'vitest';
import { discoverComponents } from '../../src/adapters/react/discover-components.js';
import { extractSignals } from '../../src/adapters/react/extract-signals.js';
import type { ClassificationSignals } from '../../src/types/component.js';
import { inMemoryHandle } from './in-memory-handle.js';

const FILE = '/proj/src/Widget.tsx';

/** Signals for the single component declared in `body`. */
function signalsOf(body: string, imports = ''): ClassificationSignals {
  const { handle } = inMemoryHandle({ [FILE]: `${imports}\n${body}\n` });
  const [descriptor] = discoverComponents(handle);
  if (!descriptor) throw new Error('fixture declares no component');
  return extractSignals(descriptor, handle);
}

describe('extractSignals — store detection', () => {
  it('detects the per-store hook convention Zustand codebases actually use', () => {
    // The old exact-name list matched 0 of 617 files on a real Zustand target
    // where 111 files read a store: nobody names the hook `useStore`.
    const s = signalsOf(
      'export function Widget() { const items = useCartStore((st) => st.items); return <b>{items.length}</b>; }',
      `import { useCartStore } from '@/stores/cart';`,
    );
    expect(s.usesStore).toBe(true);
  });

  it.each([
    ['useSelector', `import { useSelector } from 'react-redux';`],
    ['useAppSelector', `import { useAppSelector } from '@/hooks';`],
    ['useAtomValue', `import { useAtomValue } from 'jotai';`],
    ['useAuthStore', `import { useAuthStore } from '@/stores/auth';`],
    ['useCartSlice', `import { useCartSlice } from '@/state/cart';`],
  ])('treats %s as store access', (hook, imports) => {
    const s = signalsOf(`export function Widget() { const v = ${hook}(); return <b>{v}</b>; }`, imports);
    expect(s.usesStore).toBe(true);
  });

  it('detects a store hook whose name carries no marker, by its module', () => {
    const s = signalsOf(
      'export function Widget() { const user = useUser(); return <b>{user.name}</b>; }',
      `import { useUser } from '@/stores/user';`,
    );
    expect(s.usesStore).toBe(true);
  });

  it('does not treat ordinary hooks or lookalike modules as store access', () => {
    const s = signalsOf(
      'export function Widget() { const [n] = useState(0); const x = useRestoreScroll(); return <b>{n}{x}</b>; }',
      [`import { useState } from 'react';`, `import { useRestoreScroll } from '@/utils/restore';`].join('\n'),
    );
    expect(s.usesStore).toBe(false);
  });
});

describe('extractSignals — context consumers', () => {
  it('records useTheme as a context consumer (the classifier decides what it costs)', () => {
    const s = signalsOf(
      'export function Widget() { const t = useTheme(); return <b style={{ color: t.c }}/>; }',
      `import { useTheme } from '@/theme';`,
    );
    expect(s.contextConsumers).toContain('useTheme');
    expect(s.usesStore).toBe(false);
  });
});
