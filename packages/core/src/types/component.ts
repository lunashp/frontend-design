/**
 * Component discovery + classification types.
 */

export type AtomicLevel = 'atom' | 'molecule' | 'organism' | 'page';
export type ComponentKind = 'presentational' | 'container' | 'layout';

export interface SourceLocation {
  /** Absolute path in the target project (read-only reference). */
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** A UI component discovered in the target project. */
export interface ComponentDescriptor {
  /** Stable id derived from `filePath#exportName`. */
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
  /** `'default'` for default exports, otherwise the named export. */
  readonly exportName: string;
  readonly isDefaultExport: boolean;
  readonly loc: SourceLocation;
}

/**
 * Raw structural signals extracted by a FrameworkAdapter. Fed to the
 * (framework-agnostic, pure) Classifier — it never touches the filesystem.
 */
export interface ClassificationSignals {
  readonly childComponentCount: number;
  readonly jsxDepth: number;
  readonly hookNames: readonly string[];
  readonly usesRouter: boolean;
  readonly usesStore: boolean;
  readonly usesDataFetching: boolean;
  /** e.g. `useTheme`, `useContext(AuthContext)` — context this component reads. */
  readonly contextConsumers: readonly string[];
  /** React: has `"use client"` or is otherwise not an RSC. */
  readonly isClientComponent: boolean;
  readonly propCount: number;
}

export interface Classification {
  readonly atomicLevel: AtomicLevel;
  readonly kind: ComponentKind;
  /** 0 = trivially isolable (presentational atom); higher = more app context needed. */
  readonly contextDependencyScore: number;
  readonly confidence: number;
}
