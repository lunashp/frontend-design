import { describe, it, expect } from 'vitest';
import { preflightView, type ScanOutcome } from '../src/features/scan/preflight-view.js';
import type { ProjectPreflight } from '../src/api/types.js';

function preflight(over: Partial<ProjectPreflight> = {}): ProjectPreflight {
  return {
    rootPath: '/abs/project',
    packageName: 'my-app',
    framework: 'react',
    frameworkConfidence: 0.99,
    frameworkReason: 'react is a declared dependency',
    srcDirs: ['/abs/project/src'],
    pathAliases: { baseUrl: '/abs/project', paths: { '@/*': ['src/*'] } },
    nodeModulesPresent: true,
    isWorkspaceRoot: false,
    reactMembers: [],
    ...over,
  };
}

const IDLE: ScanOutcome = { status: 'idle', componentCount: 0, error: null };
const READY = (n: number): ScanOutcome => ({ status: 'ready', componentCount: n, error: null });

describe('preflightView facts', () => {
  it('names the framework and its confidence as a fact', () => {
    const v = preflightView(preflight(), IDLE);
    const fw = v.facts.find((f) => f.label.toLowerCase().includes('framework'));
    expect(fw).toBeDefined();
    expect(fw?.value.toLowerCase()).toContain('react');
    expect(fw?.value).toContain('99');
  });

  it('lists the source directories that will actually be scanned, relative to the root', () => {
    const v = preflightView(
      preflight({ srcDirs: ['/abs/project/src', '/abs/project/packages/ui'] }),
      IDLE,
    );
    const dirs = v.facts.find((f) => f.label.toLowerCase().includes('source'));
    expect(dirs?.value).toContain('src');
    expect(dirs?.value).toContain('packages/ui');
    // Relative, not the absolute noise — the root is already shown once.
    expect(dirs?.value).not.toContain('/abs/project/src');
  });

  it('reports the tsconfig path aliases, and "none" when there are none', () => {
    const withAliases = preflightView(preflight(), IDLE);
    expect(withAliases.facts.find((f) => f.label.toLowerCase().includes('alias'))?.value).toContain(
      '@/*',
    );
    const noAliases = preflightView(
      preflight({ pathAliases: { baseUrl: null, paths: {} } }),
      IDLE,
    );
    expect(
      noAliases.facts.find((f) => f.label.toLowerCase().includes('alias'))?.value.toLowerCase(),
    ).toContain('none');
  });

  it('uses the package name as the project name, falling back to the root basename', () => {
    expect(preflightView(preflight(), IDLE).projectName).toBe('my-app');
    expect(preflightView(preflight({ packageName: null }), IDLE).projectName).toBe('project');
  });
});

describe('preflightView diagnoses', () => {
  it('has no blocking diagnosis on the clean happy path', () => {
    const v = preflightView(preflight(), READY(42));
    expect(v.tone).toBe('ok');
    expect(v.diagnoses.filter((d) => d.tone === 'danger')).toEqual([]);
  });

  it('warns that node_modules is missing because the preview degrades', () => {
    const v = preflightView(preflight({ nodeModulesPresent: false }), READY(42));
    const note = v.diagnoses.find((d) => d.headline.toLowerCase().includes('node_modules'));
    expect(note).toBeDefined();
    expect(note?.tone).toBe('warn');
    expect(note?.detail.toLowerCase()).toContain('preview');
  });

  it('diagnoses an empty gallery by naming the directories it searched', () => {
    const v = preflightView(
      preflight({ srcDirs: ['/abs/project/src', '/abs/project/lib'] }),
      READY(0),
    );
    const empty = v.diagnoses.find((d) => d.headline.toLowerCase().includes('no react component'));
    expect(empty).toBeDefined();
    expect(empty?.detail).toContain('src');
    expect(empty?.detail).toContain('lib');
  });

  it('does not raise the empty-gallery diagnosis while a scan is still pending', () => {
    const v = preflightView(preflight(), IDLE);
    expect(v.diagnoses.find((d) => d.headline.toLowerCase().includes('no react component'))).toBeUndefined();
  });

  it('routes a workspace root with React members to a member picklist', () => {
    const v = preflightView(
      preflight({
        framework: 'unknown',
        frameworkConfidence: 0,
        packageName: 'monorepo-root',
        isWorkspaceRoot: true,
        reactMembers: [
          { name: '@acme/ui', dir: '/abs/project/packages/ui' },
          { name: '@acme/web', dir: '/abs/project/apps/web' },
        ],
      }),
      IDLE,
    );
    const pick = v.diagnoses.find((d) => d.tone === 'danger');
    expect(pick).toBeDefined();
    expect(pick?.headline.toLowerCase()).toContain('workspace');
    expect(pick?.suggestedMembers.map((m) => m.path).sort()).toEqual([
      '/abs/project/apps/web',
      '/abs/project/packages/ui',
    ]);
    // A member's display path is relative to the root; its scan target is absolute.
    const ui = pick?.suggestedMembers.find((m) => m.name === '@acme/ui');
    expect(ui?.relPath).toBe('packages/ui');
    expect(ui?.path).toBe('/abs/project/packages/ui');
  });

  it('flags a Vue project as unsupported without pretending it is a React dead end', () => {
    const v = preflightView(
      preflight({ framework: 'vue', frameworkConfidence: 0.99, reactMembers: [] }),
      IDLE,
    );
    const d = v.diagnoses.find((d) => d.tone === 'danger');
    expect(d).toBeDefined();
    expect(d?.headline.toLowerCase()).toMatch(/vue|react/);
    expect(d?.suggestedMembers).toEqual([]);
  });

  it('surfaces a scan error as the diagnosis, keeping the profile context', () => {
    const v = preflightView(
      preflight(),
      { status: 'error', componentCount: 0, error: 'ENOENT: bad tsconfig' },
    );
    const err = v.diagnoses.find((d) => d.tone === 'danger');
    expect(err).toBeDefined();
    expect(err?.detail).toContain('ENOENT: bad tsconfig');
  });
});
