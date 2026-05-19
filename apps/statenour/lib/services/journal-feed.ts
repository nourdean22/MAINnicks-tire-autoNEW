/**
 * Journal feed service · Phase TT (2026-05-19 AM).
 *
 * Lifted from `app/api/journal/route.ts` so both the legacy REST
 * endpoint AND the new `trpc.journal.feed` query call the same
 * function · drift between consumers structurally impossible.
 *
 * Merges 4 thought-capture tables into a single chronologically-
 * sorted stream:
 *   · BrainDump      (chat Flow Mode · Telegram · /journal capture)
 *   · Reflection     (reflection-engine cron outputs)
 *   · SituationLog   (War Room Situation Room incidents)
 *   · DecisionReplay (reviewed past decisions)
 *
 * The schema has these as 4 isolated silos with no relations · this
 * service does the merge in memory so the page renders one stream
 * while the tables stay orthogonal.
 */

import { prisma } from "@/lib/prisma";

export type FeedSource = "dump" | "reflection" | "situation" | "decision";

export interface FeedEntry {
  id: string;
  source: FeedSource;
  createdAt: Date;
  date: string;
  entryType?: string;
  title: string;
  body: string;
  summary: string | null;
  mood: string | null;
  domains: string[];
  linkedTopics: string[];
  tasksCreated: number;
  acknowledged?: boolean;
  actionable?: boolean;
  confidence?: number;
  raw: Record<string, unknown>;
}

export interface FeedCounts {
  total: number;
  shown: number;
  hasMore: boolean;
  bySource: Record<FeedSource, number>;
  byType: Record<string, number>;
}

export interface JournalFeedView {
  entries: FeedEntry[];
  counts: FeedCounts;
}

export async function buildJournalFeed(args: {
  limit?: number;
  days?: number;
  type?: string | null;
  source?: string;
}): Promise<JournalFeedView> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const days = Math.min(Math.max(args.days ?? 30, 1), 365);
  const typeFilter = args.type;
  const sourceFilter = args.source || "all";

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const [brainDumps, reflections, situationLogs, decisions] = await Promise.all([
    sourceFilter === "all" || sourceFilter === "dump"
      ? prisma.brainDump
          .findMany({
            where: { date: { gte: cutoffStr } },
            orderBy: { createdAt: "desc" },
            take: limit * 2,
          })
          .catch((): never[] => [])
      : Promise.resolve([]),

    sourceFilter === "all" || sourceFilter === "reflection"
      ? prisma.reflection
          .findMany({
            where: { date: { gte: cutoffStr } },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
          .catch((): never[] => [])
      : Promise.resolve([]),

    sourceFilter === "all" || sourceFilter === "situation"
      ? prisma.situationLog
          .findMany({
            where: { createdAt: { gte: cutoff } },
            orderBy: { createdAt: "desc" },
            take: limit,
            include: {
              law: { select: { book: true, number: true, shortTitle: true } },
            },
          })
          .catch((): never[] => [])
      : Promise.resolve([]),

    sourceFilter === "all" || sourceFilter === "decision"
      ? prisma.decisionReplay
          .findMany({
            where: { createdAt: { gte: cutoff } },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
          .catch((): never[] => [])
      : Promise.resolve([]),
  ]);

  const feed: FeedEntry[] = [];

  for (const d of brainDumps) {
    let extracted: {
      entryType?: string;
      domains?: string[];
      linkedTopics?: string[];
    } = {};
    try {
      if (d.extractedItems) extracted = JSON.parse(d.extractedItems);
    } catch {}
    const entryType = extracted.entryType || "raw";
    if (typeFilter && typeFilter !== "all" && typeFilter !== entryType) continue;
    feed.push({
      id: d.id,
      source: "dump",
      createdAt: d.createdAt,
      date: d.date,
      entryType,
      title: d.summary?.slice(0, 120) || d.rawThoughts.slice(0, 80),
      body: d.rawThoughts,
      summary: d.summary,
      mood: d.moodBefore,
      domains: Array.isArray(extracted.domains) ? extracted.domains : [],
      linkedTopics: Array.isArray(extracted.linkedTopics)
        ? extracted.linkedTopics
        : [],
      tasksCreated: d.actionsTaken,
      raw: d as unknown as Record<string, unknown>,
    });
  }

  for (const r of reflections) {
    if (typeFilter && typeFilter !== "all" && typeFilter !== "reflection") continue;
    feed.push({
      id: r.id,
      source: "reflection",
      createdAt: r.createdAt,
      date: r.date,
      entryType: "reflection",
      title: r.insight.slice(0, 120),
      body: r.insight,
      summary: r.evidence.slice(0, 200),
      mood: null,
      domains: [r.category],
      linkedTopics: [],
      tasksCreated: 0,
      acknowledged: r.acknowledged,
      actionable: r.actionable,
      confidence: r.confidence,
      raw: r as unknown as Record<string, unknown>,
    });
  }

  for (const s of situationLogs) {
    if (typeFilter && typeFilter !== "all" && typeFilter !== "reflection") continue;
    feed.push({
      id: s.id,
      source: "situation",
      createdAt: s.createdAt,
      date: s.createdAt.toISOString().split("T")[0],
      entryType: "reflection",
      title: s.situation.slice(0, 120),
      body: s.situation,
      summary: s.aiAnalysis?.slice(0, 200) ?? null,
      mood: s.emotion,
      domains: [s.context],
      linkedTopics: s.law
        ? [`${s.law.book}#${s.law.number}: ${s.law.shortTitle}`]
        : [],
      tasksCreated: 0,
      raw: s as unknown as Record<string, unknown>,
    });
  }

  for (const d of decisions) {
    if (typeFilter && typeFilter !== "all" && typeFilter !== "decision") continue;
    feed.push({
      id: d.id,
      source: "decision",
      createdAt: d.createdAt,
      date: d.createdAt.toISOString().split("T")[0],
      entryType: "decision",
      title: d.title.slice(0, 120),
      body: d.context ?? "",
      summary: d.lesson ?? d.reasoning?.slice(0, 200) ?? null,
      mood: null,
      domains: [],
      linkedTopics: [],
      tasksCreated: 0,
      acknowledged: d.reviewed,
      raw: d as unknown as Record<string, unknown>,
    });
  }

  feed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const entries = feed.slice(0, limit);

  const counts: FeedCounts = {
    total: feed.length,
    shown: entries.length,
    hasMore: feed.length > entries.length,
    bySource: {
      dump: feed.filter((e) => e.source === "dump").length,
      reflection: feed.filter((e) => e.source === "reflection").length,
      situation: feed.filter((e) => e.source === "situation").length,
      decision: feed.filter((e) => e.source === "decision").length,
    },
    byType: {
      raw: feed.filter((e) => e.entryType === "raw").length,
      thinking: feed.filter((e) => e.entryType === "thinking").length,
      reasoning: feed.filter((e) => e.entryType === "reasoning").length,
      insight: feed.filter((e) => e.entryType === "insight").length,
      decision: feed.filter((e) => e.entryType === "decision").length,
      reflection: feed.filter((e) => e.entryType === "reflection").length,
      planning: feed.filter((e) => e.entryType === "planning").length,
      venting: feed.filter((e) => e.entryType === "venting").length,
    },
  };

  return { entries, counts };
}
