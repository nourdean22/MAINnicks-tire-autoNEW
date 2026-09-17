/**
 * Proof-of-invocation for Inngest-native crons.
 *
 * ★★★ WHY THIS EXISTS — measured 2026-09-17. `/api/cron/*` routes are wrapped
 * by cronHandler -> logCronRun (lib/utils/http.ts), so route crons appear in
 * `cron_job_log` automatically. Inngest functions BYPASS that wrapper entirely:
 * of 19 cron-triggered functions, only 4 wrote a row. The other 15 were
 * INVISIBLE to `cron_job_log`, `/system/crons`, and every audit built on them —
 * they could stop firing tomorrow and nothing would look different.
 *
 * That is not hypothetical. `data-cleanup` — a ROUTE cron, and therefore one of
 * the visible ones — went quiet on 2026-09-01 and nobody noticed for 16 days.
 * The 15 invisible ones had no such tripwire at all.
 *
 * ⚠⚠ THE ROW GOES FIRST, BEFORE ANY WORK. This is the single non-obvious thing
 * about the pattern, and `cron-heartbeat` learned it the hard way: a row written
 * at the END only proves the run SUCCEEDED, so a cron that fires and then
 * crashes leaves no trace that it fired — which is exactly the blindness this
 * is meant to remove. Proof-of-invocation must precede the thing that can fail.
 *
 * Failures are NOT this function's job and must not be duplicated here:
 * `onInngestFailure` is already wired to all 27 functions and alerts to
 * Telegram after retries are exhausted. The division is clean —
 *   · stopped firing  -> no rows appear, visible here
 *   · fired and failed -> Telegram alert, visible there
 *
 * ⚠ NEVER THROWS. A telemetry write that can fail its own job would be a
 * strictly worse trade than the blindness it replaces.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

/**
 * The slice of Inngest's `step` this needs — narrowed so tests need no SDK.
 *
 * ⚠ The return is `Promise<unknown>`, NOT `Promise<T>`. Inngest's real
 * signature returns `Promise<Jsonify<Awaited<T extends void ? null : T>>>`
 * because step output round-trips through JSON, so a `Promise<T>` here is
 * narrower than what it actually gives you and every call site fails to
 * typecheck (75 errors). This helper ignores the value anyway.
 */
export interface SelfRowStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<unknown>;
}

/**
 * Write one proof-of-invocation row for an Inngest cron.
 *
 * Call it as the FIRST statement of the handler:
 *
 *   async ({ step }) => {
 *     await recordSelfRow(step, "goal-pruner");
 *     …
 *   }
 *
 * @param jobName MUST match the `name` in config/crons.ts — that manifest is
 *   what `scripts/probe-cron-truth.mjs` reconciles against, so a spelling that
 *   drifts from it produces a row nobody can attribute and leaves the cron
 *   looking just as silent as before.
 */
export async function recordSelfRow(step: SelfRowStep, jobName: string): Promise<void> {
  await step.run("self-row", async () => {
    // ⚠⚠ try/catch, NOT `.catch()` — and the difference is the whole guarantee.
    // `.catch()` only handles a REJECTED PROMISE. `prisma.cronJobLog` being
    // undefined (an uninitialised client, a partial test mock) throws
    // SYNCHRONOUSLY on property access, before any promise exists, so
    // `.catch()` never runs and the error escapes into the cron handler.
    //
    // The first version of this function used `.catch()` and carried the
    // "NEVER THROWS" promise directly above it. It did throw — a real cron
    // test caught it. A telemetry write that can fail its own job is strictly
    // worse than the blindness it replaces, so the guarantee has to be real.
    try {
      await prisma.cronJobLog.create({ data: { jobName, status: "success" } });
    } catch (e) {
      logError(
        "inngest.self-row",
        e,
        { jobName, risk: "this cron becomes invisible to /system/crons again" },
        "warn",
      );
    }
    return true;
  });
}
