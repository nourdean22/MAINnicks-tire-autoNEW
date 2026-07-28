/**
 * Wisdom Distillation Engine
 *
 * Watches for recurring patterns in brain memories, predictions,
 * reflections, and outcomes. When a pattern appears 3+ times,
 * distills it into a permanent PRINCIPLE — a piece of wisdom
 * that becomes part of Nick's core knowledge.
 *
 * Examples of distilled wisdom:
 * - "The day after a $2K+ revenue day is the highest drift risk day"
 * - "Quotes followed up on day 1 close at 2.3x the rate of day-3 followups"
 * - "Workouts before 9am correlate with 22% higher focus scores"
 * - "When open loops exceed 8, sleep quality drops within 48 hours"
 *
 * Wisdom is different from patterns:
 * - Patterns are observed (data). Wisdom is UNDERSTOOD (principles).
 * - Patterns describe WHAT happens. Wisdom explains WHY and WHEN TO ACT.
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("wisdom-distiller");
import { brainMemory } from "@/lib/brain/memory-manager";
import { today, daysAgo } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

interface WisdomCandidate {
  theme: string;
  supportingEvidence: string[];
  occurrences: number;
  domains: string[];
}

/**
 * MUNGER MENTAL-MODEL DOMAINS (Charlie Munger, Poor Charlie's Almanack)
 *
 * "You must know the big ideas in the big disciplines and use them
 *  routinely — all of them, not just a few."
 *
 * Tag every wisdom by which discipline its principle belongs to.
 * Cross-domain coverage = the moat. A wisdom-base that's all
 * psychology and zero physics has a blind spot.
 */
export type MungerDiscipline =
  | "psychology"
  | "economics"
  | "biology"
  | "physics"
  | "statistics"
  | "history"
  | "military-strategy"
  | "engineering"
  | "philosophy"
  | "operations"
  | "communication"
  | "uncategorized";

const DISCIPLINE_KEYWORDS: Record<MungerDiscipline, string[]> = {
  psychology: ["bias", "anchor", "loss aversion", "ego", "dissonance", "habit", "mood", "motivation", "fear", "shame"],
  economics: ["price", "cost", "incentive", "market", "demand", "supply", "margin", "elasticity", "trade-off", "opportunity cost"],
  biology: ["sleep", "energy", "fatigue", "circadian", "stress hormone", "recovery", "exercise", "metabolism"],
  physics: ["leverage", "compound", "momentum", "inertia", "friction", "second-order", "feedback loop", "system"],
  statistics: ["regression", "mean", "outlier", "base rate", "sample", "variance", "noise vs signal"],
  history: ["precedent", "cycle", "repeat", "pattern across time"],
  "military-strategy": ["concentration", "front", "flank", "decisive", "ambush", "withdraw", "exploit", "OODA"],
  engineering: ["constraint", "throughput", "bottleneck", "iterate", "fail-fast", "MVP"],
  philosophy: ["virtue", "akrasia", "good life", "meaning", "purpose", "telos"],
  operations: ["process", "checklist", "SOP", "throughput", "defect", "quality"],
  communication: ["frame", "story", "metaphor", "tone", "objection"],
  uncategorized: [],
};

/**
 * Tag a wisdom string by Munger discipline. Multi-discipline
 * wisdoms are the most valuable — surface those first.
 */
export function tagMungerDisciplines(wisdom: string): MungerDiscipline[] {
  const lower = wisdom.toLowerCase();
  const hits: MungerDiscipline[] = [];
  for (const [discipline, keywords] of Object.entries(DISCIPLINE_KEYWORDS)) {
    if (discipline === "uncategorized") continue;
    if (keywords.some((kw) => lower.includes(kw))) {
      hits.push(discipline as MungerDiscipline);
    }
  }
  return hits.length > 0 ? hits : ["uncategorized"];
}

