/**
 * Q-32 · deterministic eval intake + paired/PPI statistics.
 *
 * Production selection is metadata-only: it chooses traces that deserve human
 * review without exporting raw conversation text. The actual text already lives
 * on the Langfuse trace; this module only emits stable reasons and a content
 * hash so the selector can be audited without creating a second PII store.
 */

import { createHash } from "node:crypto";

export const Q32_DATASET_VERSION = "2026-09-29.v1";
export const Q32_ANNOTATION_QUEUE_KEY = "nour-os-q32-regression-review";

export const Q32_SIGNALS = [
  "thumbs_down",
  "l2_verifier_banner",
  "evidence_gate_block",
  "context_threshold_drop",
] as const;
export type Q32Signal = (typeof Q32_SIGNALS)[number];

export interface Q32PersistedTurn {
  id: string;
  createdAt: Date | string;
  feedbackScore?: number | null;
  content?: string | null;
  model?: string | null;
  provider?: string | null;
  tokenUsage?: unknown;
}

export interface Q32Selection {
  messageId: string;
  traceId: string | null;
  createdAt: string;
  signals: Q32Signal[];
  contentHash: string;
  model: string | null;
  provider: string | null;
  queueKey: typeof Q32_ANNOTATION_QUEUE_KEY;
  datasetVersion: typeof Q32_DATASET_VERSION;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function q32ContentHash(content: string | null | undefined): string {
  return createHash("sha256")
    .update((content ?? "").replace(/\s+/g, " ").trim())
    .digest("hex");
}

export function isL2VerifierBanner(content: string | null | undefined): boolean {
  if (!content?.startsWith("[VERIFIER ·")) return false;
  const first = content.split("\n", 1)[0] ?? "";
  // These are the two action-honesty banners the existing calibration module
  // classifies as repairable L2/action-receipt outcomes. Known-truth banners
  // share the marker but are a different lane and must not pollute this cohort.
  return (
    first.includes("but no matching tool call fired") ||
    first.includes("claimed action(s)")
  );
}

export function hasEvidenceGateBlock(tokenUsage: unknown): boolean {
  const usage = record(tokenUsage);
  const gate = record(usage?.evidenceGate);
  return gate?.verdict === "block";
}

export function hasActualContextThresholdDrop(tokenUsage: unknown): boolean {
  const usage = record(tokenUsage);
  const receipt = record(usage?.contextReceipt);
  const entries = Array.isArray(receipt?.entries) ? receipt.entries : [];
  return entries.some((entry) => {
    const e = record(entry);
    return e?.kept === false && e?.reason === "below_threshold";
  });
}

export function selectQ32Turn(turn: Q32PersistedTurn): Q32Selection | null {
  const signals: Q32Signal[] = [];
  if (turn.feedbackScore === -1) signals.push("thumbs_down");
  if (isL2VerifierBanner(turn.content)) signals.push("l2_verifier_banner");
  if (hasEvidenceGateBlock(turn.tokenUsage)) signals.push("evidence_gate_block");
  if (hasActualContextThresholdDrop(turn.tokenUsage)) signals.push("context_threshold_drop");
  if (signals.length === 0) return null;

  const usage = record(turn.tokenUsage);
  const traceId = stringValue(usage?.traceId);
  const createdAt =
    turn.createdAt instanceof Date
      ? turn.createdAt.toISOString()
      : new Date(turn.createdAt).toISOString();

  return {
    messageId: turn.id,
    traceId,
    createdAt,
    signals,
    contentHash: q32ContentHash(turn.content),
    model: turn.model ?? null,
    provider: turn.provider ?? null,
    queueKey: Q32_ANNOTATION_QUEUE_KEY,
    datasetVersion: Q32_DATASET_VERSION,
  };
}

export function modelFamily(model: string | null | undefined): string {
  const raw = (model ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (/claude|anthropic/.test(raw)) return "anthropic";
  if (/gpt|o\d|openai/.test(raw)) return "openai";
  if (/gemini|google/.test(raw)) return "google";
  if (/llama|meta/.test(raw)) return "meta";
  if (/mistral|mixtral/.test(raw)) return "mistral";
  if (/qwen|alibaba/.test(raw)) return "qwen";
  if (/deepseek/.test(raw)) return "deepseek";
  if (/glm|zhipu/.test(raw)) return "zhipu";
  if (/minimax/.test(raw)) return "minimax";
  return "unknown";
}

/** Q-32 single owner for runtime lane classification: model wins over host. */
export function modelFamilyFromLane(
  provider?: string | null,
  model?: string | null,
): string {
  const byModel = modelFamily(model);
  if (byModel !== "unknown") return byModel;
  const p = (provider ?? "").trim().toLowerCase();
  if (!p) return "unknown";
  if (p === "anthropic") return "anthropic";
  if (p === "openai") return "openai";
  if (p === "google") return "google";
  if (p === "meta") return "meta";
  return p;
}

export function assertDifferentJudgeFamily(
  candidateModel: string,
  judgeModel: string,
): void {
  const candidate = modelFamily(candidateModel);
  const judge = modelFamily(judgeModel);
  if (candidate === "unknown" || judge === "unknown") {
    throw new Error(
      `Q-32 family separation requires known candidate + judge families (candidate=${candidate}, judge=${judge})`,
    );
  }
  if (candidate === judge) {
    throw new Error(
      `Q-32 judge must be a different model family (both resolved to ${candidate})`,
    );
  }
}

export interface PairedPpiItem {
  /** Judge score for the approved/baseline output, normally 0..1. */
  judgeBaseline: number;
  /** Judge score for the candidate output, normally 0..1. */
  judgeCandidate: number;
  /** Human score when this item was double-labeled. */
  humanBaseline?: number;
  humanCandidate?: number;
}

export interface PairedPpiInterval {
  estimate: number;
  lower: number;
  upper: number;
  judgeMeanDelta: number;
  correctionMean: number;
  labeled: number;
  total: number;
  standardError: number;
}

function finite(values: number[]): number[] {
  return values.filter(Number.isFinite);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1);
}

/**
 * Prediction-powered paired delta:
 *   mean(judge candidate-baseline on all items)
 * + mean((human delta - judge delta) on the human-labeled subset).
 *
 * The normal interval is deliberately transparent and dependency-free. It is
 * an approximate PPI interval, not a substitute for the human-label minimum:
 * callers still gate promotion on >=30 double-labeled items and kappa.
 */
export function pairedPpiDeltaInterval(
  items: readonly PairedPpiItem[],
  z = 1.96,
): PairedPpiInterval {
  if (items.length === 0) {
    throw new Error("Q-32 PPI interval requires at least one paired item");
  }

  const judgeDeltas = finite(
    items.map((x) => x.judgeCandidate - x.judgeBaseline),
  );
  if (judgeDeltas.length !== items.length) {
    throw new Error("Q-32 PPI interval received non-finite judge scores");
  }

  const corrections = items.flatMap((x) => {
    if (
      typeof x.humanBaseline !== "number" ||
      typeof x.humanCandidate !== "number" ||
      !Number.isFinite(x.humanBaseline) ||
      !Number.isFinite(x.humanCandidate)
    ) {
      return [];
    }
    const judgeDelta = x.judgeCandidate - x.judgeBaseline;
    const humanDelta = x.humanCandidate - x.humanBaseline;
    return [humanDelta - judgeDelta];
  });

  const judgeMeanDelta = mean(judgeDeltas);
  const correctionMean = mean(corrections);
  const estimate = judgeMeanDelta + correctionMean;
  const judgeVar = sampleVariance(judgeDeltas) / judgeDeltas.length;
  const correctionVar =
    corrections.length > 0 ? sampleVariance(corrections) / corrections.length : 0;
  const standardError = Math.sqrt(judgeVar + correctionVar);
  const margin = z * standardError;

  return {
    estimate,
    lower: estimate - margin,
    upper: estimate + margin,
    judgeMeanDelta,
    correctionMean,
    labeled: corrections.length,
    total: items.length,
    standardError,
  };
}

export function cohensKappa(
  human: readonly boolean[],
  judge: readonly boolean[],
): number | null {
  if (human.length !== judge.length || human.length === 0) return null;
  let agree = 0;
  let humanYes = 0;
  let judgeYes = 0;
  for (let i = 0; i < human.length; i++) {
    if (human[i] === judge[i]) agree++;
    if (human[i]) humanYes++;
    if (judge[i]) judgeYes++;
  }
  const n = human.length;
  const observed = agree / n;
  const pHuman = humanYes / n;
  const pJudge = judgeYes / n;
  const expected = pHuman * pJudge + (1 - pHuman) * (1 - pJudge);
  if (expected === 1) return observed === 1 ? 1 : null;
  return (observed - expected) / (1 - expected);
}
