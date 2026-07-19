/**
 * Which FORM should today's content take — and is today a day to post at all?
 *
 * WHY THIS IS SEPARATE FROM shadowPlanner
 * The shadow planner picks the OPPORTUNITY (what to talk about). This picks the
 * FORM (how to say it). They change for different reasons: opportunity scoring
 * moves when seasonality or evidence changes, format choice moves when costs,
 * fatigue or available media change. Two reasons to change, two modules.
 *
 * The planner today maps every playbook moment to reel+carousel
 * (shadowPlanner.ts: "every playbook moment maps to reel+carousel today"), so it
 * cannot choose a static post, a story, or silence. That is a missing decision
 * axis, not missing wiring, and it is the real blocker on "let the system decide".
 *
 * PURE BY CONSTRUCTION, like the shadow planner. No provider, publish, generation
 * or database imports — a source-level scan enforces it. Same signals always
 * produce the same decision, so an operator can disagree with it meaningfully.
 *
 * NEVER FABRICATES CONFIDENCE. Every signal is availability-flagged. When the
 * inputs are thin the decision says so with a reason code instead of dressing a
 * guess as an analysis — the same discipline the shadow planner already applies
 * to evidence strength.
 */
import type { CampaignObjective } from "../../client/src/lib/creativeGenome";

/** What the system can publish. `none` is a real answer, not a failure. */
export const CONTENT_FORMAT = {
  single: "single",
  carousel: "carousel",
  reel: "reel",
  story: "story",
  none: "none",
} as const;
export type ContentFormat = (typeof CONTENT_FORMAT)[keyof typeof CONTENT_FORMAT];

/**
 * How much the decision is worth trusting. Deliberately three coarse words and
 * not a percentage: a number implies a calibration nobody has measured, and this
 * codebase has already been bitten by authoritative-looking figures with no
 * derivation behind them.
 */
export type DecisionConfidence = "low" | "moderate" | "high";

/** Every input is availability-flagged so a missing signal is never read as a zero. */
export interface FormatSignals {
  /** Formats posted recently, newest first — drives fatigue. */
  recentFormats: { available: boolean; values: ContentFormat[] };
  /** Usable shop media on hand. Without it, a reel means paid generation. */
  mediaOnHand: { available: boolean; clipCount: number; photoCount: number };
  /** What is left of today's generation budget, in cents. */
  budget: { available: boolean; remainingCents: number };
  /** Average engagement per format. Starved today — hence the flag. */
  performance: { available: boolean; byFormat: Partial<Record<ContentFormat, number>> };
  /** The opportunity this form has to carry, from the shadow planner. */
  objective: { available: boolean; value: CampaignObjective | null };
  /** Whether the shop has a time-sensitive thing to say (weather, closure, offer). */
  urgency: { available: boolean; isUrgent: boolean };
}

export interface FormatDecision {
  format: ContentFormat;
  /** Operator-readable. An operator who cannot see the reason cannot correct it. */
  reason: string;
  confidence: DecisionConfidence;
  /** Machine-readable codes for the same reasoning, for analytics and tests. */
  codes: string[];
  /** Which signals actually informed this. Absent ones are named, not hidden. */
  signalsUsed: string[];
  signalsMissing: string[];
}

/** A reel needs this many usable clips before it is anything but a paid generation. */
const CLIPS_FOR_A_FREE_REEL = 4;
/** Below this, starting a reel risks running out mid-generation. */
const REEL_BUDGET_FLOOR_CENTS = 500;
/** How far back fatigue looks. Three posts is enough to feel repetitive. */
const FATIGUE_WINDOW = 3;

/** Blank signals — the honest starting point when nothing could be gathered. */
export function emptyFormatSignals(): FormatSignals {
  return {
    recentFormats: { available: false, values: [] },
    mediaOnHand: { available: false, clipCount: 0, photoCount: 0 },
    budget: { available: false, remainingCents: 0 },
    performance: { available: false, byFormat: {} },
    objective: { available: false, value: null },
    urgency: { available: false, isUrgent: false },
  };
}

/** Has this format dominated the recent window? */
function isFatigued(signals: FormatSignals, format: ContentFormat): boolean {
  if (!signals.recentFormats.available) return false;
  const window = signals.recentFormats.values.slice(0, FATIGUE_WINDOW);
  if (window.length < FATIGUE_WINDOW) return false;
  return window.every((f) => f === format);
}

/** Can a reel be made from footage already paid for? */
function canMakeReelFree(signals: FormatSignals): boolean {
  return signals.mediaOnHand.available && signals.mediaOnHand.clipCount >= CLIPS_FOR_A_FREE_REEL;
}

/** Is there enough budget left to start a paid reel without stranding it? */
function canAffordPaidReel(signals: FormatSignals): boolean {
  if (!signals.budget.available) return false;
  return signals.budget.remainingCents >= REEL_BUDGET_FLOOR_CENTS;
}