/**
 * POPPER FALSIFIABILITY TAG (Karl Popper, 1934)
 *
 * "A theory which is not refutable by any conceivable event is
 *  non-scientific."
 *
 * Every wisdom should carry a "false when..." condition. Wisdoms
 * without one are platitudes ("be present", "trust yourself") —
 * untestable, unactionable. We auto-extract the falsifier when
 * the wisdom text contains common "unless / except" markers, OR
 * flag the wisdom as needing one.
 */
export function extractFalsifier(wisdom: string): string | null {
  const lower = wisdom.toLowerCase();
  const markers = [
    /\bunless\s+(.+?)(?:[.;]|$)/i,
    /\bexcept\s+(?:when\s+)?(.+?)(?:[.;]|$)/i,
    /\bbreaks down (?:if|when)\s+(.+?)(?:[.;]|$)/i,
    /\bdoes(?:n't| not) apply (?:if|when)\s+(.+?)(?:[.;]|$)/i,
    /\bfalse (?:if|when)\s+(.+?)(?:[.;]|$)/i,
  ];
  void lower;
  for (const re of markers) {
    const m = wisdom.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

export function isFalsifiable(wisdom: string): boolean {
  return extractFalsifier(wisdom) !== null;
}

/**
 * VIOLATION-RATE RANKING (Anders Ericsson, deliberate practice)
 *
 * Wisdom that's never violated isn't tested. The advice you keep
 * IGNORING is the advice you most need surfaced.
 *
 * Given a wisdom and a recent action stream, count how often the
 * action stream contradicts the wisdom. Returns 0-1 violation
 * frequency.
 *
 * Heuristic: extract the "do X / don't Y" verb-object from the
 * wisdom, then scan the action text for the OPPOSITE language.
 * Real production version would use semantic similarity, but this
 * grep-style scan catches obvious violations.
 */
export function violationRate(
  wisdom: string,
  recentActionText: string,
): { rate: number; matches: string[] } {
  const lower = wisdom.toLowerCase();
  const actions = recentActionText.toLowerCase();
  const matches: string[] = [];
  let totalChecks = 0;

  // Helper: check if any non-trivial word from a phrase appears in
  // the action text. Trivial words (the, a, an, before, after, ...)
  // are filtered so "don't open Twitter before noon" matches even
  // when the action text says "checked Twitter at 9am".
  const STOP = new Set([
    "the", "a", "an", "to", "in", "on", "at", "by", "for", "of",
    "before", "after", "during", "while", "with", "and", "or",
    "but", "is", "was", "be", "been", "am", "are", "you", "your",
  ]);
  const phraseMatchesAction = (phrase: string): string[] => {
    const tokens = phrase.split(/\s+/).filter((t) => t && !STOP.has(t));
    return tokens.filter((t) => actions.includes(t));
  };

  // Pattern 1: "don't X" wisdom → check if any object word appears
  const dontMatch = lower.match(/\bdon'?t\s+([\w\s]{2,40}?)(?:[.,;]|$)/);
  if (dontMatch) {
    totalChecks++;
    const phrase = dontMatch[1].trim();
    const hits = phraseMatchesAction(phrase);
    if (hits.length > 0)
      matches.push(`violated "don't ${phrase}" — actions hit: ${hits.join(", ")}`);
  }

  // Pattern 2: "always X" wisdom → check if X happened
  const alwaysMatch = lower.match(/\balways\s+([\w\s]{2,40}?)(?:[.,;]|$)/);
  if (alwaysMatch) {
    totalChecks++;
    const phrase = alwaysMatch[1].trim();
    const hits = phraseMatchesAction(phrase);
    if (hits.length === 0) matches.push(`failed to "always ${phrase}"`);
  }

  // Pattern 3: "never X" wisdom → check if X happened
  const neverMatch = lower.match(/\bnever\s+([\w\s]{2,40}?)(?:[.,;]|$)/);
  if (neverMatch) {
    totalChecks++;
    const phrase = neverMatch[1].trim();
    const hits = phraseMatchesAction(phrase);
    if (hits.length > 0)
      matches.push(`violated "never ${phrase}" — actions hit: ${hits.join(", ")}`);
  }

  if (totalChecks === 0) return { rate: 0, matches: [] };
  return { rate: matches.length / totalChecks, matches };
}

/**
 * TALMUDIC COUNTER-WISDOM PAIRING
 *
 * Talmud: every position held against its strongest objection. For
 * every wisdom, generate the SHARPEST counter-case so Nour considers
 * context before applying. Truth needs friction.
 *
 * This is a stub — real production should use AI to generate the
 * counter-wisdom. For deterministic engine logic we provide a
 * library of common counter-pairs.
 */
export const COUNTER_WISDOM_LIBRARY: Readonly<Record<string, string>> = {
  "be patient": "patience without urgency is just procrastination dressed up",
  "trust your gut": "your gut is wrong when you're tired, hungry, or scared",
  "stay disciplined": "rigidity in the wrong direction is faster failure",
  "focus on long-term": "people who only think long-term miss the daily compounders",
  "say no": "every no closes a door — be sure you wanted to",
  "go fast": "fast in the wrong direction is just expensive",
  "go slow": "slow in a moving market is the same as backwards",
  "morning is best": "your best time is when you have energy, not when the clock says",
  "delegate": "delegating before standardizing creates more work for you",
  "specialize": "specialists are fragile in a changing world",
  "diversify": "diversification is wisdom for risk and a shortcut for ignorance",
};

export function findCounterWisdom(wisdom: string): string | null {
  const lower = wisdom.toLowerCase();
  for (const [pattern, counter] of Object.entries(COUNTER_WISDOM_LIBRARY)) {
    if (lower.includes(pattern)) return counter;
  }
  return null;
}

/**
 * Scan for patterns that are ripe for wisdom distillation.
 * A pattern becomes wisdom when:
 * 1. It appears in 3+ separate brain memories
 * 2. It spans at least 2 weeks of data
 * 3. It has been confirmed by outcomes (not just observed)
 */
export async function distillWisdom(): Promise<string[]> {
  // Gather pattern-type memories and insights
  const [patterns, insights, confirmedPredictions, reflections] = await Promise.all([
    prisma.brainMemory.findMany({
      where: { category: { in: ["pattern", "insight", "prediction_lesson", "counter_intuitive"] }, deletedAt: null }, // v10.0.66
      orderBy: { confidence: "desc" },
      take: 50,
      select: { category: true, key: true, content: true, confidence: true, seenCount: true, createdAt: true },
    }),
    prisma.executionInsight.findMany({
      where: { insightType: { startsWith: "learned_" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { insightType: true, title: true, createdAt: true },
    }),
    prisma.prediction.findMany({
      where: { status: "confirmed" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { category: true, prediction: true, outcome: true },
    }),
    prisma.reflection.findMany({
      where: { scope: { in: ["weekly", "monthly"] }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { category: true, scope: true, insight: true, evidence: true, confidence: true },
    }),
  ]);

  // Existing wisdom (to avoid duplicates)
  const existingWisdom = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null }, // v9.1.25 · soft-delete filter
    select: { content: true },
  });

  // v9.1.25 · stronger dedup. Previous: prefix-50 match — two
  // principles about the same topic with different first 50 chars
  // ("WHEN energy < 4 for 2+ days, skip new commitments..." vs
  // "WHEN you have 2 consecutive low-energy days, avoid taking on...")
  // would NOT match, both would land in the wisdom store. Now use
  // significant-token Jaccard similarity ≥0.6 — same TOPIC but
  // different framing gets caught even when first chars differ.
  const STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "have", "in", "into", "is", "it", "its", "of", "on", "or",
    "such", "that", "the", "their", "there", "these", "they", "this",
    "to", "was", "were", "will", "with", "when", "then", "because",
    "if", "but", "you", "your", "yours", "do", "does", "did", "i",
    "me", "my", "we", "our", "ours", "be", "been", "would", "should",
    "could", "can", "may", "might", "must", "not",
  ]);
  function tokens(s: string): Set<string> {
    return new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    );
  }
  function similar(a: string, b: string): boolean {
    const ta = tokens(a);
    const tb = tokens(b);
    if (ta.size === 0 || tb.size === 0) return false;
    let intersection = 0;
    for (const t of ta) if (tb.has(t)) intersection++;
    const union = ta.size + tb.size - intersection;
    return intersection / union >= 0.6; // Jaccard ≥0.6
  }
  const wisdomTokens = existingWisdom.map((w) => w.content);

  // Combine all evidence into one corpus for AI analysis
  const evidence = [
    ...patterns.map((p) => `[${p.category}] (seen ${p.seenCount}x, confidence ${p.confidence}) ${p.content}`),
    ...insights.map((i) => `[insight] ${i.title}`),
    ...confirmedPredictions.map((p) => `[confirmed] ${p.prediction} → ${p.outcome}`),
    ...reflections.map((r) => `[reflection:${r.scope}] ${r.insight}`),
  ];

  if (evidence.length < 5) return []; // Not enough data for wisdom

  // Use AI to identify recurring themes and distill principles.
  // v10.0.356 · sharpened prompt · explicit GOOD vs BAD examples target
  // the specific failure mode that polluted the wisdom layer pre-gate
  // (vague "Nick frequently provides advice…" meta-summaries that
  // describe behavior instead of carrying actionable wisdom).
  const result = await aiChat(
    [
      {
        role: "system",
        content: `You are a wisdom distillation engine for Nour Dean (tire shop CEO, ADHD, building personal mastery system).

Analyze the evidence below and extract 1-3 PRINCIPLES — not observations, but actionable wisdom.

Hard requirements (output is REJECTED unless all met):
1. Each principle must be supported by ≥2 pieces of evidence
2. ACTIONABLE · tells Nour WHEN and WHAT to do
3. Connects ≥2 domains (body+business, habits+revenue, sleep+focus, etc.)
4. Specific · uses numbers/thresholds from the data, not generic advice
5. Format: "WHEN [condition], THEN [action] BECAUSE [evidence]"

Forbidden output shapes (these will be auto-rejected by the quality gate):
- ❌ "Nick frequently provides advice about X" (this is a SUMMARY, not a principle)
- ❌ "Nour's approach reflects discipline" (descriptive, not actionable)
- ❌ "The pattern shows variety" (vague meta-statement)
- ❌ "Stay consistent" (no condition, no threshold, no evidence link)
- ❌ Any line starting with "Nick / Nour / The user" + frequency adverb
- ❌ Lines without a conditional (when/if/before/after/unless) AND without an imperative (do/don't/avoid/start/stop)

Examples of CORRECT output:
✓ "WHEN open loops exceed 8, close 3 before starting new work BECAUSE sleep quality drops within 48h and decision quality follows"
✓ "WHEN energy < 4 for 2+ days, skip new commitments BECAUSE 3 of 4 last attempts were abandoned within a week"
✓ "WHEN a quote isn't followed up by day 1, treat it as 50% lost BECAUSE day-3 follow-ups close at 2.3x lower rate"
✓ "BEFORE 9am workouts → focus scores +22%. After 11am workouts → focus drops 15%. Schedule physical effort in the morning window."

Reply as a JSON array of strings · 1-3 elements · each string = one principle.
If the evidence is too thin or generic for principle-shaped output, return an EMPTY array [] · do not invent.`,
      },
      {
        role: "user",
        content: `EVIDENCE (${evidence.length} data points):\n\n${evidence.slice(0, 40).join("\n")}`,
      },
    ],
    "reason"
  );

  // Parse the principles
  let principles: string[] = [];
  try {
    const match = result.content.match(/\[[\s\S]*?\]/);
    if (match) {
      principles = JSON.parse(match[0]).filter((p: unknown) => typeof p === "string");
    }
  } catch {
    return [];
  }

  // Store new wisdom (skip duplicates via Jaccard similarity).
  // Stable key from a content hash of the principle (mirrors the
  // wisdom_from_<id> intent in memory-consolidation's promoteToWisdom).
  // The prior `wisdom_distilled_${Date.now()}_...` minted a fresh key
  // every run, so re-distilling the same principle wrote a brand-new
  // row — dedup leaned entirely on Jaccard. A deterministic key makes
  // the upsert idempotent (same principle → same row).
  const wisdomHash = (s: string): string => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36).slice(0, 8);
  };
  const stored: string[] = [];
  for (const principle of principles.slice(0, 3)) {
    // v9.1.25 · skip if ANY existing wisdom (including newly stored
    // ones in this run) is ≥0.6 token-overlapping with the new
    // candidate. Stops near-duplicate framings from accumulating.
    const isDuplicate =
      wisdomTokens.some((existing) => similar(existing, principle)) ||
      stored.some((s) => similar(s, principle));
    if (isDuplicate) continue;

    await brainMemory.remember(
      "wisdom",
      `wisdom_${wisdomHash(principle.slice(0, 120))}`,
      principle,
      "wisdom-distiller",
      { distilledFrom: evidence.length, distilledAt: today() }
    );

    stored.push(principle);
    wisdomTokens.push(principle); // include in subsequent dedup
  }

  return stored;
}

