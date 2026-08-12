/**
 * Stale-data purger — companion to stale-data-scanner.
 *
 * One function per category. Every category lists the exact SQL-level
 * effect in its docstring so Nour can verify the cleanup matches what
 * the scanner's `purgeAction` string said it would do.
 *
 * Design rules:
 *   · Never delete MasteryDecision rows — opt them out of the review
 *     queue only. Historical predictions keep their paper trail.
 *   · Never delete abandoned tasks — archive them. Same reason.
 *   · Always mark drift alerts / contradictions / actions resolved
 *     with an explicit audit-visible note so the trail explains why
 *     the row is no longer "live".
 *   · Return { purged: <count>, ... } so the caller can surface a
 *     precise toast.
 */

import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@prisma/client";
import type { StaleCategoryId } from "./stale-data-scanner";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface PurgeResult {
  category: StaleCategoryId;
  purged: number;
  note: string;
}

async function purgeDriftAlerts(): Promise<PurgeResult> {
  const since14d = new Date(Date.now() - 14 * 86400_000);
  const candidates = await prisma.brainMemory.findMany({
    where: {
      category: "coach_event",
      key: { startsWith: "coach:drift-recovery:" },
      createdAt: { lt: since14d },
    },
    select: { id: true, metadata: true },
  });

  const toAck = candidates.filter((c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    return !meta.ackedAt;
  });

  if (toAck.length === 0) {
    return {
      category: "drift_alerts_unresolved_14d",
      purged: 0,
      note: "No stale unresolved drift alerts found",
    };
  }

  const nowIso = new Date().toISOString();
  await prisma.$transaction(
    toAck.map((c) => {
      const meta = (c.metadata ?? {}) as Record<string, unknown>;
      const nextMeta = { ...meta, ackedAt: nowIso };
      return prisma.brainMemory.update({
        where: { id: c.id },
        data: { metadata: nextMeta as object },
      });
    })
  );

  return {
    category: "drift_alerts_unresolved_14d",
    purged: toAck.length,
    note: `Marked ${toAck.length} alerts resolved (>14d old)`,
  };
}

async function purgePendingActions(): Promise<PurgeResult> {
  // The 7d window is load-bearing beyond the UI tap: since 2026-08-12 the
  // nightly data-cleanup cron runs this too (via purgeStaleCategory), so
  // changing the window changes how long the operator gets to review a
  // pending autonomous action before it auto-rejects.
  const since7d = new Date(Date.now() - 7 * 86400_000);
  const result = await prisma.autonomousAction.updateMany({
    where: { approval: "pending", createdAt: { lt: since7d } },
    data: {
      approval: "rejected",
      approvedBy: "auto-purge",
    },
  });
  return {
    category: "pending_actions_7d",
    purged: result.count,
    note: `Marked ${result.count} actions rejected (>7d pending)`,
  };
}

async function purgeSkillCandidates(): Promise<PurgeResult> {
  const since30d = new Date(Date.now() - 30 * 86400_000);
  // v11.2 fix · matches scanner D9/D16 — skill candidates are
  // category="skill_pending", not a status string inside content.
  const result = await prisma.brainMemory.deleteMany({
    where: {
      category: BRAIN_CATEGORIES.SKILL_PENDING,
      createdAt: { lt: since30d },
    },
  });
  return {
    category: "skill_candidates_30d",
    purged: result.count,
    note: `Deleted ${result.count} stale skill candidates (>30d old, never graduated)`,
  };
}

/**
 * Build the canonical "dismissed" content payload for a contradiction
 * BrainMemory row. Extracted so tests + purger share one contract —
 * see tests/lib/stale-data-purger.test.ts.
 *
 * Returns `null` when the row is already resolved/dismissed (caller
 * should skip). Returns a stringified JSON otherwise, preserving any
 * extra fields on the original record.
 */
