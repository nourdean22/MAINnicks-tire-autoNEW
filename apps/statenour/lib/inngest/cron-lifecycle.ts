/**
 * Cron run lifecycle · one row per run, `started` -> `success` | `failed`.
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
 *     request (0 memoized steps, attempt 0)" — it is immune to Inngest's
 *     step-replay model, which a naive handler wrapper is NOT. A wrapper
 *     prologue re-executes on every checkpoint resume.
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

/**
 * Statuses this module writes. `partial` is deliberately ABSENT: it remains
 * valid for other producers (mega-fanout) and this module must never write it.
 */
export const CRON_STATUS = {
  started: "started",
  success: "success",
  failed: "failed",
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

/**
 * Record `started` for a cron run. Exported for tests; the middleware is the
 * only production caller.
 */
export async function beginCronRun(fn: unknown, ctx: unknown): Promise<void> {
  if (!isCronTriggered(fn)) return;
  const jobName = jobNameOf(fn);
  const runId = runIdOf(ctx);
  if (!jobName) return;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.cronJobLog.create({ data: { jobName, status: CRON_STATUS.started } });
  } catch (e) {
    await warn("begin", { jobName, runId }, e);
  }
}

/**
 * Settle a cron run to its terminal status.
 *
 * ⚠⚠ KNOWN LIMITATION, STATED RATHER THAN HIDDEN: this matches the NEWEST
 * `started` row for the job, not this run's own row, because `cron_job_logs`
 * has no run-id column yet. If two runs of the SAME cron overlap, the first to
 * finish settles the newer row and the older one is left to go stale.
 *
 * That is survivable here — every cron in config/crons.ts has a single
 * schedule and Inngest does not run concurrent instances of one cron by
 * default — but it is a guess of exactly the kind that made
 * `markCronRunFailed` fragile, so it is documented, tested, and temporary.
 *
 * ★ THE FIX IS A COLUMN, AND IT IS DELIBERATELY NOT IN THIS CHANGE.
 * `ctx.runId` is already read below for logs, and the Inngest failure event
 * carries the same id, so a nullable `runId` column would make this an exact
 * join. Adding it to the Prisma schema BEFORE the migration is applied to prod
 * would break far more than it fixes: Prisma's `create` issues `RETURNING` over
 * every scalar field, so a client that knows a column the database lacks fails
 * EVERY write to this table — including `lib/services/cron-manager.ts`, which
 * logs all the route crons. Applying that migration is an operator action.
 * See prisma/migrations-pending/ for the parked SQL and the follow-up.
 */
export async function settleCronRun(
  fn: unknown,
  ctx: unknown,
  status: string,
  err?: unknown,
): Promise<void> {
  if (!isCronTriggered(fn)) return;
  const jobName = jobNameOf(fn);
  const runId = runIdOf(ctx);
  if (!jobName) return;
  try {
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.cronJobLog.findFirst({
      where: { jobName, status: CRON_STATUS.started },
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
        ...(err === undefined ? {} : { error: describeError(err) }),
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

  override async onRunComplete(arg: { ctx: unknown; fn: unknown }): Promise<void> {
    await settleCronRun(arg.fn, arg.ctx, CRON_STATUS.success);
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
