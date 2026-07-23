/**
 * DTO mirror of the engine's serialized contract. The web app depends on the
 * JSON API only — never on @ce/core directly — so the engine's Node-only deps
 * never reach the browser bundle. Keep in sync with @ce/core's artifact types —
 * `packages/core/test/types/mirror-sync.test.ts` fails when this file drifts.
 */

export type AtomicLevel = 'atom' | 'molecule' | 'organism' | 'page';
export type ComponentKind = 'presentational' | 'container' | 'layout';
export type ControlKind =
  | 'boolean'
  | 'enum'
  | 'string'
  | 'number'
  | 'color'
  | 'node'
  | 'unknown';

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface ComponentDescriptor {
  id: string;
  name: string;
  filePath: string;
  exportName: string;
  isDefaultExport: boolean;
  loc: SourceLocation;
}

export interface ClassificationSignals {
  childComponentCount: number;
  jsxDepth: number;
  hookNames: string[];
  usesRouter: boolean;
  usesStore: boolean;
  usesDataFetching: boolean;
  contextConsumers: string[];
  isClientComponent: boolean;
  propCount: number;
}

export interface Classification {
  atomicLevel: AtomicLevel;
  kind: ComponentKind;
  contextDependencyScore: number;
  confidence: number;
}

export interface PropControl {
  name: string;
  tsType: string;
  kind: ControlKind;
  options?: string[];
  defaultValue?: string;
  required: boolean;
  description?: string;
}

export interface PropModel {
  props: PropControl[];
}

export interface ComponentSummary {
  descriptor: ComponentDescriptor;
  classification: Classification;
  signals: ClassificationSignals;
  propModel: PropModel;
}

export interface ScanFailure {
  componentId: string;
  name: string;
  filePath: string;
  message: string;
}

/**
 * The `ClassificationSignals` fields the engine grades for collapse. Written as
 * a `Pick` over the mirrored signals rather than a bare union so renaming a
 * signal on this side is a compile error here instead of a note that silently
 * stops matching the engine's.
 */
export type GradedSignal = keyof Pick<
  ClassificationSignals,
  'usesRouter' | 'usesStore' | 'usesDataFetching'
>;

/**
 * A signal detector a whole scan proved is no longer matching: zero hits across
 * the corpus while the target declares a dependency that exists to be detected.
 * Scan-LEVEL, so it belongs to the scan and not to any component.
 *
 * `message` is authored engine-side and carried verbatim. Re-writing the
 * sentence here would give one finding two authors, and this file cannot import
 * the engine's copy — so it forwards the prose and formats only the headline.
 */
export interface HeuristicWarning {
  signal: GradedSignal;
  dependency: string;
  scanned: number;
  message: string;
}

export interface ScanResult {
  artifactVersion: number;
  projectRoot: string;
  framework: string;
  components: ComponentSummary[];
  failures: ScanFailure[];
  /**
   * The prose restatement of every `failures` entry — the human log — and
   * NOTHING else. Scan-level findings used to be appended here too, last, where
   * every consumer that caps this list dropped them first. They now have their
   * own typed field; see `heuristicWarnings`.
   */
  warnings: string[];
  /**
   * Detectors that produced zero hits across the whole scan while the project
   * declares a library that exists to be detected. Bounded by the number of
   * graded signals rather than by project size, so it is never truncated.
   */
  heuristicWarnings: HeuristicWarning[];
}

export type Renderability = 'full' | 'stubbed' | 'code-only';
export type AssetEncoding = 'file' | 'data-url';

export interface AssetRef {
  path: string;
  encoding: AssetEncoding;
  sourcePath: string;
}

export interface StubbedModule {
  specifier: string;
  replacedWith: string;
  /** The capability given up, e.g. "client-side prefetch and route awareness". */
  lost: string;
}

export interface PortableBundle {
  files: Record<string, string>;
  entryPath: string;
  externalDeps: Record<string, string>;
  assets: AssetRef[];
  warnings: string[];
  stubbedModules: StubbedModule[];
  /** Every unresolved local import, as `<file> → <specifier>`. */
  danglingImports: string[];
  incomplete?: boolean;
  previewTheme?: { path: string; exportName: string };
  previewMessages?: string;
  previewProviders?: { path: string; exportName: string }[];
}

export interface SandpackSpec {
  files: Record<string, string>;
  entryPath: string;
  template: 'react-ts' | 'vue-ts';
  dependencies: Record<string, string>;
  renderability: Renderability;
  notes: string[];
}

export type TokenCategory =
  | 'color'
  | 'size'
  | 'spacing'
  | 'radius'
  | 'typography'
  | 'shadow'
  | 'other';

export interface TokenUsage {
  file: string;
  line: number;
  property: string;
  selector: string;
}

export interface Token {
  id: string;
  name: string;
  displayName: string;
  category: TokenCategory;
  value: string;
  fallback: string;
  usages: TokenUsage[];
  source: 'extracted' | 'derived' | 'user';
}

export interface TokenModel {
  tokens: Token[];
  /** Optional named theme presets: theme -> (tokenId -> value). */
  themes?: Record<string, Record<string, string>>;
}

export interface ComponentArtifact extends ComponentSummary {
  artifactVersion: number;
  bundle: PortableBundle;
  tokenModel: TokenModel;
  sandpack: SandpackSpec;
}

export interface ProgressEvent {
  phase: string;
  message: string;
  ratio?: number;
}

/**
 * Mirror of the engine's `PathAliases` (packages/core/src/types/project.ts).
 * project.ts is not one of the artifact modules the mirror-sync test guards, so
 * this pair is kept in sync by hand — it exists only to type the preflight DTO.
 */
export interface PathAliases {
  baseUrl: string | null;
  paths: Record<string, string[]>;
}

/** Mirror of the engine's `PreflightMember` (packages/core/src/project/preflight.ts). */
export interface PreflightMember {
  name: string | null;
  dir: string;
}

/**
 * Mirror of the engine's `ProjectPreflight` — the compact "what will I scan"
 * profile the host returns from GET /api/preflight, computed without a full scan.
 */
export interface ProjectPreflight {
  rootPath: string;
  packageName: string | null;
  framework: string;
  frameworkConfidence: number;
  frameworkReason: string;
  srcDirs: string[];
  pathAliases: PathAliases;
  nodeModulesPresent: boolean;
  isWorkspaceRoot: boolean;
  reactMembers: PreflightMember[];
}

export interface ApiError {
  error: { message: string; code: string };
}
