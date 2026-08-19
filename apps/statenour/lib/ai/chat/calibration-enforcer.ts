/**
 * lib/ai/chat/calibration-enforcer.ts · calibration lever, enforcement
 * half (2026-08-18). Detection lives in
 * lib/ai/vnext/truth/forecast-detector.ts.
 *
 * WHAT IT DOES — when a forecast-shaped ask got a reply with no
 * likelihood band, this layer appends a calibration footer BEFORE the
 * reply persists (same station as the fabrication verifier L2):
 *
 *   1 · ELICITED (preferred): one cheap classify-profile call asks the
 *       model to state its OWN credence for the prediction it just made
 *       — first listing the plausible alternative outcomes, THEN the
 *       band. The distractor-first ordering is the ICLR '26 steal
 *       (arXiv 2509.25532): naming alternatives before committing
 *       breaks single-answer anchoring, the main source of verbalized
 *       overconfidence. Output is VALIDATED through parseEstimative —
 *       an elicitation that fails to parse is treated as a failure,
 *       never appended.
 *   2 · DETERMINISTIC FALLBACK: when the call fails, times out, or
 *       emits garbage, a marked "uncalibrated forecast" notice is
 *       appended instead. Honest absence beats fake precision — this
 *       layer must NEVER invent a probability itself.
 *
 * Why elicit at all instead of banner-only: the Brier flywheel
 * (BDN-106) can only grade turns that carry a probability. The footer
 * tag `[~NN% · conf: x]` is parseEstimative-readable, so every
 * enforced turn becomes gradeable — and the flywheel then measures
 * empirically how overconfident the elicited numbers are, which is the
 * data the k-sample upgrade needs to justify itself.
 *
 * Why plain aiChat, not tracedAiChat: this module also runs inside the
 * eval harness (tests/eval/run-suite.ts replays the SYSTEM, not the
 * bare model), and traced-aichat carries `import "server-only"` which
 * throws under bare tsx. Cost is ~$0.0001/fire on the classify
 * profile, post-stream, firewall-honored.
 *
 * Kill-switch: NICK_CALIBRATION_ENFORCER=0 (default ON — operator
 * ordered this lever built; same explicit-instruction precedent as the
 * memory-gateway Phase-2 flip).
 */

import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";
import {
  bandForProbability,
  parseEstimative,
  type ConfidenceLevel,
} from "@/lib/ai/vnext/truth/estimative";
import { needsCalibration } from "@/lib/ai/vnext/truth/forecast-detector";

const log = rootLogger.withSurface("ai/calibration-enforcer");

/** Marker on every footer this layer appends — idempotency + telemetry grep. */
export const CALIBRATION_MARKER = "[calibration";

export function isCalibrationEnforcerOn(): boolean {
  return process.env.NICK_CALIBRATION_ENFORCER !== "0";
}

export function hasCalibrationFooter(text: string): boolean {
  return (text ?? "").includes(CALIBRATION_MARKER);
}

/**
 * The deterministic fallback. Marked, honest, invents nothing.
 * Italics + brackets match the verifier-banner visual family.
 */
export function buildUncalibratedNotice(): string {
  return `\n\n_${CALIBRATION_MARKER} missing — forecast stated with no likelihood band; treat the number as uncalibrated]_`;
}

const ELICIT_SYSTEM = `You are the calibration pass for a prediction you (Nick) just made. Think like a forecaster being Brier-scored.

Step 1 — silently consider the 2-3 most plausible ALTERNATIVE outcomes to the prediction (this is required: alternatives break anchoring).
Step 2 — output EXACTLY one line, nothing else:

Calibration: <ODNI band> [~NN% · conf: high|moderate|low] — <biggest evidence weakness, max 8 words>

ODNI bands: almost no chance / very unlikely / unlikely / roughly even chance / likely / very likely / almost certain. NN is YOUR percent for the prediction as stated. conf grades the EVIDENCE BASE, not the odds — low confidence in a likely call is valid, high confidence in a 30% call is valid.

NO preamble. NO restating the prediction. ONE line starting with "Calibration:".`;

type AiChatFn = (typeof import("@/lib/ai/provider"))["aiChat"];

