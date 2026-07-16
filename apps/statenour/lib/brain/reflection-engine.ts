/**
 * Layer 4: Reflection Engine — Meta-cognition across all memory layers.
 *
 * Watches patterns in BrainMemory (L1), ExecutionInsight (L2), KnowledgeDigest (L3),
 * plus DailyScore, BrainDump, Commitments, and DriftAlerts to generate higher-order
 * insights about Nour's behavior over time.
 *
 * Examples of reflections:
 * - "You always drift on Thursdays — energy drops, no workout, loop count spikes."
 * - "When energy < 4 for 2+ days, you skip workouts for the next 3 days."
 * - "You've mentioned 'hiring' in 3 brain dumps this week but taken zero action."
 * - "Quote conversion dropped 15% this month — correlates with fewer follow-up calls."
 * - "Your best weeks share a pattern: workout before 8am + score logged by 10pm."
 *
 * Scopes:
 * - daily: end-of-day analysis (runs in evening cron)
 * - weekly: pattern synthesis across 7 days (runs Sunday)
 * - triggered: real-time when a threshold is crossed
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage · see thinking-engine.ts comment.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("reflection-engine");
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { logError } from "@/lib/utils/error-log";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import {
  recentScoreSnapshots,
  recentDailyHabits,
  recentShopQuotes,
} from "@/lib/brain/legacy-shims";

// ─── Data Gathering ──────────────────────────────────────────

async function gatherDailyContext(daysBack: number = 7) {
  const since = daysAgo(daysBack);
  const sinceDate = toDateString(since);

  const [scores, memories, facts, dumps, commitments, alerts, loops, patterns, habits] =
    await Promise.all([
      // v10.0.55 · scores via legacy-shim (DailyScore retired).
      recentScoreSnapshots(daysBack),
      // v10.0.46 — added `deletedAt: null` filter. Pre-fix the
      // weekly AI reflection prompt was fed deleted memories of any
      // category (retracted beliefs, superseded snapshots), polluting
      // the reflection text.
      prisma.brainMemory.findMany({
        where: { createdAt: { gte: since }, deletedAt: null },
        orderBy: { confidence: "desc" },
        take: 30,
        select: { category: true, content: true, confidence: true, seenCount: true },
      }),
      prisma.executionInsight.findMany({
        where: { createdAt: { gte: since }, insightType: { startsWith: "learned_" } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { insightType: true, title: true },
      }),
      prisma.brainDump.findMany({
        where: { createdAt: { gte: since }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { date: true, summary: true, patterns: true, rawThoughts: true },
      }),
      prisma.commitment.findMany({
        where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
        select: { description: true, status: true, deadline: true },
      }),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          createdAt: { gte: since },
          deletedAt: null,
        },
        select: { content: true, metadata: true, createdAt: true },
      })
      .then((rows) =>
        rows.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          return {
            ruleName: r.content,
            severity: meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning",
            message: typeof meta.body === "string" ? meta.body : "",
            resolved: !!meta.ackedAt,
            createdAt: r.createdAt,
          };
        }),
      )
      .catch((): Array<{ ruleName: string; severity: string; message: string; resolved: boolean }> => []),
      // Apr 18: OpenLoop retired → read Task INBOX/READY/DOING.
      prisma.task
        .findMany({
          where: { status: { in: ["INBOX", "READY", "DOING"] } },
          orderBy: { createdAt: "asc" },
          take: 15,
          select: {
            title: true,
            autoPriority: true,
            createdAt: true,
            mission: { select: { domain: true } },
          },
        })
        .then((rows) =>
          rows.map((t) => ({
            title: t.title,
            priority:
              (t.autoPriority ?? 50) < 20 ? "critical"
              : (t.autoPriority ?? 50) < 40 ? "high"
              : (t.autoPriority ?? 50) < 60 ? "medium"
              : "low",
            domain: t.mission?.domain ?? "general",
            createdAt: t.createdAt,
          })),
        ),
      prisma.patternDetection.findMany({
        where: { date: { gte: sinceDate } },
        orderBy: { date: "desc" },
        take: 10,
        select: { patternName: true, evidence: true, date: true },
      }),
      // v10.0.55 · habits via legacy-shim (HabitLog retired).
      recentDailyHabits(daysBack),
    ]);

  // Business context — pull LIVE from nickstire + local fallback
  let liveShopData: Record<string, unknown> | null = null;
  try {
    const { queryNickBatch } = await import("@/lib/nickstire/query");
    liveShopData = await queryNickBatch([
      { query: "revenue_today" },
      { query: "leads_pipeline" },
      { query: "attention_needed" },
      { query: "bookings_status" },
    ]);
  } catch (err) {
    logError("brain.reflection-engine", err, { fn: "gatherDailyContext.liveShopData" });
  }

  // v10.0.55 · job/lead counts and quote stats currently empty (no
  // bridge query exposes ranged counts yet). The liveShopData block
  // above already pulls today's revenue + leads_pipeline from the
  // bridge for the prompt context. quoteStats projected to the
  // legacy groupBy shape ({ status, _count: { id } }) so the line-
  // formatter at line 225 doesn't need refactor.
  const quotesRaw = await recentShopQuotes(daysBack);
  const quoteStatusCounts = new Map<string, number>();
  for (const q of quotesRaw) {
    quoteStatusCounts.set(q.status, (quoteStatusCounts.get(q.status) ?? 0) + 1);
  }
  // v10.0.529.106 · Wave 58 · cleanup · `jobCount` and `leadCount` were
  // `Promise.resolve(0)` placeholders feeding zeros into the reflection
  // prompt. Now derived from the same recentShopQuotes/Jobs/Leads
  // shape · jobCount counts quotes that converted to invoices, leadCount
  // counts new quotes in the window. quoteStats keeps the previous shape.
  const jobCount = quotesRaw.filter((q) => q.status === "won" || q.status === "completed").length;
  const leadCount = quotesRaw.length; // all quotes in window = leads in
  const quoteStats = [...quoteStatusCounts.entries()].map(([status, count]) => ({
    status,
    _count: { id: count },
  }));

  // Previous reflections (to avoid repeating)
  const recentReflections = await prisma.reflection.findMany({
    where: { createdAt: { gte: daysAgo(14) }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { insight: true, category: true, date: true },
  });

  return {
    scores, memories, facts, dumps, commitments, alerts, loops,
    patterns, habits, jobCount, leadCount, quoteStats, recentReflections,
    liveShopData,
  };
}

// ─── Reflection Generator ─────────────────────────────────────

function formatContext(ctx: Awaited<ReturnType<typeof gatherDailyContext>>): string {
  const lines: string[] = [];

  // Scores
  if (ctx.scores.length > 0) {
    lines.push("## Daily Scores (last 7d)");
    for (const s of ctx.scores) {
      lines.push(`${s.date}: ${s.overallScore}/10 | E${s.energyLevel} F${s.focusQuality} D${s.disciplineScore} | ${s.workoutDone ? "Workout" : "NoWorkout"} | ${s.mood || "?"}`);
    }
  } else {
    lines.push("## Daily Scores: NONE — no scores logged recently");
  }

  // Habits
  if (ctx.habits.length > 0) {
    const habitMap: Record<string, { done: number; total: number }> = {};
    for (const h of ctx.habits) {
      if (!habitMap[h.habitKey]) habitMap[h.habitKey] = { done: 0, total: 0 };
      habitMap[h.habitKey].total++;
      if (h.completed) habitMap[h.habitKey].done++;
    }
    lines.push("## Habit Completion");
    for (const [k, v] of Object.entries(habitMap)) {
      lines.push(`${k}: ${v.done}/${v.total} (${Math.round((v.done / v.total) * 100)}%)`);
    }
  }

  // Memories
  if (ctx.memories.length > 0) {
    lines.push(`## Recent Brain Memories (${ctx.memories.length})`);
    for (const m of ctx.memories.slice(0, 15)) {
      lines.push(`[${m.category}] (${(m.confidence * 100).toFixed(0)}%, seen ${m.seenCount}x) ${m.content.slice(0, 150)}`);
    }
  }

  // Learned facts
  if (ctx.facts.length > 0) {
    lines.push(`## Learned Facts (${ctx.facts.length})`);
    for (const f of ctx.facts.slice(0, 10)) {
      lines.push(`[${f.insightType.replace("learned_", "")}] ${f.title}`);
    }
  }

  // Brain dumps
  if (ctx.dumps.length > 0) {
    lines.push("## Brain Dumps");
    for (const d of ctx.dumps) {
      lines.push(`${d.date}: ${d.summary?.slice(0, 200) || d.rawThoughts?.slice(0, 200) || "empty"}`);
      if (d.patterns) lines.push(`  Patterns: ${d.patterns.slice(0, 150)}`);
    }
  }

  // Drift alerts
  if (ctx.alerts.length > 0) {
    lines.push(`## Drift Alerts (${ctx.alerts.length})`);
    for (const a of ctx.alerts) {
      lines.push(`[${a.severity}] ${a.ruleName}: ${a.message} (${a.resolved ? "resolved" : "ACTIVE"})`);
    }
  }

  // Open loops
  if (ctx.loops.length > 0) {
    lines.push(`## Open Loops (${ctx.loops.length})`);
    for (const l of ctx.loops) {
      const age = Math.floor((Date.now() - l.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      lines.push(`[P${l.priority}] ${l.title} (${l.domain}, ${age}d old)`);
    }
  }

  // Commitments
  if (ctx.commitments.length > 0) {
    lines.push(`## Active Commitments (${ctx.commitments.length})`);
    for (const c of ctx.commitments) {
      lines.push(`- ${c.description} (${c.status}${c.deadline ? `, due ${c.deadline}` : ""})`);
    }
  }

  // Business — live nickstire data + local
  lines.push(`## Business (period)`);
  lines.push(`Local DB — Jobs: ${ctx.jobCount} | Leads: ${ctx.leadCount}`);
  if (ctx.quoteStats.length > 0) {
    lines.push(`Quotes: ${ctx.quoteStats.map((q) => `${q.status}: ${q._count.id}`).join(", ")}`);
  }
  if (ctx.liveShopData) {
    lines.push(`## LIVE Shop Data (from nickstire.org)`);
    const rev = (ctx.liveShopData.revenue_today as any)?.data;
    const pipe = (ctx.liveShopData.leads_pipeline as any)?.data;
    const attn = (ctx.liveShopData.attention_needed as any)?.data;
    const bks = (ctx.liveShopData.bookings_status as any)?.data;
    if (rev) lines.push(`Revenue today: $${rev.totalDollars || 0} (${rev.invoiceCount || 0} jobs)`);
    if (pipe?.pipeline) lines.push(`Lead pipeline: ${JSON.stringify(pipe.pipeline)}`);
    if (attn?.alerts?.length > 0) lines.push(`⚠️ ATTENTION ALERTS: ${attn.alerts.map((a: any) => a.msg).join(" | ")}`);
    if (bks?.statusBreakdown) lines.push(`Booking status: ${JSON.stringify(bks.statusBreakdown)}`);
  }

  // Previous reflections (to avoid repetition)
  if (ctx.recentReflections.length > 0) {
    lines.push("## Previous Reflections (avoid repeating these)");
    for (const r of ctx.recentReflections.slice(0, 5)) {
      lines.push(`${r.date} [${r.category}]: ${r.insight.slice(0, 120)}`);
    }
  }

  return lines.join("\n");
}

// ─── Public API ────────────────────────────────────────────────

export interface ReflectionResult {
  saved: number;
  reflections: { category: string; insight: string; actionable: boolean }[];
}

/**
 * Run daily reflection — analyzes last 7 days, generates 2-4 insights.
 */
