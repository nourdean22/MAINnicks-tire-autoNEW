/**
 * Attention Pattern Analyzer
 *
 * Tracks WHAT Nour talks about, asks about, and engages with —
 * then compares it to what he SHOULD be engaging with (based on
 * goals, commitments, and system data).
 *
 * The gap between attention and priority = missed opportunities.
 *
 * Outputs:
 * - Top topics Nour focuses on (what he asks Nick about)
 * - Neglected domains (goals he set but never discusses)
 * - Attention drift patterns (shifts in focus over time)
 * - System prompt context for Nick to be aware of attention biases
 */

import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { brainMemory } from "@/lib/brain/memory-manager";
import { logError } from "@/lib/utils/error-log";

interface AttentionProfile {
  topTopics: { topic: string; mentions: number }[];
  neglectedDomains: { domain: string; daysSinceEngagement: number; hasGoal: boolean }[];
  attentionShifts: string[];
  focusScore: number; // 0-100: how aligned is attention with priorities?
  depthAnalysis: { avgMessageLength: number; deepDives: number; quickQuestions: number; actionRatio: number };
  timeOfDayPatterns: { morning: string[]; afternoon: string[]; evening: string[] };
  toolUsage: { tool: string; count: number }[];
  attentionVelocity: number; // -100 to 100: is focus improving or degrading?
}

// Domain keywords for classification
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  revenue: ["revenue", "money", "income", "sales", "invoice", "payment", "profit", "cash", "$"],
  leads: ["lead", "customer", "callback", "follow-up", "followup", "contact", "phone", "call"],
  body: ["workout", "gym", "boxing", "weight", "exercise", "fitness", "health", "sleep"],
  relationship: ["dania", "wife", "marriage", "family", "date", "together"],
  system: ["code", "deploy", "build", "feature", "bug", "api", "database", "server"],
  strategy: ["plan", "goal", "mission", "target", "priority", "strategy", "roadmap"],
  operations: ["shop", "tech", "bay", "staff", "schedule", "inventory", "parts"],
  growth: ["marketing", "seo", "ads", "review", "reputation", "competitor", "expand"],
  mental: ["focus", "energy", "mood", "adhd", "drift", "discipline", "adderall"],
  financial: ["budget", "expense", "debt", "savings", "tax", "accounting"],
};

/**
 * Analyze Nour's recent conversation topics and compare to priorities.
 */