export function buildDismissedContradictionContent(
  currentContent: string,
  todayIso: string,
): string | null {
  const dateStr = todayIso.slice(0, 10);
  try {
    const parsed = JSON.parse(currentContent) as {
      status?: string;
      why?: string;
      resolved_at?: string | null;
      [k: string]: unknown;
    };
    if (parsed.status && parsed.status !== "unresolved") return null;
    return JSON.stringify({
      ...parsed,
      status: "dismissed",
      resolved_at: todayIso,
      why: `${parsed.why ?? ""}\n\n[auto-dismissed ${dateStr} · stale >60d]`.trim(),
    });
  } catch {
    // Malformed row — overwrite with a minimal dismissed record so
    // future scans skip it cleanly.
    return JSON.stringify({
      status: "dismissed",
      resolved_at: todayIso,
      why: `[auto-dismissed ${dateStr} · stale >60d · previously unparseable]`,
    });
  }
}

async function purgeContradictions(): Promise<PurgeResult> {
  const since60d = new Date(Date.now() - 60 * 86400_000);
  // Purge-semantics: rather than deleting, we REWRITE the JSON content
  // with status="dismissed" + resolved_at + marker in `why`. Future
  // contradiction-surfacer scans see the canonical dismissed status
  // and skip these. Preserves full history for later audit.
  //
  // v11.2 fixes:
  //   D5: per-row `await update()` in a loop was N round-trips to Neon.
  //       Now wrapped in $transaction for one round-trip total.
  //   D6: hardcoded date removed — dynamic.
  //   D9: substring filter replaced with parsed-JSON status check.
  const todayIso = new Date().toISOString();
  const candidates = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.CONTRADICTION,
      createdAt: { lt: since60d },
    },
    select: { id: true, content: true },
  });
  const unresolved: Array<{ id: string; newContent: string }> = [];
  for (const c of candidates) {
    const next = buildDismissedContradictionContent(c.content, todayIso);
    if (next === null) continue;
    unresolved.push({ id: c.id, newContent: next });
  }
  if (unresolved.length === 0) {
    return {
      category: "open_contradictions_60d",
      purged: 0,
      note: "No stale contradictions",
    };
  }
  await prisma.$transaction(
    unresolved.map((u) =>
      prisma.brainMemory.update({
        where: { id: u.id },
        data: { content: u.newContent },
      }),
    ),
  );
  return {
    category: "open_contradictions_60d",
    purged: unresolved.length,
    note: `Auto-dismissed ${unresolved.length} contradictions (>60d open)`,
  };
}

async function purgeAbandonedTasks(): Promise<PurgeResult> {
  const since30d = new Date(Date.now() - 30 * 86400_000);
  const result = await prisma.task.updateMany({
    where: {
      status: { in: [TaskStatus.READY, TaskStatus.DOING] },
      updatedAt: { lt: since30d },
    },
    data: { status: TaskStatus.ARCHIVED },
  });
  return {
    category: "abandoned_tasks_30d",
    purged: result.count,
    note: `Archived ${result.count} abandoned tasks (>30d untouched)`,
  };
}

async function purgeOrphanConvos(): Promise<PurgeResult> {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  // v11.2 fix D4: TOCTOU race. The old implementation did:
  //   findMany → filter by _count.messages → deleteMany
  // Between the find and the delete, Nour could have sent a message
  // into a previously-orphan conversation. The IDs were already in
  // our orphans[] → we'd delete an active chat.
  //
  // Fix: wrap the entire snapshot-then-delete sequence in a Prisma
  // $transaction AND re-check _count inside the transaction so any
  // chat_message rows written between snapshot and delete invalidate
  // the candidate. Transaction isolation (READ COMMITTED on Neon)
  // prevents the in-flight message from being missed.
  const candidates = await prisma.chatConversation.findMany({
    where: { createdAt: { lt: since24h } },
    select: { id: true, _count: { select: { messages: true } } },
    take: 1000, // generous cap — one-shot cleanup
  });
  const snapshotOrphans = candidates
    .filter((c) => c._count.messages <= 2)
    .map((c) => c.id);
  if (snapshotOrphans.length === 0) {
    return {
      category: BRAIN_CATEGORIES.ORPHAN_CONVERSATIONS,
      purged: 0,
      note: "No orphan conversations found",
    };
  }
  const result = await prisma.$transaction(async (tx) => {
    // Re-check message count INSIDE the transaction. Any row that
    // received a third message since we snapshotted will have
    // _count.messages > 2 and get dropped from the delete set.
    const verified = await tx.chatConversation.findMany({
      where: { id: { in: snapshotOrphans } },
      select: { id: true, _count: { select: { messages: true } } },
    });
    const confirmedOrphans = verified
      .filter((c) => c._count.messages <= 2)
      .map((c) => c.id);
    if (confirmedOrphans.length === 0) {
      return { count: 0, changed: 0 };
    }
    // FK order: messages first (though for a ≤2-msg set this is trivial),
    // then the conversation row.
    await tx.chatMessage.deleteMany({
      where: { conversationId: { in: confirmedOrphans } },
    });
    const del = await tx.chatConversation.deleteMany({
      where: { id: { in: confirmedOrphans } },
    });
    return {
      count: del.count,
      changed: snapshotOrphans.length - confirmedOrphans.length,
    };
  });
  const note =
    result.changed > 0
      ? `Deleted ${result.count} orphan conversations (${result.changed} caught live + skipped)`
      : `Deleted ${result.count} orphan 1-message conversations + their messages`;
  return {
    category: BRAIN_CATEGORIES.ORPHAN_CONVERSATIONS,
    purged: result.count,
    note,
  };
}

