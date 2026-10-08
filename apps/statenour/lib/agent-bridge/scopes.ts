/**
 * Bridge scope model — default-deny, replacing the comment that guarded
 * arbitrary code execution.
 *
 * THE DEFECT this replaces (measured 2026-08-27). `tool-policy.ts` exposed the
 * FULL catalog — `MCP_V1_TOOLS = TOOL_CATALOG.map(t => t.name)` — behind one
 * flat bearer, and its only risk gate was a COMMENT: "Full Operational Mode
 * Activated: All write, side-effecting, and high-risk tools are now permitted."
 * A sentence is not a guard. Any token holder could reach `runPython`,
 * `runDeviceCommand`, `sendOpportunitySms` (customer SMS), Instagram autopost,
 * and `githubCreatePR`. The bridge had zero measured callers, so this was
 * latent — but the first client would inherit an ungated code-execution
 * surface. Hardened BEFORE a consumer is provisioned, deliberately.
 *
 * THREE LAYERS, all pure and canaried (assert BEHAVIOUR, not presence):
 *
 *   1. HARD_DENY — tools reachable through the bridge on NO scope, ever. Not a
 *      blocklist we hope is complete: it is COMPUTED from the catalog (every
 *      business_write, every critical-risk tool) UNIONED with the operator's
 *      explicit protected-operations list, so a new critical tool is denied the
 *      day it lands without anyone editing this file. A canary asserts every
 *      named tool resolves into it AND that no scope list intersects it.
 *   2. SCOPES — explicit allowlists, the "default deny" the operator asked for.
 *      `read` is read-only; `tasks` adds a small set of writes to the operator's
 *      OWN task/brain data. A tool absent from a token's scope is denied. There
 *      is no "expose everything" path.
 *   3. TOKEN -> SCOPE — resolved in auth.ts from per-client env tokens, so a
 *      narrow token (Dispatch) cannot reach a `tasks` tool.
 *
 * Everything here is a pure function over an injected catalog so the canaries
 * drive it with synthetic fixtures — the ingestAllSources lesson: a gate you
 * can only grep is a gate a swapped argument defeats.
 */
import { TOOL_CATALOG, getToolRiskClass, type ToolMeta } from "@/lib/ai/tools/catalog";

export type BridgeScope = "read" | "tasks";

/** Every scope name a token may carry. `tasks` is a superset of `read`. */
export const BRIDGE_SCOPES: readonly BridgeScope[] = ["read", "tasks"];

/**
 * The operator's protected-operations list, by tool name. These are denied
 * EXPLICITLY (a named entry a canary pins) on top of the rule-derived denials
 * below — belt and suspenders, because a rename that dropped a tool out of
 * `business_write` must not silently re-expose it.
 */
export const PROTECTED_OPS_TOOLS: readonly string[] = [
  // customer-facing sends
  "sendOpportunitySms",
  "stageCustomerAlert",
  // social publishing
  "triggerInstagramAutopost",
  "setInstagramAutopostConfig",
  // code & device execution
  "runPython",
  "runDeviceCommand",
  // autonomous browser action
  "browseAndDo",
  // public repo write
  "githubCreatePR",
];

/**
 * Compute the full hard-deny set from a catalog: the explicit protected-ops
 * names, plus EVERY business_write tool and EVERY tool whose effective risk is
 * `critical`. Rule-derived membership is what keeps this correct as the catalog
 * grows — `getToolRiskClass` already resolves runPython/runDeviceCommand to
 * critical, so a new code-exec tool is denied without a code change here.
 */
export function computeHardDeny(
  catalog: ReadonlyArray<{ name: string; category?: string; meta?: ToolMeta }> = TOOL_CATALOG.map(
    (t) => ({ name: t.name, category: t.category, meta: t }),
  ),
): Set<string> {
  const deny = new Set<string>(PROTECTED_OPS_TOOLS);
  for (const t of catalog) {
    if (t.category === "business_write") deny.add(t.name);
    if (getToolRiskClass(t.name, t.meta ?? null) === "critical") deny.add(t.name);
  }
  return deny;
}

