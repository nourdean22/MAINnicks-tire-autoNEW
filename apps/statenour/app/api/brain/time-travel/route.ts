/**
 * GET /api/brain/time-travel?date=YYYY-MM-DD · v10.0.91 · 2026-05-02.
 *
 * Reconstructs Nour's "state of mind" for a given date by pulling:
 *   · brain_memories created on that date (with category breakdown)
 *   · chat conversations active that day
 *   · tasks completed / created on that date
 *   · reflections + brain dumps from that day
 *   · identity_snapshot if one was rolled that day
 *   · dominant emotional_state for the day
 *   · drift_score / health digest for that day
 *
 * Output is a compact "this is what was alive in your head on
 * <date>" snapshot, useful for the chat tool and for an eventual
 * /brain/time-travel UI.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";
import { startOfDayET, endOfDayET, today } from "@/lib/utils/datetime";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    // ET, not UTC. `new Date().toISOString().slice(0,10)` is the UTC date, so
    // between 20:00 and 23:59 ET it already reads as TOMORROW — the operator
    // asking "what was in my head today" at 9pm got an empty next-day view.
    const date = url.searchParams.get("date") ?? today();
    if (!DATE_RX.test(date)) {
      throw new ServiceError("date must be YYYY-MM-DD", 400);
    }

    // The day is the ET calendar day, because that is the day the operator
    // lived. `${date}T00:00:00Z` is UTC midnight — 8pm ET the PREVIOUS evening
    // — so every one of the eleven queries below was shifted by 4-5 hours and
    // an ET evening landed on the NEXT day's snapshot. Same frame defect the
    // #1809 clock arc fixed elsewhere; these helpers are the repo's answer to
    // it and return the UTC instant of the ET boundary, safe as Prisma filters.
    //
    // Noon UTC is the anchor because it is mid-day in ET for every date, so the
    // ET calendar day derived from it is always the one named by `date`.
    const anchor = new Date(`${date}T12:00:00Z`);
    const dayStart = startOfDayET(anchor);
    // endOfDayET returns the START of the next ET day — an EXCLUSIVE upper
    // bound, which is why every filter below uses `lt` and not `lte`. The old
    // `lte 23:59:59` also silently dropped the final second of each day.
    const dayEnd = endOfDayET(anchor);

    // 2026-10-01 · EMPTY vs ERROR. Each read below still fails soft (one dead
    // table must not blank the whole day), but it now records WHICH read
    // failed. Before this, a failed read was indistinguishable from a quiet
    // day: the panel printed "0 tasks done · identity snapshot absent" for a
    // day that had activity. The panel renders these keys as unknown.
    const degradedReads: string[] = [];
    const soft = <T,>(label: string, fallback: T) => (err: unknown): T => {
      degradedReads.push(label);
      logError("api.time-travel", err, { stage: "read", read: label }, "warn");
      return fallback;
    };

    const [
      memories,
      memoriesByCategory,
      chats,
      tasksCreated,
      tasksCompleted,
      brainDumps,
      reflections,
      identitySnap,
      healthDigest,
      decisions,
      emotionalStates,
    ] = await Promise.all([
      prisma.brainMemory.count({
        where: {
          createdAt: { gte: dayStart, lt: dayEnd },
          deletedAt: null,
        },
      }).catch(soft("memoriesCreated", 0)),
      prisma.brainMemory
        .groupBy({
          by: ["category"],
          where: {
            createdAt: { gte: dayStart, lt: dayEnd },
            deletedAt: null,
          },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        })
        .catch(soft("memoriesByCategory", [] as never[])),
      prisma.chatConversation
        .findMany({
          where: {
            OR: [
              { createdAt: { gte: dayStart, lt: dayEnd } },
              { lastActiveAt: { gte: dayStart, lt: dayEnd } },
            ],
          },
          select: { id: true, title: true, lastActiveAt: true, messageCount: true },
          orderBy: { lastActiveAt: "desc" },
          take: 5,
        })
        .catch(soft("chatsActive", [] as never[])),
      prisma.task
        .count({
          where: {
            createdAt: { gte: dayStart, lt: dayEnd },
            deletedAt: null,
          },
        })
        .catch(soft("tasksCreated", 0)),
      prisma.task
        .count({
          where: {
            status: "DONE",
            updatedAt: { gte: dayStart, lt: dayEnd },
            deletedAt: null,
          },
        })
        .catch(soft("tasksCompleted", 0)),
      prisma.brainDump
        .findMany({
          where: {
            createdAt: { gte: dayStart, lt: dayEnd },
            deletedAt: null,
          },
          select: { id: true, summary: true, rawThoughts: true },
          take: 5,
        })
        .catch(soft("brainDumpsWritten", [] as never[])),
      prisma.reflection
        .findMany({
          where: {
            createdAt: { gte: dayStart, lt: dayEnd },
            deletedAt: null,
          },
          select: { id: true, category: true, insight: true },
          take: 5,
        })
        .catch(soft("reflectionsLogged", [] as never[])),
      prisma.brainMemory
        .findFirst({
          where: {
            category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
            createdAt: { gte: dayStart, lt: dayEnd },
            deletedAt: null,
          },
          select: { content: true, metadata: true },
        })
        .catch(soft("identitySnapshot", null)),
      prisma.brainMemory
        .findFirst({
          where: {
            category: BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST,
            key: date,
            deletedAt: null,
          },
          select: { content: true },
        })
        .catch(soft("healthDigest", null)),
      prisma.masteryDecision
        .findMany({
          where: {
            createdAt: { gte: dayStart, lt: dayEnd },
            deletedAt: null,
          },
          select: { id: true, title: true, predictedOutcome: true, reviewDate: true },
          take: 5,
        })
        .catch(soft("decisionsLogged", [] as never[])),
      prisma.brainMemory
        .findMany({
          where: {
            category: "emotional_state",
            // DATED BY KEY, not by createdAt — the same pattern the health
            // digest above uses. Every emotional_state key embeds the day it is
            // ABOUT (`mood_{date}_{h}`, `journal_mood_{date}_{h}`); `createdAt`
            // is merely when the row was written, and the two diverge whenever
            // history is backfilled. Measured 2026-08-26: 170 rows imported in a
            // single 5-minute window on 2026-08-16 carry keys spanning
            // 2026-05-28 to 2026-08-13 — 58 distinct days. Under a createdAt
            // filter all 170 surfaced on the 2026-08-16 view (an arbitrary 5 of
            // them, per the take below) and NEVER on the days they describe. The
            // one day that was wrong showed five moods that were not its own.
            //
            // Safe because it is total: all 329 emotional_state rows have a date
            // in the key, none lack one. tests/repo/time-travel-dating.test.ts
            // pins that at the WRITERS, so a future undated key fails there
            // rather than silently vanishing from every day view.
            key: { contains: date },
            deletedAt: null,
          },
          select: { content: true, key: true },
          take: 5,
        })
        .catch(soft("emotionalStates", [] as never[])),
    ]);

    let healthOverall: string | null = null;
    let healthWarnings: number | null = null;
    if (healthDigest) {
      try {
        const d = JSON.parse(healthDigest.content) as {
          overall?: string;
          counts?: { warning?: number };
        };
        healthOverall = d.overall ?? null;
        healthWarnings = d.counts?.warning ?? null;
      } catch (e) {
        // An unparseable digest is unknown health, not "unmeasured".
        degradedReads.push("healthDigest");
        logError("api.time-travel", e, { stage: "health-snapshot" }, "warn");
      }
    }

    return {
      date,
      degradedReads,
      summary: {
        memoriesCreated: memories,
        tasksCreated,
        tasksCompleted,
        brainDumpsWritten: brainDumps.length,
        reflectionsLogged: reflections.length,
        decisionsLogged: decisions.length,
        chatsActive: chats.length,
        healthOverall,
        healthWarnings,
        emotionalStateLogged: emotionalStates.length > 0,
      },
      memoriesByCategory: memoriesByCategory.map((c) => ({
        category: c.category,
        count: c._count.id,
      })),
      chats: chats.map((c) => ({
        id: c.id,
        title: c.title?.slice(0, 80) ?? "(untitled)",
        lastActiveAt: c.lastActiveAt?.toISOString() ?? null,
        messageCount: c.messageCount,
      })),
      brainDumps: brainDumps.map((d) => ({
        id: d.id,
        text: (d.summary ?? d.rawThoughts ?? "").slice(0, 240),
      })),
      reflections: reflections.map((r) => ({
        id: r.id,
        category: r.category,
        insight: r.insight?.slice(0, 240) ?? "",
      })),
      decisions: decisions.map((d) => ({
        id: d.id,
        title: d.title?.slice(0, 100) ?? "",
        predictedOutcome: d.predictedOutcome?.slice(0, 120) ?? null,
        reviewDate: d.reviewDate ?? null,
      })),
      emotionalStates: emotionalStates.map((e) => ({
        key: e.key,
        snippet: e.content.slice(0, 200),
      })),
      identitySnapshotPresent: !!identitySnap,
      identitySnapshotMetadata: identitySnap?.metadata ?? null,
    };
  },
  { auth: "owner" },
);
