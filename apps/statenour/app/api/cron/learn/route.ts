import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { cronHandler } from "@/lib/utils/http";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/learn — Daily learning digest.
 * Analyzes today's AI interactions and extracts meta-patterns.
 * Scheduled via vercel.json cron.
 */
export const GET = cronHandler(async () => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  // v10.0.39 — anchor at ET midnight, not UTC. Pre-fix
  // `new Date(today)` parsed YYYY-MM-DD as UTC midnight; when the
  // cron ran between midnight and 5am ET, startOfDay was 5h ahead
  // of actual local midnight, silently excluding the prior day's
  // last 5h of interactions. DST-aware offset matches daily-report.
  const isDST = (() => {
    const jan = new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(new Date().getFullYear(), 6, 1).getTimezoneOffset();
    const now = new Date().getTimezoneOffset();
    return now < Math.max(jan, jul);
  })();
  const offset = isDST ? "-04:00" : "-05:00";
  const startOfDay = new Date(`${today}T00:00:00${offset}`);

  // Get today's AI interactions
  const todayGenerations = await prisma.aiGeneration.findMany({
    where: { createdAt: { gte: startOfDay } },
    select: { feature: true, model: true, durationMs: true },
  });

  // Get today's learned facts
  const todayFacts = await prisma.executionInsight.findMany({
    where: {
      insightType: { startsWith: "learned_" },
      createdAt: { gte: startOfDay },
    },
    select: { title: true, insightType: true },
  });

  // Get recent brain dumps for pattern analysis
  const recentDumps = await prisma.brainDump.findMany({
    where: { deletedAt: null }, // v10.0.68
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { rawThoughts: true, patterns: true },
  });

  // Pull live shop data for business learning
  let shopContext = "";
  try {
    const { queryNickBatch } = await import("@/lib/nickstire/query");
    const live = await queryNickBatch([
      { query: "revenue_today" },
      { query: "attention_needed" },
      { query: "leads_today" },
    ]);
    const rev = (live.revenue_today as any)?.data;
    const attn = (live.attention_needed as any)?.data;
    const leads = (live.leads_today as any)?.data;
    const parts: string[] = [];
    if (rev) parts.push(`Revenue: $${rev.totalDollars || 0} (${rev.invoiceCount || 0} jobs)`);
    if (attn?.alerts?.length > 0) parts.push(`Alerts: ${attn.alerts.map((a: any) => a.msg).join("; ")}`);
    if (leads?.count) parts.push(`New leads today: ${leads.count}`);
    if (parts.length > 0) shopContext = `\n- LIVE shop data: ${parts.join(" | ")}`;
  } catch {}

  if (todayGenerations.length === 0 && todayFacts.length === 0 && !shopContext) {
    return { message: "No interactions today — nothing to learn" };
  }

  // v10.0.69 — replaced manual mintTraceId+recordTrace with tracedAiChat
  // wrapper. Same observability, no boilerplate; matches the
  // makeTracedAiChat factory pattern used by every other cron AI call.
  const result = await tracedAiChat(
    {
      label: "learn-daily-digest",
      source: "cron",
      metadata: {
        date: today,
        interactions: todayGenerations.length,
        factsLearned: todayFacts.length,
      },
    },
    [
      {
        role: "system",
        content: `You are the learning engine for NOUR OS. Analyze today's AI usage + business activity to find meta-patterns. Focus on:
1. What topics dominated today (what's on his mind?)
2. Energy/productivity patterns (when was he most active?)
3. Business performance signals (revenue pacing, lead response speed, estimate follow-up)
4. Behavioral signals (drift, focus, motivation, pattern breaks)
5. Correlations between personal state and business performance
Return a concise 5-7 sentence analysis. Be SPECIFIC with numbers, not generic.`,
      },
      {
        role: "user",
        content: `Today's stats:
- ${todayGenerations.length} AI interactions across features: ${[...new Set(todayGenerations.map((g) => g.feature))].join(", ")}
- ${todayFacts.length} new learned facts: ${todayFacts.map((f) => f.title).join("; ")}
- Recent brain dump themes: ${recentDumps.map((d) => d.patterns || d.rawThoughts?.slice(0, 100)).join(" | ")}${shopContext}`,
      },
    ],
    "reason",
  );

  // Store as a pattern detection
  await prisma.patternDetection.create({
    data: {
      date: today,
      patternId: `daily-learn-${today}`,
      patternName: "Daily AI Learning Digest",
      triggerDesc: `${todayGenerations.length} interactions, ${todayFacts.length} facts extracted`,
      evidence: result.content,
    },
  });

  return {
    interactions: todayGenerations.length,
    factsLearned: todayFacts.length,
    digest: result.content,
  };
});
