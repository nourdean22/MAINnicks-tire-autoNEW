import { generateText } from "ai";
import { getModelWithFallback, getActiveProviderInfo } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { trackGeneration } from "@/lib/ai/track";
import { mintTraceId, recordTrace } from "@/lib/ai/agent-trace";
import { prisma } from "@/lib/prisma";
import { cronHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/weekly-review");

import { daysAgo, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
export const maxDuration = 60;

function getWeekStartMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return toDateString(monday);
}

export const GET = cronHandler(async () => {
  const model = await getModelWithFallback();
  const { provider, modelId } = getActiveProviderInfo();
  const startTime = Date.now();
  // v10 E.5 — every cron-driven AI call gets a trace so the
  // operator can answer "what AI work has run today?" from
  // /system/agent-traces without grepping logs.
  const traceId = mintTraceId();
  const weekAgo = toDateString(daysAgo(7));

  // Apr 19 · DailyScore + MasteryHabit retired. Brain-maturity
  // history + DAILY-task check-offs replace them.
  const [identityHistory, alerts, dailyTasks, commitments, openContradictions, weekDumps, weekReflections, weekTakes] = await Promise.all([
    prisma.brainMemory
      .findMany({
        where: {
          category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
          key: { startsWith: "history:" },
          updatedAt: { gte: new Date(weekAgo) },
        },
        select: { key: true, content: true },
        orderBy: { key: "asc" },
      })
      .catch(() => [] as Array<{ key: string; content: string }>),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          createdAt: { gte: new Date(weekAgo) },
          deletedAt: null,
        },
        select: { content: true, metadata: true, createdAt: true },
      })
      .then((rows) =>
        rows.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          return {
            date: new Date(r.createdAt).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
            ruleName: r.content,
            severity: meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning",
            message: typeof meta.body === "string" ? meta.body : "",
            resolved: !!meta.ackedAt,
          };
        }),
      )
      .catch(() => [] as Array<{ date: string; ruleName: string; severity: string; message: string; resolved: boolean }>),
    prisma.task
      .findMany({
        where: { loopKind: "DAILY", lastCompletedAt: { gte: new Date(weekAgo) } },
        select: { title: true, streakCount: true, lastCompletedAt: true },
      })
      .catch(() => [] as Array<{ title: string; streakCount: number; lastCompletedAt: Date | null }>),
    prisma.commitment.findMany({
      where: {
        OR: [
          { status: { in: ["active", "in_progress"] } },
          { status: "kept", updatedAt: { gte: new Date(weekAgo) } },
          { status: "broken", updatedAt: { gte: new Date(weekAgo) } },
        ],
        deletedAt: null,
      },
      select: { description: true, status: true, deadline: true },
    }),
    prisma.brainMemory
      .count({ where: { category: BRAIN_CATEGORIES.CONTRADICTION, createdAt: { gte: new Date(weekAgo) } } })
      .catch(() => 0),
    // Synthesis wave (audit 2026-07-15) · the review finally reads the
    // JOURNAL. Pre-wave "journal days" was a regex over DAILY task
    // titles (/journal|reflect/) — journaling via capture/Telegram
    // scored 0 — and no journal CONTENT reached the prompt at all.
    prisma.brainDump
      .findMany({
        where: { createdAt: { gte: new Date(weekAgo) }, deletedAt: null },
        select: { date: true, summary: true, rawThoughts: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
      .catch(() => [] as Array<{ date: string; summary: string | null; rawThoughts: string }>),
    prisma.reflection
      .findMany({
        where: { createdAt: { gte: new Date(weekAgo) }, deletedAt: null },
        select: { date: true, insight: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
      .catch(() => [] as Array<{ date: string; insight: string }>),
    prisma.brainMemory
      .findMany({
        where: {
          category: "journal_brain_take",
          createdAt: { gte: new Date(weekAgo) },
          deletedAt: null,
        },
        select: { content: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
      .catch(() => [] as Array<{ content: string }>),
  ]);

  // Parse brain-maturity series
  interface Score { date: string; score: number }
  const scores: Score[] = [];
  for (const row of identityHistory) {
    const date = row.key.replace("history:", "");
    try {
      const snap = JSON.parse(row.content) as { axes: Record<string, { value: number; manual: number | null }> };
      const axes = Object.values(snap.axes ?? {});
      if (axes.length === 0) continue;
      scores.push({ date, score: Math.round(axes.reduce((s, a) => s + (a.manual ?? a.value), 0) / axes.length) });
    } catch {
      // skip
    }
  }
  const avgScore = scores.length > 0
    ? (scores.reduce((sum, s) => sum + s.score, 0) / scores.length).toFixed(1)
    : "N/A";

  // Habit check-offs from DAILY task streaks
  const habitsByTitle = new Map<string, { days: Set<string>; streak: number }>();
  for (const t of dailyTasks) {
    if (!t.lastCompletedAt) continue;
    const ds = new Date(t.lastCompletedAt).toISOString().slice(0, 10);
    const entry = habitsByTitle.get(t.title) ?? { days: new Set(), streak: t.streakCount };
    entry.days.add(ds);
    entry.streak = Math.max(entry.streak, t.streakCount);
    habitsByTitle.set(t.title, entry);
  }
  const workoutDays = Array.from(habitsByTitle.entries())
    .filter(([k]) => /workout|gym|move|exercise/i.test(k))
    .reduce((n, [, v]) => n + v.days.size, 0);
  // Synthesis wave (audit 2026-07-15) · journal days = distinct dates
  // with REAL journal rows (dumps + reflections), not task-title regex.
  const journalDates = new Set<string>();
  for (const d of weekDumps) journalDates.add(d.date);
  for (const r of weekReflections) journalDates.add(r.date);
  const journalDays = journalDates.size;
  const habitSummary = habitsByTitle;

  // Bounded journal content for the prompt: 5 newest entry summaries +
  // the week's AI takes (idea/challenge/nextAction JSON, trimmed).
  const journalLines = [
    ...weekDumps.slice(0, 5).map((d) => `${d.date}: ${(d.summary ?? d.rawThoughts).slice(0, 160)}`),
    ...weekReflections.slice(0, 3).map((r) => `${r.date} (reflection): ${r.insight.slice(0, 160)}`),
  ];
  const takeLines = weekTakes
    .map((t) => {
      try {
        const p = JSON.parse(t.content) as { idea?: string | null; challenge?: string | null; nextAction?: { action?: string } | null };
        return [p.idea, p.challenge, p.nextAction?.action].filter(Boolean).join(" · ").slice(0, 200);
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const systemPrompt = await buildSystemPrompt();

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: `Generate Nour's weekly review for the week of ${getWeekStartMonday()}.

## Brain Maturity (${scores.length}/7 days with snapshot)
${scores.map((s) => `${s.date}: ${s.score}/100`).join("\n") || "No snapshots."}
Week avg: ${avgScore}/100 | Workout days: ${workoutDays} | Journal days: ${journalDays}
${openContradictions > 0 ? `Open contradictions: ${openContradictions}` : "No contradictions flagged."}

## Drift Alerts (${alerts.length} total, ${alerts.filter((a) => !a.resolved).length} unresolved)
${alerts.map((a) => `${a.date} [${a.severity.toUpperCase()}] ${a.ruleName}: ${a.message}`).join("\n") || "None."}

## Habits (from DAILY task streaks)
${[...habitSummary.entries()].map(([k, v]) => `${k}: ${v.days.size}/7 days (streak ${v.streak})`).join("\n") || "No data."}

## Commitments
${commitments.map((c) => `${c.description} — ${c.status}`).join("\n") || "None."}

## Journal (${weekDumps.length} entries · ${weekReflections.length} reflections this week)
${journalLines.join("\n") || "No journal entries this week."}
${takeLines.length ? `AI takes: ${takeLines.join(" | ")}` : ""}

Cover: WINS, MISSES, PATTERNS DETECTED, RECOMMENDED FOCUS FOR NEXT WEEK. Under 400 words. Be direct and evidence-based.`,
  });

  const durationMs = Date.now() - startTime;
  const weekStart = getWeekStartMonday();
  const text = result.text;

  // Parse sections
  const winsMatch = text.match(/WINS[:\s\-—]*\n([\s\S]*?)(?=\n##|\nMISSES|\n\*\*MISSES)/i);
  const missesMatch = text.match(/MISSES[:\s\-—]*\n([\s\S]*?)(?=\n##|\nPATTERNS|\n\*\*PATTERNS)/i);
  const patternsMatch = text.match(/PATTERNS[:\s\-—]*(?:DETECTED)?[:\s\-—]*\n([\s\S]*?)(?=\n##|\nRECOMMENDED|\nFOCUS|\n\*\*RECOMMENDED|\n\*\*FOCUS)/i);
  const focusMatch = text.match(/(?:RECOMMENDED FOCUS|FOCUS FOR NEXT WEEK)[:\s\-—]*\n([\s\S]*?)$/i);

  // v10.0.39 — persist the weekly review. Pre-fix `await Promise.resolve(null as any)`
  // was a dead placeholder; the AI-generated review text + parsed
  // sections were computed but NEVER persisted anywhere. The cron
  // returned only `{ weekStart }`, losing the actual content. Now:
  // upsert into BrainMemory under category `weekly_review` keyed on
  // weekStart so re-runs idempotently overwrite.
  await prisma.brainMemory
    .upsert({
      where: {
        category_key: { category: "weekly_review", key: `weekly:${weekStart}` },
      },
      create: {
        category: "weekly_review",
        key: `weekly:${weekStart}`,
        content: text.slice(0, 8000),
        confidence: 0.95,
        source: "cron:weekly-review",
        metadata: {
          weekStart,
          wins: winsMatch?.[1]?.trim().slice(0, 1500) ?? null,
          misses: missesMatch?.[1]?.trim().slice(0, 1500) ?? null,
          patterns: patternsMatch?.[1]?.trim().slice(0, 1500) ?? null,
          focus: focusMatch?.[1]?.trim().slice(0, 1500) ?? null,
          model: modelId,
          durationMs,
        } as never,
      },
      update: {
        content: text.slice(0, 8000),
        metadata: {
          weekStart,
          wins: winsMatch?.[1]?.trim().slice(0, 1500) ?? null,
          misses: missesMatch?.[1]?.trim().slice(0, 1500) ?? null,
          patterns: patternsMatch?.[1]?.trim().slice(0, 1500) ?? null,
          focus: focusMatch?.[1]?.trim().slice(0, 1500) ?? null,
          model: modelId,
          durationMs,
        } as never,
      },
    })
    .catch((err) => {
      log.error("persist_failed", { err: err instanceof Error ? err.message : String(err) });
    });

  await trackGeneration({
    feature: "cron:weekly-review",
    model: modelId,
    promptTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    durationMs,
    status: "complete",
  });

  // v10 E.5 · agent-trace contract — fire-and-forget
  void recordTrace(
    {
      traceId,
      source: "cron",
      label: "weekly-review",
      provider,
      model: modelId,
      inputChars: 0, // synthetic prompt assembled inline; not measured
      metadata: { weekStart },
    },
    {
      durationMs,
      outputChars: text.length,
    },
  );

  return { weekStart };
});