async function _elicitCalibration(
  aiChat: AiChatFn,
  args: {
    userQuery: string;
    replyText: string;
  },
): Promise<string | null> {
  const result = await aiChat(
    [
      { role: "system", content: ELICIT_SYSTEM },
      {
        role: "user",
        content: `OPERATOR ASKED: ${args.userQuery.slice(0, 600)}\n\nYOUR PREDICTION: ${args.replyText.slice(0, 1600)}\n\nOutput the one Calibration line.`,
      },
    ],
    "classify",
  );
  // aiChat never throws on total failure — sentinel check is mandatory
  // (the repo gotcha; the eval runner learned this the hard way).
  if (result.provider === "emergency" || result.provider === "none") return null;
  // First live run's lesson: models drop the "Calibration:" prefix
  // often enough that prefix-matching starved the elicited path (the
  // fallback notice fired instead). Extraction now hunts ANY line the
  // Brier reader fully validates — the tag is the contract, not the
  // prefix. Prefixed lines still win when present.
  const lines = (result.content ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const candidates = [
    ...lines.filter((l) => /^calibration:/i.test(l)),
    ...lines,
  ];
  for (const line of candidates) {
    // Validate through the SAME reader the Brier flywheel uses. If the
    // flywheel can't score it, it doesn't ship.
    const reading = parseEstimative(line);
    if (reading.tagged && reading.likelihood !== null && reading.confidence !== null) {
      return line;
    }
  }
  return null;
}

// ── k-sample aggregation (2026-08-18 upgrade) ────────────────────────
//
// The consistency literature's core result: agreement across k
// independent samples tracks correctness better than any single
// verbalized claim (black-box friendly — no logits needed). So for
// k > 1 the layer samples the elicitation k times CONCURRENTLY and
// aggregates:
//   · likelihood = MEDIAN of the valid samples' percentages (robust to
//     one outlier sample in a way the mean is not)
//   · confidence = the MORE CONSERVATIVE of (a) inter-sample dispersion
//     mapped to a level (tight agreement ≤10pts → high, ≤25 → moderate,
//     else low) and (b) the median stated confidence — dispersion may
//     DOWNGRADE the model's self-report, never inflate it. Confidence
//     still grades evidence; agreement is its proxy, not its override.
//   · band label = bandForProbability(median), so the footer's words
//     and its number can never disagree.
//
// Operator note: this shipped on explicit order ahead of the Brier
// evidence gate the arc doc recorded — their call; k× cost is pennies.
// NICK_CALIBRATION_K (default 3, clamp 1..5); k=1 degrades to the
// single-shot behavior exactly.

const K_DEFAULT = 3;
const K_MAX = 5;

export function getCalibrationK(): number {
  const raw = Number(process.env.NICK_CALIBRATION_K ?? K_DEFAULT);
  if (!Number.isInteger(raw)) return K_DEFAULT;
  return Math.max(1, Math.min(K_MAX, raw));
}

const CONF_RANK: Record<ConfidenceLevel, number> = { low: 0, moderate: 1, high: 2 };

export interface CalibrationSample {
  likelihood: number; // 0..1
  confidence: ConfidenceLevel;
  /** The "— <weakness>" tail of the sample line, when present. */
  weakness: string | null;
}

export interface AggregatedCalibration {
  likelihood: number;
  confidence: ConfidenceLevel;
  bandLabel: string;
  weakness: string | null;
  validCount: number;
  /** Max−min of sample percentages, in points. 0 when only one sample. */
  spreadPts: number;
}

/** Pure — exported for tests. Returns null when no samples are valid. */
export function aggregateSamples(
  samples: readonly CalibrationSample[],
): AggregatedCalibration | null {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a.likelihood - b.likelihood);
  const mid = Math.floor(sorted.length / 2);
  const likelihood =
    sorted.length % 2 === 1
      ? sorted[mid].likelihood
      : (sorted[mid - 1].likelihood + sorted[mid].likelihood) / 2;

  const spreadPts =
    Math.round((sorted[sorted.length - 1].likelihood - sorted[0].likelihood) * 100 * 10) / 10;

  const dispersionConf: ConfidenceLevel =
    samples.length < 2 ? "high" : spreadPts <= 10 ? "high" : spreadPts <= 25 ? "moderate" : "low";
  const statedSorted = [...samples].sort(
    (a, b) => CONF_RANK[a.confidence] - CONF_RANK[b.confidence],
  );
  // Lower-middle on even counts — ties in stated confidence resolve
  // CONSERVATIVELY, matching the min() below. [moderate, high] reads
  // as moderate, never high.
  const statedMedian = statedSorted[Math.floor((statedSorted.length - 1) / 2)].confidence;
  const confidence =
    CONF_RANK[dispersionConf] < CONF_RANK[statedMedian] ? dispersionConf : statedMedian;

  const band = bandForProbability(likelihood);
  return {
    likelihood,
    confidence,
    bandLabel: band?.label ?? "",
    weakness: samples.find((s) => s.weakness)?.weakness ?? null,
    validCount: samples.length,
    spreadPts,
  };
}