export async function runDailyReflection(): Promise<ReflectionResult> {
  const ctx = await gatherDailyContext(7);
  const contextStr = formatContext(ctx);

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Reflection Engine of NOUR OS — Layer 4 of the memory system.
Your job is meta-cognition: find patterns ACROSS data that individual layers miss.

Analyze the data and produce 2-4 reflections. Each reflection must be:
- SPECIFIC (use exact numbers, dates, names)
- CROSS-LAYER (connect data from different sources — scores + habits + brain dumps + business)
- NON-OBVIOUS (don't state what the data already says — find the hidden connection)
- TEMPORAL (show how things change over time — trends, cycles, correlations)

Categories: behavior, business, health, mastery, drift, prediction

Return ONLY a JSON array:
[{ "category": "...", "insight": "...", "evidence": "...", "actionable": true/false }]

Examples of GOOD reflections:
- "Your discipline score drops 2 points on days you skip the WAKE habit. 4/7 days this week had no wake check — directly correlates with the 3-day energy decline."
- "You've mentioned 'hiring a tech' in 3 brain dumps but have zero action items or tasks for it. This open loop is consuming mental bandwidth without progress."
- "Quote conversion is 28% this month (down from estimated 40%). The drop started when follow-up calls stopped — 0 call records this week vs 5 last week."

Examples of BAD reflections (avoid):
- "Energy has been low lately" (too vague, already in scores)
- "Consider working out more" (generic advice, not a pattern)
- "Business is growing" (no evidence or specifics)`,
    },
    { role: "user", content: contextStr },
  ], "reason");

  // Parse response · v10.0.229 extractJsonArray with repair
  const extracted = extractJsonArray<{
    category: string;
    insight: string;
    evidence: string;
    actionable: boolean;
  }>(result.content);
  if (!extracted.ok) return { saved: 0, reflections: [] };

  try {
    const reflections = extracted.value;

    if (!Array.isArray(reflections)) return { saved: 0, reflections: [] };

    const dateStr = today();
    const saved: typeof reflections = [];

    // v9.1.24 · idempotency · was raw create() with no dedup. If
    // the cron fired twice for the same date (restart, retry, flap),
    // both runs created duplicate reflection rows for the same
    // {date, scope, category}. The Reflection model has an
    // idempotencyKey column + unique partial index — wire the
    // recipe through idempotentCreate so the second run finds the
    // existing row and skips.
    const { idempotencyRecipe, idempotentCreate } = await import(
      "@/lib/db/idempotency"
    );

    for (const r of reflections.slice(0, 4)) {
      const category = r.category || "behavior";
      const key = idempotencyRecipe.reflection({
        date: dateStr,
        scope: "daily",
        category,
      });
      await idempotentCreate({
        model: prisma.reflection,
        key,
        data: {
          date: dateStr,
          scope: "daily",
          category,
          insight: r.insight,
          evidence: r.evidence || "",
          confidence: 0.7,
          actionable: !!r.actionable,
          idempotencyKey: key,
        },
      }).catch((err) => {
        logError("brain.reflection-engine", err, { fn: "runDailyReflection.idempotentCreate" });
        return undefined;
      });
      saved.push(r);
    }

    return {
      saved: saved.length,
      reflections: saved.map((r) => ({
        category: r.category,
        insight: r.insight,
        actionable: r.actionable,
      })),
    };
  } catch (err) {
    logError("brain.reflection-engine", err, { fn: "runDailyReflection" });
    return { saved: 0, reflections: [] };
  }
}

/**
 * Run weekly reflection — deeper analysis of 30-day trends.
 */
export async function runWeeklyReflection(): Promise<ReflectionResult> {
  const ctx = await gatherDailyContext(30);
  const contextStr = formatContext(ctx);

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Reflection Engine running a WEEKLY deep analysis.
Look at 30 days of data and find:
1. RECURRING CYCLES — patterns that repeat weekly or biweekly
2. TREND LINES — things getting better, worse, or stagnating
3. PREDICTIONS — based on current trajectory, what happens in 2 weeks?
4. CONTRADICTIONS — where Nour says one thing but data shows another

Return ONLY a JSON array (3-5 reflections):
[{ "category": "...", "insight": "...", "evidence": "...", "actionable": true/false }]

Weekly reflections should be BOLDER and more strategic than daily ones.
Name specific Laws of Power when relevant.`,
    },
    { role: "user", content: contextStr },
  ], "reason");

  const extracted2 = extractJsonArray<{
    category: string; insight: string; evidence: string; actionable: boolean;
  }>(result.content);
  if (!extracted2.ok) return { saved: 0, reflections: [] };

  try {
    const reflections = extracted2.value;

    if (!Array.isArray(reflections)) return { saved: 0, reflections: [] };

    const dateStr = today();
    const saved: typeof reflections = [];

    // v9.1.24 · same idempotency wire-up as runDailyReflection.
    const { idempotencyRecipe, idempotentCreate } = await import(
      "@/lib/db/idempotency"
    );

    for (const r of reflections.slice(0, 5)) {
      const category = r.category || "behavior";
      const key = idempotencyRecipe.reflection({
        date: dateStr,
        scope: "weekly",
        category,
      });
      await idempotentCreate({
        model: prisma.reflection,
        key,
        data: {
          date: dateStr,
          scope: "weekly",
          category,
          insight: r.insight,
          evidence: r.evidence || "",
          confidence: 0.8,
          actionable: !!r.actionable,
          idempotencyKey: key,
        },
      }).catch((err) => {
        logError("brain.reflection-engine", err, { fn: "runWeeklyReflection.idempotentCreate" });
        return undefined;
      });
      saved.push(r);
    }

    return { saved: saved.length, reflections: saved.map((r) => ({ category: r.category, insight: r.insight, actionable: r.actionable })) };
  } catch (err) {
    logError("brain.reflection-engine", err, { fn: "runWeeklyReflection" });
    return { saved: 0, reflections: [] };
  }
}

