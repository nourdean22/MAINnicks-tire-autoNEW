/**
 * Cron run lifecycle · one row per run, `started` -> `success` | `failed`,
 * or `interrupted` when no terminal event ever arrives (settled by AGE, see
 * `reconcileInterruptedRuns`). A success also carries `resultCount`, read off
 * the job's own return value (`deriveResultCount`), and `skipReason` when the
 * job said it chose not to work (`deriveSkipReason`).
 *
 * ★★★ WHY A MIDDLEWARE AND NOT A PER-HANDLER WRAPPER. The previous mechanism
 * (`recordSelfRow`) wrote ONE row before the work and called it done. Both a
 * review and a follow-up audit reached the same defect from opposite sides,
 * and two production consumers prove it is not theoretical:
 *
 *   · `cron-heartbeat` reads `status: { not: "failed" }`, so an invocation-only
 *     row counts as HEALTHY — a cron that fired and crashed still looks alive.
 *     That is the exact false green the row was added to remove.
 *   · `fleet-truth` reads `status: "success"` exactly, so a cron that only ever
 *     writes a non-success row looks DEAD even when it completes fine.
 *
 * One row cannot honestly be both "I started" and "I finished", and flipping
 * which string it carries only moves which consumer is deceived. A run needs
 * TWO facts at two different times, so it needs a row that is UPDATED.
 *
 * ⚠⚠ `partial` WAS NOT WRONG — IT WAS OVERLOADED. `mega-fanout` has written
 * `partial` since 2026-08-22 to mean "finished, some children failed", and
 * `cron-heartbeat`'s `not: "failed"` predicate was correct for THAT vocabulary.
 * Wave 2026-09-17 reused the same token for "invoked, outcome unknown" and
 * silently broke every reader that had reasoned about the old meaning. Hence a
 * NEW token, `started`, rather than a third meaning bolted onto an old one.
 *
 * ★★★ WHY THE SDK MIDDLEWARE RATHER THAN 17 EDITED CALL SITES:
 *   · `onRunStart` is documented as firing "1 time per run on the very first
 *     request (0 memoized steps, attempt 0)". ⚠ MEASURED 2026-09-22: that is
 *     per REQUEST that looks first, not per run. mega-fanout runs parallel
 *     `step.run`s under `concurrency: { limit: 5 }`; Inngest executes them as
 *     separate requests, each with 0 memoized steps, and fired the hook on
 *     each one — 5-6 `started` rows per run, of which the settle updated one.
 *     So `beginCronRun` is idempotent per (job, run id), and the sweep reads a
 *     stale `started` row with a terminal sibling as a DUPLICATE, not a death.
 *     Still far better than a handler wrapper, whose prologue re-executes on
 *     EVERY checkpoint resume.
 *   · `onRunError` carries `isFinalAttempt`, so a retryable blip is NOT
 *     recorded as a failure. A handler wrapper cannot see that flag and would
 *     mark `failed` on attempt 0 for runs that go on to succeed.
 *   · It applies to functions that DO NOT EXIST YET. The previous approach
 *     needed a CI ratchet to keep 17 hand-placed calls in place, and that
 *     ratchet was itself blind twice in one night (once to a `getInngest()`
 *     call shape, once to a comment containing a `.createFunction(` literal).
 *     An instrument you must remember to apply is an instrument that will be
 *     forgotten; registration happens once, in the client.
 *
 * ⚠⚠ NEVER THROWS, ON ANY HOOK — but NOT for the reason you would guess, and
 * an earlier draft of this comment got it wrong. Inngest's middleware manager
 * already wraps every hook in its own try/catch and logs to an internal logger
 * (components/middleware/manager.js), so a throw here does NOT fail the run.
 * The reason to catch is that the SDK's internal logger is not a surface anyone
 * here watches: a swallowed error would leave the fleet silently un-logged with
 * the evidence somewhere nobody reads. Catching locally routes it through
 * `logError`, where it is visible.
 *
 * ⚠ The catch must be try/catch, NOT `.catch()`. `recordSelfRow` shipped that
 * bug: `.catch()` only handles a REJECTED PROMISE, while an undefined
 * `prisma.cronJobLog` throws SYNCHRONOUSLY on property access, before any
 * promise exists.
 *
 * ⚠ A row left at `started` is a THIRD outcome, not a missing one: the process
 * died (OOM, container kill, edge timeout) before any hook could settle it.
 * In-process instrumentation structurally cannot report its own hard kill, so
 * that case is detected by AGE instead — see `isStaleRun`.
 */

