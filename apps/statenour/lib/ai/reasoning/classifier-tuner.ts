/**
 * lib/ai/reasoning/classifier-tuner.ts · Phase N.2 (2026-05-18 PM)
 *
 * Closes the H.5.3 learning loop. H.5.3 scored each classifier marker
 * (good · ok · tune) based on past trace confidence + fallback rate.
 * Pre-N.2 the verdict was VISIBLE in /reason/telemetry but the
 * classifier didn't USE it · purely regex.
 *
 * Now: this module reads the marker-quality verdicts from BrainMemory
 * traces · returns a tuning map · classifyReasoning consults the map
 * BEFORE returning a verdict · markers tagged "tune" get demoted
 * (deep → standard, smart → standard) so the operator stops paying
 * deep-tier prices for markers that historically produce weak answers.
 *
 * Caching: in-memory module map · refresh every 30 minutes or on
 * forceRefresh. Cheap (single SELECT 500 rows) but no point running
 * it per-request.
 *
 * Safety: the tuner can ONLY demote · never promote. A "tune"-tagged
 * marker for the deep tier becomes standard tier. It can't elevate
 * a standard marker to deep (that would be a learning attack vector ·
 * malicious or accidental).
 */

import type { ReasoningTier } from "./types";

interface MarkerVerdict {
  marker: string;
  verdict: "good" | "ok" | "tune";
  avgConfidence: number;
  fallbackRate: number;
  sampleSize: number;
}

interface TunerState {
  verdictsByMarker: Map<string, MarkerVerdict>;
  refreshedAt: number;
}

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_SAMPLE_SIZE = 5; // don't demote based on <5 historical runs

let state: TunerState | null = null;

async function refresh(): Promise<TunerState> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.brainMemory.findMany({
      where: { category: "reasoning_trace", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { confidence: true, metadata: true },
    });

    // Group by classifier-reason first-word bucket (same bucketing as
    // /api/nick/reason/telemetry · H.5.3)
    const byMarker = new Map<
      string,
      { confidences: number[]; fallbacks: number }
    >();
    for (const r of rows) {
      const m = (r.metadata ?? {}) as { classifierReason?: string };
      const reason = (m.classifierReason ?? "").trim();
      if (!reason) continue;
      const marker = reason.split(/\s+/)[0] || "other";
      const e = byMarker.get(marker) ?? { confidences: [], fallbacks: 0 };
      const conf = r.confidence ?? 0;
      e.confidences.push(conf);
      if (conf <= 0.3) e.fallbacks += 1;
      byMarker.set(marker, e);
    }

    const verdictsByMarker = new Map<string, MarkerVerdict>();
    for (const [marker, e] of byMarker) {
      if (e.confidences.length < MIN_SAMPLE_SIZE) continue;
      const avgConfidence =
        e.confidences.reduce((s, n) => s + n, 0) / e.confidences.length;
      const fallbackRate = (e.fallbacks / e.confidences.length) * 100;
      const verdict: MarkerVerdict["verdict"] =
        avgConfidence >= 0.75 && fallbackRate < 10
          ? "good"
          : avgConfidence >= 0.5 && fallbackRate < 25
            ? "ok"
            : "tune";
      verdictsByMarker.set(marker, {
        marker,
        verdict,
        avgConfidence,
        fallbackRate,
        sampleSize: e.confidences.length,
      });
    }

    return { verdictsByMarker, refreshedAt: Date.now() };
  } catch {
    // Fail safe · return empty map · classifier behaves as if tuner
    // returned no opinion (= no demotion). Don't degrade legacy behavior.
    return { verdictsByMarker: new Map(), refreshedAt: Date.now() };
  }
}

async function getState(forceRefresh = false): Promise<TunerState> {
  const now = Date.now();
  if (
    !state ||
    forceRefresh ||
    now - state.refreshedAt > REFRESH_INTERVAL_MS
  ) {
    state = await refresh();
  }
  return state;
}

/** Adjust a classifier verdict using the learned tuner state. Only
 *  demotes (deep → standard · smart → standard · thorough → deep) ·
 *  never promotes. Returns the input untouched if no opinion exists.
 *
 *  Operator-explicit tier overrides (request.tier) are NEVER touched
 *  by this · they bypass the auto-classifier entirely upstream. */
export async function maybeAdjustTier(
  classifierReason: string,
  tier: ReasoningTier,
): Promise<{ tier: ReasoningTier; adjusted: boolean; verdict?: MarkerVerdict }> {
  const trimmed = classifierReason.trim();
  if (!trimmed) return { tier, adjusted: false };
  const marker = trimmed.split(/\s+/)[0] || "other";

  const s = await getState();
  const v = s.verdictsByMarker.get(marker);
  if (!v) return { tier, adjusted: false };

  // Only demote on "tune" verdict
  if (v.verdict !== "tune") return { tier, adjusted: false, verdict: v };

  const demotion: Record<ReasoningTier, ReasoningTier> = {
    quick: "quick",
    standard: "standard", // already cheapest non-quick · nothing to demote to
    smart: "standard",
    deep: "standard",
    thorough: "deep",
    mega: "thorough",
  };
  const newTier = demotion[tier];
  return {
    tier: newTier,
    adjusted: newTier !== tier,
    verdict: v,
  };
}

/** For tests + debug introspection */
export async function snapshotTuner(): Promise<TunerState> {
  return getState(true);
}

export const __internals = { refresh, getState };
