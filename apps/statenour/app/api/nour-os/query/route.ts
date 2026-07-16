import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { timingSafeEqual } from "node:crypto";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/**
 * POST /api/nour-os/query
 *
 * Reciprocal oversight API. Mirrors the contract nickstire exposes at
 * the same path — just pointing the other direction (personal → shop
 * was already wired; this completes the loop so nickstire can pull
 * personal OS state when rendering Nour's admin dashboard).
 *
 * Body: { query: string, filters?: Record<string, unknown> }
 *
 * Auth: STATENOUR_SYNC_KEY via x-sync-key header (same key the
 * nickstire-side fetcher uses — symmetric trust).
 *
 * Queries supported:
 *   • daily_score         — today's energy/focus/discipline + streak
 *   • mit_today           — today's Most Important Thing + status
 *   • backlog_top3        — the 3 sharpest open signals
 *   • inbox_tasks         — { count, top: [...] } for inbox-status Tasks (replaces open_loops)
 *   • drift_alerts        — unacked drift alerts
 *   • recent_reflections  — last 5 reflections with actionable flag
 *   • top_wisdom          — 10 highest-confidence wisdom memories
 *   • commitments         — active commitments with deadlines
 *   • narrator_last       — current narrator voice + headline
 *   • brain_health        — memory counts + vector coverage + confidence
 *   • pulse               — compact single-payload with all key signals
 */