import { Middleware } from "inngest";
import { deriveSkipReason } from "@/lib/services/cron-skip-reason";
import { DECLARED_DEGRADATION_PREFIX } from "@/lib/services/cron-status";

/**
 * Statuses this module writes. `partial` is deliberately ABSENT: it remains
 * valid for other producers (mega-fanout) and this module must never write it.
 */
export const CRON_STATUS = {
  started: "started",
  success: "success",
  failed: "failed",
  /**
   * 2026-09-22 · a `started` row that outlived STALE_RUN_MINUTES with no
   * terminal event AND no terminal sibling under its run id. In-process hooks
   * cannot report their own hard kill (a deploy restart mid-run is the common
   * case here: every merge to main redeploys the container), so this is a
   * PRESUMPTION settled by age, and a real terminal event for the same run id
   * later overrides it.
   */
  interrupted: "interrupted",
  /**
   * 2026-09-22 · a `started` row whose run id ALREADY HAS a terminal row: the
   * same run knocking twice (Inngest fires onRunStart once per parallel-step
   * request). Measured before the dedupe landed: 49 such rows, 4-5 per
   * mega-fanout run, every one of those runs a `success` — the first reading
   * of them as "dead runs" was wrong. Neither ok nor failed; carries nothing
   * the terminal row does not.
   */
  duplicate: "duplicate",
} as const;

/**
 * The statuses that mean "this run reached an end and that end was not a
 * failure". THE ONE PREDICATE EVERY READER OF `cron_job_log` SHOULD USE to ask
 * "did it work".
 *
 * ★★★ POSITIVE LIST, NEVER `not: "failed"`. A negative predicate silently
 * admits every status invented after it is written — which is exactly how
 * `cron-heartbeat` began counting `started` ("fired, outcome unknown") as
 * healthy the day that token was introduced. Nobody edited that query; the
 * vocabulary moved underneath it. A positive list cannot be widened by
 * someone else's new status, so a future value stays excluded until a human
 * decides it belongs.
 *
 * `partial` IS included: mega-fanout has written it since 2026-08-22 to mean
 * "finished, some children failed" — a real, terminal, non-failure outcome.
 * `started` is NOT, and that is the entire point.
 */
export const TERMINAL_OK_STATUSES: readonly string[] = [CRON_STATUS.success, "partial"];

/**
 * A run still at `started` past this age never reported an outcome.
 * Deliberately generous — the longest legitimate cron here runs minutes, not
 * hours — so this only catches genuine hangs and hard kills, never slowness.
 */
export const STALE_RUN_MINUTES = 90;

export function isStaleRun(status: string, createdAt: Date, now: number = Date.now()): boolean {
  return status === CRON_STATUS.started && now - createdAt.getTime() > STALE_RUN_MINUTES * 60_000;
}

/**
 * Is this function cron-triggered?
 *
 * ⚠ WITHOUT THIS FILTER the middleware would write a `cron_job_log` row for
 * every EVENT-driven run too — `social-publish`, `nick-action-approved`,
 * `bulk-sms-approval` and friends — burying the cron fleet in rows that no
 * schedule expects and that would then read as unexplained jobs in every
 * audit built on that table.
 */
function isCronTriggered(fn: unknown): boolean {
  const triggers = (fn as { opts?: { triggers?: unknown } } | undefined)?.opts?.triggers;
  if (!Array.isArray(triggers)) return false;
  return triggers.some((t) => Boolean(t) && typeof t === "object" && "cron" in (t as object));
}

/** The function's configured id — this is what must match config/crons.ts. */
function jobNameOf(fn: unknown): string | null {
  const opts = (fn as { opts?: { id?: unknown } } | undefined)?.opts;
  if (opts && typeof opts.id === "string" && opts.id.trim()) return opts.id.trim();
  const idFn = (fn as { id?: unknown } | undefined)?.id;
  if (typeof idFn === "function") {
    try {
      const v = (idFn as () => unknown).call(fn);
      if (typeof v === "string" && v.trim()) return v.trim();
    } catch {
      /* fall through — an id we cannot read is not worth a thrown hook */
    }
  }
  return null;
}

