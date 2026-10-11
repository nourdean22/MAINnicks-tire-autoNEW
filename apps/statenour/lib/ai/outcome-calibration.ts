/**
 * OUTCOME-PREDICTION CALIBRATION.
 *
 * v7 · BATCH 1B · Apr 28. Tracks Nick's prediction accuracy on shipped
 * content + closes the loop so future confidence statements are
 * grounded in real base rates.
 *
 * Flow:
 *   1. PREDICT — when Nick generates content, model is prompted to
 *      include a confidence statement: "I think this hits 400+ engagement"
 *   2. PARSE — predictions are extracted from assistant replies via
 *      regex on shape "X engagement / X score / X likes / X+".
 *   3. PERSIST — prediction stored in brain_memory category="prediction"
 *      with metadata.predictedScore, metadata.captionPreview, metadata.shippedToPostId
 *   4. RESOLVE — when content_performance score lands (BATCH 5), match
 *      it to the prediction via captionPreview hash → write the actual
 *      score back to the prediction row.
 *   5. CALIBRATE — every 7 days, compute Nick's prediction error rate.
 *      Inject into system prompt: "your predictions are 73% accurate
 *      within ±20% of actual. Use base rate when claiming confidence."
 *
 * Output: a calibration block injected into the content-mode system
 * prompt that says "you're calibrated to X% — make confident claims
 * only when ≥ that threshold of historical accuracy."
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
import { weekdayET } from "@/lib/utils/datetime";

// ─────────────────────────────────────────────────────────────────────
// EXTRACT predictions from assistant replies
// ─────────────────────────────────────────────────────────────────────

const PREDICTION_PATTERNS: Array<{ pattern: RegExp; metric: string }> = [
  { pattern: /\b(?:hits?|crack|reach|land|score)\s+(\d{2,4})\+?\s*(?:engagement|score|likes|saves|shares)/i, metric: "engagement" },
  { pattern: /\bI\s+think\s+this\s+(?:hits?|gets?|lands?|cracks?)\s+(\d{2,4})/i, metric: "engagement" },
  { pattern: /\b(\d{2,4})\+?\s+(?:engagement|score|likes|saves)\b/i, metric: "engagement" },
  { pattern: /\b(\d{1,3})%\s+(?:confident|sure|likely)/i, metric: "confidence_pct" },
  { pattern: /\bconfidence\s+(\d{1,3})%/i, metric: "confidence_pct" },
];

/** Inclusive ET calendar days (YYYY-MM-DD) a clicks/revenue prediction is measured over. */
export interface PredictionWindow {
  from: string;
  to: string;
}

export interface ExtractedPrediction {
  metric: string;
  value: number;
  rawMatch: string;
  /** Present only on clicks/revenue predictions; those count only with a window. */
  window?: PredictionWindow;
}

// A measured prediction needs a number, a metric we can read back, and a window, in ONE sentence.
const WINDOW_RE = /\b(today|tomorrow|this week|next (?:7|seven) days)\b|(?<!\b(?:last|past|previous)\s)\b(sun|mon|tues|wednes|thurs|fri|satur)day\b/i;
const CLICKS_RE = /\b(\d[\d,]*)\s+(?:google|search|gsc|organic)(?:\s+search)?\s+clicks\b|\b(?:google|search|gsc|organic)(?:\s+search)?\s+clicks\b[^.\d$]{0,40}?\b(\d[\d,]*)(?![\d,]|\s*(?:%|percent))/i;
// A forecast, not a report: a reported actual scored against itself would inflate accuracy.
const FORECAST_RE = /\b(?:expect(?:s|ed|ing)?|should|will|predict(?:s|ed|ing)?|forecast(?:s|ed|ing)?|projected|estimate[ds]?|likely|on track|going to|aim(?:ing)? for)\b|'ll\b/i;
const REVENUE_WORD_RE = /\b(?:sales|revenue)\b/i;
const DOLLARS_RE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*(?:\.\d{1,2})?)\s*dollars\b/i;
const WEEKDAYS = ["sun", "mon", "tues", "wednes", "thurs", "fri", "satur"];

