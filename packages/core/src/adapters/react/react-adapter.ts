/**
 * The React + TypeScript FrameworkAdapter. Discovery/props/signals are wired up
 * for P1; `buildEntry` / `generateProviderStubs` get their full P2 implementations
 * (sandbox rendering). Core references only the FrameworkAdapter interface.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { FrameworkAdapter, FrameworkProgram, BuildEntryInput, ProviderStubResult } from '../../types/adapter.js';
import type { LoadedProject, ProjectRef } from '../../types/project.js';
import type { ComponentDescriptor } from '../../types/component.js';
import type { StyleStrategyId } from '../../types/style.js';
import type { SandpackTemplate } from '../../types/sandpack-spec.js';
import { createReactProgram, type ReactProgramHandle } from './ts-program.js';
import { discoverComponents } from './discover-components.js';
import { extractProps } from './extract-props.js';
import { extractSignals } from './extract-signals.js';
import { buildReactEntry } from './build-entry.js';
import { generateReactProviderStubs } from './provider-stubs.js';

const STYLE_STRATEGIES: readonly StyleStrategyId[] = [
  'css-modules',
  'styled-components',
  'emotion',
  'tailwind',
  'vanilla-extract',
  'inline-style',
  'plain-css',
];

function handleOf(program: FrameworkProgram): ReactProgramHandle {
  return program.handle as ReactProgramHandle;
}

export const reactAdapter: FrameworkAdapter = {
  id: 'react',

  detect(ref: ProjectRef) {
    const pkgPath = path.join(ref.rootPath, 'package.json');
    if (!existsSync(pkgPath)) return { matches: false, confidence: 0 };
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      const deps = {
        ...(pkg.dependencies as Record<string, string>),
        ...(pkg.devDependencies as Record<string, string>),
      };
      if (deps['react'] || deps['next']) return { matches: true, confidence: 0.95 };
    } catch {
      /* fall through */
    }
    return { matches: false, confidence: 0 };
  },

  createProgram(project: LoadedProject): FrameworkProgram {
    return { framework: 'react', project, handle: createReactProgram(project) };
  },

  discoverComponents(program) {
    return discoverComponents(handleOf(program));
  },

  extractProps(descriptor: ComponentDescriptor, program) {
    return extractProps(descriptor, handleOf(program));
  },

  extractSignals(descriptor: ComponentDescriptor, program) {
    return extractSignals(descriptor, handleOf(program));
  },

  styleStrategies() {
    return STYLE_STRATEGIES;
  },

  sandpackTemplate(): SandpackTemplate {
    return 'react-ts';
  },

  buildEntry(input: BuildEntryInput): string {
    return buildReactEntry(input);
  },

  generateProviderStubs(descriptor: ComponentDescriptor, program, deps): ProviderStubResult {
    return generateReactProviderStubs(descriptor, handleOf(program), deps);
  },
};
