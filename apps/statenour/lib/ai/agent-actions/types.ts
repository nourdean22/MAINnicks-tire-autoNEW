/**
 * Shared types + helpers for the extracted agent-action handlers.
 *
 * 2026-06-02 · Structural split of lib/ai/nick-agent.ts — the giant
 * executeAction switch was decomposed into per-domain handler modules
 * under lib/ai/agent-actions/. This file holds the cross-handler
 * contracts (AgentAction / ActionResult) + helpers shared by more than
 * one handler module.
 *
 * VERBATIM split — no behavior change. Handlers receive (params, type)
 * and return the exact same ActionResult shape the switch produced.
 *
 * 2026-08-01 · AgentAction / ActionResult now DECLARED here rather than
 * re-exported from nick-agent.ts. This module is a leaf: it must not
 * import the orchestrator that consumes it. nick-agent.ts re-exports
 * both from this file, so its public API is unchanged.
 */

/** A single structured action parsed out of a Nick AI response. */
export interface AgentAction {
  type: string;
  params: Record<string, unknown>;
}

/** The receipt one executed action produces. */
export interface ActionResult {
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

/** The params bag carried by every action. */
export type ActionParams = Record<string, unknown>;
