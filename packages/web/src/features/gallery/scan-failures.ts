/**
 * Turns `ScanResult.failures` into rows the UI can render. A scan of a real
 * project skips dozens of components; a bare count ("40 could not be analyzed")
 * tells nobody WHICH, so every failure is named with a jumpable location.
 */

import type {
  GradedSignal,
  HeuristicWarning,
  ScanFailure,
  SourceLocation,
} from '../../api/types.js';
import { relativePath } from '../../lib/editor-links.js';

/**
 * How many failures are listed before the rest are counted instead. The panel
 * shares a scroll container with the gallery, so an unbounded list on a target
 * with hundreds of failures would push the catalogue off screen entirely.
 */
export const FAILURES_SHOWN = 8;

export interface FailureRow {
  /** Stable within one view; a component can legitimately fail twice. */
  readonly key: string;
  readonly name: string;
  /** Path relative to the project root, for display. */
  readonly relPath: string;
  /** Absolute, for editor links and copy-path. */
  readonly location: SourceLocation;
  readonly message: string;
}

export interface FailureView {
  readonly total: number;
  readonly rows: readonly FailureRow[];
  /** How many of `total` are not in `rows`. */
  readonly hidden: number;
}

/** A scan-level finding, ready to render: a lede to scan plus the full sentence. */
export interface ScanNote {
  /** The graded signal. A scan grades each signal at most once, so it is a stable key. */
  readonly key: GradedSignal;
  /** One-line lede — which detector went silent, and what contradicts the zero. */
  readonly headline: string;
  /** The engine's own explanation, carried verbatim: one author, two presentations. */
  readonly message: string;
}

/**
 * The scan-level findings, read from the typed field the engine puts them in.
 *
 * This used to take `(warnings, failures)` and sniff strings — filtering out any
 * warning that matched the exact `Failed to analyze <name>: <message>` sentence
 * — because scan-level prose and per-component prose shared one list. That made
 * the panel's correctness depend on two modules phrasing a sentence identically,
 * and it silently swallowed any finding whose text happened to collide. Reading
 * `heuristicWarnings` cannot confuse the two, whatever the prose says.
 */
export function scanNotes(heuristicWarnings: readonly HeuristicWarning[]): readonly ScanNote[] {
  return heuristicWarnings.map((w) => ({
    key: w.signal,
    headline:
      `${w.signal} matched 0 of ${w.scanned} components, ` +
      `but this project depends on "${w.dependency}"`,
    message: w.message,
  }));
}

export function failureView(
  failures: readonly ScanFailure[],
  projectRoot: string,
  limit: number = FAILURES_SHOWN,
): FailureView {
  const rows = failures.slice(0, limit).map((failure, index) => ({
    key: `${failure.componentId}#${index}`,
    name: failure.name,
    relPath: relativePath(projectRoot, failure.filePath),
    // Analysis failed before any position was recorded, so the file's first
    // position is all there is — every editor scheme still opens the file.
    location: { file: failure.filePath, line: 1, column: 1 },
    message: failure.message,
  }));

  return { total: failures.length, rows, hidden: failures.length - rows.length };
}
