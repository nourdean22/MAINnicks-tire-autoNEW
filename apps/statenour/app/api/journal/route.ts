import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

/**
 * GET /api/journal
 *
 * Unified journal feed. Merges 4 different thought-capture tables
 * into a single chronologically-sorted stream:
 *
 *   - BrainDump      (chat Flow Mode, Telegram, /journal manual capture)
 *   - Reflection     (reflection-engine cron outputs)
 *   - SituationLog   (War Room Situation Room incidents)
 *   - DecisionReplay (reviewed past decisions)
 *
 * The existing schema has these as 4 isolated silos with no
 * relations. This route does the merge in memory so the page can
 * render a single stream while the tables stay orthogonal.
 *
 * Query params:
 *   limit    — max entries to return (default 50, cap 200)
 *   days     — how far back to look (default 30, cap 365)
 *   type     — filter by entryType (BrainDump only — reflections
 *              and decisions don't have one)
 *   source   — filter by source ("dump", "reflection", "situation",
 *              "decision", or "all")
 */
export async function GET(req: Request) {
  // v10.0.37 — CRITICAL fix. Pre-v10.0.37 this GET had ZERO auth.
  // Returned BrainDump (raw thoughts), Reflection, SituationLog,
  // and DecisionReplay rows to any unauthenticated caller. The
  // sensitive-GET pre-push gate (v9.1.17) only covered
  // app/api/{system,brain,financial,decisions,audit} — /api/journal
  // had slipped through. The gate is widened in this same commit.
  await requireSession(req);
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
  const typeFilter = url.searchParams.get("type"); // e.g. "insight"
  const sourceFilter = url.searchParams.get("source") || "all";

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  // Fan out in parallel — each table has its own query + shape.
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
            include: { law: { select: { book: true, number: true, shortTitle: true } } },
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

  // Normalize everything into a common feed shape so the UI can
  // render a single stream. "type" here is the source (dump /
  // reflection / situation / decision); "entryType" is the
  // BrainDump classification (raw / thinking / reasoning / ...).
  interface FeedEntry {
    id: string;
    source: "dump" | "reflection" | "situation" | "decision";
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
      linkedTopics: Array.isArray(extracted.linkedTopics) ? extracted.linkedTopics : [],
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
      linkedTopics: s.law ? [`${s.law.book}#${s.law.number}: ${s.law.shortTitle}`] : [],
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

  // Merge-sort by createdAt descending, cap to limit.
  feed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const entries = feed.slice(0, limit);

  // v10.0.529.21 · correctness fix · `counts` previously summed the
  // un-sliced `feed` array (up to 200 rows) while `entries` was the
  // post-slice 50-row view. Filter chips showed "dump: 80" while only
  // 50 entries actually rendered — silent lie. Now we surface BOTH:
  //   - `counts` is the total available (operator can ask for more)
  //   - `shown` is what they're seeing right now
  // The page can display "showing 50 of 80" honestly.
  const counts = {
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

  return NextResponse.json({ data: { entries, counts } });
}
