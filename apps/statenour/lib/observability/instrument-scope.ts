/**
 * The naming channel instruments use to report a write failure.
 *
 * SEPARATE FROM THE READER ON PURPOSE. `instrument-failures.ts` imports
 * `prisma`, and the call sites that need this helper are the opposite of
 * DB-eager: `tool-selection-telemetry.ts` deliberately does
 * `await import("@/lib/prisma")` so the client is not pulled in until a write
 * actually happens, and the chat hot path loads its writer dynamically for the
 * same reason. A static import of the reader would have undone both — the
 * helper is four lines, so it lives where nothing has to pay for it.
 *
 * The reader re-exports these, so `buildInstrumentFailures` and the call sites
 * cannot drift onto different prefixes.
 */

/** Marks an errorLog row as an instrument write failure. */
export const INSTRUMENT_SCOPE_PREFIX = "instrument";

/**
 * Build the `logError` scope for an instrument's write failure, e.g.
 * `instrumentScope("tool.surfaced")` → `"instrument.tool.surfaced"`.
 *
 * logError composes `[${source}] ${message}`, so the persisted row begins
 * `[instrument.` and is queryable with a single prefix match.
 */
export function instrumentScope(metric: string): string {
  return `${INSTRUMENT_SCOPE_PREFIX}.${metric}`;
}