/** The live hard-deny set over the real catalog. */
export const BRIDGE_HARD_DENY: Set<string> = computeHardDeny();

/**
 * READ scope — the highest-value read-only tools for an external agent
 * (Dispatch, Claude, Cursor). Curated, not the whole catalog: a bridge surface
 * is prompt weight and attack surface, so it earns its entries the way the
 * ChatGPT Actions-30 list already does. Every name here is read-only; the
 * canary asserts none is side-effecting and none is in HARD_DENY.
 */
const READ_TOOLS: readonly string[] = [
  // business & shop — "the business at a glance", the thing that today needs a
  // spawned SQL session
  "getShopSnapshot",
  "getRevenueStats",
  "compareLiveRevenue",
  "getDashboardSummary",
  "getReviewStats",
  "getEstimateLeaks",
  "compareCompetitors",
  "pricingAdvisorySummary",
  "getMarketingAttribution",
  "getGscSummary",
  // fleet / ops health
  "getCronStatus",
  "getAttentionAlerts",
  // brain (read) — the product is the brain; reading it is the point
  "searchMemories",
  "searchReflections",
  "getBlindSpots",
  "searchColdMemory",
  "getBrainHealth",
  "getPendingRevenueMoves",
  // strategy reads — also on the curated Actions-30 surface, so they belong on
  // the MCP read surface too (a tool safe for the ChatGPT GPT is safe for read)
  "decisionPreFlight",
  "analyzePowerDynamics",
  "getPowerBalanceSummary",
  // personal read — the operator's own loop from a phone
  "getTasks",
  "getMissions",
  "getExternalWorkerJob",
  "getExternalWorkerLanes",
  "getFinancialSnapshot",
  "getTodaySchedule",
  "getWeeklyTargets",
  "dailyPulse",
  "suggestMIT",
  "rankNextActions",
  // research
  "searchWebVerified",
];

/**
 * TASKS scope — read plus a SMALL set of writes to the operator's OWN data.
 * Nothing customer-facing, nothing that publishes externally, no code exec.
 * `triggerBrief` recomposes the operator's daily brief; `sendTelegram` is the
 * operator's own channel (not a customer), consistent with its inclusion in
 * the Actions-30 surface.
 */
const TASKS_ONLY_TOOLS: readonly string[] = [
  "createTask",
  "completeTask",
  "queueExternalWorkerJob",
  "pinMemory",
  "triggerBrief",
  "sendTelegram",
];

/**
 * The tool allowlist for a scope, with HARD_DENY subtracted as a final
 * guarantee — so even if a protected-ops name were mistakenly added to a list
 * above, it could not be exposed. The subtraction is the load-bearing line; the
 * canary breaks it and asserts a protected tool leaks, to prove it is not
 * decorative.
 */
export function scopeTools(scope: BridgeScope, hardDeny: Set<string> = BRIDGE_HARD_DENY): string[] {
  const base = scope === "tasks" ? [...READ_TOOLS, ...TASKS_ONLY_TOOLS] : [...READ_TOOLS];
  return base.filter((name) => !hardDeny.has(name));
}

/** The maximal reachable surface — the union of every scope, for the surface pin. */
export function allScopeTools(hardDeny: Set<string> = BRIDGE_HARD_DENY): string[] {
  const seen = new Set<string>();
  for (const s of BRIDGE_SCOPES) for (const n of scopeTools(s, hardDeny)) seen.add(n);
  return [...seen];
}

/** Is `toolName` reachable on `scope`? The single predicate both bridges call. */
export function isToolInScope(
  toolName: string,
  scope: BridgeScope,
  hardDeny: Set<string> = BRIDGE_HARD_DENY,
): boolean {
  if (hardDeny.has(toolName)) return false;
  return scopeTools(scope, hardDeny).includes(toolName);
}
