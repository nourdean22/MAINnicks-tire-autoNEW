/**
 * Stale-data scanner — finds rows across the system that "look live"
 * in the UI but are actually stale, and groups them into purgeable
 * categories.
 *
 * Why this exists: Nour kept seeing old data surface as if it were
 * fresh — drift alerts from 60 days ago in the HUD, abandoned tasks
 * in "ready", skill candidates that never graduated, 1-message
 * conversations left over from the X-Conversation-Id bug, etc.
 * Queries in the codebase filter by `resolved: false` or `status:
 * "pending"` without any recency guard, so anything that was ever
 * left unresolved sticks around forever.
 *
 * This module produces a single audit report with:
 *   · One category per failure mode
 *   · A count of rows caught by the category
 *   · Up to 5 example rows with their age + key identifier
 *   · A short description of what the category means + what purging
 *     it actually does
 *
 * Scope: read-only. Purging lives in the companion purge module so
 * the scan path can be safely cached / hit on every /system visit.
 */

import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@prisma/client";
import { safeQuery } from "@/lib/db/safe-prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export type StaleCategoryId =
  | "drift_alerts_unresolved_14d"
  | "pending_actions_7d"
  | "skill_candidates_30d"
  | "open_contradictions_60d"
  | "abandoned_tasks_30d"
  | "orphan_conversations"
  | "overdue_decisions_reviews"
  | "ancient_device_events";

export interface StaleExample {
  id: string | number;
  label: string;
  /** Days since the row was last touched. */
  ageDays: number;
}

export interface StaleCategory {
  id: StaleCategoryId;
  title: string;
  description: string;
  /** What actually happens when Nour clicks purge on this category. */
  purgeAction: string;
  count: number;
  examples: StaleExample[];
}

export interface StaleReport {
  generatedAt: string;
  totalStaleRows: number;
  categories: StaleCategory[];
}

function daysSince(d: Date | null | undefined): number {
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400_000);
}

/**
 * Predicate used by the orphan-conversation category. Extracted so
 * the scanner + tests share a single contract — see
 * tests/lib/stale-data-scanner.test.ts for the invariants.
 *
 * Definition: a conversation is "orphan" when it has ≤2 messages.
 * That's the shape left behind by the X-Conversation-Id bug (one
 * user turn + one Nick reply, then the conversation was never
 * extended).
 */
export function isOrphanConversation(c: {
  _count: { messages: number };
}): boolean {
  return c._count.messages <= 2;
}

/**
 * Predicate used by the open-contradictions category. Contradictions
 * are persisted as JSON in BrainMemory.content with shape
 *   { status: "unresolved" | "resolved" | "dismissed" | "both_valid", ... }
 * per lib/brain/contradiction-surfacer.ts.
 *
 * Returns true when the row is NOT resolved yet — i.e., it still
 * represents open tension on /brain. Malformed content is treated as
 * unresolved so Nour still sees it (fail-open for surfacing).
 */
export function isUnresolvedContradiction(c: { content: string }): boolean {
  try {
    const parsed = JSON.parse(c.content) as { status?: string };
    return !parsed.status || parsed.status === "unresolved";
  } catch {
    return true;
  }
}

/**
 * Run the full audit. Every category is independently safe-queried so
 * a broken one doesn't poison the report.
 */
