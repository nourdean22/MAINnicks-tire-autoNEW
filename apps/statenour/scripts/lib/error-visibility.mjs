/**
 * Pure decision logic for the two error-visibility probes.
 *
 * Extracted because the parts that can LIE are the CONTROLS, not the queries.
 * Each probe's empty state has several causes with opposite meanings, and the
 * whole value of both probes is refusing to collapse them:
 *
 *   · error_logs quiet + writer fresh  -> a real quiet period
 *   · error_logs quiet + writer stale  -> a DEAD WRITER reported as health
 *   · Langfuse 0 errors + traces > 0   -> a real result
 *   · Langfuse 0 errors + traces == 0  -> nothing was TRACED; check the
 *                                          exporter, keys, or environment
 *
 * A probe that prints "0 errors" without saying which of those it is has told
 * the operator the system is fine when the instrument may simply be off.
 */

/** Newest row older than this and a quiet window is not evidence of health. */
export const WRITER_STALE_HOURS = 48;

/**
 * @param {{ total: number, newest: string|Date|null, nowMs?: number }} args
 * @returns {{ verdict: "empty"|"stale"|"fresh", ageHours: number|null, trustQuiet: boolean }}
 *   `trustQuiet` — may a low error count in the window be read as good news?
 */
export function assessWriterControl(args) {
  const now = args.nowMs ?? Date.now();
  if (!args.total || args.total <= 0 || !args.newest) {
    // An all-time-empty error log is far more likely to be a broken writer
    // than a flawless system. Never "fresh".
    return { verdict: "empty", ageHours: null, trustQuiet: false };
  }
  const ageHours = (now - new Date(args.newest).getTime()) / 3_600_000;
  const stale = ageHours > WRITER_STALE_HOURS;
  return { verdict: stale ? "stale" : "fresh", ageHours, trustQuiet: !stale };
}

/**
 * @param {{ totalTraces: number, totalErrors?: number }} args
 * @returns {{ verdict: "no-traces"|"usable", trustZeroErrors: boolean }}
 *   `trustZeroErrors` — is "0 errors" a finding, or an absence of measurement?
 */
export function assessTraceControl(args) {
  if (!args.totalTraces || args.totalTraces <= 0) {
    return { verdict: "no-traces", trustZeroErrors: false };
  }
  return { verdict: "usable", trustZeroErrors: true };
}

/**
 * Count by a derived key, preserving insertion order of first sight.
 * @template T
 * @param {ReadonlyArray<T>} rows
 * @param {(row: T) => string} keyFn
 * @returns {Array<[string, number]>} sorted by count desc
 */
export function countBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}

/**
 * Is a sampled page a complete picture?
 *
 * One page of 50 out of thousands is a sample of whatever sorted FIRST, and
 * "all errors are X" drawn from it is a conclusion about pagination.
 * @param {{ total: number, sampled: number }} args
 */
export function assessSampleCoverage(args) {
  const { total, sampled } = args;
  if (total <= 0) return { complete: false, pct: 0, representative: false };
  const pct = (sampled / total) * 100;
  return { complete: sampled >= total, pct, representative: pct >= 20 };
}
