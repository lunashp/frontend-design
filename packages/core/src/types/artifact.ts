/**
 * The universal contract between the engine and every consumer (web app, MCP).
 * Versioned from day one — change deliberately.
 */

import type { ComponentDescriptor, Classification, ClassificationSignals } from './component.js';
import type { PropModel } from './prop-model.js';
import type { PortableBundle } from './portable-bundle.js';
import type { TokenModel } from './token-model.js';
import type { SandpackSpec } from './sandpack-spec.js';

/**
 * v2: `ComponentSummary.signals`, `ScanResult.failures`, and
 * `PortableBundle.stubbedModules` / `.danglingImports` added.
 */
export const ARTIFACT_VERSION = 2 as const;
export type ArtifactVersion = typeof ARTIFACT_VERSION;

/**
 * Reverse-import-graph result for one component: how many OTHER analyzed source
 * files import it, plus a bounded sample of which files.
 *
 * A RANK / DISPLAY / tie-break signal ONLY — NEVER a reason to hide a component.
 * Story/test/spec files are excluded from the analyzed program, so a component
 * used only by Storybook stories legitimately reads 0; the count therefore means
 * "imports from analyzed source (stories/tests excluded)", not "is it used".
 */
export interface ComponentUsage {
  /** Distinct analyzed files that import this component (stories/tests excluded). */
  readonly usedByCount: number;
  /** A bounded sample of those importing files (absolute, like descriptor.filePath). */
  readonly usedByFiles: readonly string[];
}

/**
 * Lightweight per-component record for the gallery LIST (P1). Cheap to compute
 * for every component in a project.
 */
export interface ComponentSummary {
  readonly descriptor: ComponentDescriptor;
  readonly classification: Classification;
  /**
   * The raw signals the classification was derived from. Carried so a consumer
   * can show *why* a component was classified the way it was — and disagree —
   * instead of only seeing the verdict.
   */
  readonly signals: ClassificationSignals;
  readonly propModel: PropModel;
  /**
   * Reverse-import-graph reuse signal, attached once per scan. Optional because
   * the many hand-built ComponentSummary fixtures (tests, e2e) do not compute an
   * import graph, whereas a real `scan()` always attaches it. Purely a rank /
   * display / tie-break signal — see ComponentUsage; never used to hide a
   * component, since stories-only components correctly read 0.
   */
  readonly usage?: ComponentUsage;
}

/**
 * The full artifact for a SINGLE opened component (P2–P4). Built on demand:
 * P2 adds `sandpack`, P3 adds `bundle`, P4 adds `tokenModel`.
 */
export interface ComponentArtifact extends ComponentSummary {
  readonly artifactVersion: ArtifactVersion;
  readonly bundle: PortableBundle;
  readonly tokenModel: TokenModel;
  readonly sandpack: SandpackSpec;
}

/**
 * A component discovered but not analysable. Named rather than only counted, so
 * a caller can point at the file instead of parsing a prose warning back apart.
 */
export interface ScanFailure {
  /** Descriptor id of the component that failed, i.e. `filePath#exportName`. */
  readonly componentId: string;
  readonly name: string;
  /** Absolute path in the target project (read-only reference). */
  readonly filePath: string;
  /** Why the analysis failed. */
  readonly message: string;
}

/**
 * The `ClassificationSignals` fields that `detectDegenerateHeuristics` grades.
 * Written as a `Pick` rather than a bare union so renaming a signal is a compile
 * error here instead of a silently un-gradable detector.
 */
export type GradedSignal = keyof Pick<
  ClassificationSignals,
  'usesRouter' | 'usesStore' | 'usesDataFetching'
>;

/**
 * A signal detector that a whole scan proved is no longer matching: zero hits
 * across the corpus while the target declares a dependency that exists to be
 * detected. Scan-LEVEL, so it belongs to the scan and not to any component.
 *
 * It lives here, in the wire contract, rather than beside the detector because
 * it is something every consumer receives. `message` rides along with the
 * structured fields on purpose: the web app cannot import @ce/core (Node-only
 * deps never reach the browser bundle), so dropping it would mean re-authoring
 * the sentence in a hand-maintained mirror — the exact duplication this repo
 * already pays for elsewhere. One author, two presentations.
 */
export interface HeuristicWarning {
  /** The signal that never fired. */
  readonly signal: GradedSignal;
  /** The declared dependency that contradicts the zero. */
  readonly dependency: string;
  /** How many components the zero is out of. */
  readonly scanned: number;
  /** States BOTH explanations — it never asserts a bug it cannot prove. */
  readonly message: string;
}

/** Result of a whole-project scan (P1). */
export interface ScanResult {
  readonly artifactVersion: ArtifactVersion;
  readonly projectRoot: string;
  readonly framework: string;
  readonly components: readonly ComponentSummary[];
  /** Structured per-component analysis failures. */
  readonly failures: readonly ScanFailure[];
  /**
   * The prose restatement of every `failures` entry — the human log — and
   * NOTHING else. Scan-level findings used to be appended here too, last, where
   * every consumer that caps this list (the MCP relay caps at 20) dropped them
   * first: on a target with 25 failures the one finding worth reading never
   * reached the wire. Anything that is not per-component prose gets its own
   * typed field instead; see `heuristicWarnings`.
   */
  readonly warnings: readonly string[];
  /**
   * Detectors that produced zero hits across the whole scan while the project
   * declares a library that exists to be detected. Empty on a healthy scan, and
   * bounded by the number of graded signals rather than by project size — so it
   * is never worth truncating.
   */
  readonly heuristicWarnings: readonly HeuristicWarning[];
}
