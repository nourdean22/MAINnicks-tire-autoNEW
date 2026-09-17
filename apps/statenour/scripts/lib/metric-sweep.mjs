/**
 * Pure matchers for `scripts/probe-metric-readers.mjs`, extracted so the parts
 * that can LIE are testable without walking a tree.
 *
 * THREE DEFECTS REVIEW FOUND, all of which made the sweep report a CLEANER
 * picture than reality:
 *
 * 1. WRITER DISCOVERY SAW ONE SHAPE. It matched `recordMetric…("name")` only,
 *    while a dozen files write lanes straight through
 *    `prisma.systemMetric.create({ data: { metric: "name" } })`. Nine lanes were
 *    invisible, and an invisible lane is silently exempt from the orphan check.
 *
 * 2. THE PROBE COUNTED ITSELF AS A READER. `isDataReader` tests for the string
 *    `systemMetric`, and the probe's own source contains it — in the very regex
 *    that performs the test — while `MUST_SEE` hard-codes the lane names. So it
 *    listed itself as the DATA reader for `action.done.shadow` and
 *    `operation.integrity_shadow` and concluded "1 lane nothing reads" when the
 *    real answer was 8. **An instrument that scans the tree it lives in must
 *    exclude itself, or it reports its own existence as coverage.**
 *
 * 3. NONLITERAL DIRECT WRITES WERE DROPPED, NOT REPORTED. The first fix for (1)
 *    matched only string literals, so
 *    `metric: \`pretask.lens.${lensName}\`` (lib/ai/pretask-fanout.ts) and
 *    `metric: m.name || m.metric || "agent_cycle"` (app/api/sync/nour-os/route.ts)
 *    vanished — while the probe printed "incomplete by exactly this much" and
 *    named only the two unresolved `recordMetric` calls. That is the SAME
 *    under-reporting-presented-as-complete defect the fix was written to remove.
 *    A name the scan cannot resolve must be REPORTED, never dropped.
 */

/** `recordMetric("name"` / `recordMetricStrict("name"`, name possibly on the next line. */
export const WRITE_LITERAL =
  /recordMetric(?:Strict)?\s*\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;

/** `recordMetric…(IDENT, …)` — resolved separately against the file's constants. */
export const WRITE_CONST =
  /recordMetric(?:Strict)?\s*\(\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)?)\s*,/g;

/**
 * `prisma.systemMetric.create({ data: { metric: <VALUE>` — captures the RAW
 * value so the caller can decide whether it resolved.
 *
 * Bounded lookahead rather than `[\s\S]*?` on purpose: unbounded lazy matching
 * would happily jump from one `create(` to a `metric:` several functions later
 * and attribute a lane to the wrong call site.
 */
export const WRITE_DIRECT_RAW =
  /systemMetric\.create\s*\(\s*\{[\s\S]{0,160}?\bmetric\s*:\s*([^,\n}]+)/g;

/**
 * Is this captured value a resolvable literal name?
 * A backtick string counts ONLY when it has no `${` interpolation.
 * @returns {string|null} the lane name, or null when it cannot be resolved
 */
export function resolveMetricLiteral(raw) {
  const v = String(raw).trim().replace(/[,;)\s]+$/, "");
  const quoted = /^"([^"]*)"$|^'([^']*)'$|^`([^`]*)`$/.exec(v);
  if (!quoted) return null;
  const inner = quoted[1] ?? quoted[2] ?? quoted[3] ?? "";
  if (inner.includes("${")) return null; // template — name is computed
  if (!/^[a-zA-Z0-9_.\-]+$/.test(inner)) return null;
  return inner;
}

/** A DATA reader actually queries the table; naming a lane is not reading it. */
const READS_TABLE = /system_metrics|systemMetric\b/;

export function isDataReader(code) {
  return READS_TABLE.test(code);
}

/**
 * Direct `systemMetric.create` writes in this source.
 * @returns {{ literals: string[], nonliteral: string[] }} — `nonliteral` holds
 *   the raw expressions, which the caller MUST surface as unresolved rather
 *   than discard.
 */
export function collectDirectWrites(code) {
  const literals = [];
  const nonliteral = [];
  const re = new RegExp(WRITE_DIRECT_RAW.source, "g");
  let m;
  while ((m = re.exec(code)) !== null) {
    const name = resolveMetricLiteral(m[1]);
    if (name) {
      if (!literals.includes(name)) literals.push(name);
    } else {
      const raw = m[1].trim().replace(/[,;)\s]+$/, "");
      if (!nonliteral.includes(raw)) nonliteral.push(raw);
    }
  }
  return { literals, nonliteral };
}

/**
 * Every literal lane name written by this source, across all shapes.
 * @returns {string[]} deduped, in first-seen order
 */
export function collectLiteralWrites(code) {
  const out = [];
  const re = new RegExp(WRITE_LITERAL.source, "g");
  let m;
  while ((m = re.exec(code)) !== null) if (!out.includes(m[1])) out.push(m[1]);
  for (const n of collectDirectWrites(code).literals) if (!out.includes(n)) out.push(n);
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
