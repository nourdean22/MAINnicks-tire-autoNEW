/**
 * Ultron MODE classifier
 *
 * Runs on every Ultron load + every 60s. Takes the current NourState + the
 * signal-composite counts and returns one of 5 modes. Each mode drives:
 *   - Top strip edge color
 *   - Nick's persona prompt system-wide
 *   - Which signal type bubbles to the top of the carousel
 *   - Background aura intensity
 *
 * v1 rules are deterministic. v2 may layer learned thresholds per-user.
 */

import { hourET } from "@/lib/utils/datetime";

export type UltronMode = "BATTLE" | "SURGICAL" | "RECOVERY" | "SHUTDOWN" | "NORMAL";

export interface ClassifierInputs {
  currentState: "normal" | "on_fire" | "drift" | "scattered" | string;
  timeOfDay: "morning" | "afternoon" | "evening" | string;
  todayScore: unknown; // truthy = logged
  habitsDone: number;
  habitsTotal: number;
  overdueCommitments: number;
  staleLeads: number;
  agingCritical: number;
  blindSpotsCritical: number;
  blindSpotsHigh: number;
  driftBudgetUsed: number; // 0-100
  /** v10.0.529.106 · Wave 63 · health-as-decision-variable inputs.
   *  When present, sleep < 6h forces RECOVERY mode regardless of
   *  other signals. Energy ≤ 2 contributes to RECOVERY when paired
   *  with another soft signal. Optional · classifier degrades
   *  gracefully when the body data isn't logged today. */
  sleepHours?: number | null;
  energy?: number | null; // 1-5 scale
}

export interface ClassifierResult {
  mode: UltronMode;
  reason: string; // short human-readable explanation
  edgeColor: "red" | "gold" | "blue" | "amber" | "neutral";
  auraIntensity: 0 | 1 | 2 | 3; // 0=off, 3=max
  signalTypePriority: Array<"blind_spot" | "teaching_moment" | "counter_intuitive" | "correlation" | "wisdom" | "prediction">;
}

const MODE_META: Record<UltronMode, Pick<ClassifierResult, "edgeColor" | "auraIntensity" | "signalTypePriority">> = {
  BATTLE: {
    edgeColor: "red",
    auraIntensity: 3,
    signalTypePriority: ["blind_spot", "counter_intuitive", "prediction", "teaching_moment", "correlation", "wisdom"],
  },
  SURGICAL: {
    edgeColor: "gold",
    auraIntensity: 3,
    signalTypePriority: ["correlation", "teaching_moment", "counter_intuitive", "prediction", "wisdom", "blind_spot"],
  },
  RECOVERY: {
    edgeColor: "amber",
    auraIntensity: 2,
    signalTypePriority: ["teaching_moment", "wisdom", "correlation", "blind_spot", "counter_intuitive", "prediction"],
  },
  SHUTDOWN: {
    edgeColor: "blue",
    auraIntensity: 1,
    signalTypePriority: ["wisdom", "teaching_moment", "correlation", "prediction", "counter_intuitive", "blind_spot"],
  },
  NORMAL: {
    edgeColor: "neutral",
    auraIntensity: 1,
    signalTypePriority: ["blind_spot", "teaching_moment", "counter_intuitive", "correlation", "prediction", "wisdom"],
  },
};

/**
 * Classify the current Ultron mode.
 *
 * v2 rules — hardened to only fire on REAL signal. The v1 rules (e.g.
 * "zero habits by evening") fired too eagerly and hijacked Nick's voice
 * when Nour was otherwise fine. Each rule now requires a meaningful
 * compound condition, not a single soft threshold.
 *
 * Precedence (top wins):
 *   1. RECOVERY — explicit drift state OR drift budget ≥ 70%
 *   2. SHUTDOWN — late evening (≥21h) AND score unlogged today
 *   3. BATTLE — 2+ critical blindspots OR 3+ overdue commitments
 *   4. SURGICAL — on_fire flow state
 *   5. NORMAL — default
 *
 * Business signals (staleLeads, agingCritical) are no longer inputs to
 * the personal-OS mode. Those live on nickstire admin per the Ultron
 * business/personal separation rule.
 */

