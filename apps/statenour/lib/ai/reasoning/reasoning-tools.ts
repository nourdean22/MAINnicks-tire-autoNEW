/**
 * lib/ai/reasoning/reasoning-tools.ts
 *
 * Read-only tool subset for the reasoning engine.
 *
 * The reasoning engine (engine.ts) runs a multi-step classify → plan →
 * gather → draft → critique → refine pipeline. Historically the engine
 * was "tool-blind" — it couldn't call any tools, so the chat route pre-
 * fetched a getDashboardSummary snapshot as a workaround.
 *
 * This module exposes a curated subset of nourTools that the engine's
 * new `runToolGather` step can pass to `generateText`. The whitelist
 * is STRICTLY read-only:
 *   · YES: getRevenueStats, getDashboardSummary, getReviewStats, etc.
 *   · NO:  createTask, sendSMS, triageStaleLead, etc.
 *
 * The engine should OBSERVE current state, never ACT. Write-capable
 * tools stay in the chat-route-only path where the operator can see
 * and approve side effects in real time.
 *
 * Gated by the NICK_DEEP_REASONING feature flag — when off, the
 * engine never reaches this module.
 */
import "server-only";

import { REASONING_TOOL_WHITELIST_ENTRIES } from "./whitelist";

import { businessTools } from "@/lib/ai/tools/business";
import { systemTools } from "@/lib/ai/tools/system";
import { brainTools } from "@/lib/ai/tools/brain";
// 2026-08-19 · social added to the sources: `draftOpportunitySms` (a
// genuine read — deterministic draft via the bridge, never sends) had
// been whitelisted since Wave 3 but lives in socialTools, which was not
// spread below — so it silently never resolved and REASONING_TOOL_COUNT
// overreported the delivered set by one. Only whitelisted keys are
// picked from any source, so this exposes exactly that one tool.
import { socialTools } from "@/lib/ai/tools/social";

/**
 * Whitelist of tool keys that are safe for the reasoning engine.
 * All must be data-reading tools with no side effects.
 *
 * Criteria for inclusion:
 *   1. Pure read — no DB writes, no external API mutations
 *   2. Fast — should resolve in < 5s to not stall the engine
 *   3. Useful for grounding — provides real numbers the engine
 *      would otherwise fabricate
 */
// 2026-08-18 · GATE #6 — the whitelist ENTRIES moved verbatim to
// ./whitelist.ts (pure, no server-only) so catalog-claims.ts can
// verify the read-only claim on every test run. Single source.
const REASONING_TOOL_WHITELIST = new Set<string>(REASONING_TOOL_WHITELIST_ENTRIES);

/**
 * Returns the curated read-only tool subset for the reasoning engine.
 *
 * Only tools in the whitelist are included. Unknown keys are skipped at
 * runtime (nothing breaks in prod) — but tests/ai/reasoning-tools.test.ts
 * asserts delivered === whitelist, so a silent drop goes red in CI
 * instead of quietly shrinking the engine's toolbox (which is exactly
 * what happened to draftOpportunitySms between GATE #6 and 2026-08-19).
 */
export function getReasoningTools(): Record<string, unknown> {
  const allSources: Record<string, unknown> = {
    ...businessTools,
    ...systemTools,
    ...brainTools,
    ...socialTools,
  };

  const result: Record<string, unknown> = {};
  for (const key of REASONING_TOOL_WHITELIST) {
    if (key in allSources) {
      result[key] = allSources[key];
    }
  }
  return result;
}

/** Exported for testing — the whitelist keys. */
export const WHITELIST_KEYS = [...REASONING_TOOL_WHITELIST];

/** Count of tools in the reasoning subset. */
export const REASONING_TOOL_COUNT = REASONING_TOOL_WHITELIST.size;
