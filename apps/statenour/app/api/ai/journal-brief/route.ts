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

const SYSTEM_PROMPT = `You write a 2-3 sentence brief on the operator's
recent journaling activity. Synthesize across active threads + recent
reflection counts + the OPEN QUESTION the operator hasn't answered yet.

  · sentence 1 · what threads compounded this week (name them) · 1
                  specific number ("you wrote 4 entries in shop-scaling")
  · sentence 2-3 · the open question OR the stalled thread to revisit ·
                    end with one concrete move (e.g. "best move now:
                    answer today's prompt").

SAM-ALTMAN PRINCIPLES TO CHANNEL:
  · "the journal is INPUT" — Nick reads it back so the operator
    doesn't have to scan
  · honesty about abandoned threads — name them, don't varnish
  · compounding daily wins — surface what's compounding

CONSTRAINTS:
  · Max ~300 chars total
  · No headers, no lists, no markdown
  · Mention threads by name when relevant · no generic phrasing
  · Plain prose · no motivational fluff
  · Return ONLY the brief paragraph`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Cache check.
  try {
    const cached = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.JOURNAL_BRIEF,
        key: today,
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

    const [activeThreads, reflectionCount, dumpCount] = await Promise.all([
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

    signalBlock = [
      `ACTIVE_THREADS (${activeThreads.length}):`,
      threadLines.join("\n") || "  (none)",
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
    if (brief.length > 360) brief = brief.slice(0, 360);
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
        key: today,
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
          key: today,
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