export async function analyzeAttentionPatterns(): Promise<AttentionProfile> {
  const fourteenDaysAgo = daysAgo(14);

  // Get recent conversations
  type MsgRow = { content: string; createdAt: Date };
  const recentMessages = await prisma.chatMessage.findMany({
    where: { role: "user", createdAt: { gte: fourteenDaysAgo } },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  }).catch((): MsgRow[] => []);

  // Get active goals/missions for priority comparison
  const [activeMissions, activeCommitments] = await Promise.all([
    prisma.mission.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { title: true, domain: true },
    }).catch((): never[] => []),
    prisma.commitment.findMany({
      where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
      select: { description: true, domain: true },
    }).catch((): never[] => []),
  ]);

  // Classify messages by domain
  const domainMentions: Record<string, { count: number; lastMentioned: Date }> = {};

  for (const msg of recentMessages) {
    const lower = msg.content.toLowerCase();
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      const hits = keywords.filter((kw) => lower.includes(kw)).length;
      if (hits > 0) {
        if (!domainMentions[domain]) {
          domainMentions[domain] = { count: 0, lastMentioned: msg.createdAt };
        }
        domainMentions[domain].count += hits;
        if (msg.createdAt > domainMentions[domain].lastMentioned) {
          domainMentions[domain].lastMentioned = msg.createdAt;
        }
      }
    }
  }

  // Top topics by mention count
  const topTopics = Object.entries(domainMentions)
    .map(([topic, data]) => ({ topic, mentions: data.count }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 5);

  // Find neglected domains — domains with active goals but no recent attention
  const goalDomains = new Set([
    ...activeMissions.map((m) => m.domain?.toLowerCase() ?? ""),
    ...activeCommitments.map((c) => c.domain?.toLowerCase() ?? ""),
  ].filter(Boolean));

  const neglectedDomains: AttentionProfile["neglectedDomains"] = [];

  for (const domain of Object.keys(DOMAIN_KEYWORDS)) {
    const mention = domainMentions[domain];
    const hasGoal = goalDomains.has(domain);
    const daysSince = mention
      ? Math.floor((Date.now() - mention.lastMentioned.getTime()) / 86400000)
      : 14;

    if (daysSince >= 7 && (hasGoal || daysSince >= 14)) {
      neglectedDomains.push({ domain, daysSinceEngagement: daysSince, hasGoal });
    }
  }

  // Sort by priority (goals with no attention first)
  neglectedDomains.sort((a, b) => {
    if (a.hasGoal && !b.hasGoal) return -1;
    if (!a.hasGoal && b.hasGoal) return 1;
    return b.daysSinceEngagement - a.daysSinceEngagement;
  });

  // Attention shifts — compare week 1 vs week 2
  const sevenDaysAgo = daysAgo(7);
  const weekOneTopics: Record<string, number> = {};
  const weekTwoTopics: Record<string, number> = {};

  for (const msg of recentMessages) {
    const lower = msg.content.toLowerCase();
    const isWeekOne = msg.createdAt >= sevenDaysAgo;

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        if (isWeekOne) weekOneTopics[domain] = (weekOneTopics[domain] ?? 0) + 1;
        else weekTwoTopics[domain] = (weekTwoTopics[domain] ?? 0) + 1;
      }
    }
  }

  const attentionShifts: string[] = [];
  for (const domain of Object.keys(DOMAIN_KEYWORDS)) {
    const w1 = weekOneTopics[domain] ?? 0;
    const w2 = weekTwoTopics[domain] ?? 0;
    if (w1 > w2 * 2 && w1 >= 3) {
      attentionShifts.push(`${domain}: attention surged this week (${w2}→${w1})`);
    } else if (w2 > w1 * 2 && w2 >= 3) {
      attentionShifts.push(`${domain}: attention dropped this week (${w2}→${w1})`);
    }
  }

  // Focus score: how aligned is attention with priorities?
  const totalMentions = Object.values(domainMentions).reduce((s, d) => s + d.count, 0);
  const goalMentions = Object.entries(domainMentions)
    .filter(([domain]) => goalDomains.has(domain))
    .reduce((s, [, d]) => s + d.count, 0);

  const focusScore = totalMentions > 0 ? Math.round((goalMentions / totalMentions) * 100) : 50;

  // ── Depth Analysis ──
  // Classify messages by depth: deep dive (100+ chars) vs quick question (<50 chars)
  const lengths = recentMessages.map(m => m.content.length);
  const avgMessageLength = lengths.length > 0 ? lengths.reduce((s, l) => s + l, 0) / lengths.length : 0;
  const deepDives = recentMessages.filter(m => m.content.length >= 100).length;
  const quickQuestions = recentMessages.filter(m => m.content.length < 50).length;

  // Action ratio: messages that contain action words vs passive questions
  const actionWords = ["do", "create", "build", "deploy", "fix", "send", "call", "schedule", "log", "set", "make", "run", "start", "stop"];
  const questionWords = ["what", "how", "why", "when", "where", "should", "can", "is", "are", "does"];
  let actionCount = 0, questionCount = 0;
  for (const msg of recentMessages) {
    const lower = msg.content.toLowerCase();
    const firstWord = lower.split(/\s+/)[0];
    if (actionWords.some(w => firstWord === w || lower.startsWith(w + " "))) actionCount++;
    if (questionWords.some(w => firstWord === w || firstWord === w + "?")) questionCount++;
  }
  const actionRatio = (actionCount + questionCount) > 0
    ? actionCount / (actionCount + questionCount)
    : 0.5;

  const depthAnalysis = { avgMessageLength: Math.round(avgMessageLength), deepDives, quickQuestions, actionRatio: Math.round(actionRatio * 100) / 100 };

  // ── Time-of-Day Patterns ──
  const morning: Record<string, number> = {};
  const afternoon: Record<string, number> = {};
  const evening: Record<string, number> = {};

  for (const msg of recentMessages) {
    const hour = msg.createdAt.getHours();
    const lower = msg.content.toLowerCase();
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        if (hour >= 5 && hour < 12) morning[domain] = (morning[domain] ?? 0) + 1;
        else if (hour >= 12 && hour < 17) afternoon[domain] = (afternoon[domain] ?? 0) + 1;
        else evening[domain] = (evening[domain] ?? 0) + 1;
      }
    }
  }

  const topByTime = (bucket: Record<string, number>) =>
    Object.entries(bucket).sort(([, a], [, b]) => b - a).slice(0, 3).map(([d]) => d);

  const timeOfDayPatterns = {
    morning: topByTime(morning),
    afternoon: topByTime(afternoon),
    evening: topByTime(evening),
  };

  // ── Tool Usage Tracking ──
  // Check which AI tools Nick actually called recently
  const toolUsage: { tool: string; count: number }[] = [];
  try {
    const toolCalls = await prisma.auditEvent.findMany({
      where: {
        eventType: "tool_call",
        createdAt: { gte: fourteenDaysAgo },
      },
      select: { payload: true },
      take: 200,
    }).catch((): never[] => []);

    const toolCount: Record<string, number> = {};
    for (const tc of toolCalls) {
      const payload = tc.payload as Record<string, unknown> | null;
      const toolName = typeof payload?.tool === "string" ? payload.tool : "unknown";
      toolCount[toolName] = (toolCount[toolName] ?? 0) + 1;
    }

    for (const [tool, count] of Object.entries(toolCount)) {
      toolUsage.push({ tool, count });
    }
    toolUsage.sort((a, b) => b.count - a.count);
  } catch (err) {
    logError("brain.attention-tracker", err, { fn: "analyzeAttentionPatterns.toolUsage" });
  }

  // ── Attention Velocity ──
  // Is focus improving or degrading over the last 30 days?
  // Compare first half (days 8-14) vs second half (days 1-7) focus scores
  const firstHalfGoalMentions = Object.entries(weekTwoTopics)
    .filter(([domain]) => goalDomains.has(domain))
    .reduce((s, [, count]) => s + count, 0);
  const firstHalfTotal = Object.values(weekTwoTopics).reduce((s, v) => s + v, 0);
  const secondHalfGoalMentions = Object.entries(weekOneTopics)
    .filter(([domain]) => goalDomains.has(domain))
    .reduce((s, [, count]) => s + count, 0);
  const secondHalfTotal = Object.values(weekOneTopics).reduce((s, v) => s + v, 0);

  const firstHalfScore = firstHalfTotal > 0 ? (firstHalfGoalMentions / firstHalfTotal) * 100 : 50;
  const secondHalfScore = secondHalfTotal > 0 ? (secondHalfGoalMentions / secondHalfTotal) * 100 : 50;
  const attentionVelocity = Math.round(secondHalfScore - firstHalfScore); // positive = improving

  return { topTopics, neglectedDomains, attentionShifts, focusScore, depthAnalysis, timeOfDayPatterns, toolUsage: toolUsage.slice(0, 5), attentionVelocity };
}

