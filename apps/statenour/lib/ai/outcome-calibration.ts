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

export interface ExtractedPrediction {
  metric: string;
  value: number;
  rawMatch: string;
}

export function extractPredictions(text: string): ExtractedPrediction[] {
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
  return found;
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
    console.warn("[outcome-calibration] persist failed:", err instanceof Error ? err.message : err);
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
}

export async function resolvePrediction(args: ResolveArgs): Promise<{ resolved: boolean; predictionId?: string }> {
  const captionHash = fnv1a(args.captionText.slice(0, 500));

  // Find by hash
  const candidates = await prisma.brainMemory
    .findMany({
      where: { category: "prediction" },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    .catch(() => [] as Array<{ id: string; metadata: unknown; content: string }>);

  const match = candidates.find((c) => {
    const m = c.metadata as { captionHash?: string; resolved?: boolean } | null;
    return m?.captionHash === captionHash && !m?.resolved;
  });

  if (!match) return { resolved: false };

  // Update with actual score
  const meta = (match.metadata as Record<string, unknown> | null) ?? {};
  const predictions = (meta.predictions as ExtractedPrediction[] | undefined) ?? [];
  const engagementPred = predictions.find((p) => p.metric === "engagement")?.value;
  const errorPct = engagementPred && engagementPred > 0
    ? Math.abs(args.actualScore - engagementPred) / engagementPred
    : null;

  await prisma.brainMemory.update({
    where: { id: match.id },
    data: {
      content: `[resolved] predicted ${engagementPred ?? "?"} → actual ${args.actualScore}${errorPct !== null ? ` (${(errorPct * 100).toFixed(0)}% error)` : ""}`,
      confidence: errorPct !== null && errorPct < 0.2 ? 0.95 : errorPct !== null && errorPct < 0.4 ? 0.7 : 0.4,
      metadata: {
        ...meta,
        actualScore: args.actualScore,
        errorPct,
        resolved: true,
        resolvedAt: new Date().toISOString(),
      } as unknown as Parameters<typeof prisma.brainMemory.update>[0]["data"]["metadata"],
    },
  }).catch(() => {});

  return { resolved: true, predictionId: match.id };
}

// ─────────────────────────────────────────────────────────────────────
// CALIBRATE — compute Nick's prediction accuracy over a window
// ─────────────────────────────────────────────────────────────────────

export interface CalibrationStats {
  totalPredictions: number;
  resolvedCount: number;
  pendingCount: number;
  /** Mean absolute error as % of predicted value */
  meanErrorPct: number;
  /** % of predictions within ±20% of actual */
  within20PctRate: number;
  /** % within ±40% — looser bar */
  within40PctRate: number;
  /** Bias: avg (actual - predicted) — positive = under-promised, negative = over-promised */
  meanBiasPct: number;
}

export async function getCalibrationStats(daysBack = 30): Promise<CalibrationStats> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await prisma.brainMemory
    .findMany({
      where: { category: "prediction", createdAt: { gte: since } },
      select: { metadata: true },
    })
    .catch(() => [] as Array<{ metadata: unknown }>);

  let resolved = 0;
  let pending = 0;
  let sumErrorPct = 0;
  let sumBiasPct = 0;
  let within20 = 0;
  let within40 = 0;

  for (const r of rows) {
    const meta = (r.metadata as {
      resolved?: boolean;
      errorPct?: number;
      actualScore?: number;
      predictions?: Array<{ metric: string; value: number }>;
    } | null) ?? {};
    if (!meta.resolved) {
      pending++;
      continue;
    }
    resolved++;
    const eng = meta.predictions?.find((p) => p.metric === "engagement")?.value;
    if (typeof meta.errorPct === "number" && typeof meta.actualScore === "number" && eng) {
      sumErrorPct += meta.errorPct;
      sumBiasPct += (meta.actualScore - eng) / eng;
      if (meta.errorPct < 0.2) within20++;
      if (meta.errorPct < 0.4) within40++;
    }
  }

  return {
    totalPredictions: rows.length,
    resolvedCount: resolved,
    pendingCount: pending,
    meanErrorPct: resolved > 0 ? sumErrorPct / resolved : 0,
    within20PctRate: resolved > 0 ? within20 / resolved : 0,
    within40PctRate: resolved > 0 ? within40 / resolved : 0,
    meanBiasPct: resolved > 0 ? sumBiasPct / resolved : 0,
  };
}

/**
 * Format calibration stats as a system-prompt block. Injected into
 * content-mode prompt so Nick knows his own track record.
 *
 * Wave 59 · NO-OP until the resolve loop is wired. `resolvePrediction`
 * — the step that marks predictions resolved + writes back the actual
 * score — has zero call sites, so `resolvedCount` is permanently 0.
 * That meant this function only ever emitted the "insufficient data"
 * hedge, injecting pure prompt noise into every content-mode system
 * prompt. Returning "" makes it a no-op so it stops polluting prompts;
 * the call site (`lib/ai/system-prompt.ts`) already guards `if
 * (calibBlock)` so an empty string is skipped cleanly. The `stats`
 * param + return type are preserved so callers are untouched. Restore
 * the real block (git history) once resolvePrediction is invoked from
 * the BATCH-5 content_performance scoring path.
 */
export function buildCalibrationPromptBlock(stats: CalibrationStats): string {
  if (stats.resolvedCount < 5) {
    return `
═══ PREDICTION CALIBRATION (insufficient data — fewer than 5 resolved predictions) ═══
You don't have enough shipped + scored predictions to calibrate confidence yet.
Make predictions when generating ("I think this hits 200+ engagement") so the loop can train. Until 30+ are resolved, hedge: say "early signal" instead of "high confidence."
`.trim();
  }
  const within20 = (stats.within20PctRate * 100).toFixed(0);
  const within40 = (stats.within40PctRate * 100).toFixed(0);
  const bias = stats.meanBiasPct;
  const biasNote = bias > 0.1
    ? `You tend to UNDER-PROMISE by ${(bias * 100).toFixed(0)}% — be bolder.`
    : bias < -0.1
      ? `You tend to OVER-PROMISE by ${Math.abs(bias * 100).toFixed(0)}% — temper your claims.`
      : "Your predictions are well-calibrated (no consistent bias).";
  return `
═══ PREDICTION CALIBRATION (last 30 days, ${stats.resolvedCount} resolved) ═══
Your accuracy track record:
  · ${within20}% of predictions within ±20% of actual
  · ${within40}% within ±40%
  · Mean error: ${(stats.meanErrorPct * 100).toFixed(0)}%
  · ${biasNote}

Calibration rules:
  · Make predictions ONLY when you have base-rate evidence (similar past posts).
  · State confidence as a percentage that matches your accuracy class — if ${within20}% of your predictions hit ±20%, don't claim "95% confident" lightly.
  · If you don't have base-rate evidence, say "early signal" or "no read yet" instead of inventing a number.
`.trim();
}
