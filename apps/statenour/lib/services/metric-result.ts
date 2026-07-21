/**
 * lib/services/metric-result.ts · truth-substrate audit P0 (2026-07-21)
 *
 * The audit's core finding (#4–6): the operator cockpit converts FAILED queries
 * into ordinary values — a failed cost read becomes $0, a failed list becomes
 * [], a failed count becomes 0 — and then renders those as healthy states. That
 * is worse than an error: it produces confident, false operator decisions
 * ("$0 spent" when the cost query threw; "healthy" when the alert read failed).
 *
 * The fix is an explicit three-state result. A metric is `ok` ONLY when a
 * measurement actually succeeded. Failure is `unavailable` (no value at all) or
 * `degraded` (a stale/partial value with an error). "Unknown" is now a distinct
 * shape the UI can render differently from a real zero.
 *
 *   Permissive in execution, STRICT in reporting:
 *   keep functioning when possible, but never conceal what failed.
 */

export type MetricStatus = "ok" | "degraded" | "unavailable";

export type MetricResult<T> =
  | { status: "ok"; value: T; measuredAt: string; source: string; sampleSize?: number }
  | { status: "degraded"; value?: T; measuredAt?: string; source: string; errorCode: string; staleSince?: string }
  | { status: "unavailable"; source: string; errorCode: string };

/** Compact, non-leaky error code from an unknown thrown value. */
export function errorCodeOf(e: unknown): string {
  if (e && typeof e === "object") {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === "string" && name) return name;
  }
  return "ERR";
}

/**
 * Run `fn` and classify the outcome. Success → `ok` with a measuredAt stamp;
 * any throw → `unavailable` with a compact errorCode (NOT the raw message —
 * public surfaces must never leak internal error strings, audit finding #3).
 *
 * `now` is injectable so tests are deterministic; defaults to wall clock.
 */
export async function measure<T>(
  source: string,
  fn: () => Promise<T>,
  now: () => string = () => new Date().toISOString(),
): Promise<MetricResult<T>> {
  try {
    const value = await fn();
    return { status: "ok", value, measuredAt: now(), source };
  } catch (e) {
    return { status: "unavailable", source, errorCode: errorCodeOf(e) };
  }
}

/** True iff the metric holds a real, successful measurement. */
export function isOk<T>(m: MetricResult<T>): m is Extract<MetricResult<T>, { status: "ok" }> {
  return m.status === "ok";
}

/**
 * Value for computation/display, or `fallback` when not `ok`. Use ONLY where a
 * scalar is unavoidable — prefer passing the whole MetricResult to the UI so it
 * can distinguish unknown from zero. A `degraded` result with a value is treated
 * as usable (stale-but-present) here.
 */
export function valueOr<T>(m: MetricResult<T>, fallback: T): T {
  if (m.status === "ok") return m.value;
  if (m.status === "degraded" && m.value !== undefined) return m.value;
  return fallback;
}

/**
 * Roll up an overall status: `unavailable` if any input is unavailable, else
 * `degraded` if any is degraded, else `ok`. Empty input → `ok`.
 */
export function rollupStatus(results: MetricResult<unknown>[]): MetricStatus {
  if (results.some((r) => r.status === "unavailable")) return "unavailable";
  if (results.some((r) => r.status === "degraded")) return "degraded";
  return "ok";
}

/** Sources of every non-ok metric — for surfacing WHAT is unknown. */
export function unhealthySources(results: MetricResult<unknown>[]): string[] {
  return results.filter((r) => r.status !== "ok").map((r) => r.source);
}

/**
 * Compute an honest health headline. truth-substrate audit #4: the status is
 * "healthy" ONLY when the DB is up AND every measured metric succeeded — a
 * swallowed sub-read can no longer read green while the headline stays healthy.
 * `degradedSources` names exactly what is unknown (including "db" when down).
 */
export function deriveHealthHeadline(
  dbConnected: boolean,
  metrics: MetricResult<unknown>[],
): { status: "healthy" | "degraded"; degradedSources: string[] } {
  const degradedSources = [
    ...(dbConnected ? [] : ["db"]),
    ...unhealthySources(metrics),
  ];
  const status = dbConnected && rollupStatus(metrics) === "ok" ? "healthy" : "degraded";
  return { status, degradedSources };
}