/**
 * Get attention context for system prompt.
 * Lightweight version — runs the analysis only if cached version is stale.
 * Uses the in-memory cache to avoid running 100+ message queries per chat.
 */
export async function getAttentionContext(): Promise<string> {
  const { cached } = await import("@/lib/utils/cache");

  return cached("attention_context", 600, async () => {
    try {
      const profile = await analyzeAttentionPatterns();
      const lines: string[] = [`── ATTENTION ANALYSIS ──`];

      if (profile.topTopics.length > 0) {
        lines.push(`Focus: ${profile.topTopics.map((t) => `${t.topic}(${t.mentions})`).join(", ")}`);
      }
      lines.push(`Alignment: ${profile.focusScore}% | Velocity: ${profile.attentionVelocity > 0 ? "+" : ""}${profile.attentionVelocity}% (${profile.attentionVelocity > 10 ? "improving" : profile.attentionVelocity < -10 ? "degrading" : "stable"})`);

      if (profile.neglectedDomains.length > 0) {
        const neglected = profile.neglectedDomains.slice(0, 3)
          .map((d) => `${d.domain}${d.hasGoal ? " ⚠️HAS GOAL" : ""} (${d.daysSinceEngagement}d silent)`)
          .join(", ");
        lines.push(`Neglected: ${neglected}`);
      }

      // Depth analysis
      const d = profile.depthAnalysis;
      lines.push(`Depth: ${d.deepDives} deep dives, ${d.quickQuestions} quick questions, ${(d.actionRatio * 100).toFixed(0)}% action ratio (${d.actionRatio >= 0.6 ? "executing" : d.actionRatio >= 0.4 ? "balanced" : "mostly asking — push toward action"})`);

      // Time-of-day patterns
      if (profile.timeOfDayPatterns.morning.length > 0 || profile.timeOfDayPatterns.evening.length > 0) {
        const tod = profile.timeOfDayPatterns;
        const parts: string[] = [];
        if (tod.morning.length > 0) parts.push(`AM: ${tod.morning.join(",")}`);
        if (tod.afternoon.length > 0) parts.push(`PM: ${tod.afternoon.join(",")}`);
        if (tod.evening.length > 0) parts.push(`EVE: ${tod.evening.join(",")}`);
        lines.push(`Time patterns: ${parts.join(" | ")}`);
      }

      return lines.join("\n");
    } catch (err) {
      logError("brain.attention-tracker", err, { fn: "getAttentionContext" });
      return "";
    }
  });
}
