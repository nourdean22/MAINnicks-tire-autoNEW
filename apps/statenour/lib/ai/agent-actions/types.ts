/**
 * Shared types + helpers for the extracted agent-action handlers.
 *
 * 2026-06-02 · Structural split of lib/ai/nick-agent.ts — the giant
 * executeAction switch was decomposed into per-domain handler modules
 * under lib/ai/agent-actions/. This file holds the cross-handler
 * contracts (AgentAction / ActionResult re-exported from nick-agent)
 * + helpers shared by more than one handler module.
 *
 * VERBATIM split — no behavior change. Handlers receive (params, type)
 * and return the exact same ActionResult shape the switch produced.
 */
import type { AgentAction, ActionResult } from "@/lib/ai/nick-agent";

export type { AgentAction, ActionResult };

/** The params bag carried by every action. */
export type ActionParams = Record<string, unknown>;
