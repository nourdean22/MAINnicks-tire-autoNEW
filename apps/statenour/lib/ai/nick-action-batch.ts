/**
 * Nick Action Queue · shared execute-approved core · AG-41 (2026-07-09)
 *
 * Extracted verbatim from app/api/cron/nick-action-execute/route.ts so
 * TWO callers share one executor:
 *
 *   1. The daily 9am cron (backstop — catches anything the event path
 *      missed, keeps the one-BrainMemory-digest-per-day bookkeeping).
 *   2. The `nick-action/approved` inngest event fn — fires the moment
 *      the operator taps /qa, killing the up-to-23h approve→execute
 *      latency the automation-gap register flagged.
 *
 * Safe to run concurrently from both paths: each row is CLAIMED by an
 * atomic executedAt flip before executing (at-most-once — an AI action
 * must never auto-retry side effects). The loser of a claim race skips.
 */

import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import {
  executeNickAction,
  type ExecutionResult,
} from "@/lib/ai/execute-actions";
import type { NickActionType } from "@/lib/ai/propose-actions";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export const NICK_ACTION_TYPES = new Set<string>([
  "archive_mission",
  "nudge_task",
  "commit_journal",
  "send_sms_outreach",
  "reassign_task",
  "confirm_spend",
]);

export interface NickActionRunResult {
  id: string;
  ruleName: string;
  actionType: string;
  ok: boolean;
  summary: string;
  error?: string;
}

export interface NickActionBatchSummary {
  executed: number;
  failed: number;
  skipped: number;
  results: NickActionRunResult[];
  telegramOk: boolean;
  total: number;
}

/**
 * Execute approved-but-unexecuted nick_action rows and ship ONE
 * Telegram digest. When `ids` is given, only those rows are considered
 * (event path); otherwise the 2-day approved window (cron path).
 */
export async function runNickActionBatch(opts: {
  ids?: string[];
  source: string;
}): Promise<NickActionBatchSummary> {
  const cutoff = new Date(Date.now() - TWO_DAYS_MS);
  const rows = await prisma.autonomousAction.findMany({
    where: {
      ruleName: { startsWith: "nick_action_" },
      approval: "approved",
      executedAt: null,
      ...(opts.ids && opts.ids.length > 0
        ? { id: { in: opts.ids } }
        : { createdAt: { gte: cutoff } }),
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

  const results: NickActionRunResult[] = [];
  let executed = 0;
  let failed = 0;
  let skipped = 0;

  if (rows.length === 0) {
    return { executed, failed, skipped, results, telegramOk: false, total: 0 };
  }

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

  return { executed, failed, skipped, results, telegramOk, total: rows.length };
}

/**
 * Stamp the AutonomousAction row. The caller's per-row catch ensures a
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
