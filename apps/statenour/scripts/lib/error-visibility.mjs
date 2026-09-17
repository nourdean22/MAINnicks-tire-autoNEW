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
 * What identifies a trace, given that its NAME may be absent?
 *
 * ⚠⚠ MEASURED 2026-09-17, and it refuted a claim in our own docstring.
 * `GET /api/public/traces` over production: **0 of 50 traces carried a name**
 * (672 in the window), while `userId` landed 50/50, `tags` 47/50 and
 * `metadata.source` on every row. `langfuse.ts` claimed `functionId` was the
 * "Trace name" — it is not. Langfuse uses it as the OBSERVATION name prefix
 * (`memory-consolidation:ai.generateText`); the trace name needs
 * `propagateAttributes({ traceName })` from `@langfuse/tracing`, which this app
 * does not install.
 *
 * ★★★ THE NAME ARRIVES AS `""`, NOT `null`. So `t.name ?? "(unnamed)"` — the
 * nullish coalesce, which is the natural thing to write — passes the empty
 * string straight through and prints a BLANK LABEL beside a count. That reads
 * as "a name I can't see", the opposite of "unnamed", and it is why this gap
 * sat in a note as a vague impression instead of a measured fact for a day.
 * Emptiness is not absence; `??` cannot tell you which one you have.
 *
 * ★ So this returns the identity that SURVIVES rather than only the hole:
 * fall back to `metadata.source`, then tags, then an explicit marker.
 *
 * @param {{ name?: unknown, metadata?: Record<string, unknown>|null, tags?: unknown }} trace
 * @returns {{ label: string, named: boolean, via: "name"|"metadata.source"|"tags"|"none" }}
 */
export function traceIdentity(trace) {
  const name = typeof trace?.name === "string" ? trace.name.trim() : "";
  if (name) return { label: name, named: true, via: "name" };

  const source = trace?.metadata && typeof trace.metadata === "object" ? trace.metadata.source : undefined;
  if (typeof source === "string" && source.trim()) {
    return { label: `(unnamed) source=${source.trim()}`, named: false, via: "metadata.source" };
  }

  const tags = Array.isArray(trace?.tags) ? trace.tags.filter((t) => typeof t === "string" && t.trim()) : [];
  if (tags.length > 0) return { label: `(unnamed) tags=${tags.join("+")}`, named: false, via: "tags" };

  return { label: "(unnamed, no source, no tags)", named: false, via: "none" };
}

/** Hours after which a cluster stops counting as live / recent. */
export const LIVE_HOURS = 48;
export const RECENT_HOURS = 24 * 8;

/**
 * How alive is a fault cluster?
 *
 * ★★★ MEASURED 2026-09-17, and it inverted the priority list. Ranking 30 days
 * of `error_logs` by COUNT put these on top:
 *
 *     1091  brain.kept-word-tracker   last 2026-08-20T08:38
 *      924  /api/cron/correlation-alarm   last 2026-08-20T08:38
 *      291  /api/cron/weekly-review   last 2026-08-20T08:37
 *       34  ai.agent-trace            last 2026-08-20T08:38
 *       13  brain.memory-gateway      last 2026-08-20T08:38
 *
 * Those are not five problems. The identical `last_at` makes them ONE database
 * outage on one morning a month ago, fragmented across five message shapes.
 * The only cluster still arriving — `ai.judge-eval api_timeout`, 81 — ranked
 * SIXTH and read as minor. It was the largest live fault in the system.
 *
 * ★ A COUNT WITHOUT A RECENCY IS NOT ACTIONABLE, and a shared `last_at` across
 * unrelated surfaces is the signature of a single incident, not of many bugs.
 *
 * Ordering purely by recency would be the opposite error — one stray error from
 * a minute ago would outrank an 80x live cluster. So: band by liveness, then by
 * volume WITHIN the band.
 *
 * @param {string|Date} lastAt
 * @param {number} [nowMs]
 * @returns {{ band: "live"|"recent"|"stale", rank: 0|1|2, ageHours: number, label: string }}
 */
export function ageBand(lastAt, nowMs = Date.now()) {
  const t = lastAt instanceof Date ? lastAt.getTime() : Date.parse(String(lastAt));
  // An unparseable timestamp must NOT silently become "live" (age 0) and jump
  // the queue — that is the empty-vs-missing trap in the time domain.
  if (!Number.isFinite(t)) return { band: "stale", rank: 2, ageHours: Infinity, label: "age? " };
  const ageHours = (nowMs - t) / 3_600_000;
  if (ageHours < LIVE_HOURS) return { band: "live", rank: 0, ageHours, label: "LIVE " };
  if (ageHours < RECENT_HOURS) return { band: "recent", rank: 1, ageHours, label: "recent" };
  return { band: "stale", rank: 2, ageHours, label: "stale " };
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
