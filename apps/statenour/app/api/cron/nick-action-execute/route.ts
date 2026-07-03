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

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  executeNickAction,
  type ExecutionResult,
} from "@/lib/ai/execute-actions";
import type { NickActionType } from "@/lib/ai/propose-actions";

export const maxDuration = 300;

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const NICK_ACTION_TYPES = new Set<string>([
  "archive_mission",
  "nudge_task",
  "commit_journal",
  "send_sms_outreach",
  "reassign_task",
  "confirm_spend",
]);

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

  // ── Pull approved Nick actions from the last 2 days ──
  const cutoff = new Date(Date.now() - TWO_DAYS_MS);
  const rows = await prisma.autonomousAction.findMany({
    where: {
      ruleName: { startsWith: "nick_action_" },
      approval: "approved",
      executedAt: null,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: {
      id: true,
      ruleName: true,
      actionType: true,
      targetType: true,
      targetId: true,
      payload: true,
    },
  });

  if (rows.length === 0) {
    // Mark today done so we don't re-poll on every retry.
    await persistResultRow(today, {
      executed: 0,
      failed: 0,
      skipped: 0,
      durationMs: Date.now() - startedAt,
      results: [],
      telegramOk: false,
    });
    return { ok: true, executed: 0, today };
  }

  const results: Array<{
    id: string;
    ruleName: string;
    actionType: string;
    ok: boolean;
    summary: string;
    error?: string;
  }> = [];

  let executed = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of rows) {
    // Guard: only execute action types we know how to dispatch. An
    // unfamiliar ruleName slipped through somehow — skip safely.
    if (!NICK_ACTION_TYPES.has(r.actionType) || !r.targetId) {
      skipped++;
      results.push({
        id: r.id,
        ruleName: r.ruleName,
        actionType: r.actionType,
        ok: false,
        summary: `unsupported actionType "${r.actionType}" · skipped`,
        error: "unsupported_action_type",
      });
      // Still stamp executedAt so we don't keep retrying.
      await stampRow(r.id, false, "skipped", "unsupported_action_type").catch(
        () => undefined,
      );
      continue;
    }

    // forensic-audit MEDIUM · claim-before-execute. The batch was selected by
    // executedAt:null and only stamped AFTER each action ran, so two overlapping
    // runs (a retry, or a manual runNow while the first is still mid-flight)
    // both saw the same rows and double-executed them (duplicate task nudges,
    // journal commits, SMS-outreach drafts). Atomically flip executedAt first;
    // only the run that wins the claim executes. On failure the row stays
    // claimed (at-most-once) — an AI action must not auto-retry side effects.
    const claim = await prisma.autonomousAction.updateMany({
      where: { id: r.id, executedAt: null },
      data: { executedAt: new Date() },
    });
    if (claim.count === 0) {
      skipped++;
      continue;
    }

    let exec: ExecutionResult;
    try {
      exec = await executeNickAction({
        actionRowId: r.id,
        actionType: r.actionType as NickActionType,
        targetId: r.targetId,
        payload: (r.payload as Record<string, unknown> | null) ?? {},
      });
    } catch (err) {
      exec = {
        ok: false,
        summary: `executor threw · ${r.actionType}`,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      };
    }

    if (exec.ok) executed++;
    else failed++;

    results.push({
      id: r.id,
      ruleName: r.ruleName,
      actionType: r.actionType,
      ok: exec.ok,
      summary: exec.summary,
      error: exec.error,
    });

    await stampRow(
      r.id,
      exec.ok,
      exec.ok ? "success" : "failed",
      exec.error,
      exec.meta,
    ).catch(() => undefined);
  }

  // ── Telegram digest ──
  const digestLines = results
    .slice(0, 12)
    .map((r) => `${r.ok ? "✓" : "✗"} ${escapeHtml(r.summary.slice(0, 110))}`);
  const text =
    `<b>Nick · ${executed}/${rows.length} executed</b>` +
    (failed > 0 ? ` · ${failed} failed` : "") +
    (skipped > 0 ? ` · ${skipped} skipped` : "") +
    `\n\n` +
    digestLines.join("\n") +
    `\n\n<i>Audit: bdnick.info/system/approvals</i>`;

  let telegramOk = false;
  try {
    telegramOk = await sendTelegram(text, undefined, "HTML");
  } catch {
    telegramOk = false;
  }

  await persistResultRow(today, {
    executed,
    failed,
    skipped,
    durationMs: Date.now() - startedAt,
    results,
    telegramOk,
  });

  return {
    ok: true,
    executed,
    failed,
    skipped,
    pushed: telegramOk,
    today,
  };
}

/**
 * Stamp the AutonomousAction row. The cron's per-row catch ensures a
 * stamp failure never aborts the batch.
 *
 * Payload merge · the proposer attached intent (rationale, queueIndex,
 * priority, etc.) and the executor returns outcome meta. We READ the
 * existing row's payload first, then SHALLOW-MERGE the result so the
 * /system/approvals viewer surfaces both intent + outcome.
 */
async function stampRow(
  id: string,
  ok: boolean,
  resultStr: string,
  error?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  let mergedPayload: Record<string, unknown> | undefined;
  if (meta) {
    const current = await prisma.autonomousAction
      .findUnique({ where: { id }, select: { payload: true } })
      .catch(() => null);
    const currentObj =
      current?.payload && typeof current.payload === "object"
        ? (current.payload as Record<string, unknown>)
        : {};
    mergedPayload = {
      ...currentObj,
      resultMeta: meta,
      executedOk: ok,
    };
  }
  await prisma.autonomousAction.update({
    where: { id },
    data: {
      executedAt: new Date(),
      result: resultStr,
      error: error?.slice(0, 4000),
      payload: mergedPayload as never,
    },
  });
}

/** Persist a single BrainMemory row that summarizes today's execution. */
async function persistResultRow(
  today: string,
  meta: {
    executed: number;
    failed: number;
    skipped: number;
    durationMs: number;
    results: Array<{
      id: string;
      ruleName: string;
      actionType: string;
      ok: boolean;
      summary: string;
      error?: string;
    }>;
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
