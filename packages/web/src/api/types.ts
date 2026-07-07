/**
 * DTO mirror of the engine's serialized contract. The web app depends on the
 * JSON API only — never on @ce/core directly — so the engine's Node-only deps
 * never reach the browser bundle. Keep in sync with @ce/core's artifact types.
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
  propModel: PropModel;
}

export interface ScanResult {
  artifactVersion: number;
  projectRoot: string;
  framework: string;
  components: ComponentSummary[];
  warnings: string[];
}

export type Renderability = 'full' | 'stubbed' | 'code-only';

export interface PortableBundle {
  files: Record<string, string>;
  entryPath: string;
  externalDeps: Record<string, string>;
  assets: unknown[];
  warnings: string[];
  incomplete?: boolean;
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

export interface Token {
  id: string;
  name: string;
  displayName: string;
  category: TokenCategory;
  value: string;
  fallback: string;
  usages: { file: string; line: number; property: string; selector: string }[];
  source: 'extracted' | 'derived' | 'user';
}

export interface TokenModel {
  tokens: Token[];
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

export interface ApiError {
  error: { message: string; code: string };
}
