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

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    if (!DATE_RX.test(date)) {
      throw new ServiceError("date must be YYYY-MM-DD", 400);
    }

    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(`${date}T23:59:59Z`);

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
          createdAt: { gte: dayStart, lte: dayEnd },
          deletedAt: null,
        },
      }).catch(() => 0),
      prisma.brainMemory
        .groupBy({
          by: ["category"],
          where: {
            createdAt: { gte: dayStart, lte: dayEnd },
            deletedAt: null,
          },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        })
        .catch(() => []),
      prisma.chatConversation
        .findMany({
          where: {
            OR: [
              { createdAt: { gte: dayStart, lte: dayEnd } },
              { lastActiveAt: { gte: dayStart, lte: dayEnd } },
            ],
          },
          select: { id: true, title: true, lastActiveAt: true, messageCount: true },
          orderBy: { lastActiveAt: "desc" },
          take: 5,
        })
        .catch(() => []),
      prisma.task
        .count({
          where: {
            createdAt: { gte: dayStart, lte: dayEnd },
            deletedAt: null,
          },
        })
        .catch(() => 0),
      prisma.task
        .count({
          where: {
            status: "DONE",
            updatedAt: { gte: dayStart, lte: dayEnd },
            deletedAt: null,
          },
        })
        .catch(() => 0),
      prisma.brainDump
        .findMany({
          where: {
            createdAt: { gte: dayStart, lte: dayEnd },
            deletedAt: null,
          },
          select: { id: true, summary: true, rawThoughts: true },
          take: 5,
        })
        .catch(() => []),
      prisma.reflection
        .findMany({
          where: {
            createdAt: { gte: dayStart, lte: dayEnd },
            deletedAt: null,
          },
          select: { id: true, category: true, insight: true },
          take: 5,
        })
        .catch(() => []),
      prisma.brainMemory
        .findFirst({
          where: {
            category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
            createdAt: { gte: dayStart, lte: dayEnd },
            deletedAt: null,
          },
          select: { content: true, metadata: true },
        })
        .catch(() => null),
      prisma.brainMemory
        .findFirst({
          where: {
            category: BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST,
            key: date,
            deletedAt: null,
          },
          select: { content: true },
        })
        .catch(() => null),
      prisma.masteryDecision
        .findMany({
          where: {
            createdAt: { gte: dayStart, lte: dayEnd },
            deletedAt: null,
          },
          select: { id: true, title: true, predictedOutcome: true, reviewDate: true },
          take: 5,
        })
        .catch(() => []),
      prisma.brainMemory
        .findMany({
          where: {
            category: "emotional_state",
            createdAt: { gte: dayStart, lte: dayEnd },
            deletedAt: null,
          },
          select: { content: true, key: true },
          take: 5,
        })
        .catch(() => []),
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
        logError("api.time-travel", e, { stage: "health-snapshot" }, "warn");
      }
    }

    return {
      date,
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
