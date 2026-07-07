import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  classifySpecifier,
  packageName,
  resolveLocalSpecifier,
  isInProjectSrc,
} from '../../src/graph/resolve-module.js';
import type { LoadedProject } from '../../src/types/project.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');

const loaded = {
  rootPath: FIXTURE,
  srcDirs: [path.join(FIXTURE, 'src')],
  tsconfigPath: path.join(FIXTURE, 'tsconfig.json'),
  pathAliases: { baseUrl: FIXTURE, paths: { '@/*': ['src/*'] } },
  pkg: { name: 'fixture', dependencies: {}, devDependencies: {} },
  framework: 'react',
  workspaceDir: '/tmp/ws',
} satisfies LoadedProject;

describe('classifySpecifier', () => {
  it('classifies relative, alias, and external specifiers', () => {
    expect(classifySpecifier('./Button', loaded)).toBe('relative');
    expect(classifySpecifier('../x/y', loaded)).toBe('relative');
    expect(classifySpecifier('@/components/Button/Button', loaded)).toBe('alias');
    expect(classifySpecifier('react', loaded)).toBe('external');
    expect(classifySpecifier('@radix-ui/react-slot', loaded)).toBe('external');
  });
});

describe('packageName', () => {
  it('extracts the installable package name', () => {
    expect(packageName('clsx')).toBe('clsx');
    expect(packageName('lodash/merge')).toBe('lodash');
    expect(packageName('@radix-ui/react-slot')).toBe('@radix-ui/react-slot');
    expect(packageName('@scope/pkg/sub/deep')).toBe('@scope/pkg');
  });
});

describe('resolveLocalSpecifier', () => {
  const cardFile = path.join(FIXTURE, 'src/components/Card/Card.tsx');

  it('resolves an alias specifier to a real source file', () => {
    const resolved = resolveLocalSpecifier('@/components/Button/Button', cardFile, loaded);
    expect(resolved).toBe(path.join(FIXTURE, 'src/components/Button/Button.tsx'));
  });

  it('resolves a relative style import with an explicit extension', () => {
    const buttonFile = path.join(FIXTURE, 'src/components/Button/Button.tsx');
    const css = resolveLocalSpecifier('./Button.module.css', buttonFile, loaded);
    expect(css).toBe(path.join(FIXTURE, 'src/components/Button/Button.module.css'));
  });

  it('returns null for external specifiers', () => {
    expect(resolveLocalSpecifier('react', cardFile, loaded)).toBeNull();
  });

  it('returns null when nothing resolves', () => {
    expect(resolveLocalSpecifier('./does-not-exist', cardFile, loaded)).toBeNull();
  });
});

describe('isInProjectSrc', () => {
  it('accepts files under the project and rejects node_modules', () => {
    expect(isInProjectSrc(path.join(FIXTURE, 'src/components/Card/Card.tsx'), loaded)).toBe(true);
    expect(isInProjectSrc(path.join(FIXTURE, 'node_modules/react/index.js'), loaded)).toBe(false);
    expect(isInProjectSrc('/somewhere/else/file.ts', loaded)).toBe(false);
  });
});
