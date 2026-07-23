/**
 * EngineSession — holds a loaded project + its framework program so expensive
 * setup (ts-morph program, docgen parser) is done once and reused across the
 * scan (P1) and per-component artifact builds (P2–P4).
 */

import type { Project } from 'ts-morph';
import type { ProjectRef, LoadedProject } from '../types/project.js';
import type { ComponentDescriptor } from '../types/component.js';
import type {
  ComponentArtifact,
  ComponentSummary,
  ScanFailure,
  ScanResult,
} from '../types/artifact.js';
import type { FrameworkAdapter, FrameworkProgram } from '../types/adapter.js';
import { ARTIFACT_VERSION } from '../types/artifact.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { createDefaultRegistry } from '../adapters/default-registry.js';
import { loadProject } from '../project/load-project.js';
import { classify } from '../classify/classifier.js';
import { detectDegenerateHeuristics } from '../classify/heuristic-health.js';
import { resolvePortability } from '../portability/portability-resolver.js';
import { resolveMany } from '../portability/resolve-many.js';
import type { PortableKit } from '../types/portable-kit.js';
import { tokenizeBundle, TOKENS_CSS_PATH } from '../tokenize/tokenization-transform.js';
import { mineThemeTokens, type ThemeMiningResult } from '../theme/theme-extractor.js';
import type { TokenModel } from '../types/token-model.js';
import { generateSampleProps } from '../sandbox/sample-props.js';
import { scaffoldSandbox } from '../sandbox/sandbox-scaffolder.js';
import type { PortableBundle } from '../types/portable-bundle.js';
import { UnsupportedFrameworkError, ComponentNotFoundError, EngineError } from '../util/errors.js';
import { NOOP_LOGGER, type Logger } from '../util/logger.js';

export interface EngineSessionOptions {
  readonly workspaceRoot?: string;
  readonly logger?: Logger;
  readonly registry?: AdapterRegistry;
}

