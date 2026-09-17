/**
 * Shared Inngest failure handler · Wave-200 Phase 1.2 follow-up (2026-05-17)
 *
 * Wires every Inngest function's `onFailure` to a single Telegram
 * alert pipeline. Fires AFTER all retries are exhausted · not on
 * transient blips. Replaces the ad-hoc "operator notices the Inngest
 * dashboard turn red" workflow with proactive push.
 *
 * Why one handler for all functions:
 *   · Consistent message shape · operator-readable at a glance
 *   · Single place to enrich (e.g. add run-URL deeplink later)
 *   · Easy to disable in one place (env flag) without per-function edits
 *
 * Format:
 *   ⚠️ Inngest · <function-id> failed
 *   error: <first 200 chars>
 *   run: <inngest run URL when available>
 *
 * Activation · `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` must be set
 * (operator already configured per nickstire wave-103). Without them
 * the handler is a structured no-op (sendTelegram returns false
 * cleanly).
 *
 * See: docs/adr/0005-inngest-durable-workflows.md follow-up section
 */

import type { FailureEventArgs } from "inngest";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/on-failure");

/**
 * Inngest's FailureEventArgs shape · `event.data` carries the
 * function_id + run_id + the original triggering event. We narrow
 * what we use rather than the full payload because formatting only
 * needs the function id and the final error message.
 */
type FailurePayload = FailureEventArgs;

/**
 * Format + send a Telegram alert when an Inngest function exhausts
 * its retries. Fire-and-forget · the alert is a notification, NOT a
 * mutation · we never want to throw from this path because that would
 * make Inngest re-trigger the failure handler in a loop.
 */
async function notifyTelegram(args: FailurePayload): Promise<void> {
  try {
    const { sendTelegram } = await import("@/lib/services/telegram");
    const functionId = args.event?.data?.function_id ?? "(unknown)";
    const runId = args.event?.data?.run_id;
    const errMsg = args.error?.message ?? "no error message";
    const errLine = errMsg.slice(0, 240);
    const runLine = runId ? `\nrun: <code>${escapeHtml(runId)}</code>` : "";

    const message =
      `⚠️ <b>Inngest failure</b> · ${escapeHtml(functionId)}\n` +
      `<code>${escapeHtml(errLine)}</code>${runLine}`;

    // 2026-08-23 · the boolean was DISCARDED and this logged "notified"
    // unconditionally. sendTelegram returns false cleanly on four paths — no bot
    // token, no chat id, a non-2xx from the Bot API, and a network error or the
    // 5s timeout — so a revoked token or a bot removed from the chat produced:
    // run fails, handler runs, nothing delivered, log says notified. An alerting
    // system that reports success when it delivered nothing is the blind
    // instrument its own alerts exist to prevent.
    const delivered = await sendTelegram(message, undefined, "HTML");
    if (delivered) {
      log.warn("inngest_failure_notified", {
        fn: functionId,
        runId,
        err: errLine.slice(0, 80),
      });
    } else {
      log.error("inngest_failure_notify_undelivered", {
        fn: functionId,
        runId,
        err: errLine.slice(0, 80),
        note: "sendTelegram returned false — check TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID and bot membership",
      });
    }
  } catch (err) {
    log.error("inngest_failure_notify_threw", {
      message: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The handler to pass as `onFailure` in every Inngest function's
 * config. Inngest invokes this AFTER all retries on the parent
 * function exhaust. The `args` shape is Inngest's `FailureEventArgs` ·
 * narrowed inside notifyTelegram.
 */
export const onInngestFailure = async (args: FailurePayload): Promise<void> => {
  await notifyTelegram(args);
  await markCronRunFailed(args);
};

/**
 * Upgrade this run's proof-of-invocation row from `partial` to `failed`.
 *
 * ★★★ THIS IS THE OTHER HALF OF `recordSelfRow`, and without it the liveness
 * signal would lie by omission. That helper writes `partial` BEFORE the work,
 * because a row written afterwards cannot witness a crash. `partial` honestly
 * means "fired; completion not confirmed" — but a job that fired and then
 * FAILED deserves to say so, and Telegram alone is a channel nobody queries
 * when auditing `cron_job_log`.
 *
 * With both halves the three states are unambiguous, from the log alone:
 *   · no row  -> never fired
 *   · partial -> fired; completion not confirmed
 *   · failed  -> fired and failed
 *
 * ⚠ ONE EDIT COVERS ALL 27 FUNCTIONS because this handler is wired to every
 * one of them — the alternative was a second call at the end of 17 handlers,
 * each with multiple return points.
 *
 * ⚠ NEVER THROWS, for the reason stated above notifyTelegram: throwing here
 * makes Inngest re-trigger the failure handler in a loop.
 */
async function markCronRunFailed(args: FailurePayload): Promise<void> {
  try {
    const functionId = String(args.event?.data?.function_id ?? "");
    if (!functionId) return;

    // ⚠ DO NOT PARSE THE function_id. Inngest may prefix it with the app id,
    // and a guessed split that is subtly wrong produces a SILENT no-op — the
    // upgrade never fires and the row sits at `partial` forever, looking like a
    // hang instead of a failure. Match by SUFFIX against rows that actually
    // exist: whatever the prefix turns out to be, the job name is its tail.
    const { prisma } = await import("@/lib/prisma");
    const candidates = await prisma.cronJobLog.findMany({
      where: { status: "partial", createdAt: { gte: new Date(Date.now() - 6 * 3_600_000) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, jobName: true },
      take: 200,
    });
    const latest = candidates.find(
      (c) => functionId === c.jobName || functionId.endsWith(`-${c.jobName}`) || functionId.endsWith(`/${c.jobName}`),
    );
    if (!latest) return; // no invocation row — nothing to upgrade, and that is fine
    await prisma.cronJobLog.update({
      where: { id: latest.id },
      data: {
        status: "failed",
        error: (args.error?.message ?? "inngest failure").slice(0, 500),
      },
    });
  } catch (err) {
    log.warn("inngest_failure_cron_row_skipped", {
      message: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}
