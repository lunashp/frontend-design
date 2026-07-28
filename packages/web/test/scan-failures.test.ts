import { describe, it, expect } from 'vitest';
import { failureView, scanNotes, FAILURES_SHOWN } from '../src/features/gallery/scan-failures.js';
import { formatLocation, relativePath } from '../src/lib/editor-links.js';
import type { HeuristicWarning, ScanFailure } from '../src/api/types.js';

const ROOT = '/Users/x/app';

function failure(name: string, message = 'boom'): ScanFailure {
  return {
    componentId: `${ROOT}/src/${name}.tsx#${name}`,
    name,
    filePath: `${ROOT}/src/${name}.tsx`,
    message,
  };
}

describe('failureView', () => {
  it('names each failure with its path, message and a jumpable location', () => {
    const view = failureView([failure('Chart', 'Maximum call stack size exceeded')], ROOT);

    expect(view.total).toBe(1);
    expect(view.hidden).toBe(0);
    const [row] = view.rows;
    expect(row.name).toBe('Chart');
    expect(row.message).toBe('Maximum call stack size exceeded');
    expect(row.relPath).toBe('src/Chart.tsx');
    expect(relativePath(ROOT, row.location.file)).toBe('src/Chart.tsx');
  });

  it('keeps the absolute path in the location so editor links and copy still work', () => {
    const [row] = failureView([failure('Chart')], ROOT).rows;

    // A failure never reached the point where a line/column was recorded, so the
    // location is the file's first position — enough for every editor scheme.
    expect(row.location).toEqual({ file: `${ROOT}/src/Chart.tsx`, line: 1, column: 1 });
    expect(formatLocation(row.location)).toBe(`${ROOT}/src/Chart.tsx:1:1`);
  });

  it('caps the list and reports how many it withheld', () => {
    const many = Array.from({ length: FAILURES_SHOWN + 12 }, (_, i) => failure(`C${i}`));
    const view = failureView(many, ROOT);

    expect(view.rows).toHaveLength(FAILURES_SHOWN);
    expect(view.total).toBe(FAILURES_SHOWN + 12);
    expect(view.hidden).toBe(12);
  });

  it('honours an explicit limit', () => {
    const view = failureView([failure('A'), failure('B'), failure('C')], ROOT, 2);

    expect(view.rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(view.hidden).toBe(1);
  });

  it('gives every row a distinct key even when one component fails twice', () => {
    const dup = failure('Chart');
    const view = failureView([dup, dup], ROOT);

    expect(view.rows).toHaveLength(2);
    expect(view.rows[0].key).not.toBe(view.rows[1].key);
  });

  it('is empty and quiet when nothing failed', () => {
    expect(failureView([], ROOT)).toEqual({ total: 0, rows: [], hidden: 0 });
  });

  it('falls back to the absolute path when the file sits outside the project root', () => {
    const outside: ScanFailure = {
      componentId: '/elsewhere/Odd.tsx#Odd',
      name: 'Odd',
      filePath: '/elsewhere/Odd.tsx',
      message: 'nope',
    };

    expect(failureView([outside], ROOT).rows[0].relPath).toBe('/elsewhere/Odd.tsx');
  });
});

describe('scanNotes', () => {
  const COLLAPSED: HeuristicWarning = {
    signal: 'usesStore',
    dependency: 'zustand',
    scanned: 1133,
    message:
      'Heuristic check: this project depends on "zustand", but store usage was detected in 0 of ' +
      '1133 components. Either no component uses it, or the usesStore heuristic no longer matches ' +
      "this project's naming conventions.",
  };

  it('headlines a finding with the signal and the dependency that contradicts it', () => {
    const [note] = scanNotes([COLLAPSED]);

    expect(note.headline).toContain('usesStore');
    expect(note.headline).toContain('zustand');
    expect(note.message).toBe(COLLAPSED.message);
  });

  it('keys each note by its signal, which a scan grades at most once', () => {
    const notes = scanNotes([
      COLLAPSED,
      { ...COLLAPSED, signal: 'usesRouter', dependency: 'react-router-dom' },
    ]);

    expect(notes.map((n) => n.key)).toEqual(['usesStore', 'usesRouter']);
  });

  it('keeps a finding whose prose happens to read like a failure restatement', () => {
    // The old implementation string-sniffed `warnings` to tell a scan-level
    // finding from a per-component "Failed to analyze …" line, so any finding
    // that collided with that sentence vanished from the panel. Reading the
    // typed field cannot confuse the two, whatever the prose says.
    const notes = scanNotes([{ ...COLLAPSED, message: 'Failed to analyze Chart: boom' }]);

    expect(notes).toHaveLength(1);
    expect(notes[0].message).toBe('Failed to analyze Chart: boom');
  });

  it('is empty when every detector still fires', () => {
    expect(scanNotes([])).toEqual([]);
  });
});
