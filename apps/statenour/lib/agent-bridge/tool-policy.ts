import { TOOL_CATALOG, ToolMeta } from "@/lib/ai/tools/catalog";
import { BRIDGE_HARD_DENY, allScopeTools, isToolInScope, type BridgeScope } from "./scopes";
export { isToolInScope };

// MCP surface, 2026-08-27 · SCOPED, NOT the full catalog. It used to be
// `TOOL_CATALOG.map(t => t.name)` — the entire 181-tool surface behind one
// token. It is now the union of every scope's allowlist with the
// protected-operations set (HARD_DENY) subtracted, i.e. the maximal set any
// token could ever reach. The per-request surface is narrower still — see
// getBridgeSafeTools(protocol, scope).
export const MCP_V1_TOOLS = allScopeTools();

// ── ChatGPT Custom GPT Actions: hard 30-operation cap ────────────────
// ChatGPT rejects any action whose OpenAPI schema declares more than 30
// operations ("OpenAPI spec can have a maximum of 30 operations"). The
// full catalog is ~150 tools, so the Actions surface exposes a CURATED,
// priority-ordered subset (<=30) of the highest-leverage tools for the
// "Nour Command" operator GPT. This one list is the single source of
// truth for BOTH the /api/actions/openapi schema and the
// /api/actions/[tool] executor, so the advertised and executable
// surfaces never drift. Actions is a strict subset of MCP_V1_TOOLS.
// INVARIANT (enforced by tests/agent-bridge/dual-protocol.test.ts):
//   - length <= 30
//   - every name is present in the catalog (and therefore in MCP_V1_TOOLS)
// To add/remove: edit this list; keep it at or under 30 entries.
export const CHATGPT_ACTIONS_V1_TOOLS: string[] = [
  // business & revenue
  "getDashboardSummary",
  "getRevenueStats",
  "getReviewStats",
  "getEstimateLeaks",
  "compareCompetitors",
  "pricingAdvisorySummary",
  // live shop (nickstire cross-ring bridge)
  "getShopSnapshot",
  "getMarketingAttribution",
  "getAttentionAlerts",
  "getGscSummary",
  // personal execution
  "getTasks",
  "createTask",
  "completeTask",
  "getMissions",
  "getFinancialSnapshot",
  "getTodaySchedule",
  "getWeeklyTargets",
  "rankNextActions",
  "suggestMIT",
  "dailyPulse",
  // brain & strategy
  "searchMemories",
  "searchReflections",
  "getBlindSpots",
  "getPendingRevenueMoves",
  "decisionPreFlight",
  "analyzePowerDynamics",
  "getPowerBalanceSummary",
  // research & comms
  "searchWebVerified",
  "sendTelegram",
];

export function getBridgeToolPolicy(toolName: string): ToolMeta | undefined {
  return TOOL_CATALOG.find((t) => t.name === toolName);
}

/**
 * The choke point both bridges share. Throws unless the tool is reachable on
 * the given protocol AND scope — the CODE that replaces the sentence
 * "Full Operational Mode Activated: the operator assumes full responsibility",
 * which guarded arbitrary code execution with nothing but prose.
 *
 * `scope` is required for MCP (the request's authenticated scope). Actions runs
 * at a fixed `tasks`-equivalent surface defined by its own curated 30-list, so
 * it passes scope undefined and is checked against that list plus HARD_DENY.
 *
 * Three ways to be denied, each a distinct thrown message so the audit row and
 * the canaries can tell them apart:
 *   - not in the protocol's advertised list
 *   - in HARD_DENY (protected operations — never reachable on any scope)
 *   - in the list but not in the caller's SCOPE
 */
export function assertBridgeToolAllowed(
  toolName: string,
  protocol: "mcp" | "actions",
  scope?: BridgeScope,
): void {
  // HARD_DENY first: protected operations are unreachable regardless of
  // protocol or scope, and saying so explicitly beats relying on their absence
  // from a list.
  if (BRIDGE_HARD_DENY.has(toolName)) {
    throw new Error(`Tool ${toolName} is a protected operation and is never exposed over the bridge.`);
  }

  if (protocol === "actions") {
    if (!CHATGPT_ACTIONS_V1_TOOLS.includes(toolName)) {
      throw new Error(`Tool ${toolName} is not in the allowlist for actions.`);
    }
    // P1 (Codex #1944): Actions honors the caller's SCOPE too. Without this a
    // read-only token could still execute an Actions write (createTask,
    // sendTelegram are in the curated 30). When a scope is present the tool
    // must ALSO be in it; scope-less calls (OpenAPI schema advertisement) keep
    // the full curated list and rely on the execution path to carry a scope.
    if (scope && !isToolInScope(toolName, scope)) {
      throw new Error(`Tool ${toolName} is not permitted for scope "${scope}".`);
    }
  } else {
    // MCP requires an authenticated scope. No scope = deny (fail closed).
    if (!scope) {
      throw new Error(`Tool ${toolName} denied: no bridge scope on the request.`);
    }
    if (!isToolInScope(toolName, scope)) {
      throw new Error(`Tool ${toolName} is not permitted for scope "${scope}".`);
    }
  }

  const policy = getBridgeToolPolicy(toolName);
  if (!policy) {
    throw new Error(`Tool ${toolName} missing catalog metadata. Failing closed.`);
  }
}
