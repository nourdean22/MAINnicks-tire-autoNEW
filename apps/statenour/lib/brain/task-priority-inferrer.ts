/**
 * @deprecated DO NOT IMPORT — pre-2026-08-19 INVERTED polarity.
 * This module has ZERO importers and still emits the retired
 * lower-is-hotter scale (its output contradicts the canonical
 * higher-is-hotter contract in lib/scoring/task-priority.ts). Wiring it
 * anywhere reintroduces the bipolar column the 2026-08-19 wave
 * exterminated. It is on the operator-sign-off delete list
 * (docs/REIMAGINE-VERDICT-2026-08-19.md); if it is ever revived instead,
 * invert the scale and route bands through lib/scoring/task-priority.
 *
 * Task Priority Inferrer — heuristic auto-priority for tasks created
 * on-the-fly from chat or brain dumps. Apr 19.
 *
 * Signals:
 *   • Mission domain → business=higher, personal=medium, body=medium
 *   • Deadline cue (today/tomorrow/asap) → multiply urgency
 *   • Person mention (Dania/customer/vendor) → +person weight
 *   • Identity weakness match → +alignment weight
 *   • Overdue commitments → crowd-out penalty (too much in flight)
 *   • Effort band → shorter tasks score higher priority (quick wins)
 *
 * Output: autoPriority number 0-100 (lower = more urgent) + a
 * human-readable explanation suitable for autoPriorityExplanation.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

export interface PriorityInput {
  title: string;
  context?: string;
  effort?: string;
  suggestedDeadline?: string | null;
  missionDomain?: string | null;
  promiseTo?: string | null;
}

export interface PriorityOutput {
  autoPriority: number;
  autoPriorityExplanation: string;
  factors: Array<{ factor: string; delta: number }>;
}

const DEADLINE_WEIGHT: Record<string, number> = {
  now: -30,
  today: -20,
  tomorrow: -10,
  week: -5,
  nextweek: 0,
};

const DOMAIN_WEIGHT: Record<string, number> = {
  business: -10,
  money: -10,
  revenue: -10,
  body: -5,
  mind: -5,
  mastery: -5,
  personal: 0,
  life: 0,
};

const EFFORT_BIAS: Record<string, number> = {
  M5: -5,
  M15: -3,
  M30: 0,
  H1: +2,
  H2: +5,
  H4: +10,
  H8: +15,
};

function pushFactor(factors: Array<{ factor: string; delta: number }>, factor: string, delta: number) {
  if (delta !== 0) factors.push({ factor, delta });
}

export async function inferTaskPriority(input: PriorityInput): Promise<PriorityOutput> {
  const factors: Array<{ factor: string; delta: number }> = [];
  let score = 50; // baseline

  // Domain
  const domainKey = (input.missionDomain ?? "personal").toLowerCase();
  const domainDelta = DOMAIN_WEIGHT[domainKey] ?? 0;
  score += domainDelta;
  pushFactor(factors, `domain:${domainKey}`, domainDelta);

  // Deadline
  if (input.suggestedDeadline) {
    const d = DEADLINE_WEIGHT[input.suggestedDeadline] ?? 0;
    score += d;
    pushFactor(factors, `deadline:${input.suggestedDeadline}`, d);
  }

  // Effort band — shorter = higher priority (quick wins)
  if (input.effort) {
    const e = EFFORT_BIAS[input.effort] ?? 0;
    score += e;
    pushFactor(factors, `effort:${input.effort}`, e);
  }

  // Person / promise weight
  if (input.promiseTo && input.promiseTo.length > 0) {
    score -= 10;
    pushFactor(factors, `promise:${input.promiseTo}`, -10);
  }

  // Title keywords
  const lowerTitle = input.title.toLowerCase();
  if (/\b(urgent|asap|critical|emergency|now)\b/.test(lowerTitle)) {
    score -= 15;
    pushFactor(factors, "title:urgent-keyword", -15);
  }
  if (/\b(refund|cancel|complaint|stuck|broken|failing|failed)\b/.test(lowerTitle)) {
    score -= 8;
    pushFactor(factors, "title:problem-signal", -8);
  }
  if (/\b(review|cleanup|organize|tidy|archive)\b/.test(lowerTitle)) {
    score += 8;
    pushFactor(factors, "title:housekeeping", 8);
  }

  // Identity weakness alignment — if task helps a weak axis, bump priority
  try {
    const snap = await prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
        select: { content: true },
      })
      .catch((err) => {
        logError("brain.task-priority-inferrer", err, { fn: "inferTaskPriority.findIdentity" });
        return null;
      });
    if (snap?.content) {
      const parsed = JSON.parse(snap.content) as {
        axes?: Record<string, { value: number; manual: number | null }>;
      };
      const axes = parsed.axes ?? {};
      // Check if title mentions something tied to a weak axis (velocity,
      // patience_horizon, promise_integrity, dopamine_discipline,
      // business_vs_personal, risk_appetite, social_battery,
      // reflection_cadence)
      const weakAxisCues: Array<[string, RegExp]> = [
        ["promise_integrity", /\b(promise|commit|followup|follow up)\b/i],
        ["social_battery", /\b(call|reach out|text|hang|dinner|visit)\b/i],
        ["reflection_cadence", /\b(reflect|journal|review|debrief)\b/i],
        ["dopamine_discipline", /\b(focus|deep work|block|phone off)\b/i],
      ];
      for (const [axisKey, rx] of weakAxisCues) {
        const a = axes[axisKey];
        const v = a?.manual ?? a?.value;
        if (v != null && v < 45 && rx.test(lowerTitle)) {
          score -= 8;
          pushFactor(factors, `weak-axis:${axisKey}@${v}`, -8);
          break;
        }
      }
    }
  } catch (err) {
    // silent
    logError("brain.task-priority-inferrer", err, { fn: "inferTaskPriority.identityParse" });
  }

  // Overdue crowd penalty — if Nour has 5+ overdue commits, new
  // non-urgent tasks get lower urgency (deliberate queue management)
  try {
    const overdueCount = await prisma.commitment
      .count({
        where: {
          status: "active",
          deletedAt: null,
          deadline: { lt: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) },
        },
      })
      .catch((err) => {
        logError("brain.task-priority-inferrer", err, { fn: "inferTaskPriority.countOverdue" });
        return 0;
      });
    if (overdueCount >= 5 && score > 40) {
      score += 5;
      pushFactor(factors, `overdue-crowd:${overdueCount}`, 5);
    }
  } catch (err) {
    // silent
    logError("brain.task-priority-inferrer", err, { fn: "inferTaskPriority.overduePenalty" });
  }

  // Clamp
  const autoPriority = Math.max(1, Math.min(99, Math.round(score)));

  // Build explanation
  const topFactors = [...factors]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  const explanation = topFactors.length > 0
    ? `p${autoPriority} · ${topFactors.map((f) => `${f.factor}${f.delta > 0 ? "+" : ""}${f.delta}`).join(" · ")}`
    : `p${autoPriority} · baseline`;

  return {
    autoPriority,
    autoPriorityExplanation: explanation,
    factors,
  };
}
