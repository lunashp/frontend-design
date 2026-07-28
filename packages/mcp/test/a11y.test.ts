/**
 * Pure accessibility-shaping for the MCP: how get_accessibility folds an
 * auditor's response together with the component identity, and how it short-
 * circuits code-only and the no-backend default — all without a browser or the
 * SDK, so the shaping is unit-testable directly.
 */

import { describe, it, expect } from 'vitest';
import type { ComponentArtifact, Renderability } from '@ce/core';
import {
  resolveAccessibility,
  unavailableA11yAuditor,
  type A11yAuditor,
  type A11yReport,
} from '../src/a11y.js';

function artifact(renderability: Renderability): ComponentArtifact {
  return {
    descriptor: {
      id: 'src/Button.tsx#Button',
      name: 'Button',
      filePath: '/src/Button.tsx',
      exportName: 'Button',
      isDefaultExport: false,
      loc: { file: '/src/Button.tsx', line: 1, column: 1 },
    },
    classification: { atomicLevel: 'atom', kind: 'presentational', contextDependencyScore: 0, confidence: 1 },
    signals: {
      childComponentCount: 0,
      jsxDepth: 1,
      hookNames: [],
      usesRouter: false,
      usesStore: false,
      usesDataFetching: false,
      contextConsumers: [],
      isClientComponent: false,
      propCount: 0,
    },
    propModel: { props: [] },
    artifactVersion: 1,
    bundle: {
      files: {},
      entryPath: '/src/Button.tsx',
      externalDeps: {},
      assets: [],
      warnings: [],
      stubbedModules: [],
      danglingImports: [],
    },
    tokenModel: { tokens: [] },
    sandpack: {
      files: {},
      entryPath: '/index.tsx',
      template: 'react-ts',
      dependencies: {},
      renderability,
      notes: [],
    },
  } as ComponentArtifact;
}

const REPORT: A11yReport = {
  available: true,
  renderability: 'stubbed',
  stubbedContext: true,
  summary: { critical: 1, serious: 0, moderate: 0, minor: 0 },
  total: 1,
  findings: [
    {
      ruleId: 'image-alt',
      impact: 'critical',
      help: 'Images must have alternate text',
      helpUrl: 'https://example.test/image-alt',
      nodeCount: 1,
      targets: ['img'],
    },
  ],
  truncated: false,
  disclosure: 'advisory, from the rendered preview',
};

describe('resolveAccessibility', () => {
  it('refuses a code-only component without ever calling the auditor', async () => {
    let called = false;
    const auditor: A11yAuditor = async () => {
      called = true;
      return { available: false, reason: 'unavailable', disclosure: 'x' };
    };
    const result = await resolveAccessibility(artifact('code-only'), auditor, '/proj');
    expect(called).toBe(false);
    expect(result.available).toBe(false);
    expect(result.id).toBe('src/Button.tsx#Button');
    if (!result.available) expect(result.reason).toBe('code-only');
  });

  it('folds the auditor report together with the component identity', async () => {
    const auditor: A11yAuditor = async () => REPORT;
    const result = await resolveAccessibility(artifact('stubbed'), auditor, '/proj');
    expect(result.id).toBe('src/Button.tsx#Button');
    expect(result.name).toBe('Button');
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.summary).toEqual({ critical: 1, serious: 0, moderate: 0, minor: 0 });
      expect(result.findings[0]?.ruleId).toBe('image-alt');
      // The stubbed-context caveat must survive onto the MCP payload.
      expect(result.stubbedContext).toBe(true);
      expect(result.disclosure.toLowerCase()).toContain('preview');
    }
  });

  it('passes the resolved project root through to the auditor as targetRoot', async () => {
    let seen = '';
    const auditor: A11yAuditor = async (input) => {
      seen = input.targetRoot;
      return REPORT;
    };
    await resolveAccessibility(artifact('full'), auditor, '/abs/project');
    expect(seen).toBe('/abs/project');
  });
});

describe('unavailableA11yAuditor (the standalone-MCP default)', () => {
  it('reports no render backend, honestly pointing at where the audit runs', async () => {
    const response = await unavailableA11yAuditor({ targetRoot: '/p', spec: artifact('full').sandpack });
    expect(response.available).toBe(false);
    if (!response.available) {
      expect(response.reason).toBe('no-render-backend');
      // The disclosure must tell the agent the audit runs in the web host, not lie about running it.
      expect(response.disclosure.toLowerCase()).toContain('host');
    }
  });
});