function sampleFromLine(line: string): CalibrationSample | null {
  const reading = parseEstimative(line);
  if (!reading.tagged || reading.likelihood === null || reading.confidence === null) return null;
  const weakness = /—\s*(.{3,80})$/.exec(line)?.[1]?.trim() ?? null;
  return { likelihood: reading.likelihood, confidence: reading.confidence, weakness };
}

async function _elicitAggregate(args: {
  userQuery: string;
  replyText: string;
  k: number;
}): Promise<AggregatedCalibration | null> {
  // Import ONCE, then fan out. Three concurrent first-time dynamic
  // imports of the same module raced vitest's mock registry (one shot
  // got the mock, two escaped to the real provider) — and a single
  // import is simply less work either way.
  const { aiChat } = await import("@/lib/ai/provider");
  const shots = await Promise.all(
    Array.from({ length: args.k }, () =>
      _elicitCalibration(aiChat, args).catch(() => null),
    ),
  );
  const samples = shots
    .filter((l): l is string => typeof l === "string")
    .map(sampleFromLine)
    .filter((s): s is CalibrationSample => s !== null);
  return aggregateSamples(samples);
}

const elicitAggregate = withGuardian("calibration-enforcer", _elicitAggregate, {
  // Samples run concurrently, so wall-clock ≈ the slowest single call;
  // 9s covers a slow classify shot (judge-eval runs 8s). The first live
  // run's 3s starved real elicitations into the fallback path.
  timeoutMs: 9_000,
  maxRetries: 0,
  reliabilityOnly: true,
});

export interface CalibrationResult {
  text: string;
  /** What happened — for telemetry and the eval's receipts. */
  action: "skipped" | "elicited" | "fallback-notice";
  skipReason?: string;
}

/**
 * The layer's single entry point. Returns the (possibly augmented)
 * reply text. Never throws; never blocks persist on failure.
 */
export async function enforceCalibration(
  userQuery: string,
  replyText: string,
): Promise<CalibrationResult> {
  if (!isCalibrationEnforcerOn()) return { text: replyText, action: "skipped", skipReason: "kill-switch" };
  if (hasCalibrationFooter(replyText)) return { text: replyText, action: "skipped", skipReason: "already-footered" };

  const verdict = needsCalibration(userQuery, replyText);
  if (!verdict.needed) return { text: replyText, action: "skipped", skipReason: verdict.reason };

  const k = getCalibrationK();
  try {
    const agg = await elicitAggregate({ userQuery, replyText, k });
    if (agg) {
      const pct = Math.round(agg.likelihood * 100);
      const kNote =
        k > 1 ? ` (k=${k} · ${agg.validCount} valid${agg.validCount >= 2 ? ` · spread ${agg.spreadPts}pts` : ""})` : "";
      const weakness = agg.weakness ? ` — ${agg.weakness}` : "";
      const body = `${agg.bandLabel} [~${pct}% · conf: ${agg.confidence}]${weakness}${kNote}`;
      log.info("calibration_elicited", { k, valid: agg.validCount, spreadPts: agg.spreadPts, pct });
      return { text: `${replyText}\n\n_${CALIBRATION_MARKER}] ${body}_`, action: "elicited" };
    }
  } catch (err) {
    log.warn("calibration_elicit_failed", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
  }
  return { text: `${replyText}${buildUncalibratedNotice()}`, action: "fallback-notice" };
}
