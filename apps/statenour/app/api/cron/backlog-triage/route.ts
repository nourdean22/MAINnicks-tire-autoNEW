import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { daysAgo, today } from "@/lib/utils/datetime";
import { brainMemory } from "@/lib/brain/memory-manager";

export const maxDuration = 60;

/**
 * GET /api/cron/backlog-triage — keeps the signal surface honest
 *
 * Handles the three surfaces that can silently pile up:
 *   1. Task (INBOX) auto-park: status=INBOX + untouched 30d → ARCHIVED
 *      (replaces the old OpenLoop auto-archive — OpenLoop retired
 *      Apr 18 as a concept; inbox-Task is the unified home for
 *      "things captured but not yet started")
 *   2. DriftAlert auto-resolve: unacked + 21d old → resolved
 *      (keeps the audit trail, stops them scoring in active count)
 *   3. CaptureInboxItem auto-archive: status="active" + NEW triage
 *      + 14d → status="archived"
 *
 *   4. Top-3 surfacing: writes `top_3_backlog_<date>` BrainMemory row
 *      listing the sharpest three items across all three surfaces so
 *      the narrator + system prompt + HQ can surface them without the
 *      model having to ask.
 *
 * Schedule: daily 7am.
 */
export const GET = cronHandler(async () => {
  const thirtyDaysAgo = daysAgo(30);
  const twentyOneDaysAgo = daysAgo(21);
  const fourteenDaysAgo = daysAgo(14);
  const todayStr = today();

  // ── 1. Task INBOX auto-park ──
  // Replaces OpenLoop auto-archive. Inbox tasks untouched 30d become
  // ARCHIVED — they can still be un-archived via the tasks page if
  // Nour decides they're actually relevant.
  const staleInboxTasks = await prisma.task.findMany({
    where: {
      status: "INBOX",
      lastTouchedAt: { lt: thirtyDaysAgo },
      deletedAt: null,
    },
    select: { id: true, title: true },
  });
  // v10.0.39 — single transactional updateMany. Pre-fix: per-task
  // update with .catch(() => {}) silently swallowed individual
  // failures, so `inboxTasksArchived` could report 50 archived
  // when only 30 actually persisted (then on next run the 20 that
  // failed were re-processed — silently spinning forever on a
  // sticky DB issue). Now: one atomic call; if it throws, the
  // outer cronHandler logs it as a real failure.
  if (staleInboxTasks.length > 0) {
    await prisma.task.updateMany({
      where: { id: { in: staleInboxTasks.map((t) => t.id) } },
      data: {
        status: "ARCHIVED",
        autoPriorityExplanation: "auto-archived · 30d untouched · re-open if still relevant",
      },
    });
  }

  // ── 2. DriftAlert auto-resolve ──
  const staleAlerts = await prisma.driftAlert.updateMany({
    where: {
      acknowledged: false,
      resolved: false,
      createdAt: { lt: twentyOneDaysAgo },
    },
    data: {
      resolved: true,
      resolvedDate: todayStr,
    },
  });

  // ── 3. CaptureInboxItem auto-archive ──
  const staleCaptures = await prisma.captureInboxItem.updateMany({
    where: {
      status: "active",
      triageStatus: "NEW",
      capturedAt: { lt: fourteenDaysAgo },
    },
    data: {
      status: "archived",
      triagedAt: new Date(),
    },
  });

  // ── 4. Top-3 surfacing across surfaces ──
  // Score = age in days + severity/priority boost. Sources: drift,
  // task (inbox), capture. OpenLoop removed Apr 18.
  const [activeAlerts, inboxTasks, activeCaptures] = await Promise.all([
    prisma.driftAlert.findMany({
      where: { resolved: false },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true, ruleName: true, severity: true, message: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { status: "INBOX", deletedAt: null },
      orderBy: [{ autoPriority: "asc" }, { lastTouchedAt: "asc" }],
      take: 10,
      select: {
        id: true,
        title: true,
        autoPriority: true,
        lastTouchedAt: true,
        createdAt: true,
      },
    }),
    prisma.captureInboxItem.findMany({
      where: { status: "active", triageStatus: "NEW" },
      orderBy: { capturedAt: "asc" },
      take: 10,
      select: { itemKey: true, title: true, actionabilityScore: true, capturedAt: true },
    }),
  ]);

  const scored: Array<{ source: string; label: string; score: number; detail: string }> = [];
  const now = Date.now();

  for (const a of activeAlerts) {
    const ageDays = (now - a.createdAt.getTime()) / 86400000;
    const severityBoost = a.severity === "high" ? 5 : a.severity === "medium" ? 2 : 0;
    scored.push({
      source: "drift",
      label: `[${a.severity}] ${a.ruleName}`,
      score: ageDays + severityBoost,
      detail: a.message.slice(0, 140),
    });
  }
  for (const t of inboxTasks) {
    const ageDays = (now - (t.lastTouchedAt ?? t.createdAt).getTime()) / 86400000;
    // lower autoPriority = sharper. Convert to a boost that climbs as
    // priority sharpens so sharp+aged tasks rank highest.
    const p = t.autoPriority ?? 50;
    const priorityBoost = p <= 20 ? 5 : p <= 40 ? 2 : 0;
    scored.push({
      source: "task",
      label: t.title,
      score: ageDays + priorityBoost,
      detail: `inbox ${Math.round(ageDays)}d · priority p${p}`,
    });
  }
  for (const c of activeCaptures) {
    const ageDays = (now - c.capturedAt.getTime()) / 86400000;
    scored.push({
      source: "capture",
      label: c.title,
      score: ageDays + c.actionabilityScore / 25,
      detail: `captured ${Math.round(ageDays)}d ago · actionability ${c.actionabilityScore}`,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top3 = scored.slice(0, 3);

  if (top3.length > 0) {
    const body = top3
      .map((t, i) => `${i + 1}. [${t.source}] ${t.label} — ${t.detail}`)
      .join("\n");
    await brainMemory
      .remember(
        "backlog_triage",
        `top_3_backlog_${todayStr}`,
        `TOP 3 TO CLEAR TODAY [${todayStr}]:\n${body}`,
        "backlog-triage-engine",
        { count: top3.length, sources: top3.map((t) => t.source) }
      )
      .catch(() => {});
  }

  return {
    inboxTasksArchived: staleInboxTasks.length,
    alertsAutoResolved: staleAlerts.count,
    capturesArchived: staleCaptures.count,
    top3,
  };
});
