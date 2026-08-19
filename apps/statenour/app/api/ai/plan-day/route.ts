/**
 * /api/ai/plan-day — orchestrated day planner.
 *
 * v6 · BATCH 6 · Apr 28. Pulls everything Nour needs to plan a real
 * day or weekend, runs it through the AI brain, returns a structured
 * plan with cards the UI renders as one-click actions:
 *
 *   1. Active tasks (from Task table) — what's open + priority
 *   2. Today's calendar (from CalendarEvent) — meetings/blocks
 *   3. Recent brain memory (high-importance) — what's top of mind
 *   4. Current weather (existing weather integration) — outdoor work fit
 *   5. Recent commitments (DailyScore + Commitment) — what was promised
 *   6. Industry intel (BATCH 5) — automotive trends worth riffing on
 *
 * Body: { dayLabel?: "today" | "saturday" | "this-week" | iso-date, intent?: string }
 * Returns: {
 *   plan: { period, theme, blocks: PlanBlock[] },
 *   inputs: { taskCount, eventCount, brainCount, ... },
 *   meta: { model, durationMs, tokensUsed }
 * }
 *
 * UI: /plan page (BATCH 6) renders + action-buttons each block.
 */

import { NextResponse } from "next/server";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
// v10.0.529.37 · Arc B F7 expansion · day-plan generator uses
// operator-tuned style so block titles + framing inherit voice tells.
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { prisma } from "@/lib/prisma";
import { trackGeneration } from "@/lib/ai/track";
import { recallIndustryIntel } from "@/lib/automotive/industry-monitor";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// v10.0.184 · was 60s. plan-day uses task="deep" which gets 100s
// provider timeout — 60s couldn't even fit ONE attempt. Bumped to
// 180s for primary + fallback within Vercel Pro budget.
export const maxDuration = 180;

