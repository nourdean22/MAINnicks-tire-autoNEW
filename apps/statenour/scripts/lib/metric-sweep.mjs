/**
 * Pure matchers for `scripts/probe-metric-readers.mjs`, extracted so the parts
 * that can LIE are testable without walking a tree.
 *
 * TWO DEFECTS REVIEW FOUND IN THE FIRST VERSION, both of which made the probe
 * report a CLEANER picture than reality:
 *
 * 1. WRITER DISCOVERY SAW ONE SHAPE. It matched `recordMetric…("name"` only,
 *    while a dozen files write lanes straight through
 *    `prisma.systemMetric.create({ data: { metric: "name" } })`. The scan
 *    reported "5 metric lanes written" for an app that writes many more, so
 *    every one of those lanes was invisible to the orphan check.
 *
 * 2. THE PROBE COUNTED ITSELF AS A READER. `isDataReader` tests for the string
 *    `systemMetric`, and the probe's own source contains it — in the very regex
 *    that performs the test — while `MUST_SEE` hard-codes the lane names. So it
 *    listed itself as the DATA reader for `action.done.shadow` and
 *    `operation.integrity_shadow` and concluded "1 lane nothing reads" when the
 *    real answer was 3. **An instrument that scans the tree it lives in must
 *    exclude itself, or it reports its own existence as coverage.**
 */

/** `recordMetric("name"` / `recordMetricStrict("name"`, name possibly on the next line. */
export const WRITE_LITERAL =
  /recordMetric(?:Strict)?\s*\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;

/** `recordMetric…(IDENT, …)` — resolved separately against the file's constants. */
export const WRITE_CONST =
  /recordMetric(?:Strict)?\s*\(\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)?)\s*,/g;

/**
 * `prisma.systemMetric.create({ data: { metric: "name", … } })`.
 *
 * Bounded lookahead rather than `[\s\S]*?` on purpose: unbounded lazy matching
 * would happily jump from one `create(` to a `metric:` several functions later
 * and attribute a lane to the wrong call site.
 */
export const WRITE_DIRECT =
  /systemMetric\.create\s*\(\s*\{[\s\S]{0,160}?\bmetric\s*:\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;

/** A DATA reader actually queries the table; naming a lane is not reading it. */
const READS_TABLE = /system_metrics|systemMetric\b/;

export function isDataReader(code) {
  return READS_TABLE.test(code);
}

/**
 * Every literal lane name written by this source, across all three shapes.
 * @returns {string[]} deduped, in first-seen order
 */
export function collectLiteralWrites(code) {
  const out = [];
  for (const re of [WRITE_LITERAL, WRITE_DIRECT]) {
    re.lastIndex = 0; // these are module-level /g regexes — stateful across calls
    let m;
    while ((m = re.exec(code)) !== null) if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Drop the scanning script from a candidate list.
 *
 * Path comparison is normalised because the walker yields OS-native separators
 * (`scripts\probe-metric-readers.mjs` on Windows) while a hard-coded self path
 * is written with forward slashes — a mismatch would silently re-admit the
 * probe and restore the exact defect this exists to prevent.
 */
export function excludeSelf(candidates, selfRelPath) {
  const norm = (p) => p.replace(/\\/g, "/");
  const self = norm(selfRelPath);
  return candidates.filter((c) => norm(c) !== self);
}
