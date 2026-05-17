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
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("mastra/index");

// Construct lazily so we only instantiate when accessed. Same rationale
// as agents/nick.ts — keep cold paths off the module-load hot path.
//
// 2026-05-17 follow-up · race-safe promise singleton matching
// agents/nick.ts. Two concurrent first-requests on a cold container
// no longer double-construct (which would propagate to two duplicate
// nick agents under the same key). Construction failure clears the
// promise so the next request can retry instead of caching rejection.
let _mastraPromise: Promise<Mastra> | null = null;

export function getMastra(): Promise<Mastra> {
  if (_mastraPromise) return _mastraPromise;
  _mastraPromise = (async () => {
    try {
      const nick = await getNickAgent();
      const m = new Mastra({
        agents: { nick },
        // workflows: { ... }  // Phase 3 (Inngest-backed)
        // mcpServers: { ... } // Phase 2 (1,423-skill registry exposed via MCP)
      });
      log.info("mastra_ready", {});
      return m;
    } catch (err) {
      _mastraPromise = null;
      log.error("mastra_construct_failed", {
        message: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      throw err;
    }
  })();
  return _mastraPromise;
}

export type AppMastra = Awaited<ReturnType<typeof getMastra>>;
