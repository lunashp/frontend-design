/**
 * Turns a raw preflight profile (+ the current scan outcome) into an honest,
 * render-ready card model. This is the tested half of the preflight surface: the
 * PreflightCard component only lays out what this produces, so the diagnosis
 * logic — "workspace dead end, pick a member" / "no components under these dirs"
 * / "node_modules missing, preview degraded" — lives here where it can be
 * asserted without a DOM.
 *
 * It invents nothing the host didn't report: every fact and every diagnosis is
 * derived purely from the ProjectPreflight DTO and the scan's own status/count.
 */

import type { PreflightMember, ProjectPreflight } from '../../api/types.js';

export type PreflightTone = 'ok' | 'warn' | 'danger';

export interface PreflightFact {
  readonly label: string;
  readonly value: string;
  readonly tone?: PreflightTone;
}

export interface SuggestedMember {
  /** Package name, or the directory basename when the package is unnamed. */
  readonly name: string;
  /** Absolute directory — the exact target to hand back to a re-scan. */
  readonly path: string;
  /** Path relative to the scanned root, for display. */
  readonly relPath: string;
}

export interface PreflightDiagnosis {
  readonly tone: PreflightTone;
  readonly headline: string;
  readonly detail: string;
  /** Non-empty only for a workspace dead end: the members worth scanning instead. */
  readonly suggestedMembers: readonly SuggestedMember[];
}

/** The scan's own state, so the card can diagnose an empty or failed scan. */
export interface ScanOutcome {
  readonly status: 'idle' | 'scanning' | 'ready' | 'error';
  readonly componentCount: number;
  readonly error: string | null;
}

export interface PreflightView {
  readonly projectName: string;
  readonly rootPath: string;
  readonly facts: readonly PreflightFact[];
  /** Ordered most-severe first; empty on a clean happy path. */
  readonly diagnoses: readonly PreflightDiagnosis[];
  /** The worst tone across the diagnoses — the card's accent. */
  readonly tone: PreflightTone;
}

const TONE_RANK: Record<PreflightTone, number> = { danger: 0, warn: 1, ok: 2 };

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
}

function relativeToRoot(root: string, p: string): string {
  if (p === root) return '.';
  const prefix = `${root}/`;
  return p.startsWith(prefix) ? p.slice(prefix.length) : basename(p);
}

function frameworkLabel(framework: string): string {
  if (framework === 'react') return 'React';
  if (framework === 'vue') return 'Vue';
  return 'Unknown';
}

function toSuggested(root: string, m: PreflightMember): SuggestedMember {
  return { name: m.name ?? basename(m.dir), path: m.dir, relPath: relativeToRoot(root, m.dir) };
}

function buildFacts(pf: ProjectPreflight): PreflightFact[] {
  const pct = Math.round(pf.frameworkConfidence * 100);
  const relDirs = pf.srcDirs.map((d) => relativeToRoot(pf.rootPath, d));
  const aliasKeys = Object.keys(pf.pathAliases.paths);
  return [
    {
      label: 'Framework',
      value: `${frameworkLabel(pf.framework)} · ${pct}% confidence`,
      tone: pf.frameworkConfidence >= 0.9 ? 'ok' : pf.frameworkConfidence > 0 ? 'warn' : 'danger',
    },
    { label: 'Source directories', value: relDirs.length > 0 ? relDirs.join(', ') : '(none)' },
    { label: 'tsconfig aliases', value: aliasKeys.length > 0 ? aliasKeys.join(', ') : 'none' },
    {
      label: 'Dependencies',
      value: pf.nodeModulesPresent ? 'node_modules installed' : 'node_modules not installed',
      tone: pf.nodeModulesPresent ? 'ok' : 'warn',
    },
  ];
}

function buildDiagnoses(pf: ProjectPreflight, outcome: ScanOutcome): PreflightDiagnosis[] {
  const diagnoses: PreflightDiagnosis[] = [];

  // A non-React target is the hard stop — this tool only reads React. A monorepo
  // root that itself declares no React but has React members is the one case with
  // a concrete next step, so it gets the picklist rather than a flat rejection.
  if (pf.framework !== 'react') {
    if (pf.isWorkspaceRoot && pf.reactMembers.length > 0) {
      diagnoses.push({
        tone: 'danger',
        headline: 'This looks like a workspace root — pick a member with React',
        detail: `${basename(pf.rootPath)} declares no React itself, but ${pf.reactMembers.length} member package${pf.reactMembers.length === 1 ? '' : 's'} do. Scan one of them instead:`,
        suggestedMembers: pf.reactMembers.map((m) => toSuggested(pf.rootPath, m)),
      });
    } else if (pf.framework === 'vue') {
      diagnoses.push({
        tone: 'danger',
        headline: 'Detected Vue, not React',
        detail: 'Component Explorer reads React + TypeScript projects. This target declares Vue.',
        suggestedMembers: [],
      });
    } else {
      diagnoses.push({
        tone: 'danger',
        headline: 'No React detected',
        detail: pf.isWorkspaceRoot
          ? 'This looks like a workspace root, but none of its member packages declare React.'
          : `${pf.frameworkReason}. Component Explorer reads React + TypeScript projects.`,
        suggestedMembers: [],
      });
    }
  }

  // A React target that scanned clean but yielded nothing is not a silent empty
  // grid — name the very directories that were searched so the miss is actionable.
  if (pf.framework === 'react' && outcome.status === 'ready' && outcome.componentCount === 0) {
    const dirs = pf.srcDirs.map((d) => relativeToRoot(pf.rootPath, d)).join(', ');
    diagnoses.push({
      tone: 'warn',
      headline: 'No React components found',
      detail: `The scan completed but found no components under: ${dirs}. Check the target keeps its components in these directories.`,
      suggestedMembers: [],
    });
  }

  // A failed scan used to dead-end on a bare message; keep the profile context
  // and surface the reason.
  if (outcome.status === 'error' && outcome.error) {
    diagnoses.push({
      tone: 'danger',
      headline: 'The scan failed',
      detail: outcome.error,
      suggestedMembers: [],
    });
  }

  // Independent of the scan's success: an un-installed target degrades every
  // preview, and that must be stated up front rather than discovered later.
  if (!pf.nodeModulesPresent) {
    diagnoses.push({
      tone: 'warn',
      headline: 'node_modules is not installed',
      detail:
        'The target is not installed, so the preview is degraded — the app’s real theme and third-party dependencies can’t be bundled. Install the target to fix this.',
      suggestedMembers: [],
    });
  }

  return diagnoses.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}

export function preflightView(pf: ProjectPreflight, outcome: ScanOutcome): PreflightView {
  const diagnoses = buildDiagnoses(pf, outcome);
  const tone: PreflightTone = diagnoses.some((d) => d.tone === 'danger')
    ? 'danger'
    : diagnoses.some((d) => d.tone === 'warn')
      ? 'warn'
      : 'ok';
  return {
    projectName: pf.packageName ?? basename(pf.rootPath),
    rootPath: pf.rootPath,
    facts: buildFacts(pf),
    diagnoses,
    tone,
  };
}
