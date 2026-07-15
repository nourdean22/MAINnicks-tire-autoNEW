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
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/journal-feed");

/** Feed v2 (audit 2026-07-15) · titles were raw `.slice(0, N)` — every
 *  card on /journal ended mid-word ("attending a d", "get in fron").
 *  Cut at the last word boundary and add an ellipsis when truncated. */
export function truncateAtWord(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export type FeedSource = "dump" | "reflection" | "situation" | "decision" | "retro";

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
  // Journal Brain (Phase 1) · grounding columns surfaced for the inline link
  // chip. The full XP receipt is fetched on-expand via trpc.journal.receipt.
  goalId?: string | null;
  missionId?: string | null;
  linkStatus?: string | null;
  linkConfidence?: number | null;
  linkedGoalTitle?: string | null;
  raw: Record<string, unknown>;
}

export interface FeedCounts {
  /** TRUE DB total for the current filters (count queries) — pre-wave
   *  this was the size of the capped fetch, which lied as soon as any
   *  source exceeded its take. byType stays window-derived (see note). */
  total: number;
  shown: number;
  hasMore: boolean;
  bySource: Record<FeedSource, number>;
  byType: Record<string, number>;
}

export interface JournalFeedView {
  entries: FeedEntry[];
  counts: FeedCounts;
  /** Cursor pagination (feed v2 · audit 2026-07-15): ISO createdAt of
   *  the last returned entry when a full page was served; null = end.
   *  Pass back as `cursor` to fetch the next page. */
  nextCursor: string | null;
  /** Sources whose query failed this request (previously swallowed
   *  silently — the operator saw a plausible-but-incomplete feed with
   *  zero signal). UI shows a degraded banner when non-empty. */
  degraded: FeedSource[];
}