// Sliding "late evening" boundary for SHUTDOWN — anything before 21h
// is just "evening" without hard wind-down pressure.
const SHUTDOWN_HOUR_START = 21;

export function classifyMode(inputs: ClassifierInputs): ClassifierResult {
  const {
    currentState,
    todayScore,
    overdueCommitments,
    blindSpotsCritical,
    driftBudgetUsed,
    sleepHours,
    energy,
  } = inputs;

  const now = new Date();
  const hourOfDay = hourET(now);

  // v10.0.529.106 · Wave 63 · BODY-SIGNAL RECOVERY (top of precedence).
  // Sleep < 6h forces RECOVERY · this is the highest-confidence body
  // signal · no operator who slept 4h should be in BATTLE mode.
  if (typeof sleepHours === "number" && sleepHours < 6) {
    return {
      mode: "RECOVERY",
      reason: `slept ${sleepHours.toFixed(1)}h · body needs recovery`,
      ...MODE_META.RECOVERY,
    };
  }

  // Compound body signal · low energy AND a soft drift indicator.
  if (typeof energy === "number" && energy <= 2 && driftBudgetUsed >= 40) {
    return {
      mode: "RECOVERY",
      reason: `low energy (${energy}/5) + drift ${driftBudgetUsed}%`,
      ...MODE_META.RECOVERY,
    };
  }

  // 1 — RECOVERY (real drift only)
  if (currentState === "drift") {
    return { mode: "RECOVERY", reason: "drift state detected", ...MODE_META.RECOVERY };
  }
  if (driftBudgetUsed >= 70) {
    return {
      mode: "RECOVERY",
      reason: `drift budget ${driftBudgetUsed}%`,
      ...MODE_META.RECOVERY,
    };
  }

  // 2 — SHUTDOWN (hard evening + score missing)
  if (hourOfDay >= SHUTDOWN_HOUR_START && !todayScore) {
    return {
      mode: "SHUTDOWN",
      reason: "past 9pm · score not logged",
      ...MODE_META.SHUTDOWN,
    };
  }

  // 3 — BATTLE (at least 2 critical signals)
  if (blindSpotsCritical >= 2) {
    return {
      mode: "BATTLE",
      reason: `${blindSpotsCritical} critical blindspots`,
      ...MODE_META.BATTLE,
    };
  }
  if (overdueCommitments >= 3) {
    return {
      mode: "BATTLE",
      reason: `${overdueCommitments} overdue commitments`,
      ...MODE_META.BATTLE,
    };
  }

  // 4 — SURGICAL (flow state explicitly detected upstream)
  if (currentState === "on_fire") {
    return { mode: "SURGICAL", reason: "on-fire flow state", ...MODE_META.SURGICAL };
  }

  // 5 — NORMAL (default, most of the time)
  return { mode: "NORMAL", reason: "all systems nominal", ...MODE_META.NORMAL };
}

/**
 * Stable color variable mapping for the top-strip edge.
 * Matches the theme tokens already in the project.
 */
export function modeEdgeVar(color: ClassifierResult["edgeColor"]): string {
  switch (color) {
    case "red": return "var(--red-500, #ef4444)";
    case "gold": return "var(--gold)";
    case "blue": return "var(--blue-500, #3b82f6)";
    case "amber": return "var(--amber-500, #f59e0b)";
    case "neutral":
    default:
      return "var(--border-default)";
  }
}

/**
 * One-line badge text per mode. Short by design — the reason string
 * carries the detail for hover/aria.
 */
export function modeBadge(mode: UltronMode): string {
  switch (mode) {
    case "BATTLE":   return "BATTLE";
    case "SURGICAL": return "SURGICAL";
    case "RECOVERY": return "RECOVERY";
    case "SHUTDOWN": return "SHUTDOWN";
    case "NORMAL":   return "NORMAL";
  }
}