interface PlanBody {
  dayLabel?: "today" | "tomorrow" | "saturday" | "this-week" | string;
  intent?: string;
}

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard

  let body: PlanBody;
  try {
    body = (await req.json()) as PlanBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const dayLabel = body.dayLabel ?? "today";
  const intent = (body.intent ?? "").trim();

  // ── Pull all the inputs in parallel (cheap reads) ──
  const t0 = Date.now();
  const startBoundary = dayBoundaryDate(dayLabel, "start");
  const endBoundary = dayBoundaryDate(dayLabel, "end");
  const [tasks, calendarEvents, brainItems, industry] = await Promise.all([
    prisma.task
      .findMany({
        where: { status: { in: ["INBOX", "READY", "DOING", "WAITING"] } },
        orderBy: [{ autoPriority: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
        take: 30,
        select: { id: true, title: true, autoPriority: true, status: true, dueDate: true },
      })
      .catch(() => [] as Array<{ id: string; title: string; autoPriority: number | null; status: string; dueDate: Date | null }>),
    prisma.auditEvent
      .findMany({
        where: {
          eventType: "calendar_event",
          createdAt: { gte: startBoundary, lte: endBoundary },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: { id: true, detail: true, createdAt: true, payload: true },
      })
      .catch(() => [] as Array<{ id: string; detail: string | null; createdAt: Date; payload: unknown }>),
    prisma.brainMemory
      .findMany({
        where: {
          OR: [
            { category: BRAIN_CATEGORIES.PINNED_USER },
            { category: "commitment" },
            { category: BRAIN_CATEGORIES.FEEDBACK, confidence: { gte: 0.8 } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: { content: true, category: true, source: true },
      })
      .catch(() => [] as Array<{ content: string; category: string; source: string | null }>),
    recallIndustryIntel({ limit: 5, daysBack: 7 }),
  ]);

  // ── Build the plan-input prompt ──
  const today = new Date();
  const dayName = dayBoundaryLabel(dayLabel);
  const promptParts = [
    `Today is ${today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`,
    `Build a structured plan for ${dayName}${intent ? ` with this intent: "${intent}"` : ""}.`,
    "",
    "## CURRENT STATE",
    `Active tasks (${tasks.length}):`,
    ...tasks.slice(0, 15).map(
      (t: { title: string; autoPriority: number | null; dueDate: Date | null }) =>
        `  · ${(t.autoPriority ?? 0) > 70 ? "🔴" : (t.autoPriority ?? 0) > 40 ? "🟡" : "⚪"} ${t.title}${t.dueDate ? ` (due ${t.dueDate.toISOString().split("T")[0]})` : ""}`,
    ),
    "",
    `Calendar for ${dayName} (${calendarEvents.length}):`,
    ...calendarEvents.map(
      (e: { detail: string | null; createdAt: Date }) =>
        `  · ${e.createdAt.toISOString().split("T")[1].slice(0, 5)} — ${e.detail ?? "(unnamed)"}`,
    ),
    "",
    `High-priority brain context (${brainItems.length}):`,
    ...brainItems.slice(0, 8).map((b: { category: string; content: string }) => `  · [${b.category}] ${b.content.slice(0, 200)}`),
    "",
    `Strategic context — recent industry trends:`,
    ...industry.slice(0, 3).map((i: { category: string; title: string }) => `  · [${i.category}] ${i.title.slice(0, 150)}`),
    "",
    "## OUTPUT FORMAT",
    "Return JSON exactly matching this shape (no extra fields, no comments):",
    "```json",
    `{
  "period": "${dayName}",
  "theme": "Two-word theme — e.g. 'Close Loops', 'Build Momentum', 'Reset & Recover'",
  "blocks": [
    {
      "id": "block-1",
      "time": "08:00-09:30",
      "title": "Short title",
      "kind": "deep-work" | "meeting" | "shop" | "personal" | "marketing" | "rest",
      "actions": [
        { "label": "What to do", "type": "task" | "nav" | "capture" | "reminder", "target": "task title or path" }
      ],
      "rationale": "Why this block, in 1 sentence"
    }
  ],
  "antiPatterns": ["What to avoid today, max 3"],
  "winCondition": "What 'today went well' looks like in 1 sentence"
}`,
    "```",
    "",
    "## RULES",
    "- Pull from current state above. Don't invent tasks not on the list.",
    "- Cluster similar work. Match deep-work blocks to 90-min windows. Cluster meetings.",
    "- Cleveland weather + outdoor work fit (winter = inside, spring = mixed).",
    `- ${dayName.toLowerCase().includes("saturday") || dayName.toLowerCase().includes("sunday") ? "Weekend mode: half-pace, lighter blocks, no shop-floor execution." : "Weekday mode: shop-floor execution priority."}`,
    "- Maximum 6 blocks. Most days have 4-5.",
    "- Every block has 1-3 actions tied to a real task or page. Use `target` to link.",
    "",
    "Return ONLY the JSON, no commentary.",
  ];

  const userPrompt = promptParts.join("\n");

  // v10.0.287 · Strategic Frameworks lens injection (9th surface).
  // Day-planning fires Pareto / OKRs / OODA on focus + cadence themes.
  let lensBlock = "";
  try {
    const { pickFrameworks, composeStrategicLensBlock } = await import("@/lib/ai/strategic-frameworks");
    const { recordLensFire } = await import("@/lib/ai/strategic-frameworks/record-lens-fire");
    const lensInput = `${intent ?? ""} · ${userPrompt}`.slice(0, 1200);
    lensBlock = composeStrategicLensBlock(lensInput);
    if (lensBlock) {
      const matches = pickFrameworks(lensInput);
      recordLensFire({ surface: "plan-day", matches, lensBlockLength: lensBlock.length, metadata: { dayLabel } });
    }
  } catch {
    // best-effort · lens injection failures shouldn't break the AI call
  }

  // 2026-05-23 · Wave I · operator-state opt-in (2nd surface after
  // /api/ai/page-insight · ADR-0019/0020). Day planning is the highest-
  // payoff state-aware surface · mood=depleted should produce shorter
  // plans · mood=scattered should compress to fewer blocks · etc.
  let stateBlock = "";
  try {
    const { currentOperatorState, formatOperatorStateBlock } = await import(
      "@/lib/services/operator-state"
    );
    const snap = await currentOperatorState();
    if (snap.confidence > 0) {
      stateBlock = formatOperatorStateBlock(snap);
    }
  } catch {
    // best-effort · state injection failures shouldn't break the AI call
  }

  let result;
  try {
    result = await tracedAiChat(
      { label: "plan-day", source: "tool", metadata: { dayLabel, intent: intent ? intent.slice(0, 80) : null } },
      [
        {
          role: "system",
          content: await applyOperatorStyle(
            "You are Nick — Nour's operator-strategist AI. Build day plans that match how Nour actually works: tight blocks, no fluff, action-tied. Return only JSON." +
              (lensBlock ? `\n\n${lensBlock}` : "") +
              (stateBlock ? `\n\n${stateBlock}` : ""),
          ),
        },
        { role: "user", content: userPrompt },
      ],
      "deep",
    );
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }

  const durationMs = Date.now() - t0;
  void trackGeneration({
    feature: "plan_day",
    model: result.model,
    durationMs,
    status: "complete",
  });

  // Strip code fences + parse
  const cleaned = result.content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
  let plan: unknown = null;
  try {
    plan = JSON.parse(cleaned);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: "model returned non-JSON",
      raw: cleaned.slice(0, 1000),
      parseError: sanitizeError(err),
    }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    plan,
    inputs: {
      taskCount: tasks.length,
      eventCount: calendarEvents.length,
      brainCount: brainItems.length,
      industryCount: industry.length,
    },
    meta: {
      model: result.model,
      provider: result.provider,
      durationMs,
      dayLabel,
    },
  });
}

function dayBoundaryLabel(dayLabel: string): string {
  if (dayLabel === "today") return "today";
  if (dayLabel === "tomorrow") return "tomorrow";
  if (dayLabel === "saturday") return "Saturday";
  if (dayLabel === "this-week") return "this week";
  const parsed = new Date(dayLabel);
  if (isNaN(parsed.getTime())) return "today";
  return parsed.toLocaleDateString("en-US", { weekday: "long" });
}

function dayBoundaryDate(dayLabel: string, edge: "start" | "end"): Date {
  const now = new Date();
  let target: Date;
  if (dayLabel === "today") {
    target = new Date();
  } else if (dayLabel === "tomorrow") {
    target = new Date();
    target.setDate(target.getDate() + 1);
  } else if (dayLabel === "saturday") {
    target = new Date();
    const daysUntilSaturday = (6 - target.getDay() + 7) % 7 || 7;
    target.setDate(target.getDate() + daysUntilSaturday);
  } else if (dayLabel === "this-week") {
    target = now;
  } else {
    target = new Date(dayLabel);
  }
  if (isNaN(target.getTime())) target = now;
  if (edge === "start") {
    target.setHours(0, 0, 0, 0);
  } else {
    target.setHours(23, 59, 59, 999);
    if (dayLabel === "this-week") {
      const daysToSunday = 7 - target.getDay();
      target.setDate(target.getDate() + daysToSunday);
    }
  }
  return target;
}