export async function scanStaleData(): Promise<StaleReport> {
  const now = Date.now();
  const since14d = new Date(now - 14 * 86400_000);
  const since7d = new Date(now - 7 * 86400_000);
  const since30d = new Date(now - 30 * 86400_000);
  const since60d = new Date(now - 60 * 86400_000);
  const since24h = new Date(now - 24 * 3600_000);
  const since180d = new Date(now - 180 * 86400_000);

  const [
    driftAlerts,
    pendingActions,
    skillCandidates,
    openContradictions,
    abandonedTasks,
    orphanConvos,
    overdueDecisions,
    ancientDeviceEvents,
  ] = await Promise.all([
    // 1. Unresolved drift alerts older than 14 days. The backlog-triage
    //    cron auto-resolves these but occasionally it falls behind.
    safeQuery(
      async () => {
        const candidates = await prisma.brainMemory.findMany({
          where: {
            category: "coach_event",
            key: { startsWith: "coach:drift-recovery:" },
            createdAt: { lt: since14d },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, key: true, content: true, createdAt: true, metadata: true },
        });
        const unresolved = candidates.filter((c) => {
          const meta = (c.metadata ?? {}) as Record<string, unknown>;
          return !meta.ackedAt;
        });
        return {
          count: unresolved.length,
          rows: unresolved.slice(0, 5).map((r) => ({
            id: r.key,
            ruleName: r.content,
            createdAt: r.createdAt,
          })),
        };
      },
      { count: 0, rows: [] as Array<{ id: string; ruleName: string; createdAt: Date }> },
      { label: "stale.driftAlerts" },
    ),

    // 2. Autonomous actions stuck "pending" for > 7 days. Nour either
    //    approved or rejected by now — the row was left orphaned.
    safeQuery(
      async () => {
        const [count, rows] = await Promise.all([
          prisma.autonomousAction.count({
            where: { approval: "pending", createdAt: { lt: since7d } },
          }),
          prisma.autonomousAction.findMany({
            where: { approval: "pending", createdAt: { lt: since7d } },
            orderBy: { createdAt: "asc" },
            take: 5,
            select: { id: true, ruleName: true, createdAt: true },
          }),
        ]);
        return { count, rows };
      },
      { count: 0, rows: [] as Array<{ id: string; ruleName: string; createdAt: Date }> },
      { label: "stale.pendingActions" },
    ),

    // 3. Skill candidates that never graduated. The graduation cron
    //    should promote them to active OR drop them. If they've sat as
    //    "candidate" for 30 days they're never going to graduate.
    //
    //    v11.2 fix (D9/D16) — was `content: { contains: "status:candidate" }`
    //    which was (a) a substring search on JSON-serialized content
    //    (brittle) AND (b) wrong: skill candidates are stored with
    //    `category: BRAIN_CATEGORIES.SKILL_PENDING`, not a status field inside content.
    //    The old filter matched zero rows. Now: correct category.
    safeQuery(
      async () => {
        const where = {
          category: BRAIN_CATEGORIES.SKILL_PENDING,
          createdAt: { lt: since30d },
        };
        const [count, rows] = await Promise.all([
          prisma.brainMemory.count({ where }),
          prisma.brainMemory.findMany({
            where,
            orderBy: { createdAt: "asc" },
            take: 5,
            select: { id: true, key: true, createdAt: true },
          }),
        ]);
        return { count, rows };
      },
      { count: 0, rows: [] as Array<{ id: string; key: string; createdAt: Date }> },
      { label: "stale.skillCandidates" },
    ),

    // 4. Contradictions left open (status=unresolved) > 60 days.
    //    These loiter forever on /brain and poison the resolution flow.
    //
    //    v11.2 fix (D9) — was `content: { not: { contains: "resolved" } }`
    //    which false-excluded any contradiction whose content mentioned
    //    "resolved" in prose (e.g., "I resolved to ..."). Now we pull
    //    candidates by category + date, then parse the JSON-serialized
    //    content in JS to check the canonical `status` field, which is
    //    "unresolved" | "resolved" | "dismissed" | "both_valid" per
    //    lib/brain/contradiction-surfacer.ts.
    safeQuery(
      async () => {
        const candidates = await prisma.brainMemory.findMany({
          where: {
            category: BRAIN_CATEGORIES.CONTRADICTION,
            createdAt: { lt: since60d },
          },
          orderBy: { createdAt: "asc" },
          take: 500,
          select: { id: true, key: true, content: true, createdAt: true },
        });
        const unresolved = candidates.filter(isUnresolvedContradiction);
        return {
          count: unresolved.length,
          rows: unresolved.slice(0, 5).map((c) => ({
            id: c.id,
            key: c.key,
            createdAt: c.createdAt,
          })),
        };
      },
      { count: 0, rows: [] as Array<{ id: string; key: string; createdAt: Date }> },
      { label: "stale.contradictions" },
    ),

    // 5. Tasks stuck in READY/DOING with no updates in 30+ days.
    //    Abandoned. Not a "done" task — just left behind.
    safeQuery(
      async () => {
        const where = {
          status: { in: [TaskStatus.READY, TaskStatus.DOING] },
          updatedAt: { lt: since30d },
          deletedAt: null,
        };
        const [count, rows] = await Promise.all([
          prisma.task.count({ where }),
          prisma.task.findMany({
            where,
            orderBy: { updatedAt: "asc" },
            take: 5,
            select: { id: true, title: true, updatedAt: true },
          }),
        ]);
        return { count, rows };
      },
      { count: 0, rows: [] as Array<{ id: string; title: string; updatedAt: Date }> },
      { label: "stale.abandonedTasks" },
    ),

    // 6. Orphan 1-message conversations from the X-Conversation-Id bug
    //    (fixed 2026-04-22). Each broken send left a fresh Conversation
    //    with 1 user message + 1 assistant message = 2 chat_message rows.
    //    Sidebar fills with these. 24h old because we don't want to kill
    //    a conversation that's still being used.
    //
    //    v11.2 · single-pass implementation. Old version had two bugs:
    //      (a) prisma.chatConversation.count({ messages: { every: {} } })
    //          vacuously matched every row (empty predicate = true)
    //      (b) the count() result was discarded inside a .then() that ran
    //          a second findMany — burning a wasted round-trip
    //    Now: ONE findMany with _count.messages, filter in-memory, derive
    //    both total count and the 5 oldest examples from the same result.
    safeQuery(
      async () => {
        // Pull up to 500 candidates (bounded upper limit — /system/stale
        // is a diagnostic, not a bulk tool). Ordered oldest-first so the
        // first 5 in the filtered result are the examples.
        const candidates = await prisma.chatConversation.findMany({
          where: { createdAt: { lt: since24h } },
          orderBy: { createdAt: "asc" },
          take: 500,
          select: {
            id: true,
            title: true,
            createdAt: true,
            _count: { select: { messages: true } },
          },
        });
        const orphans = candidates.filter(isOrphanConversation);
        return {
          count: orphans.length,
          rows: orphans.slice(0, 5).map((c) => ({
            id: c.id,
            title: c.title ?? "(untitled)",
            createdAt: c.createdAt,
          })),
        };
      },
      { count: 0, rows: [] as Array<{ id: string; title: string; createdAt: Date }> },
      { label: "stale.orphanConvos" },
    ),

    // 7. Decisions past their review date with no actualOutcome recorded.
    //    These drift-drift-drift; the library doesn't auto-grade so they
    //    stay "unreviewed" until Nour does it, and many never get done.
    safeQuery(
      async () => {
        const where = {
          reviewDate: { lt: new Date(now - 30 * 86400_000).toISOString().slice(0, 10) },
          actualOutcome: null,
          deletedAt: null,
        };
        const [count, rows] = await Promise.all([
          prisma.masteryDecision.count({ where }),
          prisma.masteryDecision.findMany({
            where,
            orderBy: { reviewDate: "asc" },
            take: 5,
            select: { id: true, title: true, reviewDate: true, createdAt: true },
          }),
        ]);
        return { count, rows };
      },
      { count: 0, rows: [] as Array<{ id: number; title: string; reviewDate: string | null; createdAt: Date }> },
      { label: "stale.overdueDecisions" },
    ),

    // 8. DeviceEvent rows older than 180 days. Useful as a general
    //    DB-pruning signal — these accumulate thousands per month of
    //    usage and slow down any time-range query.
    safeQuery(
      async () => {
        const count = await prisma.deviceEvent.count({
          where: { createdAt: { lt: since180d } },
        });
        const rows = count > 0
          ? await prisma.deviceEvent.findMany({
              where: { createdAt: { lt: since180d } },
              orderBy: { createdAt: "asc" },
              take: 5,
              select: { id: true, event: true, createdAt: true },
            })
          : [];
        return { count, rows };
      },
      { count: 0, rows: [] as Array<{ id: string; event: string; createdAt: Date }> },
      { label: "stale.deviceEvents" },
    ),
  ]);

  const categories: StaleCategory[] = [
    {
      id: "drift_alerts_unresolved_14d",
      title: "Drift alerts unresolved > 14 days",
      description:
        "Drift rules fired, nobody resolved them. Auto-triage cron should have picked these up but missed. They keep showing on /brain + HQ as 'live warnings' even though they're weeks old.",
      purgeAction: "Marks each alert resolved with note: 'auto-resolved · stale >14d'.",
      count: driftAlerts.count,
      examples: driftAlerts.rows.map((r) => ({
        id: r.id,
        label: r.ruleName,
        ageDays: daysSince(r.createdAt),
      })),
    },
    {
      id: "pending_actions_7d",
      title: "Autonomous actions pending > 7 days",
      description:
        "Nick flagged these for approval, you never hit approve or reject. They clutter /system/actions and the approval counter on the orb.",
      purgeAction: "Marks each action rejected with note: 'auto-rejected · stale >7d'.",
      count: pendingActions.count,
      examples: pendingActions.rows.map((r) => ({
        id: r.id,
        label: r.ruleName,
        ageDays: daysSince(r.createdAt),
      })),
    },
    {
      id: "skill_candidates_30d",
      title: "Skill candidates stuck > 30 days",
      description:
        "Skills that the extraction cron proposed but were never graduated to active. They sit on /settings skill library bloating the candidates count.",
      purgeAction: "Deletes the candidate BrainMemory rows.",
      count: skillCandidates.count,
      examples: skillCandidates.rows.map((r) => ({
        id: r.id,
        label: r.key,
        ageDays: daysSince(r.createdAt),
      })),
    },
    {
      id: "open_contradictions_60d",
      title: "Contradictions unresolved > 60 days",
      description:
        "Surfaced by the contradiction-surfacer. Each one is a belief-vs-behavior mismatch that Nour never addressed. /brain shows them as active tension.",
      purgeAction: "Marks each contradiction resolved with note: 'auto-closed · stale >60d'.",
      count: openContradictions.count,
      examples: openContradictions.rows.map((r) => ({
        id: r.id,
        label: r.key,
        ageDays: daysSince(r.createdAt),
      })),
    },
    {
      id: "abandoned_tasks_30d",
      title: "Tasks abandoned > 30 days (READY/DOING)",
      description:
        "Tasks still flagged as active work but nobody's touched them in a month. They're clogging /tasks + inflating the 'open loops' counters across the OS.",
      purgeAction: "Moves each task to status=ARCHIVED. The row isn't deleted — just hidden from active views.",
      count: abandonedTasks.count,
      examples: abandonedTasks.rows.map((r) => ({
        id: r.id,
        label: r.title,
        ageDays: daysSince(r.updatedAt),
      })),
    },
    {
      id: "orphan_conversations",
      title: "Orphan 1-message chat conversations",
      description:
        "Leftovers from the X-Conversation-Id bug (fixed 2026-04-22). Each failed capture left a fresh conversation with 2 messages (user + reply) instead of appending to the active one.",
      purgeAction: "Deletes conversations + their messages. Only touches rows with <= 2 messages older than 24h.",
      count: orphanConvos.count,
      examples: orphanConvos.rows.map((r) => ({
        id: r.id,
        label: r.title,
        ageDays: daysSince(r.createdAt),
      })),
    },
    {
      id: "overdue_decisions_reviews",
      title: "Decisions past reviewDate (no outcome)",
      description:
        "MasteryDecision rows where the review date passed > 30 days ago but no actualOutcome was ever logged. These drag down the decision-drift review-rate.",
      purgeAction: "Marks each decision reviewDate = null (opts it out of the review queue). Doesn't delete — you can still see the original prediction.",
      count: overdueDecisions.count,
      examples: overdueDecisions.rows.map((r) => ({
        id: r.id,
        label: r.title,
        ageDays: daysSince(r.createdAt),
      })),
    },
    {
      id: "ancient_device_events",
      title: "DeviceEvent rows > 180 days",
      description:
        "Device telemetry older than 6 months. Safe to purge — nothing in the UI looks this far back, they just slow down time-range queries.",
      purgeAction: "Deletes all DeviceEvent rows older than 180 days.",
      count: ancientDeviceEvents.count,
      examples: ancientDeviceEvents.rows.map((r) => ({
        id: r.id,
        label: r.event,
        ageDays: daysSince(r.createdAt),
      })),
    },
  ];

  const totalStaleRows = categories.reduce((s, c) => s + c.count, 0);

  return {
    generatedAt: new Date().toISOString(),
    totalStaleRows,
    categories,
  };
}