function describeAvailability(signals: FormatSignals): Pick<FormatDecision, "signalsUsed" | "signalsMissing"> {
  const used: string[] = [];
  const missing: string[] = [];
  const push = (name: string, available: boolean) => (available ? used : missing).push(name);
  push("recentFormats", signals.recentFormats.available);
  push("mediaOnHand", signals.mediaOnHand.available);
  push("budget", signals.budget.available);
  push("performance", signals.performance.available);
  push("objective", signals.objective.available);
  push("urgency", signals.urgency.available);
  return { signalsUsed: used, signalsMissing: missing };
}

/**
 * Confidence follows the evidence, not the strength of the preference.
 * A decision made with two of six signals is `low` however obvious it feels.
 */
function gradeConfidence(signals: FormatSignals): DecisionConfidence {
  const { signalsUsed } = describeAvailability(signals);
  if (signalsUsed.length >= 5) return "high";
  if (signalsUsed.length >= 3) return "moderate";
  return "low";
}

/**
 * Choose the form for today.
 *
 * Ordered by what the operator would consider first, so the code reads the way
 * the decision is actually made: urgency beats everything, cost gates reels,
 * fatigue breaks ties, and thin evidence falls back to the cheapest useful form
 * rather than the most impressive one.
 */
export function decideContentFormat(signals: FormatSignals): FormatDecision {
  const availability = describeAvailability(signals);
  const confidence = gradeConfidence(signals);
  const decide = (format: ContentFormat, reason: string, codes: string[]): FormatDecision =>
    ({ format, reason, confidence, codes, ...availability });

  // 1. Time-sensitive news is a story. It is the cheapest form and the only one
  //    whose 24-hour lifespan matches the message.
  if (signals.urgency.available && signals.urgency.isUrgent) {
    return decide(
      CONTENT_FORMAT.story,
      "There is something time-sensitive to say today, and a story is the cheapest form whose 24-hour life matches it.",
      ["urgency_present", "story_matches_lifespan"],
    );
  }

  // 2. Footage already paid for is the best reason to make a reel — highest
  //    reach for no new spend.
  if (canMakeReelFree(signals) && !isFatigued(signals, CONTENT_FORMAT.reel)) {
    return decide(
      CONTENT_FORMAT.reel,
      `There are ${signals.mediaOnHand.clipCount} usable clips on hand, so a reel costs nothing new to generate.`,
      ["media_on_hand", "reel_free"],
    );
  }

  // 3. A reel with no footage is a paid generation, so it must clear the budget
  //    floor. Below it, starting one risks stranding a half-generated job.
  if (!canMakeReelFree(signals) && signals.budget.available && !canAffordPaidReel(signals)) {
    if (isFatigued(signals, CONTENT_FORMAT.carousel)) {
      return decide(
        CONTENT_FORMAT.single,
        "Budget is too low for a paid reel and the last few posts were carousels, so a single post keeps the feed varied without spending.",
        ["budget_below_reel_floor", "carousel_fatigue"],
      );
    }
    return decide(
      CONTENT_FORMAT.carousel,
      "Budget is too low to start a paid reel. A carousel carries the most substance for no generation spend.",
      ["budget_below_reel_floor", "carousel_is_cheap"],
    );
  }

  // 4. Teaching needs room; an offer needs immediacy. Only consult this once
  //    cost has been cleared, because objective never justifies overspending.
  if (signals.objective.available && signals.objective.value) {
    const objective = String(signals.objective.value);
    if (/educat|explain|teach|myth/i.test(objective) && !isFatigued(signals, CONTENT_FORMAT.carousel)) {
      return decide(
        CONTENT_FORMAT.carousel,
        "The objective is educational, and a carousel gives each step its own slide.",
        ["objective_educational", "carousel_carries_steps"],
      );
    }
    if (/offer|promo|urgen|book/i.test(objective) && !isFatigued(signals, CONTENT_FORMAT.single)) {
      return decide(
        CONTENT_FORMAT.single,
        "The objective is a direct offer, and a single post puts the ask in one frame.",
        ["objective_offer", "single_is_direct"],
      );
    }
  }

  // 5. Break a run of the same form even when nothing else argues.
  for (const fatigued of [CONTENT_FORMAT.reel, CONTENT_FORMAT.carousel, CONTENT_FORMAT.single]) {
    if (isFatigued(signals, fatigued)) {
      const alternative = fatigued === CONTENT_FORMAT.single ? CONTENT_FORMAT.carousel : CONTENT_FORMAT.single;
      return decide(
        alternative,
        `The last ${FATIGUE_WINDOW} posts were all ${fatigued}s, so this one changes form to keep the feed from flattening.`,
        ["format_fatigue", `fatigued_${fatigued}`],
      );
    }
  }

  // 6. Nothing argued for anything. Fall back to the cheapest useful form and SAY
  //    that the evidence was thin — a confident-sounding default is how a guess
  //    gets mistaken for an analysis.
  return decide(
    CONTENT_FORMAT.single,
    availability.signalsMissing.length >= 4
      ? `Too little signal to choose well (${availability.signalsMissing.join(", ")} unavailable), so this defaults to a single post — the cheapest useful form. Treat it as a default, not a recommendation.`
      : "No signal argued strongly for a richer format, so a single post is the cheapest way to say something today.",
    ["fallback_default", ...(availability.signalsMissing.length >= 4 ? ["evidence_starved"] : [])],
  );
}
