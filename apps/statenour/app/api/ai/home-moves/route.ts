/**
 * /api/ai/home-moves · Wave AC Phase 1B · 2026-05-28.
 *
 * The one-tap-moves shelf for the Sam home page · returns 3 proposed
 * actions:
 *
 *   1. mission_task         · top mission's most-urgent open task
 *   2. relationship_outreach · top of today's relationship picks
 *   3. journal_prompt        · today's journal prompt
 *
 * Heuristic + deterministic · no AI cost (the underlying pick endpoints
 * already cached their AI work). Cached per day so navigation home
 * doesn't re-walk the DB.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/home-moves");
const DAY_MS = 1000 * 60 * 60 * 24;

type MoveKind = "mission_task" | "relationship_outreach" | "journal_prompt";

interface OneTapMove {
  kind: MoveKind;
  title: string;
  rationale: string;
  cta: string;
  href: string;
}

const JOURNAL_PROMPTS = [
  "What compounded today · or what stalled?",
  "Who showed up for me this week · who'd I leave hanging?",
  "What did Nick get right yesterday · what'd he miss?",
  "What's the smallest thing I could ship today?",
  "What am I avoiding · and why?",
];

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // ── Cache check ──
  try {
    const cached = await prisma.brainMemory.findFirst({
      where: { category: BRAIN_CATEGORIES.HOME_MOVES, key: today },
      select: { metadata: true, createdAt: true },
    });
    if (cached?.metadata) {
      const meta = cached.metadata as Record<string, unknown>;
      const moves = meta.moves as OneTapMove[] | undefined;
      if (Array.isArray(moves) && moves.length > 0) {
        return NextResponse.json({
          moves,
          generatedAt: cached.createdAt.toISOString(),
        });
      }
    }
  } catch (err) {
    log.warn("cache_read_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const moves: OneTapMove[] = [];

  // ── Slot 1: top mission task ──
  try {
    const mission = await prisma.mission.findFirst({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: [
        { deadline: "asc" },
        { updatedAt: "desc" },
      ],
      select: { id: true, title: true, deadline: true },
    });
    if (mission) {
      const task = await prisma.task.findFirst({
        where: {
          missionId: mission.id,
          status: { in: ["DOING", "READY", "INBOX"] },
        },
        orderBy: [
          { status: "desc" }, // DOING first (alphabetical desc puts D before R)
          { dueDate: "asc" },
          { autoPriority: { sort: "desc", nulls: "last" } },
        ],
        select: { id: true, title: true, dueDate: true, status: true },
      });
      if (task) {
        let rationale = mission.title;
        if (task.status === "DOING") rationale += " · in flight";
        if (task.dueDate) {
          const due = task.dueDate.getTime();
          const days = Math.round((due - Date.now()) / DAY_MS);
          if (days < 0) rationale += ` · ${Math.abs(days)}d late`;
          else if (days === 0) rationale += " · due today";
          else if (days <= 7) rationale += ` · ${days}d`;
        }
        moves.push({
          kind: "mission_task",
          title: task.title,
          rationale,
          cta: task.status === "DOING" ? "Continue" : "Start",
          href: `/missions#task-${task.id}`,
        });
      }
    }
  } catch (err) {
    log.warn("mission_task_slot_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Slot 2: top relationship pick ──
  try {
    const cachedPicks = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.RELATIONSHIPS_PICKS_TODAY,
        key: today,
      },
      select: { metadata: true },
    });
    const meta = (cachedPicks?.metadata as Record<string, unknown> | null) ?? {};
    const picks = meta.picks as
      | Array<{ personId: string; personName: string; rationale: string }>
      | undefined;
    if (picks && picks.length > 0) {
      const top = picks[0];
      moves.push({
        kind: "relationship_outreach",
        title: `Message ${top.personName}`,
        rationale: top.rationale,
        cta: "Log",
        href: "/people",
      });
    }
  } catch (err) {
    log.warn("relationship_slot_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Slot 3: journal prompt ──
  try {
    // Deterministic-per-day rotation · same operator sees the same
    // prompt all day, gets a fresh one tomorrow.
    const seedHash = today
      .split("")
      .reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const promptIdx = seedHash % JOURNAL_PROMPTS.length;
    const prompt = JOURNAL_PROMPTS[promptIdx];
    moves.push({
      kind: "journal_prompt",
      title: prompt,
      rationale: "today's prompt · 2-3 sentences",
      cta: "Open",
      href: "/journal",
    });
  } catch (err) {
    log.warn("journal_slot_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Cache write ──
  try {
    const existing = await prisma.brainMemory.findFirst({
      where: { category: BRAIN_CATEGORIES.HOME_MOVES, key: today },
      select: { id: true },
    });
    const payload = {
      content: `Home moves for ${today} · ${moves.map((m) => m.kind).join(", ")}`,
      confidence: 0.9,
      source: "tool:home-moves",
      createdBy: "ai" as const,
      metadata: {
        moves,
        generatedAt: new Date().toISOString(),
      } as never,
    };
    if (existing) {
      await prisma.brainMemory.update({
        where: { id: existing.id },
        data: { ...payload, lastSeen: new Date() },
      });
    } else {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.HOME_MOVES,
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

  return NextResponse.json({
    moves,
    generatedAt: new Date().toISOString(),
  });
}
