/**
 * Mastra instance · Wave-200 Phase 0 scaffold (2026-05-17)
 *
 * NOT WIRED INTO LIVE CHAT YET. This file exists so the next phase
 * (Phase 1 · Nick-as-agent v1) has a single place to grow into.
 *
 * Phase 1 will:
 *   · Register the real `nick` agent (currently a placeholder)
 *   · Add the first 5 tools (createTask · snoozeTask · closeLoop · pinMemory · sendOperatorAlert)
 *   · Wire memory adapters to the existing BrainMemory table
 *   · Wrap the chat endpoint behind AGENT_V2=true feature flag
 *
 * See: `docs/WAVE-200-PLAN.md` · `docs/adr/0001-mastra-adoption.md`
 */

import { Mastra } from "@mastra/core";

// Placeholder · no agents registered yet (Phase 1 lands the first one).
// Importing `nick` from agents/ would force-load it at module-load time
// in dev mode; we keep the registry empty until the agent is real.
export const mastra = new Mastra({
  agents: {},
  // workflows: {},   // Phase 3
  // mcpServers: {},  // Phase 2
});

export type AppMastra = typeof mastra;