/**
 * Validate existing wisdom against recent data.
 * Checks if stored principles are still supported by evidence.
 * Run weekly to age out stale wisdom.
 */
export async function validateWisdom(): Promise<{
  validated: number;
  aged: number;
  contradicted: number;
}> {
  // v10.0.46 — added `deletedAt: null` + `take: 200` bound. Pre-fix
  // unbounded scan of all wisdom rows including soft-deleted ones,
  // and the per-row decay/reinforce updates would resurrect deleted
  // wisdom by mutating its confidence. Bound prevents the weekly
  // cron from blowing past the 60s envelope as the wisdom corpus
  // grows.
  const wisdom = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null },
    orderBy: { confidence: "desc" },
    take: 200,
    select: { id: true, content: true, confidence: true, seenCount: true, createdAt: true, updatedAt: true },
  });

  let validated = 0, aged = 0, contradicted = 0;
  let confWriteFails = 0;
  let lastConfWriteErr: unknown = null;

  for (const w of wisdom) {
    const ageDays = Math.round((Date.now() - w.updatedAt.getTime()) / 86400000);

    // Age decay: wisdom not reinforced in 30+ days loses confidence
    if (ageDays > 30 && w.confidence > 0.3) {
      const newConf = Math.max(0.2, w.confidence - 0.05);
      await prisma.brainMemory.update({
        where: { id: w.id },
        data: { confidence: newConf },
      }).catch((e) => { confWriteFails++; lastConfWriteErr = e; });
      aged++;
    }

    // Reinforcement: wisdom seen 5+ times gets confidence boost
    if ((w.seenCount ?? 0) >= 5 && w.confidence < 0.95) {
      await prisma.brainMemory.update({
        where: { id: w.id },
        data: { confidence: Math.min(0.95, w.confidence + 0.05) },
      }).catch((e) => { confWriteFails++; lastConfWriteErr = e; });
      validated++;
    }
  }

  // Aggregated: one log per run, never per row — a DB blip during the
  // 200-row loop must not flood ErrorLog (phase-1 rule 1).
  if (confWriteFails > 0) {
    logError("brain.wisdom-distiller", lastConfWriteErr, { stage: "confidence-decay-reinforce", failedWrites: confWriteFails }, "warn");
  }

  // Check for contradictions: wisdom that conflicts with recent counter-intuitive findings
  const recentCI = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.COUNTER_INTUITIVE, createdAt: { gte: new Date(Date.now() - 14 * 86400000) }, deletedAt: null }, // v10.0.66
    select: { content: true },
    take: 10,
  }).catch((): never[] => []);

  // v10.0.46 — collect contradiction pairs, dedupe by stable key,
  // batch the writes outside the loop. Pre-fix this was N×M serial
  // upserts with `Date.now()` in the key → a brand-new row written
  // every weekly run for the same w.id × ci.content pair → never
  // dedupes, accumulates indefinitely. Stable key is wisdom-id +
  // ci-hash so re-detection of the same contradiction overwrites.
  const contradictions: Array<{ wisdomId: string; ciHash: string; w: typeof wisdom[number]; ci: typeof recentCI[number] }> = [];
  const ciHash = (s: string): string => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36).slice(0, 8);
  };
  for (const ci of recentCI) {
    // Simple keyword overlap check
    const ciWords = new Set(ci.content.toLowerCase().split(/\s+/).filter((w: string) => w.length > 5));
    for (const w of wisdom) {
      const wisdomWords = w.content.toLowerCase().split(/\s+/).filter(wd => wd.length > 5);
      const overlap = wisdomWords.filter(wd => ciWords.has(wd)).length;
      if (overlap >= 3) {
        contradictions.push({ wisdomId: w.id, ciHash: ciHash(ci.content), w, ci });
        contradicted++;
      }
    }
  }
  // Batch the upserts via Promise.allSettled (independent, dedup-keyed).
  if (contradictions.length > 0) {
    await Promise.allSettled(
      contradictions.map((c) =>
        brainMemory.remember(
          "wisdom_contradiction",
          `contradiction_${c.wisdomId}_${c.ciHash}`,
          `CONTRADICTION: Wisdom "${c.w.content.slice(0, 80)}" may conflict with recent finding "${c.ci.content.slice(0, 80)}"`,
          "wisdom-validator",
        ),
      ),
    );
  }

  return { validated, aged, contradicted };
}

