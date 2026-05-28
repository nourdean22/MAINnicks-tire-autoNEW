/**
 * /api/ai/goals-brief · Wave AI · 2026-05-28.
 *
 * Sam-Altman frame for /goals · "the ONE thing that, if it worked,
 * would matter 10x more than everything else." Synthesizes Nick's
 * 2-3 sentence brief from the operator's current goals state:
 *
 *   "Tire Shop revenue is on pace at 78%, Power Atlas mastery is
 *    stalled 11d. The ONE move this week: ship Wave AG so the
 *    autopilot loop closes. Stretch · 10x is automation that runs
 *    without you."
 *
 * Cached daily in BrainMemory(category=goals_brief, key=YYYY-MM-DD).
 * Owner-gated. Mirrors home-brief + relationships-morning-brief.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/goals-brief");
const DAY_MS = 1000 * 60 * 60 * 24;

const SYSTEM_PROMPT = `You write a Sam-Altman-shaped 2-3 sentence brief
on the operator's goals state. Synthesize across active LifeGoals,
mastery axes, and recent goal-touch activity into:

  · sentence 1: where the operator stands across the goal portfolio
                · pick 1-2 specific goals + axes (NOT generic phrases)
  · sentence 2-3: name the ONE goal that should compound most this
                  week + the single concrete move ("best move now: X").
                  If a goal is stalled > 14 days, call it out by name.

SAM-ALTMAN PRINCIPLES TO CHANNEL:
  · "what's the ONE thing that, if it worked, would matter 10x more
    than everything else?" — surface that goal explicitly
  · stretch vs minimum · gently surface the 10x version when it's
    farther off than the current pace
  · honesty about stall · no varnishing

CONSTRAINTS:
  · Max ~300 chars total
  · No headers, no lists, no markdown
  · Mention goals + axes by name · no generic phrasing
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
        category: BRAIN_CATEGORIES.GOALS_BRIEF,
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

  // Gather goals signal.
  let signalBlock = "";
  try {
    const now = Date.now();
    const [activeGoals, recentReflections] = await Promise.all([
      prisma.lifeGoal.findMany({
        where: { status: "active", deletedAt: null },
        orderBy: [{ horizon: "asc" }, { progress: "desc" }],
        take: 12,
        select: {
          title: true,
          domain: true,
          horizon: true,
          progress: true,
          currentValue: true,
          targetValue: true,
          unit: true,
          deadline: true,
          updatedAt: true,
        },
      }),
      prisma.reflection.count({
        where: { createdAt: { gte: new Date(now - 7 * DAY_MS) } },
      }),
    ]);

    const goalLines = activeGoals.map((g) => {
      const daysSilent = Math.floor(
        (now - g.updatedAt.getTime()) / DAY_MS,
      );
      const dl = g.deadline
        ? ` deadline:${g.deadline.toISOString().slice(0, 10)}`
        : "";
      const stall = daysSilent > 14 ? ` STALLED:${daysSilent}d` : "";
      return `  [${g.horizon ?? "?"}] ${g.title} · ${Math.round(g.progress)}% · ${g.currentValue}/${g.targetValue}${g.unit ?? ""}${dl}${stall}`;
    });

    signalBlock = [
      `ACTIVE_GOALS (${activeGoals.length}):`,
      goalLines.join("\n") || "  (none)",
      "",
      `REFLECTIONS_7D: ${recentReflections}`,
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
      { label: "goals-brief", source: "tool" },
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
        category: BRAIN_CATEGORIES.GOALS_BRIEF,
        key: today,
      },
      select: { id: true },
    });
    const payload = {
      content: brief,
      confidence: 0.9,
      source: "tool:goals-brief",
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
          category: BRAIN_CATEGORIES.GOALS_BRIEF,
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
