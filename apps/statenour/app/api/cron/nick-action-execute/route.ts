/**
 * GET /api/cron/nick-action-execute · Wave AG · 2026-05-28.
 *
 * Daily 9am UTC. The execute half of the Nick Action Queue. Reads
 * every AutonomousAction row that:
 *
 *   ruleName LIKE 'nick_action_%'
 *   AND approval = 'approved'
 *   AND executedAt IS NULL
 *   AND createdAt >= now() - 2 days
 *
 * Dispatches each through `executeNickAction` (lib/ai/execute-actions.ts),
 * stamps `executedAt` + `result` + (optional) `error`, and ships a
 * single Telegram digest at the end:
 *
 *   <b>Nick · 3 moves executed</b>
 *
 *   ✓ archived mission · Stage A wrap
 *   ✓ nudged · refactor RoutingBlock → READY
 *   ✗ outreach · person karim-1 gone
 *
 * Idempotency · ONE BrainMemory(NICK_ACTION_RESULTS, key=today) row
 * per day. Re-fires skip. The per-row stamp on executedAt is itself a
 * second layer of idempotency · the query above filters NULL only.
 *
 * The Telegram digest is best-effort · if the bot's down the work
 * still happened. The /system/approvals page reads executedAt + result
 * so the operator's audit trail is in the DB regardless.
 */

// AG-41 · the claim/execute/stamp/digest core moved to
// lib/ai/nick-action-batch.ts so the `nick-action/approved` inngest
// event fn (fires on /qa, kills the up-to-23h latency) shares it.
// This route keeps ONLY the cron-specific wrapper: flag gate, daily
// idempotency row, and the operator-grade failure alert.
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  runNickActionBatch,
  type NickActionRunResult,
} from "@/lib/ai/nick-action-batch";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  // v-truth · NICK_AUTONOMY gate (defense-in-depth · the proposer is
  // already gated, so with the flag off there are no approved rows to
  // execute — this just makes the posture explicit).
  const { getFlag } = await import("@/lib/feature-flags");
  if (!getFlag("NICK_AUTONOMY")?.isOn) {
    return { ok: true, skipped: "NICK_AUTONOMY off" };
  }

  const today = new Date().toISOString().slice(0, 10);
  // Wave AK · 2026-05-28 · operator-grade alerting wrapper. The
  // executor is operator-trust-critical · a silent fail at 9am means
  // approved AutonomousActions just sit pending forever with no
  // visible signal. Telegram on fail.
  try {
    return await runExecutorCore(today);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 240) : String(err);
    console.error("[nick-action-execute] cron_failed", { err: msg, today });
    try {
      const { sendTelegram } = await import("@/lib/services/telegram");
      await sendTelegram(
        `🚨 <b>Nick executor FAILED · ${today}</b>\n\n${msg}\n\n<i>Approved actions stay pending · /system/approvals shows them · audit /system/logs for the stack.</i>`,
        undefined,
        "HTML",
      );
    } catch {
      /* best-effort */
    }
    throw err;
  }
});

async function runExecutorCore(today: string) {
  const startedAt = Date.now();

  // ── Idempotency: skip if today's batch already ran ──
  const existing = await prisma.brainMemory
    .findFirst({
      where: {
        category: BRAIN_CATEGORIES.NICK_ACTION_RESULTS,
        key: today,
      },
      select: { id: true },
    })
    .catch(() => null);

  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: "already_executed_today",
      today,
    };
  }

  const summary = await runNickActionBatch({
    source: "cron:nick-action-execute",
  });

  await persistResultRow(today, {
    executed: summary.executed,
    failed: summary.failed,
    skipped: summary.skipped,
    durationMs: Date.now() - startedAt,
    results: summary.results,
    telegramOk: summary.telegramOk,
  });

  return {
    ok: true,
    executed: summary.executed,
    failed: summary.failed,
    skipped: summary.skipped,
    pushed: summary.telegramOk,
    today,
  };
}

/** Persist a single BrainMemory row that summarizes today's execution. */
async function persistResultRow(
  today: string,
  meta: {
    executed: number;
    failed: number;
    skipped: number;
    durationMs: number;
    results: NickActionRunResult[];
    telegramOk: boolean;
  },
): Promise<void> {
  await prisma.brainMemory
    .create({
      data: {
        category: BRAIN_CATEGORIES.NICK_ACTION_RESULTS,
        key: today,
        content: `${meta.executed} executed · ${meta.failed} failed · ${meta.skipped} skipped`,
        confidence: 1,
        source: "cron:nick-action-execute",
        metadata: meta as never,
      },
    })
    .catch(() => undefined);
}
