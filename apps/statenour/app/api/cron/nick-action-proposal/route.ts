/**
 * GET /api/cron/nick-action-proposal · Wave AG · 2026-05-28.
 *
 * Daily 8am UTC. Generates 3-6 candidate actions from current operator
 * state, writes them as AutonomousAction(approval="pending") rows, and
 * pushes a numbered Telegram message so the operator can approve any
 * subset with one line ("/qa 1 3 5" or "/qa all" or "/qa none").
 *
 * Idempotency · one BrainMemory(NICK_ACTION_PROPOSAL_SENT) row per
 * YYYY-MM-DD. Re-firing the cron skips. Also: every
 * AutonomousAction.idempotencyKey is `nick_action::<today>::<index>`
 * so a partial failure mid-batch can be re-run safely.
 *
 * What the operator sees in Telegram:
 *
 *   <b>Nick · 4 moves for today</b>
 *
 *   1. Archive mission · Stage A wrap (all 6 tasks closed)
 *   2. Nudge task · refactor RoutingBlock (3d overdue)
 *   3. Commit journal · 2026-05-27 dump (38 lines uncommitted)
 *   4. Outreach · Karim — "12d silent · law 18"
 *
 *   Reply with the numbers to approve, "/qa all" or "/qa none".
 *
 * Then at 9am the execute cron runs through approved rows.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { proposeNickActions } from "@/lib/ai/propose-actions";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const today = new Date().toISOString().slice(0, 10);
  // Wave AK · 2026-05-28 · operator-grade alerting wrapper. The
  // proposer is operator-trust-critical · a silent fail at 8am means
  // no Telegram lands and the operator never knows the loop broke
  // until they manually open /system/approvals at lunch. This
  // top-level try/catch posts a fail-mode Telegram so the operator
  // sees "cron failed" before they see "no proposal arrived."
  try {
    return await runProposerCore(today);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 240) : String(err);
    console.error("[nick-action-proposal] cron_failed", { err: msg, today });
    try {
      const { sendTelegram } = await import("@/lib/services/telegram");
      await sendTelegram(
        `🚨 <b>Nick proposer FAILED · ${today}</b>\n\n${msg}\n\n<i>Audit /system/logs for the stack · operator missed today's queue.</i>`,
        undefined,
        "HTML",
      );
    } catch {
      // Best-effort · Telegram down should not mask the original error.
    }
    throw err;
  }
});

async function runProposerCore(today: string) {
  // ── Idempotency: skip if today's batch already shipped ──
  const existing = await prisma.brainMemory
    .findFirst({
      where: {
        category: BRAIN_CATEGORIES.NICK_ACTION_PROPOSAL_SENT,
        key: today,
      },
      select: { id: true, metadata: true },
    })
    .catch(() => null);

  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: "already_sent_today",
      today,
    };
  }

  // ── Build the draft list ──
  const drafts = await proposeNickActions(today);
  if (drafts.length === 0) {
    // Mark today as "sent" anyway so we don't loop on a quiet day.
    await prisma.brainMemory
      .create({
        data: {
          category: BRAIN_CATEGORIES.NICK_ACTION_PROPOSAL_SENT,
          key: today,
          content: `0 actions proposed for ${today}`,
          confidence: 1,
          source: "cron:nick-action-proposal",
          metadata: { count: 0, ruleNames: [], queuedIds: [] } as never,
        },
      })
      .catch(() => undefined);
    return { ok: true, count: 0, today };
  }

  // ── Persist each draft as an AutonomousAction(pending) row ──
  const queuedIds: string[] = [];
  const ruleNames: string[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const idempotencyKey = `nick_action::${today}::${i + 1}`;
    try {
      const row = await prisma.autonomousAction.create({
        data: {
          ruleName: d.ruleName,
          trigger: d.trigger,
          actionType: d.actionType,
          targetType: d.targetType,
          targetId: d.targetId,
          payload: {
            ...d.payload,
            rationale: d.rationale,
            priority: d.priority,
            queueIndex: i + 1,
            queueDate: today,
          } as never,
          approval: "pending",
          idempotencyKey,
        },
        select: { id: true },
      });
      queuedIds.push(row.id);
      ruleNames.push(d.ruleName);
    } catch (err) {
      // Best-effort · a single insert failure (e.g. idempotency
      // collision from a stuck retry) doesn't blow up the batch.
      console.error("[nick-action-proposal] write_failed", {
        idempotencyKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (queuedIds.length === 0) {
    return {
      ok: false,
      count: 0,
      reason: "all_writes_failed",
      today,
    };
  }

  // ── Compose Telegram message ──
  const lines = drafts.slice(0, queuedIds.length).map((d, i) => {
    const kindLabel = LABELS[d.actionType] ?? d.actionType;
    const tag = d.priority === "P0" ? " ·" : "";
    return `${i + 1}. ${kindLabel} · ${escapeHtml(d.trigger.slice(0, 90))}${tag}`;
  });

  const text =
    `<b>Nick · ${queuedIds.length} ${queuedIds.length === 1 ? "move" : "moves"} for today</b>\n\n` +
    lines.join("\n") +
    `\n\n<i>Reply <code>/qa 1 3</code> · or <code>/qa all</code> / <code>/qa none</code></i>` +
    `\n<i>Queue: bdnick.info/system/approvals</i>`;

  let telegramOk = false;
  try {
    telegramOk = await sendTelegram(text, undefined, "HTML");
  } catch {
    telegramOk = false;
  }

  // ── Idempotency marker ──
  await prisma.brainMemory
    .create({
      data: {
        category: BRAIN_CATEGORIES.NICK_ACTION_PROPOSAL_SENT,
        key: today,
        content: `${queuedIds.length} actions proposed for ${today} · ${ruleNames.join(", ")}`,
        confidence: 1,
        source: "cron:nick-action-proposal",
        metadata: {
          count: queuedIds.length,
          ruleNames,
          queuedIds,
          telegramOk,
        } as never,
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    count: queuedIds.length,
    today,
    queuedIds,
    pushed: telegramOk,
  };
}

// ── Action-type → short label for Telegram readability ─────────────
const LABELS: Record<string, string> = {
  archive_mission: "Archive mission",
  nudge_task: "Nudge task",
  commit_journal: "Commit journal",
  send_sms_outreach: "Outreach",
  reassign_task: "Reassign task",
  confirm_spend: "Spend ack",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
