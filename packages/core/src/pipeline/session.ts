/**
 * EngineSession — holds a loaded project + its framework program so expensive
 * setup (ts-morph program, docgen parser) is done once and reused across the
 * scan (P1) and per-component artifact builds (P2–P4).
 */

import type { Project } from 'ts-morph';
import type { ProjectRef, LoadedProject } from '../types/project.js';
import type { ComponentDescriptor } from '../types/component.js';
import type { ComponentArtifact, ComponentSummary, ScanResult } from '../types/artifact.js';
import type { FrameworkAdapter, FrameworkProgram } from '../types/adapter.js';
import { ARTIFACT_VERSION } from '../types/artifact.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { createDefaultRegistry } from '../adapters/default-registry.js';
import { loadProject } from '../project/load-project.js';
import { classify } from '../classify/classifier.js';
import { resolvePortability } from '../portability/portability-resolver.js';
import { tokenizeBundle, TOKENS_CSS_PATH } from '../tokenize/tokenization-transform.js';
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

export class EngineSession {
  private descriptorsById = new Map<string, ComponentDescriptor>();
  private summariesById = new Map<string, ComponentSummary>();

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

  /** Discover + classify all components (P1). Caches descriptors for later phases. */
  scan(): ScanResult {
    const descriptors = this.adapter.discoverComponents(this.program);
    this.descriptorsById = new Map(descriptors.map((d) => [d.id, d]));

    const warnings: string[] = [];
    const components: ComponentSummary[] = [];
    this.summariesById = new Map();

    descriptors.forEach((descriptor, i) => {
      try {
        const propModel = this.adapter.extractProps(descriptor, this.program);
        const signals = this.adapter.extractSignals(descriptor, this.program);
        const classification = classify(descriptor, signals);
        const summary: ComponentSummary = { descriptor, classification, propModel };
        components.push(summary);
        this.summariesById.set(descriptor.id, summary);
      } catch (err) {
        warnings.push(`Failed to analyze ${descriptor.name}: ${(err as Error).message}`);
      }
      this.logger.progress({
        phase: 'classify',
        message: descriptor.name,
        ratio: (i + 1) / Math.max(descriptors.length, 1),
      });
    });

    return {
      artifactVersion: ARTIFACT_VERSION,
      projectRoot: this.loaded.rootPath,
      framework: this.loaded.framework,
      components,
      warnings,
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
    const tokenModel = tok.tokenModel;

    const sampleProps = generateSampleProps(summary.propModel, summary.descriptor);
    const providers = this.adapter.generateProviderStubs(summary.descriptor, this.program);
    const entry = this.adapter.buildEntry({
      descriptor: summary.descriptor,
      bundle,
      sampleProps,
      providers,
      tokenCssPath: TOKENS_CSS_PATH,
    });
    const sandpack = scaffoldSandbox({
      classification: summary.classification,
      bundle,
      entry,
      template: this.adapter.sandpackTemplate(),
      propModel: summary.propModel,
      sampleProps,
      providerDeps: providers.dependencies,
    });

    return {
      artifactVersion: ARTIFACT_VERSION,
      descriptor: summary.descriptor,
      classification: summary.classification,
      propModel: summary.propModel,
      bundle,
      tokenModel,
      sandpack,
    };
  }
}
