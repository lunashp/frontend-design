/**
 * Component discovery + classification types.
 */

export type AtomicLevel = 'atom' | 'molecule' | 'organism' | 'page';
export type ComponentKind = 'presentational' | 'container' | 'layout';

/**
 * What a component is FOR — a conservative, single primary role inferred from its
 * name, the DOM elements it renders, and its prop contract. `other` is the honest
 * catch-all: a wrong role is worse than none, so anything not decisively one of
 * the six falls here. Sibling facet to `AtomicLevel` (how big) and `ComponentKind`
 * (how it's wired).
 */
export type ComponentRole =
  | 'form-control'
  | 'data-display'
  | 'navigation'
  | 'feedback'
  | 'action'
  | 'layout'
  | 'other';

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
  /**
   * Lowercase intrinsic (DOM) element names this component renders, deduped —
   * the evidence behind the role facet (`input`/`table`/`nav`/`dialog`/…). Only
   * a ts-morph adapter can read them from the JSX, so they are OPTIONAL: the many
   * hand-built signal fixtures omit them, and a role check treats absent as none.
   */
  readonly domTags?: readonly string[];
  /**
   * Explicit `role="…"` attribute values found on rendered elements, deduped and
   * lowercased (`dialog`/`navigation`/`alert`/…). Optional for the same reason as
   * `domTags`.
   */
  readonly ariaRoles?: readonly string[];
}

export interface Classification {
  readonly atomicLevel: AtomicLevel;
  readonly kind: ComponentKind;
  /** What the component is FOR — see `ComponentRole`. Always set by `classify`. */
  readonly role: ComponentRole;
  /** 0 = trivially isolable (presentational atom); higher = more app context needed. */
  readonly contextDependencyScore: number;
  readonly confidence: number;
}
