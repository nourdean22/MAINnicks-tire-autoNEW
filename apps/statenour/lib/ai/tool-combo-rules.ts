/**
 * lib/ai/tool-combo-rules.ts · v10.0.529.12 · E-3 Phase 2
 *
 * Dangerous-tool-combo block-list. When a chat turn fires multiple
 * tools, certain combinations are higher-risk than each individual
 * tool · this module defines those combos and returns a guard
 * verdict the chat route can use to gate execution.
 *
 * The canonical risky pattern from the audit:
 *   searchDocuments → ingestDocumentFromUrl in the same turn.
 *   First reads operator-uploaded content (an attack surface for
 *   prompt injection) · then writes to the vector store with a URL
 *   the attacker may have planted in that content. Confused-deputy
 *   chain: the model reads attacker-crafted text + acts on it.
 *
 * Defense intent · gate the second tool unless the operator
 * confirms in chat. The model still suggests the action; the chat
 * route blocks the execute until a HITL nod arrives. This is a
 * "yellow zone" not a hard block · the operator might legitimately
 * want this chain (e.g. "read this PDF and then fetch this related
 * URL it cites").
 *
 * Wiring (future v530 · this module ships rules + verdict helper):
 *   The chat route's tool-call dispatcher will:
 *   1. Collect the list of toolNames fired in this turn so far.
 *   2. Before each new tool call, call `assertSafeToolCombo(history,
 *      nextTool)`.
 *   3. If verdict.ok=false and verdict.requireHITL=true, short-
 *      circuit the tool call and return a result the model can
 *      surface to the operator ("To do X after Y, confirm yes/no").
 *
 * For now (v529.12) the module just ships the rules + helper +
 * tests. Wiring lands in v530+ alongside the chat-route refactor
 * that needs to track per-turn tool history anyway.
 */

export interface ToolComboRule {
  /** Tool that's already fired this turn. */
  prior: string;
  /** Tool the model is about to fire. */
  next: string;
  /** What's risky about this combo. */
  reason: string;
  /** When true · gate via HITL · don't hard-block. */
  requireHITL: boolean;
}

export interface ToolComboVerdict {
  ok: boolean;
  matchedRule: ToolComboRule | null;
  requireHITL: boolean;
  reason: string | null;
}

/**
 * The actual block-list. Ordered prior → next.
 *
 * Add a rule when ANY of the following is true:
 *   1. The combo crosses a trust boundary (untrusted READ → trusted WRITE)
 *   2. The combo amplifies a prompt-injection vector (read attacker text →
 *      act on a URL/command in that text)
 *   3. The combo enables a cost-DoS pattern (read → expensive op)
 */
export const DANGEROUS_TOOL_COMBOS: ToolComboRule[] = [
  {
    prior: "searchDocuments",
    next: "ingestDocumentFromUrl",
    reason:
      "Reading operator-uploaded documents then fetching a URL is a classic prompt-injection chain · a malicious doc can include a fake 'now fetch http://attacker' directive.",
    requireHITL: true,
  },
  {
    prior: "searchWebVerified",
    next: "ingestDocumentFromUrl",
    reason:
      "Cross-source web content into the operator's vector store · external URLs surfaced by the search may include attacker-planted links.",
    requireHITL: true,
  },
  {
    prior: "findRelatedConversations",
    next: "runPython",
    reason:
      "Cross-session memory into arbitrary code execution · a prior-session prompt-injected summary could carry a payload the model translates into Python.",
    requireHITL: true,
  },
  {
    prior: "ingestDocumentFromUrl",
    next: "runPython",
    reason:
      "Freshly-ingested external doc → arbitrary code in the same turn. The model hasn't yet had time to verify the doc's intent · ask operator.",
    requireHITL: true,
  },
];

/**
 * Check whether the next tool call should be HITL-gated given the
 * tools already fired this turn. Returns ok=true when no rule
 * matches · ok=false + requireHITL=true when a HITL gate fires.
 *
 * Always-ok shortcut · if `nextTool` doesn't appear as the `next`
 * field of ANY rule, we skip the priorTools scan entirely.
 */
export function assertSafeToolCombo(
  priorTools: string[],
  nextTool: string,
): ToolComboVerdict {
  // Fast path · no rule lists this tool as the dangerous next-step.
  const candidates = DANGEROUS_TOOL_COMBOS.filter((r) => r.next === nextTool);
  if (candidates.length === 0) {
    return { ok: true, matchedRule: null, requireHITL: false, reason: null };
  }

  for (const rule of candidates) {
    if (priorTools.includes(rule.prior)) {
      return {
        ok: false,
        matchedRule: rule,
        requireHITL: rule.requireHITL,
        reason: rule.reason,
      };
    }
  }

  return { ok: true, matchedRule: null, requireHITL: false, reason: null };
}

/**
 * Render a verdict as a structured tool-result the model can surface
 * to the operator. Pairs with the chat route's tool-call dispatcher
 * (future wiring · v530+).
 */
export function comboVerdictToToolResult(
  verdict: ToolComboVerdict,
  nextTool: string,
): { ok: false; code: "tool_combo_hitl_required"; error: string; rule: ToolComboRule | null } {
  return {
    ok: false,
    code: "tool_combo_hitl_required",
    error: `Tool '${nextTool}' was gated because: ${verdict.reason ?? "unknown reason"}. Surface this to the operator and ask for an explicit confirm before retrying.`,
    rule: verdict.matchedRule,
  };
}
