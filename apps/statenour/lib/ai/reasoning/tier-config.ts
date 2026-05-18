/**
 * lib/ai/reasoning/tier-config.ts · Phase O.1 (2026-05-18 PM)
 *
 * Single source of truth for per-tier configuration. Pre-O the tier-
 * specific numbers were scattered across `budget.ts:estimateTierCost`,
 * `engine.ts:buildResult` callCost, the critique branch, the tier-
 * picker UI · adding a new tier (like M.1's `smart`) required hunting
 * 5+ files to update them all. Easy to miss one · silent failure.
 *
 * Now: `TIER_CONFIG: Record<ReasoningTier, TierConfig>` enforces
 * exhaustiveness at compile time. TypeScript yells if a new tier is
 * added to `ReasoningTier` without a config entry. Each tier's
 * behavior toggles (critique · refine · router) live here too · the
 * engine reads them instead of branching by string literal.
 */

import type { ReasoningTier } from "./types";

export interface TierConfig {
  /** Operator-facing label */
  label: string;
  /** Pre-execution estimate · drives the budget gate cap */
  budgetEstimateUsd: number;
  /** Per-call cost used by buildResult fallback estimate when accumulator
   *  is empty or under the known-cost threshold */
  callCostEstimate: number;
  /** Whether to run the critique step after draft */
  hasCritique: boolean;
  /** Whether to run the refine step after critique (only if critique
   *  returns "refine" verdict · hasCritique implied) */
  hasRefine: boolean;
  /** Whether the hierarchical router (M.1) runs · only smart tier */
  usesRouter: boolean;
  /** Operator-facing hint shown on the tier pill */
  hint: string;
}

/**
 * Adding a new tier to ReasoningTier WITHOUT updating this map is a
 * compile error. The Record<K, V> shape forces every union member to
 * have an entry.
 */
export const TIER_CONFIG: Record<ReasoningTier, TierConfig> = {
  quick: {
    label: "quick",
    budgetEstimateUsd: 0.0005,
    callCostEstimate: 0.00015,
    hasCritique: false,
    hasRefine: false,
    usesRouter: false,
    hint: "passthrough · standard chat",
  },
  standard: {
    label: "standard",
    budgetEstimateUsd: 0.006,
    callCostEstimate: 0.0008,
    hasCritique: true,
    hasRefine: false,
    usesRouter: false,
    hint: "~5s · ~$0.005",
  },
  smart: {
    label: "smart",
    budgetEstimateUsd: 0.015,
    callCostEstimate: 0.0015,
    hasCritique: true,
    hasRefine: true,
    usesRouter: true, // M.1 · the only tier that runs the router
    hint: "~10s · ~$0.015 · router picks sources",
  },
  deep: {
    label: "deep",
    budgetEstimateUsd: 0.025,
    callCostEstimate: 0.002,
    hasCritique: true,
    hasRefine: true,
    usesRouter: false,
    hint: "~15s · ~$0.02",
  },
  thorough: {
    label: "thorough",
    budgetEstimateUsd: 0.12,
    callCostEstimate: 0.005,
    hasCritique: true,
    hasRefine: true,
    usesRouter: false,
    hint: "~45s · ~$0.10",
  },
  mega: {
    label: "mega",
    budgetEstimateUsd: 0.25,
    callCostEstimate: 0.008,
    hasCritique: true,
    hasRefine: true,
    usesRouter: false,
    hint: "~90s · ~$0.20 · everything",
  },
};

/** Type-safe accessor · returns the config or throws if tier is somehow
 *  missing (should never happen given the Record exhaustiveness check). */
export function getTierConfig(tier: ReasoningTier): TierConfig {
  const cfg = TIER_CONFIG[tier];
  if (!cfg) {
    // Defensive · TS already enforces this at compile time
    throw new Error(`TIER_CONFIG missing entry for tier "${tier}"`);
  }
  return cfg;
}

/** All tiers in operator-facing display order (cheap → expensive).
 *  Used by the UI tier picker so adding a new tier auto-shows up in
 *  display order. */
export const TIER_ORDER: readonly ReasoningTier[] = [
  "quick",
  "standard",
  "smart",
  "deep",
  "thorough",
  "mega",
] as const;
