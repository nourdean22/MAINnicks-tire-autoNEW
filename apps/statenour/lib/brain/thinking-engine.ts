/**
 * The Thinking Engine — Layers 7-12 of the Memory Tree
 *
 * This is what makes the memory THINK, not just store and pattern-match.
 * It powers 6 specialized branch layers that grow from the trunk (L1-L6):
 *
 * Branch A: Self-Awareness (from L4 Reflective)
 *   L7: Contradiction Detector — "You say X but data shows Y"
 *   L8: Identity Evolution — "You're becoming more X, less Y"
 *
 * Branch B: Foresight (from L5 Predictive)
 *   L9: Simulation Engine — "If you do X, then Y→Z→W happens"
 *   L10: Causal Engine — "This pattern repeats BECAUSE of root cause X"
 *
 * Branch C: Social Intelligence (from L6 Relational)
 *   L11: People Intelligence — deep profiles, trust scores, leverage
 *   L12: Environmental Awareness — market, weather, competition, seasonal
 *
 * The engine runs as a unified cron — each branch analyzes independently
 * but all share the same data foundation. Results feed back into Nick AI.
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage · auto-trace every aiChat call from
// this module under label "thinking-engine" (source="brain") so
// /system/agent-traces shows cost + latency + error class per turn.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("thinking-engine");
import { extractJsonArray, extractJsonObject } from "@/lib/ai/extract-structured";
import { logError } from "@/lib/utils/error-log";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  recentScoreSnapshots,
  recentDailyHabits,
  recentShopJobs,
  recentShopLeads,
  recentShopQuotes,
} from "@/lib/brain/legacy-shims";

// ─── L7: Contradiction Detector ──────────────────────────

export async function detectContradictions(): Promise<{ found: number }> {
  // Gather what Nour claims vs what data shows
  // v10.0.55 · scores + habits sourced via legacy-shims (DailyScore +
  // HabitLog retired; identity_snapshot + DAILY-tasks now provide).
  const [scores, habits, commitments, dumps, memories] = await Promise.all([
    recentScoreSnapshots(14),
    recentDailyHabits(14),
    // v9.1.15 · added deletedAt:null on all three. Soft-deleted rows
    // were leaking into thinking-engine context and skewing identity
    // analysis with rows the operator had already pruned.
    prisma.commitment.findMany({ where: { deletedAt: null, status: { in: ["active", "in_progress"] } }, select: { description: true, deadline: true, status: true } }),
    prisma.brainDump.findMany({ where: { deletedAt: null, createdAt: { gte: daysAgo(14) } }, orderBy: { createdAt: "desc" }, take: 5, select: { rawThoughts: true, summary: true } }),
    prisma.brainMemory.findMany({ where: { deletedAt: null, category: { in: ["preference", "pattern", "insight"] }, confidence: { gte: 0.5 } }, take: 20, select: { category: true, content: true } }),
  ]);

  const context = [
    `Daily scores (14d): ${scores.map(s => `${s.date}: ${s.overallScore}/10 D${s.disciplineScore} ${s.workoutDone ? "workout" : "no-workout"}`).join(", ")}`,
    `Habits: ${habits.filter(h => h.completed).length}/${habits.length} completed`,
    `Active commitments: ${commitments.map(c => `"${c.description.slice(0, 60)}" (${c.status}${c.deadline ? `, due ${c.deadline}` : ""})`).join("; ")}`,
    `Brain dumps: ${dumps.map(d => (d.summary || d.rawThoughts || "").slice(0, 150)).join(" | ")}`,
    `Memories: ${memories.map(m => `[${m.category}] ${m.content.slice(0, 80)}`).join("; ")}`,
  ].join("\n");

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Contradiction Detector — Layer 7 of the NOUR OS memory tree.
Find places where Nour's STATED beliefs, goals, or self-image CONFLICT with what the data actually shows.

Return ONLY a JSON array of contradictions:
[{ "claim": "what he says/believes", "reality": "what data shows", "gap": "the specific discrepancy", "severity": "mild|moderate|severe|critical", "category": "identity|business|health|commitment|habit" }]

GOOD contradictions:
- claim: "I'm disciplined", reality: "Discipline score averaged 3.1/10 for 14 days", severity: "severe"
- claim: "I follow up on every lead", reality: "0 follow-up calls logged this week", severity: "critical"
- claim: "Exercise is my priority", reality: "2 workouts in 14 days", severity: "moderate"

Return [] if no contradictions found. Max 4.`,
    },
    { role: "user", content: context },
  ], "reason");

  // v10.0.229 · shared extractor with repair pass
  const extracted = extractJsonArray<{ claim: string; reality: string; gap: string; severity: string; category: string }>(result.content);
  if (!extracted.ok) return { found: 0 };
  const contradictions = extracted.value;
  if (!Array.isArray(contradictions)) return { found: 0 };

  for (const c of contradictions.slice(0, 4)) {
    await prisma.contradiction.create({
      data: { date: today(), claim: c.claim, reality: c.reality, gap: c.gap, severity: c.severity || "moderate", category: c.category || "identity", claimSource: "ai_detected" },
    }).catch((err) => {
      logError("brain.thinking-engine", err, { fn: "detectContradictions.create" });
    });
  }
  return { found: contradictions.length };
}

// ─── L8: Identity Evolution ──────────────────────────────

export async function trackIdentityEvolution(): Promise<{ tracked: boolean }> {
  // v10.0.55 · scores + habits via legacy-shims.
  const [scores, habits, decisions, reflections, contradictions] = await Promise.all([
    recentScoreSnapshots(30),
    recentDailyHabits(30),
    prisma.masteryDecision.findMany({ where: { deletedAt: null, createdAt: { gte: daysAgo(30) } }, take: 10, select: { title: true, stakes: true, grade: true } }),
    prisma.reflection.findMany({ where: { deletedAt: null, createdAt: { gte: daysAgo(30) } }, take: 10, select: { insight: true, category: true } }),
    prisma.contradiction.findMany({ where: { createdAt: { gte: daysAgo(30) } }, take: 5, select: { claim: true, gap: true } }),
  ]);

  const lastSnapshot = await prisma.identitySnapshot.findFirst({ where: { deletedAt: null }, orderBy: { date: "desc" } });

  const context = [
    `Scores (30d avg): overall ${(scores.reduce((s, r) => s + (r.overallScore ?? 0), 0) / Math.max(scores.length, 1)).toFixed(1)}, discipline ${(scores.reduce((s, r) => s + (r.disciplineScore ?? 0), 0) / Math.max(scores.length, 1)).toFixed(1)}`,
    `Habits: ${habits.filter(h => h.completed).length}/${habits.length}`,
    `Decisions: ${decisions.map(d => `"${d.title}" (${d.stakes}, grade: ${d.grade || "?"})`).join("; ")}`,
    `Reflections: ${reflections.map(r => r.insight.slice(0, 80)).join("; ")}`,
    `Contradictions: ${contradictions.map(c => c.gap.slice(0, 80)).join("; ")}`,
    lastSnapshot ? `Last snapshot: ${lastSnapshot.trajectory.slice(0, 200)}` : "No previous snapshot",
  ].join("\n");

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Identity Evolution Tracker — Layer 8 of the NOUR OS memory tree.
Based on 30 days of behavioral data, produce a snapshot of WHO Nour is right now — not who he says he is, but who the DATA shows he is.

Return ONLY JSON:
{
  "coreValues": { "discipline": 0.0-1.0, "creativity": 0.0-1.0, "consistency": 0.0-1.0, "ambition": 0.0-1.0, "honesty": 0.0-1.0 },
  "strengths": ["strength 1 with evidence", "strength 2"],
  "blindSpots": ["blind spot 1 with evidence", "blind spot 2"],
  "trajectory": "One paragraph: who is Nour becoming? What direction is the trend?",
  "deltaFromLast": "What changed since the last snapshot?",
  "masterySelf": 0.0-10.0
}

Score values ONLY from data, not from claims. 0.0 = no evidence, 1.0 = overwhelming evidence.`,
    },
    { role: "user", content: context },
  ], "reason");

  // Use any-typed result · prisma create expects a specific input
  // shape that's not worth duplicating here. The repair pass still
  // applies; we just don't lose type erasure on snapshot fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extracted = extractJsonObject<any>(result.content);
  if (!extracted.ok) return { tracked: false };

  try {
    const snapshot = extracted.value;
    const todayStr = today();
    const data = {
      coreValues: snapshot.coreValues || {},
      strengths: snapshot.strengths || [],
      blindSpots: snapshot.blindSpots || [],
      trajectory: snapshot.trajectory || "No trajectory detected",
      deltaFromLast: snapshot.deltaFromLast || null,
      masterySelf: snapshot.masterySelf || 0,
    };
    // v7.9 · Apr 29 — IdentitySnapshot.date is no longer @unique (the
    // soft-delete pattern needs to support "redo today" by hiding the
    // prior alive row). Daily-uniqueness is now app-side: find the
    // alive row for today, update it; if none, create a new one.
    const existing = await prisma.identitySnapshot.findFirst({
      where: { date: todayStr, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.identitySnapshot.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.identitySnapshot.create({
        data: { date: todayStr, ...data },
      });
    }
    return { tracked: true };
  } catch (err) {
    logError("brain.thinking-engine", err, { fn: "trackIdentityEvolution" });
    return { tracked: false };
  }
}

// ─── L9: Simulation Engine ───────────────────────────────

export async function runSimulation(scenario: string): Promise<{ id: string } | null> {
  // v10.0.529.106 · Wave 58 · cleanup · the legacy `jobs` and `leads`
  // slots were `Promise.resolve(0)` placeholders that fed structurally-
  // corrupted zeros into the AI context string ("0 jobs last 30d ·
  // 0 leads"). The bridge doesn't expose those rolling totals directly,
  // and the AI was making simulation calls believing the operator had
  // zero business activity. Dropped from the parallel + context string
  // · the financial snapshot + score average already give the model
  // enough state to simulate against.
  const [financial, scores] = await Promise.all([
    prisma.financialSnapshot.findFirst({ orderBy: { date: "desc" }, select: { businessRevenue: true, ownerTakeHome: true, totalDebt: true } }),
    recentScoreSnapshots(30),
  ]);

  const context = `Current state: Revenue $${financial?.businessRevenue || "?"}/mo, Take-home $${financial?.ownerTakeHome || "?"}, Debt $${financial?.totalDebt || "?"}. Avg score: ${(scores.reduce((s, r) => s + (r.overallScore ?? 0), 0) / Math.max(scores.length, 1)).toFixed(1)}/10.`;

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Simulation Engine — Layer 9 of the NOUR OS memory tree.
Given a scenario, simulate the CASCADE of consequences — what happens step by step.

Return ONLY JSON:
{
  "assumptions": ["key assumption 1", "key assumption 2"],
  "cascade": [{ "step": 1, "outcome": "...", "probability": 0.0-1.0, "timeframe": "1 week" }],
  "bestCase": "Best realistic outcome",
  "worstCase": "Worst realistic outcome",
  "recommendation": "What the strategist would do",
  "confidence": 0.0-1.0
}

Think 3-5 steps deep. Each step's outcome feeds the next. Be specific with numbers.`,
    },
    { role: "user", content: `Scenario: "${scenario}"\n\n${context}` },
  ], "deep");

  const extracted = extractJsonObject<Record<string, unknown>>(result.content);
  if (!extracted.ok) return null;

  try {
    const sim = extracted.value;
    // v10.0.46 — pre-fix `await Promise.resolve(null as any)` then
    // `return { id: record.id }` threw TypeError on every call
    // (record is null → .id access fails). The outer catch
    // swallowed it so `runSimulation` silently returned `null` for
    // its entire production lifetime. Now persists to BrainMemory
    // (where other engine outputs live) and returns the real id.
    const { brainMemory } = await import("./memory-manager");
    const key = `simulation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const stored = await brainMemory.remember(
      "simulation",
      key,
      JSON.stringify(sim),
      "thinking-engine",
    );
    return stored ? { id: stored.id ?? key } : { id: key };
  } catch (err) {
    logError("brain.thinking-engine", err, { fn: "runSimulation" });
    return null;
  }
}

// ─── L10: Causal Engine ──────────────────────────────────

export async function analyzeCausalChains(): Promise<{ chains: number }> {
  const [patterns, reflections, contradictions, alerts] = await Promise.all([
    prisma.patternDetection.findMany({ orderBy: { date: "desc" }, take: 15, select: { patternName: true, evidence: true } }),
    prisma.reflection.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 10, select: { insight: true, category: true } }),
    prisma.contradiction.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { claim: true, reality: true, gap: true } }),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        select: { content: true, metadata: true },
        take: 30,
      })
      .then((rows) => {
        const unresolved = rows.filter((e) => {
          const meta = (e.metadata ?? {}) as Record<string, unknown>;
          return !meta.ackedAt;
        });
        return unresolved.slice(0, 10).map((e) => {
          const meta = (e.metadata ?? {}) as Record<string, unknown>;
          return {
            ruleName: e.content,
            message: typeof meta.body === "string" ? meta.body : "",
          };
        });
      })
      .catch((err): Array<{ ruleName: string; message: string }> => {
        logError("brain.thinking-engine", err, { fn: "analyzeCausalChains.fetchAlerts" });
        return [];
      }),
  ]);

  const existing = await prisma.causalChain.findMany({ take: 10, select: { effect: true, rootCause: true } });

  const context = [
    `Patterns: ${patterns.map(p => p.patternName).join(", ")}`,
    `Reflections: ${reflections.map(r => r.insight.slice(0, 100)).join("; ")}`,
    `Contradictions: ${contradictions.map(c => c.gap.slice(0, 80)).join("; ")}`,
    `Active drift alerts: ${alerts.map(a => `${a.ruleName}: ${a.message.slice(0, 60)}`).join("; ")}`,
    `Existing chains: ${existing.map(e => `"${e.effect.slice(0, 50)}" ← "${e.rootCause.slice(0, 50)}"`).join("; ")}`,
  ].join("\n");

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Causal Engine — Layer 10 of the NOUR OS memory tree.
Find ROOT CAUSES behind repeating patterns. Don't just name the pattern — trace WHY it fires.

Return ONLY a JSON array:
[{
  "effect": "The observable pattern/problem",
  "rootCause": "The deepest why (not the surface reason)",
  "chain": [{ "cause": "...", "effect": "...", "evidence": "..." }],
  "intervention": "What could break this causal chain"
}]

GOOD causal chain:
effect: "Skips workouts 3+ days"
chain: [
  { cause: "Late-night system building", effect: "Sleep deficit", evidence: "Brain dumps at 1-2am" },
  { cause: "Sleep deficit", effect: "Low morning energy", evidence: "Energy scores 2-3/10" },
  { cause: "Low energy", effect: "Skips gym", evidence: "0 workouts when energy < 4" }
]
rootCause: "Dopamine-seeking through system building replaces the discipline of sleep"
intervention: "Hard shutdown at 11pm. No screens. The system will be there tomorrow."

Max 3 chains. Skip if no clear causal pattern exists.`,
    },
    { role: "user", content: context },
  ], "reason");

  const extracted = extractJsonArray<{ effect: string; rootCause: string; chain: unknown[]; intervention: string }>(result.content);
  if (!extracted.ok) return { chains: 0 };

  try {
    const chains = extracted.value;
    if (!Array.isArray(chains)) return { chains: 0 };

    for (const c of chains.slice(0, 3)) {
      // Check if this chain already exists (by similar effect)
      const existing = await prisma.causalChain.findFirst({
        where: { effect: { contains: c.effect.slice(0, 30) } },
      });

      if (existing) {
        await prisma.causalChain.update({
          where: { id: existing.id },
          data: { frequency: { increment: 1 }, lastSeen: new Date(), chain: c.chain as any, intervention: c.intervention },
        });
      } else {
        await prisma.causalChain.create({
          data: { date: today(), effect: c.effect, rootCause: c.rootCause, chain: c.chain as any, intervention: c.intervention },
        });
      }
    }
    return { chains: chains.length };
  } catch (err) {
    logError("brain.thinking-engine", err, { fn: "analyzeCausalChains" });
    return { chains: 0 };
  }
}

// ─── L11: People Intelligence ────────────────────────────
// (Populated through chat interactions and manual input — not auto-generated)

// ─── L12: Environmental Awareness ────────────────────────

export async function scanEnvironment(): Promise<{ signals: number }> {
  // v10.0.55 · shop reads via legacy-shims (currently empty; no
  // bridge query exposes ranged jobs/leads/quotes lists).
  const [jobs, leads, quotes] = await Promise.all([
    recentShopJobs(30),
    recentShopLeads(30),
    recentShopQuotes(30),
  ]);

  // Detect seasonal patterns
  const month = new Date().getMonth(); // 0-11
  const seasonalContext = month >= 10 || month <= 2 ? "winter (tire season, battery failures, salt damage)" :
    month >= 3 && month <= 4 ? "spring (pothole damage, alignment, AC prep)" :
    month >= 5 && month <= 7 ? "summer (AC repair, road trips, tire blowouts)" :
    "fall (winter prep, brake checks, coolant flush)";

  const dayOfWeek = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });

  const context = [
    `Season: ${seasonalContext}`,
    `Day: ${dayOfWeek}`,
    // Apr 18: Job/Lead/Quote are retired-model shims returning any[];
    // typed as Record<string, number> and inline-typed iterables so the
    // arithmetic + set operations below compile.
    `Jobs last 30d: ${jobs.length}. Top services: ${Object.entries(
      (jobs as Array<{ serviceCategory: string }>).reduce(
        (acc, j) => { acc[j.serviceCategory] = (acc[j.serviceCategory] || 0) + 1; return acc; },
        {} as Record<string, number>,
      ),
    ).sort((a: [string, number], b: [string, number]) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join(", ")}`,
    `Leads: ${leads.length}. Sources: ${[...new Set((leads as Array<{ source: string }>).map(l => l.source))].join(", ")}`,
    `Quote conversion: ${(quotes as Array<{ status: string }>).filter(q => q.status === "booked").length}/${quotes.length}`,
  ].join("\n");

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Environmental Awareness system — Layer 12 of the NOUR OS memory tree.
Analyze external factors that affect Nick's Tire & Auto and Nour's life.

Return ONLY a JSON array of environmental signals:
[{
  "category": "seasonal|market|competition|weather|economy|regulation",
  "signal": "What's happening externally",
  "impact": "How it affects the shop or Nour",
  "urgency": "low|medium|high|critical",
  "actionable": true/false
}]

Think about: seasonal demand shifts, weather patterns for Cleveland, economic conditions,
competitive landscape, regulatory changes (Ohio E-Check, emissions), industry trends.
Max 3 signals.`,
    },
    { role: "user", content: context },
  ], "fast");

  const extracted = extractJsonArray<{ category: string; signal: string; impact: string; urgency: string; actionable: boolean }>(result.content);
  if (!extracted.ok) return { signals: 0 };
  const signals = extracted.value;
  if (!Array.isArray(signals)) return { signals: 0 };

  // EnvironmentalSignal model removed — no-op
  void signals;

  return { signals: signals.length };
}

// ─── Unified System Prompt Output ────────────────────────

export async function getThinkingLayersContext(): Promise<string> {
  const sections: string[] = [];

  // L7: Contradictions
  const contradictions = await prisma.contradiction.findMany({
    where: { resolved: false }, orderBy: { createdAt: "desc" }, take: 5,
    select: { claim: true, reality: true, severity: true, category: true },
  }).catch((err): never[] => {
    logError("brain.thinking-engine", err, { fn: "getThinkingLayersContext.contradictions" });
    return [];
  });

  if (contradictions.length > 0) {
    sections.push(`\n## L7 — Contradictions Detected (${contradictions.length})`);
    for (const c of contradictions) {
      sections.push(`[${c.severity.toUpperCase()}/${c.category}] Says: "${c.claim.slice(0, 80)}" → Data: "${c.reality.slice(0, 80)}"`);
    }
  }

  // L8: Identity
  const identity = await prisma.identitySnapshot.findFirst({
    where: { deletedAt: null }, // v7.9
    orderBy: { date: "desc" }, select: { trajectory: true, masterySelf: true, deltaFromLast: true },
  }).catch((err): null => {
    logError("brain.thinking-engine", err, { fn: "getThinkingLayersContext.identity" });
    return null;
  });

  if (identity) {
    sections.push(`\n## L8 — Identity Evolution`);
    sections.push(`Mastery: ${identity.masterySelf}/10. ${identity.trajectory.slice(0, 200)}`);
    if (identity.deltaFromLast) sections.push(`Change: ${identity.deltaFromLast.slice(0, 150)}`);
  }

  // L9: Active simulations
  // v10.0.55 · Pre-fix dead `Promise.resolve([])`. v10.0.46 wired
  // runSimulation() to persist into BrainMemory category="simulation"
  // so the read here just queries those rows. Surfaces the most recent
  // 3 simulations with their stored scenario + recommendation +
  // confidence. Malformed JSON content is skipped.
  const simRows = await prisma.brainMemory
    .findMany({
      where: { category: BRAIN_CATEGORIES.SIMULATION, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { content: true },
    })
    .catch((err): Array<{ content: string }> => {
      logError("brain.thinking-engine", err, { fn: "getThinkingLayersContext.simRows" });
      return [];
    });
  const sims: Array<{ scenario: string; recommendation: string; confidence: number }> = [];
  for (const row of simRows) {
    try {
      const parsed = JSON.parse(row.content) as {
        scenario?: string;
        recommendation?: string;
        confidence?: number;
      };
      sims.push({
        scenario: typeof parsed.scenario === "string" ? parsed.scenario : "",
        recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      });
    } catch (err) {
      logError("brain.thinking-engine", err, { fn: "getThinkingLayersContext.parseSim" });
    }
  }

  if (sims.length > 0) {
    sections.push(`\n## L9 — Active Simulations (${sims.length})`);
    for (const s of sims) {
      sections.push(`"${s.scenario.slice(0, 80)}" → ${s.recommendation.slice(0, 100)} (${(s.confidence * 100).toFixed(0)}% conf)`);
    }
  }

  // L10: Causal chains
  const chains = await prisma.causalChain.findMany({
    where: { broken: false }, orderBy: { frequency: "desc" }, take: 3,
    select: { effect: true, rootCause: true, intervention: true, frequency: true },
  }).catch((err): never[] => {
    logError("brain.thinking-engine", err, { fn: "getThinkingLayersContext.chains" });
    return [];
  });

  if (chains.length > 0) {
    sections.push(`\n## L10 — Active Causal Chains (${chains.length})`);
    for (const c of chains) {
      sections.push(`"${c.effect.slice(0, 60)}" ← ROOT: "${c.rootCause.slice(0, 80)}" (seen ${c.frequency}x) → Break: "${(c.intervention || "unknown").slice(0, 80)}"`);
    }
  }

  // L11: Key people
  const people = await prisma.personProfile.findMany({
    orderBy: { interactionCount: "desc" }, take: 5,
    select: { name: true, role: true, trustScore: true },
  }).catch((err): never[] => {
    logError("brain.thinking-engine", err, { fn: "getThinkingLayersContext.people" });
    return [];
  });

  if (people.length > 0) {
    sections.push(`\n## L11 — Key People (${people.length})`);
    sections.push(people.map(p => `${p.name} (${p.role}, trust: ${(p.trustScore * 100).toFixed(0)}%)`).join(", "));
  }

  // L12: Environmental signals
  const signals: Array<{ category: string; signal: string; impact: string; urgency: string }> = [];

  if (signals.length > 0) {
    sections.push(`\n## L12 — Environmental Signals (${signals.length})`);
    for (const s of signals) {
      sections.push(`[${s.urgency.toUpperCase()}/${s.category}] ${s.signal.slice(0, 80)} → ${s.impact.slice(0, 80)}`);
    }
  }

  return sections.length > 0 ? sections.join("\n") : "";
}
