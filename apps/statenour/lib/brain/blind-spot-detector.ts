/**
 * Blind Spot Detector — What is Nour NOT paying attention to?
 *
 * Analyzes the gap between what Nour SHOULD be doing (based on his
 * goals, commitments, and tracked domains) and what he ACTUALLY
 * engages with (conversations, page visits, scores, actions).
 *
 * Blind spots are ranked by severity:
 * - CRITICAL: commitment with deadline approaching + zero activity
 * - HIGH: domain score declining + no recent conversations about it
 * - MEDIUM: habit streak broken + no awareness shown
 * - LOW: topic mentioned in brain dumps but no action taken
 *
 * Output feeds into:
 * - System prompt (so Nick proactively surfaces blind spots)
 * - Morning autopilot (daily blind spot highlight)
 * - /blindspots Telegram command
 */

import { prisma } from "@/lib/prisma";
import { daysAgo, today, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

export interface BlindSpot {
  domain: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  evidence: string;
  daysSinceAttention: number;
  suggestedAction: string;
  /**
   * Diagnostic frame — which proven mental model surfaced this spot.
   * Lets the system prompt and /brain UI label findings by lineage.
   */
  frame?:
    | "neglect"        // simple: hasn't been touched
    | "inversion"      // Munger: accidentally executing the opposite of the goal
    | "constraint"     // Goldratt: the bottleneck nobody's looking at
    | "survivor-bias"  // Wald: zero-data domain; silence IS the signal
    | "dunning-kruger" // Confidence ≫ engagement
    | "shadow";        // Jung: language denial pattern
}

/**
 * Munger / Carl Jacobi inversion mapping. For each tracked domain,
 * what would it look like if Nour was accidentally pursuing the
 * INVERSE? The engine flags spots where current behavior tracks the
 * inverse instead of the goal.
 *
 * "All I want to know is where I'm going to die so I'll never go there."
 */
export const DOMAIN_INVERSIONS: Readonly<Record<string, string>> = {
  body:        "neglect → injury | inactivity → decline | sugar over fuel",
  revenue:     "discount-spiral | one-bad-month spirals into desperate moves",
  relationships: "withdrawal under stress | resentment loops | silent treatment",
  strategy:    "shiny-object switching | activity ≠ progress",
  mental:      "rumination loops | scroll-as-coping | avoidance dressed as planning",
  discipline:  "cheat-meal-becomes-cheat-week | once-is-fine compounds",
  family:      "transactional contact | obligation calls | crisis-only outreach",
  spiritual:   "performative practice | absence shows up as edginess",
  financial:   "lifestyle creep | debt-to-fund-impulse | tracking → judging cycle",
  health:      "symptoms-as-signal-ignored | doctor-deferred | sleep-debt rationalized",
};

/**
 * Confidence-language detector — Dunning-Kruger blind spots show
 * up as high stated confidence in a domain that has low actual
 * engagement. These phrases register as "I've got this handled":
 */
export const CONFIDENCE_LANGUAGE = [
  "i've got",
  "i have it handled",
  "i'm fine on",
  "all good on",
  "no issue with",
  "not a problem",
  "i know what",
  "i don't need to",
  "already covered",
];

/**
 * Detect blind spots across all domains.
 */
export async function detectBlindSpots(): Promise<BlindSpot[]> {
  const blindSpots: BlindSpot[] = [];
  const sevenDaysAgo = daysAgo(7);
  const fourteenDaysAgo = daysAgo(14);
  const todayStr = today();

  // Gather data in parallel. Apr 19 · DailyScore + MasteryHabit
  // retired. Dropped both queries entirely. fourteenDaysAgo still
  // referenced downstream (brain dumps), so leave it declared.
  void fourteenDaysAgo;

  // truth-substrate audit P0 (#6): the corpus (chat + brain dumps) that drives
  // the Wald survivor-bias detector below is built from two reads that used to
  // .catch(() => []) SILENTLY. A partial failure looked like a genuinely empty
  // domain → false "zero data inflow" blind spots (absence mistaken for signal).
  // We now LOG the failure and mark the corpus unreliable so absence-inference
  // is skipped when a feeding read failed.
  let corpusReliable = true;
  const [
    overdueCommitments,
    staleLoops,
    recentConversations,
    driftAlerts,
    recentBrainDumps,
    staleLEads,
    pendingDecisions,
  ] = await Promise.all([
    // Commitments with deadlines that passed
    prisma.commitment.findMany({
      where: { status: { in: ["active", "in_progress"] }, deadline: { lt: todayStr }, deletedAt: null },
      select: { description: true, deadline: true, domain: true },
    }).catch((): never[] => []),

    // Active tasks untouched for 7+ days (Apr 18: OpenLoop → Task).
    prisma.task
      .findMany({
        where: {
          status: { in: ["INBOX", "READY"] },
          lastTouchedAt: { lte: sevenDaysAgo },
        },
        orderBy: { lastTouchedAt: "asc" },
        take: 5,
        select: {
          title: true,
          lastTouchedAt: true,
          updatedAt: true,
          mission: { select: { domain: true } },
        },
      })
      .then((rows) =>
        rows.map((t) => ({
          title: t.title,
          domain: t.mission?.domain ?? "general",
          updatedAt: t.lastTouchedAt ?? t.updatedAt,
        })),
      )
      .catch((): never[] => []),

    // Recent conversation topics (from chat messages)
    prisma.chatMessage.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, role: "user" },
      select: { content: true },
      take: 50,
    }).catch((e): never[] => {
      logError("brain.blind-spot-detector", e, { fn: "recentConversations" });
      corpusReliable = false;
      return [];
    }),

    // Unresolved drift alerts — v-truth · only RECENT ones. Without the
    // createdAt floor, months-old never-resolved alerts inflated the count
    // into a false "the system is screaming". 14d mirrors stale-data-scanner.
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          createdAt: { gte: fourteenDaysAgo },
        },
        select: { key: true, content: true, metadata: true, createdAt: true },
      })
      .then((rows) => {
        const unresolved = rows.filter((r) => {
          const meta = (r.metadata ?? {}) as Record<string, any>;
          return !meta.ackedAt;
        });
        return unresolved.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, any>;
          const severity = meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "high" : "warning";
          return {
            ruleName: r.content,
            severity,
            message: typeof meta.body === "string" ? meta.body : "",
            createdAt: r.createdAt,
          };
        });
      })
      .catch((): never[] => []),

    // Brain dumps mentioning topics without follow-through
    prisma.brainDump.findMany({
      where: { deletedAt: null, createdAt: { gte: fourteenDaysAgo } }, // v9.1.18
      select: { summary: true, patterns: true, rawThoughts: true },
      take: 5,
    }).catch((e): never[] => {
      logError("brain.blind-spot-detector", e, { fn: "recentBrainDumps" });
      corpusReliable = false;
      return [];
    }),

    // Leads going stale
    Promise.resolve(0).catch(() => 0),

    // Decisions awaiting review
    prisma.decisionReplay.count({
      where: { reviewed: false, reviewAt: { lte: new Date() } },
    }).catch(() => 0),
  ]);

  // ── Overdue commitments ──
  for (const c of overdueCommitments) {
    const daysOverdue = Math.floor(
      (Date.now() - new Date(c.deadline + "T12:00:00").getTime()) / 86400000
    );
    // v-truth · age ceiling. A commitment 90+ days overdue with no update
    // is abandoned-in-practice; nagging about it daily for months/years
    // (e.g. the 809-day-overdue "text Dania" one) is noise, not signal.
    // Suppress the per-item attention flag past the window — ancient
    // commitments get cleaned up in /commitments, not via a daily chip.
    if (daysOverdue > 90) continue;
    blindSpots.push({
      domain: c.domain || "general",
      description: `Commitment overdue: "${c.description}"`,
      severity: daysOverdue > 7 ? "critical" : "high",
      evidence: `Due ${c.deadline}, now ${daysOverdue} days overdue with no update`,
      daysSinceAttention: daysOverdue,
      suggestedAction: `Resolve commitment`,
    });
  }

  // ── Stale open loops ──
  for (const loop of staleLoops) {
    const daysStale = Math.floor((Date.now() - loop.updatedAt.getTime()) / 86400000);
    // v-truth · age ceiling (mirror of the commitment fix above). A task
    // untouched for 90+ days is abandoned-in-practice; it gets cleaned up in
    // /tasks, not nagged about as a daily blind-spot chip.
    if (daysStale > 90) continue;
    blindSpots.push({
      domain: loop.domain,
      description: `Open loop untouched: "${loop.title}"`,
      severity: daysStale > 14 ? "high" : "medium",
      evidence: `Last updated ${daysStale} days ago. Still marked as open.`,
      daysSinceAttention: daysStale,
      suggestedAction: `Close, delegate, or schedule`,
    });
  }

  // Apr 19 · Scoring-gap + workout-gap blind spots retired alongside
  // DailyScore. Self-awareness signal now lives in identity snapshot
  // cadence + chat-recall. Workout signal now fires from
  // PersonalJournal rows (handled by the body/workout detector).

  // ── Stale leads ──
  if (staleLEads > 0) {
    blindSpots.push({
      domain: "revenue",
      description: `${staleLEads} leads over 7 days old without response`,
      severity: staleLEads > 3 ? "critical" : "high",
      evidence: `Each hour unanswered = -15% conversion probability. These leads are likely dead.`,
      daysSinceAttention: 7,
      suggestedAction: `Triage leads`,
    });
  }

  // ── Unreviewed decisions ──
  if (pendingDecisions > 0) {
    blindSpots.push({
      domain: "growth",
      description: `${pendingDecisions} decisions awaiting review`,
      severity: "medium",
      evidence: `Decision replays are how you learn from past choices. Skipping them means repeating mistakes.`,
      daysSinceAttention: 7,
      suggestedAction: `Review decisions`,
    });
  }

  // ── Unresolved drift alerts ──
  if (driftAlerts.length > 3) {
    blindSpots.push({
      domain: "system",
      description: `${driftAlerts.length} unresolved drift alerts accumulating`,
      severity: "high",
      evidence: `Alerts pile up when you stop looking. ${driftAlerts.length} unresolved means the system is screaming.`,
      daysSinceAttention: 3,
      suggestedAction: `Resolve alerts`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // MENTAL-MODEL DETECTORS (Apr 2026)
  // ═══════════════════════════════════════════════════════════════
  // Augments the neglect-based scan above with 4 proven frames:
  //   · Munger inversion · Goldratt constraint
  //   · Wald survivor bias · Dunning-Kruger gap
  // Each runs against the data already fetched + the chat language
  // scan so we don't add per-detector DB round-trips.

  // Build a per-domain mention-frequency map from recent chat + dumps.
  const userText = [
    ...recentConversations.map((m) => m.content),
    ...recentBrainDumps.map((d) => `${d.summary ?? ""} ${d.rawThoughts ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();

  const domainMentionCount = (domain: string): number => {
    const re = new RegExp(`\\b${domain.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "g");
    return (userText.match(re) ?? []).length;
  };

  // ── 1. MUNGER INVERSION (Jacobi → Munger) ──────────────────────
  // For each domain, scan recent text for inversion language. If
  // Nour is talking about THE OPPOSITE of his stated goal, the
  // domain is in inversion-mode — most expensive blind spot class.
  for (const [domain, inverseWords] of Object.entries(DOMAIN_INVERSIONS)) {
    const domainHits = domainMentionCount(domain);
    const inverseHits = inverseWords
      .toLowerCase()
      .split("|")
      .filter((phrase) => userText.includes(phrase.trim()))
      .length;
    if (inverseHits >= 2 && domainHits >= 1) {
      blindSpots.push({
        domain,
        description: `${domain} domain is tracking the INVERSE of the goal`,
        severity: inverseHits >= 4 ? "critical" : "high",
        evidence: `Recent text contains ${inverseHits} inversion phrases (e.g. "${inverseWords.split("|")[0].trim()}"). You're not just neglecting ${domain} — you're accidentally executing the opposite. Munger: "Invert, always invert."`,
        daysSinceAttention: 0,
        suggestedAction: `Name inversion`,
        frame: "inversion",
      });
    }
  }

  // ── 2. WALD SURVIVOR BIAS ──────────────────────────────────────
  // Domains with ZERO mentions in 14d. Silence IS the signal —
  // Wald told the WW2 Air Force to armor where bullets WEREN'T.
  //
  // Guard: only fire when there's SOME data flow somewhere. With a
  // truly empty corpus (fresh install, no journal/chat data), all
  // domains are silent and Wald would emit 10 spots about absence.
  // That's not a blind spot — that's an empty system.
  //
  // truth-substrate audit #6: ALSO require corpusReliable — if a feeding read
  // FAILED, apparent silence is a measurement gap, not real neglect. Emitting
  // "zero data inflow" off a failed query is a false signal, so skip it.
  if (corpusReliable && userText.trim().length > 100) {
    for (const domain of Object.keys(DOMAIN_INVERSIONS)) {
      if (domainMentionCount(domain) === 0) {
        blindSpots.push({
          domain,
          description: `${domain}: zero data inflow in last 14 days`,
          severity: "medium",
          evidence: `No journal entries, chat mentions, or decisions touch this domain. Wald's bullet-hole rule: the planes that DIDN'T come back showed where the armor was missing. Silence is the real blind spot.`,
          daysSinceAttention: 14,
          suggestedAction: `Reflect on domain`,
          frame: "survivor-bias",
        });
      }
    }
  }

  // ── 3. DUNNING-KRUGER GAP ──────────────────────────────────────
  // High stated confidence × low actual engagement = classic D-K
  // blind spot. Scan for confidence language tied to a domain
  // that's also under-engaged.
  for (const phrase of CONFIDENCE_LANGUAGE) {
    const phraseIdx = userText.indexOf(phrase);
    if (phraseIdx < 0) continue;
    // Look at the 50 chars after the phrase for a domain mention
    const window = userText.slice(phraseIdx, phraseIdx + 80);
    for (const domain of Object.keys(DOMAIN_INVERSIONS)) {
      if (window.includes(domain) && domainMentionCount(domain) <= 2) {
        blindSpots.push({
          domain,
          description: `Stated confidence on ${domain}, but engagement is ≤ 2 mentions`,
          severity: "high",
          evidence: `Phrase "${phrase} ${domain}..." surfaced, but domain has near-zero engagement signal. Dunning-Kruger: high confidence + low data = peak risk zone.`,
          daysSinceAttention: 7,
          suggestedAction: `Verify action`,
          frame: "dunning-kruger",
        });
        break;
      }
    }
  }

  // ── 4. GOLDRATT CONSTRAINT IDENTIFIER ──────────────────────────
  // Find the BOTTLENECK domain — high importance signal (active
  // commitments + missions touch it) but low engagement (mentions).
  // The constraint is what you're NOT working on, not what's busiest.
  const importanceMap: Record<string, number> = {};
  for (const c of overdueCommitments) {
    const d = (c.domain || "general").toLowerCase();
    importanceMap[d] = (importanceMap[d] ?? 0) + 2; // overdue = 2x
  }
  for (const t of staleLoops) {
    const d = t.domain.toLowerCase();
    importanceMap[d] = (importanceMap[d] ?? 0) + 1;
  }
  // Highest importance with lowest engagement = the constraint.
  const constraintCandidates = Object.entries(importanceMap)
    .map(([d, imp]) => {
      const eng = Math.max(1, domainMentionCount(d));
      return { domain: d, importance: imp, engagement: eng, ratio: imp / eng };
    })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 1);
  // truth-substrate audit #6: the ENGAGEMENT half of this ratio comes from
  // userText (domainMentionCount). If a feeding read FAILED (corpusReliable=false),
  // "low engagement" is a measurement gap, not real neglect — a partial failure
  // would otherwise emit a false high/critical "SYSTEM CONSTRAINT" spot. Same
  // reason the Wald block above is gated. Importance-only (no corpus) isn't enough.
  for (const c of corpusReliable ? constraintCandidates : []) {
    if (c.ratio < 2) continue; // need real signal
    blindSpots.push({
      domain: c.domain,
      description: `${c.domain}: the SYSTEM CONSTRAINT — high stakes, low attention`,
      severity: c.ratio > 4 ? "critical" : "high",
      evidence: `Importance signal: ${c.importance} (overdue commitments + stale loops). Engagement signal: ${c.engagement} mentions. Goldratt: every system has ONE constraint. Optimizing anything else is wasted effort.`,
      daysSinceAttention: 7,
      suggestedAction: `Focus on bottleneck`,
      frame: "constraint",
    });
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  blindSpots.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return blindSpots;
}

/**
 * Get blind spot context for system prompt.
 * Reads from STORED memories (computed by evening cron), not live.
 * This keeps the system prompt fast (<100ms for this section).
 */
export async function getBlindSpotContext(): Promise<string> {
  try {
    const spots = await prisma.brainMemory.findMany({
      where: { deletedAt: null, category: BRAIN_CATEGORIES.BLIND_SPOT }, // v9.1.18
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { content: true },
    });

    if (spots.length === 0) return "";

    return [
      `── BLIND SPOTS (from last scan) ──`,
      ...spots.map((s) => `• ${s.content.slice(0, 180)}`),
      `Surface these proactively. Don't wait for Nour to ask.`,
    ].join("\n");
  } catch {
    return "";
  }
}