export async function buildJournalFeed(args: {
  limit?: number;
  days?: number;
  type?: string | null;
  source?: string;
  /** Server-side substring search (insensitive) across each silo's
   *  text columns — pre-wave search was client-only over the loaded
   *  window, so archive matches were unreachable. */
  search?: string;
  /** ISO date-time — only rows strictly older are returned. */
  cursor?: string;
}): Promise<JournalFeedView> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const days = Math.min(Math.max(args.days ?? 30, 1), 365);
  const typeFilter = args.type;
  const sourceFilter = args.source || "all";
  const search = args.search?.trim() || null;
  const cursorDate = args.cursor ? new Date(args.cursor) : null;
  const cursorWhere =
    cursorDate && !Number.isNaN(cursorDate.getTime())
      ? { createdAt: { lt: cursorDate } }
      : {};
  const degraded: FeedSource[] = [];
  const swallow =
    (source: FeedSource) =>
    (err: unknown): never[] => {
      degraded.push(source);
      log.warn("feed_source_failed", {
        source,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      return [];
    };
  const ci = "insensitive" as const;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const [brainDumps, reflections, situationLogs, decisions, missionRetros] = await Promise.all([
    sourceFilter === "all" || sourceFilter === "dump"
      ? prisma.brainDump
          .findMany({
            where: {
              date: { gte: cutoffStr },
              // schema.prisma: consumers MUST filter deletedAt — the
              // mission_retro branch below always did; this one didn't,
              // so soft-deleted dumps kept rendering (audit 2026-07-15).
              deletedAt: null,
              ...cursorWhere,
              ...(search
                ? { OR: [{ rawThoughts: { contains: search, mode: ci } }, { summary: { contains: search, mode: ci } }] }
                : {}),
              // Journal Brain · push the type filter to SQL on the real
              // entry_type column. Keep null-column rows (not-yet-enriched /
              // legacy) so the in-memory JSON fallback still classifies them.
              ...(typeFilter && typeFilter !== "all"
                ? { AND: [{ OR: [{ entryType: typeFilter }, { entryType: null }] }] }
                : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit * 2,
          })
          .catch(swallow("dump"))
      : Promise.resolve([]),

    sourceFilter === "all" || sourceFilter === "reflection"
      ? prisma.reflection
          .findMany({
            where: {
              date: { gte: cutoffStr },
              deletedAt: null,
              ...cursorWhere,
              ...(search
                ? { OR: [{ insight: { contains: search, mode: ci } }, { evidence: { contains: search, mode: ci } }] }
                : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
          .catch(swallow("reflection"))
      : Promise.resolve([]),

    sourceFilter === "all" || sourceFilter === "situation"
      ? prisma.situationLog
          .findMany({
            where: {
              createdAt: { gte: cutoff, ...(cursorWhere.createdAt ?? {}) },
              ...(search
                ? { OR: [{ situation: { contains: search, mode: ci } }, { lessonLearned: { contains: search, mode: ci } }] }
                : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit,
            include: {
              law: { select: { book: true, number: true, shortTitle: true } },
            },
          })
          .catch(swallow("situation"))
      : Promise.resolve([]),

    sourceFilter === "all" || sourceFilter === "decision"
      ? prisma.decisionReplay
          .findMany({
            where: {
              createdAt: { gte: cutoff, ...(cursorWhere.createdAt ?? {}) },
              ...(search
                ? {
                    OR: [
                      { title: { contains: search, mode: ci } },
                      { reasoning: { contains: search, mode: ci } },
                      { lesson: { contains: search, mode: ci } },
                    ],
                  }
                : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
          .catch(swallow("decision"))
      : Promise.resolve([]),

    // 2026-05-29 · 5th source · mission_retro BrainMemory rows (written
    // on mission completion). They were embedded + now recall-surfaced
    // in chat, but /journal — the operator's life-review surface — never
    // showed them. Same merge-in-memory pattern as the other 4 silos.
    sourceFilter === "all" || sourceFilter === "retro"
      ? prisma.brainMemory
          .findMany({
            where: {
              category: "mission_retro",
              deletedAt: null,
              createdAt: { gte: cutoff, ...(cursorWhere.createdAt ?? {}) },
              ...(search ? { content: { contains: search, mode: ci } } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
          .catch(swallow("retro"))
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
    // Journal Brain · the real entry_type column (grounded reclassification)
    // wins over the legacy JSON-blob entryType; fall back for unenriched rows.
    const entryType = d.entryType || extracted.entryType || "raw";
    if (typeFilter && typeFilter !== "all" && typeFilter !== entryType) continue;
    feed.push({
      id: d.id,
      source: "dump",
      createdAt: d.createdAt,
      date: d.date,
      entryType,
      title: d.summary ? truncateAtWord(d.summary, 120) : truncateAtWord(d.rawThoughts, 80),
      body: d.rawThoughts,
      summary: d.summary,
      mood: d.moodBefore,
      domains: Array.isArray(extracted.domains) ? extracted.domains : [],
      linkedTopics: Array.isArray(extracted.linkedTopics)
        ? extracted.linkedTopics
        : [],
      tasksCreated: d.actionsTaken,
      goalId: d.goalId,
      missionId: d.missionId,
      linkStatus: d.linkStatus,
      linkConfidence: d.linkConfidence,
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
      title: truncateAtWord(r.insight, 120),
      body: r.insight,
      summary: r.evidence.slice(0, 200),
      mood: null,
      domains: [r.category],
      linkedTopics: [],
      tasksCreated: 0,
      acknowledged: r.acknowledged,
      actionable: r.actionable,
      confidence: r.confidence,
      goalId: r.goalId,
      missionId: r.missionId,
      linkStatus: r.linkStatus,
      linkConfidence: r.linkConfidence,
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
      title: truncateAtWord(s.situation, 120),
      body: s.situation,
      summary: s.aiAnalysis?.slice(0, 200) ?? null,
      mood: s.emotion,
      domains: [s.context],
      linkedTopics: s.law
        ? [`${s.law.book}#${s.law.number}: ${s.law.shortTitle}`]
        : [],
      tasksCreated: 0,
      goalId: s.goalId,
      missionId: s.missionId,
      linkStatus: s.linkStatus,
      linkConfidence: s.linkConfidence,
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
      title: truncateAtWord(d.title, 120),
      body: d.context ?? "",
      summary: d.lesson ?? d.reasoning?.slice(0, 200) ?? null,
      mood: null,
      domains: [],
      linkedTopics: [],
      tasksCreated: 0,
      acknowledged: d.reviewed,
      goalId: d.goalId,
      missionId: d.missionId,
      linkStatus: d.linkStatus,
      linkConfidence: d.linkConfidence,
      raw: d as unknown as Record<string, unknown>,
    });
  }

  for (const m of missionRetros) {
    if (typeFilter && typeFilter !== "all" && typeFilter !== "retro") continue;
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const missionTitle =
      typeof meta.missionTitle === "string" ? meta.missionTitle : "";
    const retroText =
      typeof meta.retroText === "string" ? meta.retroText : m.content;
    feed.push({
      id: m.id,
      source: "retro",
      createdAt: m.createdAt,
      date: m.createdAt.toISOString().split("T")[0],
      entryType: "retro",
      title: (missionTitle ? `Mission retro · ${missionTitle}` : retroText).slice(
        0,
        120,
      ),
      body: retroText,
      summary: missionTitle || null,
      mood: null,
      domains: ["mission"],
      linkedTopics: [],
      tasksCreated: typeof meta.taskCount === "number" ? meta.taskCount : 0,
      confidence: m.confidence,
      raw: m as unknown as Record<string, unknown>,
    });
  }

  // Journal Brain · batch-resolve linked goal titles in ONE query (no N+1) so
  // each entry's chip can show "→ <goal>" without a per-row lookup.
  const goalIds = [...new Set(feed.map((e) => e.goalId).filter((x): x is string => !!x))];
  if (goalIds.length) {
    const goals = await prisma.lifeGoal
      .findMany({ where: { id: { in: goalIds } }, select: { id: true, title: true } })
      .catch((): { id: string; title: string }[] => []);
    const titleById = new Map(goals.map((g) => [g.id, g.title]));
    for (const e of feed) if (e.goalId) e.linkedGoalTitle = titleById.get(e.goalId) ?? null;
  }

  feed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const entries = feed.slice(0, limit);

  // Feed v2 (audit 2026-07-15) · TRUE totals via count queries over the
  // same filters (search/type/source · WITHOUT the cursor, so the total
  // describes the whole filtered set, not the remaining tail). Pre-wave
  // `total` was the capped-fetch size — misleading the moment any
  // source exceeded its take. Failures fall back to the window size
  // (never block the feed on a count).
  const [dumpTotal, reflTotal, sitTotal, decTotal, retroTotal] = await Promise.all([
    sourceFilter === "all" || sourceFilter === "dump"
      ? prisma.brainDump
          .count({
            where: {
              date: { gte: cutoffStr },
              deletedAt: null,
              ...(search
                ? { OR: [{ rawThoughts: { contains: search, mode: ci } }, { summary: { contains: search, mode: ci } }] }
                : {}),
              ...(typeFilter && typeFilter !== "all"
                ? { AND: [{ OR: [{ entryType: typeFilter }, { entryType: null }] }] }
                : {}),
            },
          })
          .catch(() => brainDumps.length)
      : Promise.resolve(0),
    sourceFilter === "all" || sourceFilter === "reflection"
      ? prisma.reflection
          .count({
            where: {
              date: { gte: cutoffStr },
              deletedAt: null,
              ...(search
                ? { OR: [{ insight: { contains: search, mode: ci } }, { evidence: { contains: search, mode: ci } }] }
                : {}),
            },
          })
          .catch(() => reflections.length)
      : Promise.resolve(0),
    sourceFilter === "all" || sourceFilter === "situation"
      ? prisma.situationLog
          .count({
            where: {
              createdAt: { gte: cutoff },
              ...(search
                ? { OR: [{ situation: { contains: search, mode: ci } }, { lessonLearned: { contains: search, mode: ci } }] }
                : {}),
            },
          })
          .catch(() => situationLogs.length)
      : Promise.resolve(0),
    sourceFilter === "all" || sourceFilter === "decision"
      ? prisma.decisionReplay
          .count({
            where: {
              createdAt: { gte: cutoff },
              ...(search
                ? {
                    OR: [
                      { title: { contains: search, mode: ci } },
                      { reasoning: { contains: search, mode: ci } },
                      { lesson: { contains: search, mode: ci } },
                    ],
                  }
                : {}),
            },
          })
          .catch(() => decisions.length)
      : Promise.resolve(0),
    sourceFilter === "all" || sourceFilter === "retro"
      ? prisma.brainMemory
          .count({
            where: {
              category: "mission_retro",
              deletedAt: null,
              createdAt: { gte: cutoff },
              ...(search ? { content: { contains: search, mode: ci } } : {}),
            },
          })
          .catch(() => missionRetros.length)
      : Promise.resolve(0),
  ]);

  // Cursor convention: a full page implies more may exist; the client
  // passes nextCursor back to fetch strictly-older rows.
  const nextCursor =
    entries.length === limit
      ? entries[entries.length - 1].createdAt.toISOString()
      : null;

  const counts: FeedCounts = {
    total: dumpTotal + reflTotal + sitTotal + decTotal + retroTotal,
    shown: entries.length,
    hasMore: nextCursor !== null,
    bySource: {
      dump: dumpTotal,
      reflection: reflTotal,
      situation: sitTotal,
      decision: decTotal,
      retro: retroTotal,
    },
    // byType stays window-derived (real column exists on brain_dumps
    // only; JSON-fallback typing can't be counted in SQL) — these power
    // the filter chips, not the archive total.
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

  return { entries, counts, nextCursor, degraded };
}