function runIdOf(ctx: unknown): string | null {
  const v = (ctx as { runId?: unknown } | undefined)?.runId;
  return typeof v === "string" && v ? v : null;
}

type PrismaLike = Awaited<typeof import("@/lib/prisma")>["prisma"];

/**
 * The countable result of a run, read off the job's own return value.
 *
 * ★ 2026-09-22 · MEASURED: 692 of 694 `success` rows in a day carried
 * `resultCount = null`. The column existed since 2026-08-22 and NOTHING wrote
 * it, so "success" said only that the handler returned. Every job here already
 * returns a summary (`{ swept: 0 }`, `{ ok: true, measured: 12 }`,
 * `{ sent: 1, failed: 0 }`), and Inngest hands that summary to
 * `onRunComplete` as `output` - the receipt was being thrown away at the door.
 *
 * Rules, in order, first hit wins:
 *   1. an explicit `resultCount` key;
 *   2. a known work-count key (COUNT_KEYS, derived from the fleet's real
 *      return shapes - see the test file for the census);
 *   3. any key ending in Count / Created / Ingested / Processed / Swept /
 *      Added / Scanned / Sent / Run - unless its stem is a failure word
 *      (`failedCount`, `errorCount`, `skippedCount` are not work done);
 *   4. a bare array -> its length.
 * Only a non-negative integer within Postgres INTEGER range counts: a boolean
 * `sent: true`, a negative or fractional value, a value past 2,147,483,647
 * (the same bound `countFrom` in cron-manager.ts enforces - a rejected update
 * would strand a finished run at `started`), or a `skipped: "reason"` string
 * is NOT a count, and the honest answer for a run that reported none is
 * `null`, never an invented 0 (the schema comment on `resultCount` draws
 * exactly this line).
 */
const COUNT_KEYS = [
  "resultCount",
  "count",
  "processed",
  "swept",
  "drained",
  "measured",
  "sent",
  "scanned",
  "checked",
  "fired",
  "flagged",
  "ingested",
  "created",
  "updated",
  "records",
  "total",
] as const;
const COUNT_KEY_SUFFIX = /(?:Count|Created|Ingested|Processed|Swept|Added|Scanned|Sent|Run)$/;
const NOT_WORK_STEM = /^(?:failed|failure|failures|error|errors|skipped|unsupported|missing|rejected|dry)/i;
/** Prisma `Int` is a signed 32-bit column; a larger value is rejected by the database, not stored. */
const INT32_MAX = 2_147_483_647;

const asCount = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= INT32_MAX ? v : null;

/**
 * 2026-10-02 · a function that RETURNS but declares degradation is a `partial`
 * run, never a `success`. The intelligence brief's compose timeout degraded its
 * text to an honest fallback and then returned `completed`; the row read
 * `success`, and the one owner surface that reads this table saw nothing.
 * Declared by `status: "partial"` or `degraded: true` on the output, with the
 * reason in `degradedReason` (or `error`).
 */
export function deriveDegradation(output: unknown): { degraded: boolean; reason: string | null } {
  if (!output || typeof output !== "object" || Array.isArray(output)) return { degraded: false, reason: null };
  const o = output as Record<string, unknown>;
  if (o.status !== "partial" && o.degraded !== true) return { degraded: false, reason: null };
  const reason =
    typeof o.degradedReason === "string" && o.degradedReason.trim()
      ? o.degradedReason
      : typeof o.error === "string" && o.error.trim()
        ? o.error
        : "finished degraded (partial); no reason declared";
  return { degraded: true, reason };
}

