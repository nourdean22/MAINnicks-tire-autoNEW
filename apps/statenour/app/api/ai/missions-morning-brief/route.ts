/**
 * /api/ai/missions-morning-brief · Wave AA Phase 2 · 2026-05-28.
 *
 * Returns Nick's 1-paragraph synthesis across the operator's active
 * missions. Cached daily in BrainMemory(category=mission_morning_brief)
 * so navigation doesn't refire AI cost.
 *
 * Body: { missions: [{id,title,status,deadline?,domain?}], taskSummary: {open,doing,doneToday,overdue} }
 * Returns: { brief: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/missions-morning-brief");

interface RequestBody {
  missions: Array<{
    id: string;
    title: string;
    status: string;
    deadline?: string | null;
    domain?: string | null;
  }>;
  // AG-40 · optional: the missions header can't always compute pace.
  // Absent = "(unavailable)" in the prompt — never fabricated zeros.
  taskSummary?: {
    open: number;
    doing: number;
    doneToday: number;
    overdue: number;
  };
}

const SYSTEM_PROMPT = `You are an operator's personal-OS coach. Write a ONE
PARAGRAPH morning brief (3-5 sentences · max ~280 chars) synthesizing the
operator's active missions + today's pace. Be concrete and specific to what
matters today.

STRUCTURE:
  · sentence 1: a single sharp framing of where the operator stands
  · sentence 2-4: which mission needs attention + why
  · final sentence: the SINGLE highest-leverage next move ("best move now: X")

CONSTRAINTS:
  · No headers, no lists, no markdown · raw prose only
  · No "good morning" or pleasantries
  · No motivational fluff
  · Mention specific mission titles · not generic phrases
  · Return ONLY the paragraph · no preamble`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ brief: "" }, { status: 200 });
  }

  if (!body.missions || !Array.isArray(body.missions)) {
    return NextResponse.json({ brief: "" }, { status: 200 });
  }

  // ── Cache check · 1 brief per day ──
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = today;
  try {
    const cached = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.MISSION_MORNING_BRIEF,
        key: cacheKey,
      },
      select: { content: true, metadata: true },
    });
    if (cached?.content) {
      const meta =
        (cached.metadata as Record<string, unknown> | null) ?? {};
      const cachedMissionCount = meta.missionCount;
      // Invalidate if the active mission count changed significantly · the
      // brief loses relevance after a mission lands or completes.
      if (
        typeof cachedMissionCount === "number" &&
        Math.abs(cachedMissionCount - body.missions.length) <= 1
      ) {
        return NextResponse.json({ brief: cached.content });
      }
    }
  } catch (err) {
    log.warn("cache_read_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Compose prompt + call Nick ──
  const missionsBlock = body.missions
    .slice(0, 30)
    .map((m, i) => {
      const dueHint = formatDeadline(m.deadline);
      return `${i + 1}. ${m.title}${m.domain ? ` (${m.domain})` : ""}${dueHint ? ` · ${dueHint}` : ""}`;
    })
    .join("\n");

  const userBlock = [
    `ACTIVE MISSIONS (${body.missions.length}):`,
    missionsBlock,
    "",
    body.taskSummary
      ? `TODAY'S PACE: ${body.taskSummary.doneToday} done · ${body.taskSummary.doing} in flight · ${body.taskSummary.open} open · ${body.taskSummary.overdue} overdue`
      : `TODAY'S PACE: (unavailable)`,
  ].join("\n");

  // AG-40 · compose via the shared brief-composer, but with
  // bypassCache: this route's cache has REAL custom semantics the
  // generic composer must not flatten — mission-count invalidation on
  // read (a landed/completed mission stales the brief) and
  // missionCount/taskSummary metadata on write. Cache stays inline;
  // the compose core (scrub, trim, grounding footer) is shared.
  const { composeBrief } = await import("@/lib/ai/brief-composer");
  const brief = await composeBrief({
    label: "missions-morning-brief",
    cacheCategory: BRAIN_CATEGORIES.MISSION_MORNING_BRIEF,
    cacheKey,
    systemPrompt: SYSTEM_PROMPT,
    signalBlock: userBlock,
    taskType: "reason",
    maxChars: 320,
    bypassCache: true,
  });

  if (!brief) {
    return NextResponse.json({ brief: "" });
  }

  // ── Cache write ──
  try {
    const existing = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.MISSION_MORNING_BRIEF,
        key: cacheKey,
      },
      select: { id: true },
    });
    const metadata = {
      missionCount: body.missions.length,
      taskSummary: body.taskSummary,
      generatedAt: new Date().toISOString(),
    };
    if (existing) {
      await prisma.brainMemory.update({
        where: { id: existing.id },
        data: {
          content: brief,
          lastSeen: new Date(),
          metadata: metadata as never,
        },
      });
    } else {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.MISSION_MORNING_BRIEF,
          key: cacheKey,
          content: brief,
          confidence: 0.9,
          source: "tool:missions-morning-brief",
          createdBy: "ai",
          metadata: metadata as never,
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

function formatDeadline(due: string | null | undefined): string {
  if (!due) return "";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "due today";
  if (days <= 7) return `${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
