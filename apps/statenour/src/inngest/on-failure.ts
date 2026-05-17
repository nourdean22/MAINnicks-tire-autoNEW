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

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/on-failure");

interface InngestFailureContext {
  error?: Error | { message?: string };
  event?: {
    name?: string;
    data?: Record<string, unknown>;
  };
  runId?: string;
  function?: {
    id?: string;
    name?: string;
  };
}

/**
 * Format + send a Telegram alert when an Inngest function exhausts
 * its retries. Fire-and-forget · the alert is a notification, NOT a
 * mutation · we never want to throw from this path because that would
 * make Inngest re-trigger the failure handler in a loop.
 */
async function notifyTelegram(ctx: InngestFailureContext): Promise<void> {
  try {
    const { sendTelegram } = await import("@/lib/services/telegram");
    const fnLabel = ctx.function?.name ?? ctx.function?.id ?? "(unknown)";
    const errMsg =
      ctx.error instanceof Error
        ? ctx.error.message
        : (ctx.error as { message?: string } | undefined)?.message;
    const errLine = (errMsg ?? "no error message").slice(0, 240);
    const runLine = ctx.runId
      ? `\nrun: <code>${ctx.runId}</code>`
      : "";

    const message =
      `⚠️ <b>Inngest failure</b> · ${fnLabel}\n` +
      `<code>${escapeHtml(errLine)}</code>${runLine}`;

    await sendTelegram(message, undefined, "HTML");
    log.warn("inngest_failure_notified", {
      fn: fnLabel,
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
 * config. Mastra's Inngest types around onFailure are wide; we keep
 * this as a function with a loose parameter shape and narrow inside.
 */
export const onInngestFailure = async (ctx: unknown): Promise<void> => {
  await notifyTelegram((ctx ?? {}) as InngestFailureContext);
};