// v10.0.44 — switched from `header === syncKey` to constant-time
// `timingSafeEqual`. Matches the project-wide pattern (lib/auth-
// guard.ts safeEqual, app/api/telegram/webhook timingSafeEqual). On
// a 256-bit secret the timing-leak window is small but the sibling
// /api/webhooks/* surfaces all use timing-safe compare; this brings
// the symmetric-trust surface into the same posture.
function isAuthorized(req: NextRequest): boolean {
  const syncKey = process.env.STATENOUR_SYNC_KEY;
  if (!syncKey) return false;
  const header = req.headers.get("x-sync-key") ?? "";
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(syncKey);
  if (a.length !== b.length) {
    // Constant-time self-compare to keep timing flat then return false.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

type QueryResult = { data: unknown; query: string; timestamp: string };

async function handleQuery(
  query: string,
  filters: Record<string, unknown>
): Promise<QueryResult["data"]> {
  switch (query) {
    case "daily_score": {
      // v10.0.60 · Wave A part 3 · Pre-fix dead Promise.resolve(null/[]).
      // Sourced from identity_snapshot history via legacy-shim
      // (DailyScore retired Apr 19). Streak counts identity-snapshot
      // engagement contiguously back from today.
      const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
      const recent = await recentScoreSnapshots(30);
      const score = recent[0] ?? null;
      let streakDays = 0;
      for (let i = 0; i < recent.length; i++) {
        const expected = new Date(Date.now() - i * 86400000)
          .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        if (recent[i].date === expected) streakDays++;
        else break;
      }
      return { today: score, streakDays };
    }

    case "mit_today": {
      // MIT stored as BrainMemory row — category=mit, key=YYYY-MM-DD
      // (matches the /mit telegram command shape in webhook route).
      const today = todayStr();
      const mit = await prisma.brainMemory.findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.MIT, key: today } },
        select: { content: true, confidence: true, updatedAt: true },
      });
      return mit ? { text: mit.content, confidence: mit.confidence, updatedAt: mit.updatedAt } : null;
    }

    case "backlog_top3": {
      const today = todayStr();
      const yesterday = new Date(Date.now() - 86400000)
        .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const memory = await prisma.brainMemory.findFirst({
        where: {
          category: BRAIN_CATEGORIES.BACKLOG_TRIAGE,
          OR: [
            { key: `top_3_backlog_${today}` },
            { key: `top_3_backlog_${yesterday}` },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { content: true, key: true },
      });
      return memory ?? null;
    }

    case "inbox_tasks":
    case "open_loops": {
      // Formerly `open_loops` — OpenLoop retired Apr 18. Inbox-Tasks
      // are the unified backlog now. Legacy "open_loops" query name
      // still accepted for backwards compat with any nickstire caller.
      const [count, top] = await Promise.all([
        // deletedAt:null — the findMany below always filtered, so this
        // endpoint returned `count: 52` alongside an EMPTY `top` list. The
        // count and the rows it summarizes must query the same population.
        prisma.task.count({ where: { status: "INBOX", deletedAt: null } }),
        prisma.task.findMany({
          where: { status: "INBOX", deletedAt: null },
          orderBy: [{ autoPriority: "asc" }, { lastTouchedAt: "desc" }],
          take: 5,
          select: {
            id: true,
            title: true,
            autoPriority: true,
            effort: true,
            lastTouchedAt: true,
            mission: { select: { title: true, domain: true } },
          },
        }),
      ]);
      return { count, top };
    }

    case "drift_alerts": {
      const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
      const list = await getUnresolvedAlerts().catch(() => []);
      const alerts = list.slice(0, 10).map((a) => ({
        id: a.id,
        ruleName: a.ruleName,
        severity: a.severity,
        message: a.message,
        acknowledged: a.acknowledged,
        createdAt: a.createdAt,
      }));
      return { count: list.length, alerts };
    }

    case "recent_reflections": {
      const reflections = await prisma.reflection.findMany({
        where: { deletedAt: null }, // v10.0.68
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          date: true,
          scope: true,
          category: true,
          insight: true,
          actionable: true,
          acknowledged: true,
          confidence: true,
        },
      });
      return reflections;
    }

    case "top_wisdom": {
      const limit = Math.min(Number(filters.limit ?? 10), 30);
      const wisdom = await prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.WISDOM, confidence: { gte: 0.8 } },
        orderBy: [{ confidence: "desc" }, { seenCount: "desc" }],
        take: limit,
        select: { content: true, confidence: true, seenCount: true, createdAt: true },
      });
      return wisdom;
    }

    case "commitments": {
      const commitments = await prisma.commitment.findMany({
        where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
        orderBy: { deadline: "asc" },
        take: 10,
        select: {
          id: true,
          description: true,
          deadline: true,
          domain: true,
          toWhom: true,
          status: true,
        },
      });
      return { count: commitments.length, commitments };
    }

    case "narrator_last": {
      // Returns the narrator's most recent observation — mirrors the
      // `/api/ultron/narrator` surface but without the wrapper.
      const { generateNarrations } = await import("@/lib/ultron/narrator");
      const narrations = await generateNarrations();
      return narrations[0] ?? null;
    }

    case "brain_health": {
      const [memCount, vecCount, confDist, recentDump] = await Promise.all([
        prisma.brainMemory.count({ where: { deletedAt: null } }),
        prisma.vectorEmbedding.count(),
        prisma.brainMemory.groupBy({
          by: ["category"],
          where: { deletedAt: null },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 8,
        }),
        prisma.brainDump.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      const now = Date.now();
      const lastDumpHours = recentDump
        ? Math.round((now - recentDump.createdAt.getTime()) / 3600_000)
        : null;
      return {
        memoryCount: memCount,
        vectorCount: vecCount,
        topCategories: confDist.map((c) => ({
          category: c.category,
          count: c._count.id,
        })),
        lastBrainDumpHoursAgo: lastDumpHours,
      };
    }

    case "pulse": {
      // One-shot compact payload for nickstire's admin dashboard to
      // render a "personal pulse" card without making 6 round trips.
      const today = todayStr();
      const [score, mit, inboxCount, driftCount, captureCount, lastDump] =
        await Promise.all([
          // v10.0.60 · score → most-recent identity_snapshot row.
          (async () => {
            const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
            const all = await recentScoreSnapshots(1);
            return all[0] ?? null;
          })(),
          prisma.brainMemory.findUnique({
            where: { category_key: { category: BRAIN_CATEGORIES.MIT, key: today } },
            select: { content: true },
          }),
          // OpenLoop count retired Apr 18 — inbox-Task count is the
          // replacement backlog signal.
          prisma.task.count({ where: { status: "INBOX", deletedAt: null } }),
          (async () => {
            const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
            return (await getUnresolvedAlerts().catch(() => [])).length;
          })(),
          prisma.captureInboxItem.count({ where: { status: "active" } }),
          prisma.brainDump.findFirst({
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          }),
        ]);
      return {
        date: today,
        score,
        mit: mit?.content ?? null,
        inboxTasks: inboxCount,
        driftAlerts: driftCount,
        captures: captureCount,
        lastBrainDumpHoursAgo: lastDump
          ? Math.round((Date.now() - lastDump.createdAt.getTime()) / 3600_000)
          : null,
      };
    }

    default:
      throw new Error(`Unknown query: ${query}`);
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { query?: string; filters?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query;
  const filters = body.filters ?? {};
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  try {
    const data = await handleQuery(query, filters);
    return NextResponse.json({
      data,
      query,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Query failed",
        query,
      },
      { status: 400 }
    );
  }
}

/**
 * GET /api/nour-os/query — returns the catalog of supported queries
 * so the nickstire side can render a "what can I ask" panel.
 */
export async function GET() {
  return NextResponse.json({
    data: {
      queries: [
        { name: "daily_score", returns: "today's score + streak days" },
        { name: "mit_today", returns: "today's MIT task or null" },
        { name: "backlog_top3", returns: "raw BrainMemory row for top-3" },
        { name: "inbox_tasks", returns: "count + top 5 (replaces open_loops)" },
        { name: "drift_alerts", returns: "unresolved alerts" },
        { name: "recent_reflections", returns: "last 5 reflections" },
        { name: "top_wisdom", returns: "top confidence wisdom (limit filter)" },
        { name: "commitments", returns: "active commitments" },
        { name: "narrator_last", returns: "latest narrator voice + headline" },
        { name: "brain_health", returns: "memory/vector counts, freshness" },
        { name: "pulse", returns: "compact single-payload personal pulse" },
      ],
      auth: "x-sync-key header · STATENOUR_SYNC_KEY env var",
    },
  });
}