/**
 * Get recent reflections for the system prompt.
 */
export async function getRecentReflections(limit = 10): Promise<string> {
  try {
    const reflections = await prisma.reflection.findMany({
      where: { confidence: { gte: 0.5 }, deletedAt: null }, // v10.0.68 · system-prompt feeder
      orderBy: [{ actionable: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { date: true, scope: true, category: true, insight: true, actionable: true, acknowledged: true },
    });

    if (reflections.length === 0) return "";

    const lines = reflections.map((r) => {
      const flag = r.actionable && !r.acknowledged ? " ⚡" : "";
      return `[${r.scope}/${r.category}] ${r.insight.slice(0, 250)}${flag}`;
    });

    return `\n## Layer 4 — Self-Reflections (${reflections.length} active)\n${lines.join("\n")}`;
  } catch (err) {
    logError("brain.reflection-engine", err, { fn: "getRecentReflections" });
    return "";
  }
}

/**
 * Get reflection stats for dashboard.
 */
export async function getReflectionStats() {
  try {
    const [total, unacknowledged, byCategory] = await Promise.all([
      prisma.reflection.count({ where: { deletedAt: null } }),
      prisma.reflection.count({ where: { deletedAt: null, actionable: true, acknowledged: false } }),
      prisma.reflection.groupBy({
        by: ["category"],
        where: { deletedAt: null },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
    ]);

    return {
      total,
      unacknowledged,
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count.id })),
    };
  } catch (err) {
    logError("brain.reflection-engine", err, { fn: "getReflectionStats" });
    return { total: 0, unacknowledged: 0, byCategory: [] };
  }
}
