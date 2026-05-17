/**
 * Mastra instance · Wave-200 Phase 1 (2026-05-17)
 *
 * Registers the `nick` agent. The actual integration point is the chat
 * route — it checks AGENT_V2 env and either calls `getNickAgent()` or
 * falls back to the legacy streamText pipeline.
 *
 * See: docs/WAVE-200-PLAN.md Phase 1 · docs/adr/0001-mastra-adoption.md
 */

import { Mastra } from "@mastra/core";
import { getNickAgent } from "./agents/nick";

// Construct lazily so we only instantiate when accessed. Same rationale
// as agents/nick.ts — keep cold paths off the module-load hot path.
let _mastra: Mastra | null = null;

export function getMastra(): Mastra {
  if (_mastra) return _mastra;
  _mastra = new Mastra({
    agents: {
      nick: getNickAgent(),
    },
    // workflows: { ... }  // Phase 3 (Inngest-backed)
    // mcpServers: { ... } // Phase 2 (1,423-skill registry exposed via MCP)
  });
  return _mastra;
}

export type AppMastra = ReturnType<typeof getMastra>;
