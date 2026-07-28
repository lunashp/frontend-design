import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

const WS = path.join(os.tmpdir(), 'ce-realtheme-ws');
const dirs: string[] = [];

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function project(): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-realtheme-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });
  await write(
    root,
    'package.json',
    JSON.stringify({ name: 't', dependencies: { react: '^19.0.0', '@mui/material': '^7', 'next-intl': '^4' } }),
  );
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx', 'src/**/*.ts'] }));
  // Real app theme (createTheme) — must be bundled and used by the provider.
  await write(
    root,
    'src/config/theme.ts',
    `import { createTheme } from '@mui/material/styles';\n` +
      `export const lightTheme = createTheme({ palette: { primary: { main: '#0055ff' } } });\n`,
  );
  await write(root, 'messages/ko.json', JSON.stringify({ common: { hi: '안녕' } }));
  // A component that consumes both the theme (via sx) and translations.
  await write(
    root,
    'src/Widget.tsx',
    `import { Box } from '@mui/material';\n` +
      `import { useTranslations } from 'next-intl';\n` +
      `export const Widget = () => { const t = useTranslations('common'); return <Box sx={{ color: (th) => th.palette.primary.main }}>{t('hi')}</Box>; };\n`,
  );
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('faithful preview: real theme + messages', () => {
  it('bundles the app theme and message catalogue and wires them into providers', async () => {
    const root = await project();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const widget = scan.components.find((c) => c.descriptor.name === 'Widget');
    const artifact = session.buildArtifact(widget!.descriptor.id);

    const paths = Object.keys(artifact.bundle.files);
    // The real theme file is bundled in (not just a defensive createTheme()).
    expect(paths.some((p) => p.endsWith('/config/theme.ts'))).toBe(true);
    // The message catalogue is bundled in.
    expect(paths.some((p) => p.endsWith('/messages/ko.json'))).toBe(true);

    const entry = artifact.sandpack.files['/index.tsx'] as string;
    // Provider imports the real theme export and the real messages, not stubs.
    expect(entry).toMatch(/import \{ lightTheme as __rawTheme \}/);
    // The real theme is rebuilt with cssVariables ON so it EMITS overridable
    // `--mui-palette-*` vars, carrying the app's palette across faithfully.
    expect(entry).toMatch(/cssVariables: true/);
    expect(entry).toMatch(/colorSchemes: \{ light: \{ palette: \(__rawTheme\)\.palette \} \}/);
    // Its palette is used as-is (no guard proxy, which corrupts colour resolution).
    expect(entry).not.toMatch(/palette: __wrap\(__raw/);
    // An app theme is routinely EXTENDED with its own top-level sections
    // (`customShadows`, design-system scales). `createTheme` knows nothing about
    // them, so rebuilding dropped them and every `theme.customShadows.tooltip`
    // threw — the single largest cause of "Needs app context" on a real target.
    // They are carried across, and anything still missing degrades to a
    // placeholder instead of throwing.
    expect(entry).toMatch(/if \(!\(__k in __built\)\) __built\[__k\] = \(__rawTheme\)\[__k\]/);
    expect(entry).toMatch(/const __theme = __guardTop\(__built\)/);
    // The top-level guard is SHALLOW: an existing section (palette above all)
    // must pass through untouched.
    expect(entry).toMatch(/__guardTop/);
    expect(entry).toMatch(/import __messages from/);
    expect(entry).toMatch(/messages=\{__messages\}/);
    expect(entry).toMatch(/ThemeProvider theme=\{__theme\}/);
  });

  it('falls back to a defensive theme when the project has none', async () => {
    const root = path.join(os.tmpdir(), `ce-realtheme-none-${dirs.length}`);
    dirs.push(root);
    await fs.rm(root, { recursive: true, force: true });
    await write(root, 'package.json', JSON.stringify({ name: 'n', dependencies: { react: '^19', '@mui/material': '^7' } }));
    await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx'] }));
    await write(root, 'src/Plain.tsx', `import { Box } from '@mui/material';\nexport const Plain = () => <Box>hi</Box>;\n`);

    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const plain = scan.components.find((c) => c.descriptor.name === 'Plain');
    const entry = session.buildArtifact(plain!.descriptor.id).sandpack.files['/index.tsx'] as string;

    // No app theme → a default cssVariables theme (so its standard palette is
    // overridable), with the missing-token guard re-applied to its palette.
    expect(entry).toMatch(/createTheme\(\{ cssVariables: true \}\)/);
    expect(entry).toMatch(/__theme\.palette = __wrap\(__base\.palette\)/);
  });
});