/** ET calendar date of an instant. */
function etDate(at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Calendar arithmetic on a YYYY-MM-DD date; UTC here is only a calendar, not a clock. */
export function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function windowFor(m: RegExpExecArray, at: Date): PredictionWindow {
  const day = etDate(at);
  const weekday = weekdayET(at);
  const word = (m[1] ?? "").toLowerCase();
  if (word === "today") return { from: day, to: day };
  if (word === "tomorrow") return { from: shiftDate(day, 1), to: shiftDate(day, 1) };
  if (word === "this week") {
    // Sun-Sat, the same week startOfWeekET uses.
    const sunday = shiftDate(day, -weekday);
    return { from: sunday, to: shiftDate(sunday, 6) };
  }
  if (word) return { from: shiftDate(day, 1), to: shiftDate(day, 7) }; // next 7 days
  // A bare weekday is its next occurrence, today included.
  const target = WEEKDAYS.indexOf(m[2]!.toLowerCase());
  const d = shiftDate(day, (target - weekday + 7) % 7);
  return { from: d, to: d };
}

const toNumber = (s: string) => Number(s.replace(/,/g, ""));

function extractMeasured(text: string, at: Date): ExtractedPrediction[] {
  const found: ExtractedPrediction[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const w = WINDOW_RE.exec(sentence);
    if (!w || !FORECAST_RE.test(sentence)) continue;
    const window = windowFor(w, at);
    const clicks = CLICKS_RE.exec(sentence);
    const dollars = REVENUE_WORD_RE.test(sentence) ? DOLLARS_RE.exec(sentence) : null;
    const rawMatch = sentence.trim().slice(0, 200);
    if (clicks) {
      const value = toNumber(clicks[1] ?? clicks[2]!);
      if (value > 0) found.push({ metric: "clicks", value, rawMatch, window });
    } else if (dollars) {
      const value = toNumber(dollars[1] ?? dollars[2]!);
      if (value > 0) found.push({ metric: "revenue", value, rawMatch, window });
    }
  }
  return found;
}

/** `at` is the message time; clicks/revenue windows are ET days relative to it. */
export function extractPredictions(text: string, at: Date = new Date()): ExtractedPrediction[] {
  if (!text) return [];
  const found: ExtractedPrediction[] = [];
  for (const { pattern, metric } of PREDICTION_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      const value = parseInt(m[1], 10);
      if (!isNaN(value)) {
        found.push({ metric, value, rawMatch: m[0] });
      }
    }
  }
  return [...found, ...extractMeasured(text, at)];
}

// ─────────────────────────────────────────────────────────────────────
// PERSIST a prediction (called from chat post-process when content gen)
// ─────────────────────────────────────────────────────────────────────