/** Hand the event loop back so queued I/O can run. See `scan()`. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class EngineSession {
  private descriptorsById = new Map<string, ComponentDescriptor>();
  private summariesById = new Map<string, ComponentSummary>();
  /**
   * Per-id artifact memo. A ComponentArtifact is immutable (buildArtifact builds
   * it from fresh objects and every consumer only reads or spread-copies it —
   * host serializes it, customizeArtifact/customizeSpec return new specs) and a
   * session is per-scan (a re-scan constructs a new EngineSession, so this map is
   * never handed stale summaries), so caching the whole artifact for the session
   * lifetime is safe. It exists because the web bounces
   * Details<->Preview<->Portable<->Customize and re-opens components, and each
   * buildArtifact re-ran the full resolvePortability + tokenizeBundle otherwise —
   * a wasted rebuild on every one of those hits.
   */
  private artifactsById = new Map<string, ComponentArtifact>();

  /**
   * Per-id-set kit memo, keyed by the SORTED, deduped ids so `[a,b]` and `[b,a]`
   * hit the same slot (a kit is a set, not a sequence — its `components` list
   * still follows the caller's order). Safe for the session lifetime for the same
   * reason as `artifactsById`: a PortableKit is built from fresh objects and only
   * read afterwards, and a re-scan constructs a new session.
   */
  private kitsByIdSet = new Map<string, PortableKit>();

  /**
   * Theme mining is theme-level, not component-level: the same `createTheme`
   * literal yields the same derived tokens for every component. So it runs once
   * per session and every buildArtifact reuses it. `undefined` = not yet
   * computed; `null` = computed, nothing to mine (no themeRef or unreadable).
   */
  private minedTheme: ThemeMiningResult | null | undefined;

  private constructor(
    readonly loaded: LoadedProject,
    readonly adapter: FrameworkAdapter,
    readonly program: FrameworkProgram,
    private readonly logger: Logger,
  ) {}

  static async create(ref: ProjectRef, options: EngineSessionOptions = {}): Promise<EngineSession> {
    const logger = options.logger ?? NOOP_LOGGER;
    const registry = options.registry ?? createDefaultRegistry();

    logger.progress({ phase: 'load', message: 'Loading project' });
    const loaded = await loadProject(ref, { workspaceRoot: options.workspaceRoot });

    const adapter =
      registry.detect(ref) ?? (registry.has(loaded.framework) ? registry.get(loaded.framework) : null);
    if (!adapter) throw new UnsupportedFrameworkError(loaded.framework);

    logger.progress({ phase: 'program', message: 'Building program' });
    const program = adapter.createProgram(loaded);

    return new EngineSession(loaded, adapter, program, logger);
  }

  /**
   * Discover + classify all components (P1). Caches descriptors for later phases.
   *
   * Async only to yield between components: prop extraction is synchronous and
   * is ~99% of a scan (527s of 530s on a 1133-component project), so a plain
   * loop pins the event loop for the whole run. The process would then serve
   * nothing — not even a health check — and progress events would queue up and
   * flush only once the scan was already over.
   */
  async scan(): Promise<ScanResult> {
    const descriptors = this.adapter.discoverComponents(this.program);
    this.descriptorsById = new Map(descriptors.map((d) => [d.id, d]));

    const warnings: string[] = [];
    const failures: ScanFailure[] = [];
    const components: ComponentSummary[] = [];
    this.summariesById = new Map();

    for (const [i, descriptor] of descriptors.entries()) {
      try {
        const propModel = this.adapter.extractProps(descriptor, this.program);
        const signals = this.adapter.extractSignals(descriptor, this.program);
        const classification = classify(descriptor, signals);
        const summary: ComponentSummary = { descriptor, classification, signals, propModel };
        components.push(summary);
        this.summariesById.set(descriptor.id, summary);
      } catch (err) {
        // Recorded twice on purpose: `warnings` stays the human-readable log,
        // `failures` names the component so a caller can link to the file
        // instead of parsing the prose back apart.
        const message = (err as Error).message;
        warnings.push(`Failed to analyze ${descriptor.name}: ${message}`);
        failures.push({
          componentId: descriptor.id,
          name: descriptor.name,
          filePath: descriptor.filePath,
          message,
        });
      }
      this.logger.progress({
        phase: 'classify',
        message: descriptor.name,
        ratio: (i + 1) / Math.max(descriptors.length, 1),
      });
      await yieldToEventLoop();
    }

    // Graded only once the whole scan is in: a detector's hit-rate is a
    // property of the corpus, not of any one component. It is returned as its
    // own typed field rather than flattened into `warnings`: appended there it
    // sorted LAST, so every consumer that caps that list cut the scan-level
    // finding first — on exactly the large targets whose scale makes it
    // diagnostic. See `ScanResult.warnings`.
    const heuristicWarnings = detectDegenerateHeuristics(components, this.loaded.pkg);

    return {
      artifactVersion: ARTIFACT_VERSION,
      projectRoot: this.loaded.rootPath,
      framework: this.loaded.framework,
      components,
      failures,
      warnings,
      heuristicWarnings,
    };
  }

  /** Look up a previously-scanned descriptor by id (used by P2+ artifact builds). */
  descriptor(id: string): ComponentDescriptor {
    const d = this.descriptorsById.get(id);
    if (!d) throw new ComponentNotFoundError(id);
    return d;
  }

  /**
   * Build the full artifact for a scanned component (P2): portable bundle +
   * generated sandbox spec. `scan()` must have run first. Token model is empty
   * until P4.
   */
  buildArtifact(id: string): ComponentArtifact {
    const memoized = this.artifactsById.get(id);
    if (memoized) return memoized;

    const summary = this.summariesById.get(id);
    if (!summary) throw new ComponentNotFoundError(id);

    const tsProject = (this.program.handle as { tsProject?: Project }).tsProject;
    if (!tsProject) {
      throw new EngineError('Adapter does not expose a ts-morph project', 'NO_TS_PROJECT');
    }

    const rawBundle = resolvePortability(tsProject, summary.descriptor, this.loaded);

    // Tokenize the bundle's CSS (colors/sizes → CSS-variable tokens) and add the
    // emitted tokens.css to the bundle so the ported code stays re-themeable.
    const tok = tokenizeBundle(rawBundle.files);
    const bundle: PortableBundle = {
      ...rawBundle,
      files: { ...tok.files, [TOKENS_CSS_PATH]: tok.tokensCss },
    };
    // Attach statically-mined theme tokens (source:"derived") ALONGSIDE the
    // extracted CSS tokens — both coexist, distinguished by `source`. The CSS
    // tokenization (and `tok.files`) is left byte-for-byte unchanged; mining
    // only appends to the token model, so a plain-CSS target is unaffected.
    const tokenModel = this.withDerivedTokens(tok.tokenModel);

    const sampleProps = generateSampleProps(summary.propModel, summary.descriptor);
    const providers = this.adapter.generateProviderStubs(
      summary.descriptor,
      this.program,
      bundle.externalDeps,
      {
        theme: bundle.previewTheme,
        messagesPath: bundle.previewMessages,
        providers: bundle.previewProviders,
      },
    );
    const entry = this.adapter.buildEntry({
      descriptor: summary.descriptor,
      bundle,
      sampleProps,
      providers,
      tokenCssPath: TOKENS_CSS_PATH,
      propModel: summary.propModel,
    });
    const sandpack = scaffoldSandbox({
      classification: summary.classification,
      bundle,
      entry,
      template: this.adapter.sandpackTemplate(),
      propModel: summary.propModel,
      sampleProps,
      providerDeps: providers.dependencies,
      // The whole result, not just its deps: the scaffolder needs `unresolved`
      // and "was a wrapper produced at all" to tell a faithful render from a
      // bare one. Passing deps alone left `input.providers` undefined in
      // production, so every context component was reported with the same
      // placeholder wording no matter what the stubber actually managed.
      providers,
    });

    const artifact: ComponentArtifact = {
      artifactVersion: ARTIFACT_VERSION,
      descriptor: summary.descriptor,
      classification: summary.classification,
      signals: summary.signals,
      propModel: summary.propModel,
      bundle,
      tokenModel,
      sandpack,
    };
    // Memoize on first build; later lookups skip resolvePortability +
    // tokenizeBundle entirely. Safe for the session lifetime — see the
    // `artifactsById` field comment for why the artifact can never go stale.
    this.artifactsById.set(id, artifact);
    return artifact;
  }

  /**
   * Mine the target's TS theme once (memoized) so every artifact shares the
   * result. `null` when no theme was detected or it could not be read/mined.
   */
  private themeMining(): ThemeMiningResult | null {
    if (this.minedTheme !== undefined) return this.minedTheme;
    const ref = this.loaded.themeRef;
    this.minedTheme = ref ? mineThemeTokens(ref) : null;
    return this.minedTheme;
  }

  /**
   * Merge derived theme tokens (+ presets + disclosure) into the CSS-extracted
   * token model. Returns the input unchanged when there is no theme to mine, so
   * a plain-CSS target keeps exactly its extracted tokens.
   */
  private withDerivedTokens(extracted: TokenModel): TokenModel {
    const mined = this.themeMining();
    if (!mined) return extracted;
    return {
      tokens: [...extracted.tokens, ...mined.tokens],
      ...(mined.themes ? { themes: mined.themes } : {}),
      derivedFrom: mined.disclosure,
    };
  }

  /**
   * Build a PortableKit for a SET of scanned components (the harvest endpoint):
   * one shared token namespace, shared files deduped, deps merged with conflicts
   * recorded. `scan()` must have run first. Reuses the cached descriptors, so no
   * re-scan; memoized by the id-set.
   */
  buildKit(ids: readonly string[]): PortableKit {
    // Validate every id up front so an unknown one is a clear error, not a later
    // crash deep in the graph walk. Ordered `components` follows the caller's
    // (deduped) order; the memo key is the sorted set so order never re-resolves.
    const seen = new Set<string>();
    const orderedIds: string[] = [];
    const descriptors: ComponentDescriptor[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const summary = this.summariesById.get(id);
      if (!summary) throw new ComponentNotFoundError(id);
      orderedIds.push(id);
      descriptors.push(summary.descriptor);
    }

    const key = [...orderedIds].sort().join(' ');
    const memoized = this.kitsByIdSet.get(key);
    if (memoized) return memoized;

    const tsProject = (this.program.handle as { tsProject?: Project }).tsProject;
    if (!tsProject) {
      throw new EngineError('Adapter does not expose a ts-morph project', 'NO_TS_PROJECT');
    }

    const kit = resolveMany(tsProject, descriptors, this.loaded);
    this.kitsByIdSet.set(key, kit);
    return kit;
  }
}
