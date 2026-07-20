/**
 * Project-level types: what the engine learns when it first loads a target
 * project (read-only) and prepares its own workspace.
 */

export type Framework = 'react' | 'vue' | 'unknown';

/** The minimal pointer to a target project on disk. */
export interface ProjectRef {
  readonly rootPath: string;
}

/** Resolved tsconfig path-alias configuration. */
export interface PathAliases {
  readonly baseUrl: string | null;
  readonly paths: Readonly<Record<string, readonly string[]>>;
}

/** The parts of the target's package.json the engine cares about. */
export interface PackageInfo {
  readonly name: string | null;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

/** The app's real MUI theme, so previews render with true brand colors. */
export interface ThemeRef {
  /** Absolute path of the file exporting the theme. */
  readonly file: string;
  /** Export name, e.g. `lightTheme`. */
  readonly exportName: string;
}

/**
 * A loaded target project. `workspaceDir` is the tool-owned copy directory;
 * the source `rootPath` is never written to.
 */
export interface LoadedProject {
  readonly rootPath: string;
  readonly srcDirs: readonly string[];
  readonly tsconfigPath: string | null;
  readonly pathAliases: PathAliases;
  readonly pkg: PackageInfo;
  readonly framework: Framework;
  /** Tool-owned scratch dir under `.workspace/<projectHash>/`. */
  readonly workspaceDir: string;
  /** The app's MUI theme for faithful previews, if one was detected. */
  readonly themeRef: ThemeRef | null;
  /** Absolute path of an i18n message catalogue (next-intl), if detected. */
  readonly messagesFile: string | null;
}