interface PersistArgs {
  predictions: ExtractedPrediction[];
  /** Caption text being predicted on — used to match later against actual score */
  captionText: string;
  conversationId?: string;
  messageId?: string;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export async function persistPrediction(args: PersistArgs): Promise<void> {
  if (args.predictions.length === 0) return;
  try {
    const captionHash = fnv1a(args.captionText.slice(0, 500));
    const key = `pred:${captionHash}-${Date.now()}`;
    const summary = args.predictions
      .map((p) => `${p.metric}=${p.value}`)
      .join(" · ");
    await prisma.brainMemory.create({
      data: {
        category: "prediction",
        key,
        source: "chat_assistant",
        content: `[unresolved] ${summary} on caption: "${args.captionText.slice(0, 200)}..."`,
        confidence: 0.5, // pending — bumped after resolve
        metadata: {
          predictions: args.predictions,
          captionPreview: args.captionText.slice(0, 500),
          captionHash,
          conversationId: args.conversationId,
          messageId: args.messageId,
          predictedAt: new Date().toISOString(),
          resolved: false,
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    });
  } catch (err) {
    logError("ai.outcome-calibration", err, { fn: "persistPrediction" });
  }
}

// ─────────────────────────────────────────────────────────────────────
// RESOLVE — match prediction against actual content_performance score
// ─────────────────────────────────────────────────────────────────────

interface ResolveArgs {
  /** Caption text from the post that just got a performance score */
  captionText: string;
  /** Actual engagement-rate score (per-mille) from BATCH 5 */
  actualScore: number;
  /** What actualScore measures; errorPct is computed only against a prediction of this metric. */
  metric: "engagement" | "clicks" | "revenue";
  /** Resolve this exact row; without it, the newest unresolved row with the caption's hash. */
  predictionId?: string;
}

export async function resolvePrediction(args: ResolveArgs): Promise<{ resolved: boolean; predictionId?: string }> {
  const captionHash = fnv1a(args.captionText.slice(0, 500));

  // Find by hash
  const candidates = await prisma.brainMemory
    .findMany({
      where: args.predictionId ? { id: args.predictionId, category: "prediction" } : { category: "prediction" },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    .catch((err) => {
      logError("ai.outcome-calibration", err, { fn: "resolvePrediction.findMany" });
      return [] as Array<{ id: string; metadata: unknown; content: string }>;
    });

  const match = candidates.find((c) => {
    const m = c.metadata as { captionHash?: string; resolved?: boolean } | null;
    return (args.predictionId ? c.id === args.predictionId : m?.captionHash === captionHash) && !m?.resolved;
  });

  if (!match) return { resolved: false };

  // Update with actual score
  const meta = (match.metadata as Record<string, unknown> | null) ?? {};
  const predictions = (meta.predictions as ExtractedPrediction[] | undefined) ?? [];
  const samePred = predictions.find((p) => p.metric === args.metric)?.value;
  const errorPct = samePred && samePred > 0
    ? Math.abs(args.actualScore - samePred) / samePred
    : null;

  await prisma.brainMemory.update({
    where: { id: match.id },
    data: {
      content: `[resolved] predicted ${samePred ?? "?"} -> actual ${args.actualScore} ${args.metric}${errorPct !== null ? ` (${(errorPct * 100).toFixed(0)}% error)` : ""}`,
      confidence: errorPct !== null && errorPct < 0.2 ? 0.95 : errorPct !== null && errorPct < 0.4 ? 0.7 : 0.4,
      metadata: {
        ...meta,
        actualScore: args.actualScore,
        resolvedMetric: args.metric,
        errorPct,
        resolved: true,
        resolvedAt: new Date().toISOString(),
      } as unknown as Parameters<typeof prisma.brainMemory.update>[0]["data"]["metadata"],
    },
  });

  return { resolved: true, predictionId: match.id };
}

// ─────────────────────────────────────────────────────────────────────
// CALIBRATE — compute Nick's prediction accuracy over a window
// ─────────────────────────────────────────────────────────────────────

export interface MetricCalibration {
  /** Resolved rows that carry a measured same-metric errorPct; every rate below divides by this. */
  resolvedCount: number;
  /** Mean absolute error as % of predicted value; null when nothing was measured */
  meanErrorPct: number | null;
  within20PctRate: number | null;
  within40PctRate: number | null;
  meanBiasPct: number | null;
}

export interface CalibrationStats {
  totalPredictions: number;
  /** Measured rows of `metric` only; metrics are never pooled. Every rate below divides by this. */
  resolvedCount: number;
  pendingCount: number;
  /** The metric the top-level numbers describe: the one with the most measured rows (null = none). */
  metric: string | null;
  /** Each resolved metric on its own (predicted and actual of the SAME metric). */
  byMetric: Record<string, MetricCalibration>;
  /** Mean absolute error as % of predicted value; null when nothing was measured */
  meanErrorPct: number | null;
  /** % of predictions within +/-20% of actual */
  within20PctRate: number | null;
  /** % within +/-40%, looser bar */
  within40PctRate: number | null;
  /** Bias: avg (actual - predicted); positive = under-promised, negative = over-promised */
  meanBiasPct: number | null;
}

/** Below this many measured predictions the block hedges instead of quoting rates. */
const MIN_MEASURED = 30;

export async function getCalibrationStats(daysBack = 30): Promise<CalibrationStats> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await prisma.brainMemory
    .findMany({
      where: { category: "prediction", createdAt: { gte: since } },
      select: { metadata: true },
    })
    .catch((err) => {
      logError("ai.outcome-calibration", err, { fn: "getCalibrationStats.findMany" });
      return [] as Array<{ metadata: unknown }>;
    });

  let pending = 0;
  const acc: Record<string, { n: number; err: number; bias: number; w20: number; w40: number }> = {};

  for (const r of rows) {
    const meta = (r.metadata as {
      resolved?: boolean;
      resolvedOutcome?: string;
      errorPct?: number;
      actualScore?: number;
      resolvedMetric?: string;
      predictions?: Array<{ metric: string; value: number }>;
    } | null) ?? {};
    if (!meta.resolved) {
      pending++;
      continue;
    }
    // expired_unverifiable rows are marked resolved:true by the
    // brain-intelligence cron ONLY so they leave the pending pool — they carry
    // no measured outcome. Counting them here inflated resolvedCount past the
    // >=5 threshold while contributing zero accuracy data, so the prompt could
    // receive a fabricated "0% within ±20%" block built from rows nobody ever
    // verified (found by adversarial review, 2026-08-06). They are neither
    // resolved-with-data nor pending: skip.
    if (meta.resolvedOutcome === "expired_unverifiable") {
      continue;
    }
    // Legacy rows lack resolvedMetric: their errorPct compared an engagement guess with clicks or dollars.
    const metric = meta.resolvedMetric;
    const predicted = metric ? meta.predictions?.find((p) => p.metric === metric)?.value : undefined;
    if (!metric || typeof meta.errorPct !== "number" || typeof meta.actualScore !== "number" || !predicted) {
      continue;
    }
    const a = (acc[metric] ??= { n: 0, err: 0, bias: 0, w20: 0, w40: 0 });
    a.n++;
    a.err += meta.errorPct;
    a.bias += (meta.actualScore - predicted) / predicted;
    if (meta.errorPct < 0.2) a.w20++;
    if (meta.errorPct < 0.4) a.w40++;
  }

  const byMetric: Record<string, MetricCalibration> = {};
  for (const [metric, a] of Object.entries(acc)) {
    byMetric[metric] = {
      resolvedCount: a.n,
      meanErrorPct: a.err / a.n,
      within20PctRate: a.w20 / a.n,
      within40PctRate: a.w40 / a.n,
      meanBiasPct: a.bias / a.n,
    };
  }
  const top = Object.keys(byMetric).sort((x, y) => byMetric[y]!.resolvedCount - byMetric[x]!.resolvedCount)[0] ?? null;
  const empty: MetricCalibration = { resolvedCount: 0, meanErrorPct: null, within20PctRate: null, within40PctRate: null, meanBiasPct: null };

  return {
    totalPredictions: rows.length,
    pendingCount: pending,
    metric: top,
    byMetric,
    ...(top ? byMetric[top]! : empty),
  };
}

/**
 * Format calibration stats as a system-prompt block. Injected into
 * content-mode prompt so Nick knows his own track record.
 *
 * The resolve loop is LIVE: `resolvePrediction` (marks a prediction
 * resolved + writes back its actual score) is invoked by the
 * brain-intelligence cron (`app/api/cron/brain-intelligence/route.ts`),
 * so `resolvedCount` grows as predictions get scored. Below 30 measured
 * this emits the "insufficient data" hedge; at 30+ it emits the real
 * calibration block (accuracy + bias as a number, no order). Call site:
 * `buildCalibrationBlock()` in `lib/ai/prompt/v2/index.ts` (wired
 * 2026-08-05 — this function had ZERO callers between the V2 cutover
 * and that wire, despite an earlier comment here claiming the v1
 * system-prompt call site was live. Historical: Wave 59 once stubbed
 * this to "" while resolvePrediction had no callers.)
 */
/** How Nick must phrase a shop forecast so extractPredictions can score it: number + metric + window. */
export const BUSINESS_FORECAST_RULE =
  'For shop forecasts give a number, the metric and the window, e.g. "expect about 40 Google clicks tomorrow" or "tire sales should land near $1,200 this week"; vague calls ("more clicks than usual") cannot be scored.';

export function buildCalibrationPromptBlock(stats: CalibrationStats): string {
  const { within20PctRate, within40PctRate, meanErrorPct, meanBiasPct } = stats;
  if (stats.resolvedCount < MIN_MEASURED || within20PctRate === null || within40PctRate === null || meanErrorPct === null || meanBiasPct === null) {
    return `
=== PREDICTION CALIBRATION (insufficient data: ${stats.resolvedCount} resolved, ${MIN_MEASURED} needed) ===
You don't have enough shipped + scored predictions to calibrate confidence yet.
Make predictions when generating ("I think this hits 200+ engagement") so the loop can train. Until ${MIN_MEASURED}+ are resolved, hedge: say "early signal" instead of "high confidence."
${BUSINESS_FORECAST_RULE}
`.trim();
  }
  const within20 = (within20PctRate * 100).toFixed(0);
  const within40 = (within40PctRate * 100).toFixed(0);
  const bias = (meanBiasPct * 100).toFixed(0);
  return `
=== PREDICTION CALIBRATION (last 30 days, ${stats.resolvedCount} resolved${stats.metric ? ` ${stats.metric} predictions` : ""}) ===
Your accuracy track record:
  - ${within20}% of predictions within +/-20% of actual
  - ${within40}% within +/-40%
  - Mean error: ${(meanErrorPct * 100).toFixed(0)}%
  - Mean bias (actual vs predicted): ${meanBiasPct > 0 ? "+" : ""}${bias}%

Calibration rules:
  - Make predictions ONLY when you have base-rate evidence (similar past posts).
  - State confidence as a percentage that matches your accuracy class: if ${within20}% of your predictions hit +/-20%, don't claim "95% confident" lightly.
  - If you don't have base-rate evidence, say "early signal" or "no read yet" instead of inventing a number.
  - ${BUSINESS_FORECAST_RULE}
`.trim();
}