async function purgeOverdueDecisions(): Promise<PurgeResult> {
  const cutoffDate = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  // Clear reviewDate — keeps the decision record itself but pulls it
  // out of the "overdue reviews" queue on /system/decision-drift.
  const result = await prisma.masteryDecision.updateMany({
    where: {
      reviewDate: { lt: cutoffDate },
      actualOutcome: null,
    },
    data: { reviewDate: null },
  });
  return {
    category: BRAIN_CATEGORIES.OVERDUE_DECISIONS_REVIEWS,
    purged: result.count,
    note: `Cleared reviewDate on ${result.count} overdue decisions (still visible on /decisions, just not in the overdue queue)`,
  };
}

async function purgeAncientDeviceEvents(): Promise<PurgeResult> {
  const since180d = new Date(Date.now() - 180 * 86400_000);
  const result = await prisma.deviceEvent.deleteMany({
    where: { createdAt: { lt: since180d } },
  });
  return {
    category: BRAIN_CATEGORIES.ANCIENT_DEVICE_EVENTS,
    purged: result.count,
    note: `Deleted ${result.count} DeviceEvent rows >180d old`,
  };
}

const PURGERS: Record<StaleCategoryId, () => Promise<PurgeResult>> = {
  drift_alerts_unresolved_14d: purgeDriftAlerts,
  pending_actions_7d: purgePendingActions,
  skill_candidates_30d: purgeSkillCandidates,
  open_contradictions_60d: purgeContradictions,
  abandoned_tasks_30d: purgeAbandonedTasks,
  orphan_conversations: purgeOrphanConvos,
  overdue_decisions_reviews: purgeOverdueDecisions,
  ancient_device_events: purgeAncientDeviceEvents,
};

export async function purgeStaleCategory(
  category: StaleCategoryId,
): Promise<PurgeResult> {
  const fn = PURGERS[category];
  if (!fn) {
    throw new Error(`Unknown stale category: ${category}`);
  }
  return fn();
}

/**
 * Run every purger in parallel and return aggregate results. Used
 * when Nour hits "purge all" from the UI.
 *
 * v11.2 fix D14: was sequential (for-of await) which meant purge-all
 * worst-case = sum of every purger's latency. A slow DeviceEvent
 * purge (millions of rows) could blow Vercel's 60s function timeout
 * before subsequent purgers ran. Now parallel via Promise.allSettled
 * — each purger still runs in its own isolated scope so one failure
 * doesn't cascade, but they're not blocking each other.
 *
 * Order-preserving: the input id list defines the result order, even
 * when individual purgers finish out of order.
 */
export async function purgeAllStale(): Promise<{
  results: PurgeResult[];
  totalPurged: number;
}> {
  const ids = Object.keys(PURGERS) as StaleCategoryId[];
  const settled = await Promise.allSettled(ids.map((id) => PURGERS[id]()));
  const results: PurgeResult[] = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      category: ids[i],
      purged: 0,
      note: `Failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
    };
  });
  const totalPurged = results.reduce((s, r) => s + r.purged, 0);
  return { results, totalPurged };
}