/**
 * Get all stored wisdom for context.
 * Enhanced with age indicators and contradiction warnings.
 */
export async function getWisdomContext(): Promise<string> {
  try {
    const [wisdom, contradictions] = await Promise.all([
      prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.WISDOM, confidence: { gte: 0.3 }, deletedAt: null }, // v10.0.66 · system-prompt feeder
        orderBy: { confidence: "desc" },
        take: 10,
        select: { content: true, confidence: true, seenCount: true, updatedAt: true },
      }),
      prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.WISDOM_CONTRADICTION, deletedAt: null }, // v10.0.66 · system-prompt feeder
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { content: true },
      }),
    ]);

    if (wisdom.length === 0) return "";

    const lines = [`── DISTILLED WISDOM (${wisdom.length} principles) ──`];

    for (const w of wisdom) {
      const ageDays = Math.round((Date.now() - w.updatedAt.getTime()) / 86400000);
      const ageLabel = ageDays > 30 ? " ⏳stale" : ageDays > 14 ? " 📅aging" : "";
      const reinforced = (w.seenCount ?? 0) >= 5 ? " ✅validated" : "";
      lines.push(`• [${(w.confidence * 100).toFixed(0)}%${ageLabel}${reinforced}] ${w.content.slice(0, 200)}`);
    }

    if (contradictions.length > 0) {
      lines.push(`⚠️ ${contradictions.length} wisdom contradictions detected — review and resolve:`);
      for (const c of contradictions) lines.push(`  → ${c.content.slice(0, 150)}`);
    }

    lines.push(`Apply these proactively. When a condition matches, trigger the action. Flag stale wisdom for re-evaluation.`);

    return lines.join("\n");
  } catch {
    return "";
  }
}
