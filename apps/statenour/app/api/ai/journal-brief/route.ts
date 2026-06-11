/**
 * /api/ai/journal-brief · Wave AP · 2026-05-28.
 *
 * Sam-Altman frame for /journal · synthesizes the last 14 days of
 * reflection + brain-dump + thread activity into a 2-3 sentence
 * brief Nick speaks to the operator:
 *
 *   "You wrote 6 entries this week · 4 landed in 'shop scaling'
 *    thread (now 11 entries deep). The 'health discipline' thread
 *    has been silent 18 days · worth re-opening? Best move now:
 *    answer today's prompt."
 *
 * Cached daily in BrainMemory(category=journal_brief, key=YYYY-MM-DD).
 * Owner-gated. Mirrors home-brief + goals-brief route pattern.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/journal-brief");
const DAY_MS = 1000 * 60 * 60 * 24;

// Journal-advancement item F (2026-06-10) · brief → OPERATOR DIRECTIVE.
// The old prompt produced a 2-3 sentence narrative summary; this one
// produces a 4-line strategic read Nick hands the operator like a chief
// of staff: compounding · stalled · the pattern · THE move. Grounded in
// real threads + drift + active goals/missions — never invented.
const SYSTEM_PROMPT = `You are Nick — the operator's chief of staff —
writing his journal directive. Read the signals and return EXACTLY 4
lines, each starting with its label:

COMPOUNDING: what is actually compounding (name the thread/goal + one number). If nothing is, say so plainly.
STALLED: the most important stalled thread/goal (name it + days silent). If nothing is stalled, say so.
WATCH: the one pattern in the data worth watching (drift signal, recurring concern, or thread trend).
MOVE: the ONE concrete move today — imperative, specific, doable in under an hour.

RULES:
  · 4 lines, one sentence each · no markdown beyond the labels · max ~420 chars total
  · Direct and strategic. NO therapy voice, NO flattery, NO "you got this".
  · Name threads/goals verbatim from the signals · never invent data.
  · If a signal block is empty, say what's missing — don't fabricate around it.
  · Return ONLY the 4 lines.`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Cache key carries a format version — bumping it (v2 = the 4-line
  // directive format, item F) invalidates stale same-day briefs in the
  // old narrative format the moment the new code deploys.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const cacheKey = `${today}:v2`;

  // Cache check.
  try {
    const cached = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.JOURNAL_BRIEF,
        key: cacheKey,
      },
      select: { content: true },
    });
    if (cached?.content) return NextResponse.json({ brief: cached.content });
  } catch (err) {
    log.warn("cache_read_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Gather journal signal.
  let signalBlock = "";
  try {
    const now = Date.now();
    const fourteenDaysAgo = new Date(now - 14 * DAY_MS);
    const sevenDaysAgo = new Date(now - 7 * DAY_MS);

    // Item F · the directive reads MORE than thread names: drift (what's
    // pulling the operator off course), active goals/missions (what the
    // entries should be advancing), and recent entry summaries (what he
    // actually wrote). All best-effort — a failed source becomes an empty
    // block the prompt is told to acknowledge, never fabricate around.
    const [activeThreads, reflectionCount, dumpCount, drift, goals, missions, recentDumps] =
      await Promise.all([
        prisma.journalThread.findMany({
          where: {
            status: { in: ["active", "dormant"] },
            deletedAt: null,
          },
          orderBy: [{ status: "asc" }, { lastJoinAt: "desc" }],
          take: 10,
          select: {
            name: true,
            status: true,
            summary: true,
            memberCount: true,
            lastJoinAt: true,
          },
        }),
        prisma.reflection.count({
          where: { createdAt: { gte: sevenDaysAgo } },
        }),
        prisma.brainDump.count({
          where: { createdAt: { gte: sevenDaysAgo }, deletedAt: null },
        }),
        import("@/lib/brain/drift-detector")
          .then((m) => m.computeDriftScore())
          .catch(() => null),
        prisma.lifeGoal
          .findMany({
            where: { status: "active", deletedAt: null },
            select: { title: true, domain: true },
            take: 10,
          })
          .catch(() => []),
        prisma.mission
          .findMany({
            where: { status: "ACTIVE" },
            select: { title: true, domain: true },
            take: 10,
          })
          .catch(() => []),
        prisma.brainDump
          .findMany({
            where: { createdAt: { gte: sevenDaysAgo }, deletedAt: null, summary: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { summary: true, createdAt: true },
            take: 8,
          })
          .catch(() => []),
      ]);

    const threadLines = activeThreads.map((t) => {
      const daysSilent = t.lastJoinAt
        ? Math.floor((now - t.lastJoinAt.getTime()) / DAY_MS)
        : null;
      const stall =
        daysSilent !== null && daysSilent > 14 ? ` STALLED:${daysSilent}d` : "";
      const dormant = t.status === "dormant" ? " DORMANT" : "";
      return `  [${t.status}] ${t.name} · ${t.memberCount} entries${stall}${dormant}`;
    });

    const goalLines = goals.map((g) => `  ${g.title} (${g.domain})`);
    const missionLines = missions.map((m) => `  ${m.title} (${m.domain})`);
    const entryLines = recentDumps.map(
      (d) => `  [${d.createdAt.toISOString().slice(5, 10)}] ${(d.summary ?? "").slice(0, 140)}`,
    );

    signalBlock = [
      `ACTIVE_THREADS (${activeThreads.length}):`,
      threadLines.join("\n") || "  (none)",
      "",
      `ACTIVE_GOALS (${goals.length}):`,
      goalLines.join("\n") || "  (none)",
      "",
      `ACTIVE_MISSIONS (${missions.length}):`,
      missionLines.join("\n") || "  (none)",
      "",
      `DRIFT: ${drift ? `${drift.overallScore.toFixed(1)}/10${drift.topConcern ? ` · top concern: ${drift.topConcern}` : ""}` : "(unavailable)"}`,
      "",
      `RECENT_ENTRY_SUMMARIES (last 7d):`,
      entryLines.join("\n") || "  (none)",
      "",
      `REFLECTIONS_7D: ${reflectionCount}`,
      `BRAIN_DUMPS_7D: ${dumpCount}`,
      `FOURTEEN_DAY_WINDOW: ${fourteenDaysAgo.toISOString().slice(0, 10)}`,
    ].join("\n");
  } catch (err) {
    log.warn("signal_gather_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ brief: "" });
  }

  // Compose via tracedAiChat.
  let brief = "";
  try {
    const result = await tracedAiChat(
      { label: "journal-brief", source: "tool" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: signalBlock },
      ],
      "reason",
    );
    brief = (result.content ?? "").trim();
    // 4 labeled lines run longer than the old 1-paragraph brief.
    if (brief.length > 560) brief = brief.slice(0, 560);
  } catch (err) {
    log.warn("brief_generation_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ brief: "" });
  }

  if (!brief) return NextResponse.json({ brief: "" });

  // Cache write · upsert per-day.
  try {
    const existing = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.JOURNAL_BRIEF,
        key: cacheKey,
      },
      select: { id: true },
    });
    const payload = {
      content: brief,
      confidence: 0.9,
      source: "tool:journal-brief",
      createdBy: "ai" as const,
      metadata: { generatedAt: new Date().toISOString() } as never,
    };
    if (existing) {
      await prisma.brainMemory.update({
        where: { id: existing.id },
        data: { ...payload, lastSeen: new Date() },
      });
    } else {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.JOURNAL_BRIEF,
          key: cacheKey,
          ...payload,
        },
      });
    }
  } catch (err) {
    log.warn("cache_write_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ brief });
}