export function deriveResultCount(output: unknown): number | null {
  if (Array.isArray(output)) return output.length;
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  for (const k of COUNT_KEYS) {
    const n = asCount(o[k]);
    if (n !== null) return n;
  }
  for (const k of Object.keys(o)) {
    if (!COUNT_KEY_SUFFIX.test(k) || NOT_WORK_STEM.test(k)) continue;
    const n = asCount(o[k]);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Settle by AGE the rows no hook will ever settle.
 *
 * A process killed mid-run (deploy restart, OOM, edge timeout) emits no
 * terminal event, so its row stays `started` forever and reads exactly like a
 * run still in flight. Nothing consumed `isStaleRun` in production before this
 * - the constant existed, the verdict was never written down. This rides the
 * fleet's own cadence (called from every cron start, throttled) rather than
 * adding a schedule to watch the schedules.
 *
 * ★ GROUP BY THE RUN ID BEFORE NAMING THE SHAPE. A stale `started` row whose
 * run id already has a terminal row is a DUPLICATE (the same run's parallel
 * step requests each fired onRunStart), not a death — 49 of 49 measured rows
 * were exactly that. Only a stale row with NO terminal sibling is presumed
 * `interrupted`.
 *
 * Both writes re-check `status: started` (#2525): the read above and the
 * update below are not atomic, and a run that settles in between must keep
 * its real outcome - cron-control counts `interrupted` as a hard failure.
 *
 * `interrupted` is a presumption: `settleCronRun` still accepts an exact-run-id
 * terminal event for such a row and overrides it, so a retry that lands after
 * the ceiling keeps its real outcome. Never throws - a failed sweep must not
 * cost the current run its own `started` row.
 */
const RECONCILE_EVERY_MS = 10 * 60_000;
const RECONCILE_BATCH = 500;
let lastReconcileAt = 0;

async function reconcileInterruptedRuns(prisma: PrismaLike): Promise<void> {
  const now = Date.now();
  if (now - lastReconcileAt < RECONCILE_EVERY_MS) return;
  lastReconcileAt = now;
  try {
    const stale = await prisma.cronJobLog.findMany({
      where: {
        status: CRON_STATUS.started,
        createdAt: { lt: new Date(now - STALE_RUN_MINUTES * 60_000) },
      },
      select: { id: true, runId: true },
      take: RECONCILE_BATCH,
    });
    if (stale.length === 0) return;
    const runIds = [...new Set(stale.map((r) => r.runId).filter((x): x is string => Boolean(x)))];
    const settled =
      runIds.length > 0
        ? await prisma.cronJobLog.findMany({
            where: { runId: { in: runIds }, status: { not: CRON_STATUS.started } },
            select: { runId: true },
            distinct: ["runId"],
          })
        : [];
    const settledRuns = new Set(settled.map((r) => r.runId));
    const isDuplicate = (r: { runId: string | null }) => Boolean(r.runId && settledRuns.has(r.runId));
    const duplicates = stale.filter(isDuplicate).map((r) => r.id);
    const orphans = stale.filter((r) => !isDuplicate(r)).map((r) => r.id);
    if (duplicates.length > 0) {
      await prisma.cronJobLog.updateMany({
        where: { id: { in: duplicates }, status: CRON_STATUS.started },
        data: {
          status: CRON_STATUS.duplicate,
          error:
            "duplicate started row: this run id already has a terminal row " +
            "(Inngest fires onRunStart once per parallel-step request)",
        },
      });
    }
    if (orphans.length > 0) {
      await prisma.cronJobLog.updateMany({
        where: { id: { in: orphans }, status: CRON_STATUS.started },
        data: {
          status: CRON_STATUS.interrupted,
          error:
            `no terminal event within ${STALE_RUN_MINUTES} min; the process was presumably ` +
            "killed before any hook could settle this run (deploy restart, OOM, timeout)",
        },
      });
    }
  } catch (e) {
    await warn("reconcile", {}, e);
  }
}

/**
 * Record `started` for a cron run. Exported for tests; the middleware is the
 * only production caller.
 */
export async function beginCronRun(fn: unknown, ctx: unknown): Promise<void> {
  if (!isCronTriggered(fn)) return;
  const jobName = jobNameOf(fn);
  const runId = runIdOf(ctx);
  if (!jobName) return;
  let prisma: PrismaLike | null = null;
  try {
    ({ prisma } = await import("@/lib/prisma"));
    // One run, one row. Inngest fires onRunStart once per parallel-step request
    // (measured: 5-6 per mega-fanout run), so a run id that already has an open
    // row is this same run knocking again, not a new run.
    if (runId) {
      const open = await prisma.cronJobLog.findFirst({
        where: { jobName, runId, status: CRON_STATUS.started },
        select: { id: true },
      });
      if (open) return;
    }
    await prisma.cronJobLog.create({
      data: { jobName, status: CRON_STATUS.started, ...(runId ? { runId } : {}) },
    });
  } catch (e) {
    await warn("begin", { jobName, runId }, e);
  }
  // After the row, never before it: this run's own receipt outranks the sweep.
  if (prisma) await reconcileInterruptedRuns(prisma);
}

/**
 * Settle a cron run to its terminal status.
 *
 * ★ MATCHES BY `runId` — THE RUN SETTLES ITS OWN ROW, NOT A RECENT ONE.
 *
 * The first cut of this had no run id and matched "newest `started` row for
 * this job", which is correct only while a cron never overlaps itself. That is
 * the same class of guess that made `markCronRunFailed` fragile: with two runs
 * in flight, the first to finish settles the WRONG row and strands the other.
 *
 * `ctx.runId` is stable across every request a run spans, which is what makes
 * it usable as the key — the middleware instance is NOT (Inngest constructs a
 * fresh one per request), so the join has to live in the database.
 *
 * ⚠ THE FALLBACK IS RETAINED AND IS NOT DEAD CODE. Rows written before
 * 2026-09-17T23:58Z have `runId` NULL, and a run whose id could not be read
 * still deserves to be settled. When `runId` is absent this degrades to the
 * old recency match rather than refusing to settle at all.
 *
 * Column applied to prod 2026-09-17 ·
 * prisma/migrations/20260917234500_cron_job_log_run_id/.
 */
export async function settleCronRun(
  fn: unknown,
  ctx: unknown,
  status: string,
  err?: unknown,
  output?: unknown,
): Promise<void> {
  if (!isCronTriggered(fn)) return;
  const jobName = jobNameOf(fn);
  const runId = runIdOf(ctx);
  if (!jobName) return;
  try {
    const { prisma } = await import("@/lib/prisma");
    // With an exact run id the terminal event may also override an
    // `interrupted` presumption (a retry that landed after the age ceiling).
    // The recency FALLBACK never may: a guess must not upgrade a presumed-dead
    // row that might belong to a different run.
    const row = await prisma.cronJobLog.findFirst({
      where: runId
        ? { jobName, runId, status: { in: [CRON_STATUS.started, CRON_STATUS.interrupted] } }
        : { jobName, status: CRON_STATUS.started },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
    // No `started` row means this run was never recorded (the create failed, or
    // the row predates this code). Inventing a terminal row here would assert a
    // run we have no evidence began, so we record nothing.
    if (!row) return;
    await prisma.cronJobLog.update({
      where: { id: row.id },
      data: {
        status,
        duration: Math.max(0, Date.now() - row.createdAt.getTime()),
        // Always written: a success overriding `interrupted` must also clear
        // the presumed-dead text that sweep left behind.
        error: err === undefined ? null : describeError(err),
        ...(TERMINAL_OK_STATUSES.includes(status)
          ? { resultCount: deriveResultCount(output), skipReason: deriveSkipReason(output) }
          : {}),
      },
    });
  } catch (e) {
    await warn("settle", { jobName, runId, status }, e);
  }
}

function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

/** Logging that cannot itself throw, even if the logger module fails to load. */
async function warn(stage: string, meta: Record<string, unknown>, e: unknown): Promise<void> {
  try {
    const { logError } = await import("@/lib/utils/error-log");
    logError("inngest.cron-lifecycle", e, { stage, ...meta }, "warn");
  } catch {
    /* deliberately empty — see the NEVER THROWS note at the top of this file */
  }
}

/**
 * ★ THE KILL SWITCH, FOR INNGEST-NATIVE CRONS (2026-10-02).
 *
 * `isCronEnabled` (lib/services/cron-control.ts) was consulted ONLY by
 * `cronHandler` (lib/utils/http.ts), which wraps /api/cron/* routes. The 19
 * active `inngest: true` crons in config/crons.ts never pass through it, so
 * the kill switch on /system/crons (and the Settings panel before it) was
 * WRITE-ONLY for them: the row flipped, the toggle said Off, the cron kept
 * running (docs/design/settings-census-2026-10-02.md, finding 7). Same
 * reasoning as the lifecycle rows above — one registration here covers every
 * Inngest function, including ones that do not exist yet, where a per-handler
 * check would need a ratchet to stay applied.
 *
 * `wrapFunctionHandler` is the one middleware hook that can decline to run the
 * handler: it owns `next()`. (Throwing from an `on*` hook cannot stop a run —
 * the SDK try/catches those; see the NEVER THROWS note.) A killed cron returns
 * the fleet's own skip shape, `{ skipped: true, reason }`, so `onRunComplete`
 * settles it as a terminal-ok row with `skipReason = "disabled via settings"`,
 * exactly what `cronHandler` produces for a killed route cron.
 *
 * ⚠ The hook runs once per REQUEST, and a run with N steps is N+ requests, so
 * the read is cached per process for KILL_SWITCH_TTL_MS: a kill takes effect
 * at the next request after the cache expires, not mid-step. Fail OPEN: an
 * unreadable switch never stops a cron (`cronHandler` makes the same call).
 */
export const KILL_SWITCH_SKIP_REASON = "disabled via settings";
export const KILL_SWITCH_TTL_MS = 30_000;
const killSwitchCache = new Map<string, { enabled: boolean; at: number }>();

/** Tests only. */
export function __resetKillSwitchCache(): void {
  killSwitchCache.clear();
}

export async function isCronKilled(jobName: string, now: number = Date.now()): Promise<boolean> {
  const hit = killSwitchCache.get(jobName);
  if (hit && now - hit.at < KILL_SWITCH_TTL_MS) return !hit.enabled;
  try {
    const { isCronEnabled } = await import("@/lib/services/cron-control");
    const enabled = await isCronEnabled(jobName);
    killSwitchCache.set(jobName, { enabled, at: now });
    return !enabled;
  } catch (e) {
    await warn("kill-switch", { jobName }, e);
    return false;
  }
}

/**
 * Registered once in `lib/inngest/client.ts`; covers every function the client
 * serves, including ones added later.
 *
 * ⚠ Inngest instantiates middleware FRESH PER REQUEST ("so that middleware can
 * safely use `this` for request-scoped state"), and a single run spans many
 * requests as steps checkpoint. So this class holds NO state between hooks —
 * the join key lives in the database, on `runId`.
 */
export class CronLifecycleMiddleware extends Middleware.BaseMiddleware {
  readonly id = "cron-lifecycle";

  override async onRunStart(arg: { ctx: unknown; fn: unknown }): Promise<void> {
    await beginCronRun(arg.fn, arg.ctx);
  }

  // The kill switch (see isCronKilled above). Only cron-triggered functions
  // with a manifest name are gated; event-triggered functions and fan-out
  // children run untouched. Any failure in the check itself runs the cron.
  override async wrapFunctionHandler(args: {
    ctx: unknown;
    fn: unknown;
    next: () => Promise<unknown>;
  }): Promise<unknown> {
    if (isCronTriggered(args.fn)) {
      const jobName = jobNameOf(args.fn);
      if (jobName && (await isCronKilled(jobName))) {
        return { skipped: true, reason: KILL_SWITCH_SKIP_REASON, jobName };
      }
    }
    return args.next();
  }

  // `output` is the function's return value (Middleware.OnRunCompleteArgs) -
  // the summary every job here already builds, now kept as `resultCount`.
  override async onRunComplete(arg: { ctx: unknown; fn: unknown; output?: unknown }): Promise<void> {
    // A returned output that declares degradation settles `partial` with its reason
    // (deriveDegradation, 2026-10-02); anything else is the success it always was.
    const { degraded, reason } = deriveDegradation(arg.output);
    await settleCronRun(
      arg.fn,
      arg.ctx,
      degraded ? "partial" : CRON_STATUS.success,
      // The prefix is what lets a reader tell a DECLARED degradation from a fan-out
      // parent's plain `partial` (lib/services/cron-status.ts isDeclaredDegradation).
      degraded ? `${DECLARED_DEGRADATION_PREFIX}${reason}` : undefined,
      arg.output,
    );
  }

  override async onRunError(arg: {
    ctx: unknown;
    fn: unknown;
    error: unknown;
    isFinalAttempt: boolean;
  }): Promise<void> {
    // ⚠ A retryable error is NOT a failed run. Marking `failed` on attempt 0
    // would report a failure for runs that go on to succeed on attempt 1 —
    // the mirror image of the false green this file exists to remove, and
    // just as misleading. The row stays `started` until the outcome is real.
    if (!arg.isFinalAttempt) return;
    await settleCronRun(arg.fn, arg.ctx, CRON_STATUS.failed, arg.error);
  }
}
