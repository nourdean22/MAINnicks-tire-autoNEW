/**
 * /api/ai/home-brief · Wave AC Phase 2 · 2026-05-28.
 *
 * Cross-surface synthesis · the Sam home page's lead sentence. Reads
 * mission state · relationship state · recent journal · brain digest
 * markers · returns a 2-3 sentence brief Nick speaks to the operator.
 *
 *   "3 missions in motion · Power Atlas leads at 64%. Manny silent 11d.
 *    Best move now: ship the ErrorBoundary task."
 *
 * Cached daily in BrainMemory(category=home_brief, key=YYYY-MM-DD).
 * Owner-gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/home-brief");
const DAY_MS = 1000 * 60 * 60 * 24;

const SYSTEM_PROMPT = `You write a 2-3 sentence morning brief for an
operator's personal-OS home page. You will receive cross-surface
signal (mission state · relationship state · brain markers · journal
activity). Synthesize into:

  · sentence 1: where the operator stands across all surfaces today
  · sentence 2-3: the 1-2 most important specific signals + one
                  concrete next move ("best move now: X")

CONSTRAINTS:
  · Max ~280 chars total
  · No headers, no lists, no markdown
  · Mention people + missions by name · no generic phrasing
  · Plain prose · no "good morning" / motivational fluff
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
        category: BRAIN_CATEGORIES.HOME_BRIEF,
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

  // Gather cross-surface signal.
  let signalBlock = "";
  try {
    const now = Date.now();
    const [missionBriefCache, relBriefCache, recentLedger, openTasks] =
      await Promise.all([
        prisma.brainMemory.findFirst({
          where: {
            category: BRAIN_CATEGORIES.MISSION_MORNING_BRIEF,
            key: today,
          },
          select: { content: true },
        }),
        prisma.brainMemory.findFirst({
          where: {
            category: BRAIN_CATEGORIES.RELATIONSHIPS_MORNING_BRIEF,
            key: today,
          },
          select: { content: true },
        }),
        prisma.relationshipLedger.count({
          where: { createdAt: { gte: new Date(now - 7 * DAY_MS) } },
        }),
        prisma.task.count({
          where: { status: { in: ["READY", "DOING", "INBOX"] } },
        }),
      ]);

    const lines = [
      missionBriefCache?.content
        ? `MISSIONS_BRIEF: ${missionBriefCache.content.slice(0, 320)}`
        : "MISSIONS_BRIEF: (no cached brief)",
      relBriefCache?.content
        ? `RELATIONSHIPS_BRIEF: ${relBriefCache.content.slice(0, 320)}`
        : "RELATIONSHIPS_BRIEF: (no cached brief)",
      `OPEN_TASKS: ${openTasks}`,
      `LEDGER_TOUCHES_7D: ${recentLedger}`,
    ];
    signalBlock = lines.join("\n");
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
      { label: "home-brief", source: "tool" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: signalBlock },
      ],
      "reason",
    );
    brief = (result.content ?? "").trim();
    if (brief.length > 320) brief = brief.slice(0, 320);
  } catch (err) {
    log.warn("brief_generation_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ brief: "" });
  }

  if (!brief) return NextResponse.json({ brief: "" });

  try {
    const existing = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.HOME_BRIEF,
        key: today,
      },
      select: { id: true },
    });
    const payload = {
      content: brief,
      confidence: 0.9,
      source: "tool:home-brief",
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
          category: BRAIN_CATEGORIES.HOME_BRIEF,
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
