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

    await sendTelegram(message, undefined, "HTML");
    log.warn("inngest_failure_notified", {
      fn: functionId,
      runId,
      err: errLine.slice(0, 80),
    });
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
};
