/**
 * A design component imported ONLY by a Storybook story. Story/test/spec files
 * are excluded from the ts program (ts-program.ts IGNORE_GLOBS), so this reads
 * as 0 usages — the documented caveat: usedByCount counts imports from analyzed
 * source (stories/tests excluded), never a claim that the component is dead.
 */
export function Widget() {
  return <div>widget</div>;
}
