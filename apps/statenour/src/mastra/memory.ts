/**
 * Nick Mastra memory · Wave-200 Phase 1.2 (2026-05-17)
 *
 * Per-thread working memory + last-N message window for the Mastra
 * agent. This is the substrate that gives the AGENT_V2 path real
 * conversational continuity instead of starting from scratch every
 * turn (which is what the bare Phase 1.1 agent did).
 *
 * Storage shape choices · per ADR-0009:
 *   · Phase 1.2 (THIS): no explicit storage adapter · Mastra uses
 *     its in-process default. Working memory + last-20 messages
 *     survive across turns within the same Node process but reset
 *     on cold restart. Zero schema impact · zero new tables · zero
 *     Prisma migration coordination. This is the operator-cautious
 *     starting point.
 *   · Phase 1.3 (FOLLOW-UP): swap to @mastra/pg pointed at our
 *     existing Neon DB with `tablePrefix: "mastra_"` so the adapter
 *     auto-creates its own tables side-by-side with Prisma's. No
 *     Prisma migration needed (the tables live outside Prisma's
 *     ownership) · operator can review what shows up.
 *
 * Working memory template · Markdown form the LLM updates each turn.
 * Resource-scoped so the same operator's preferences persist across
 * conversations (vs. thread-scoped which is per-conversation only).
 * The template tells the agent what to track; structure stays
 * implicit so the LLM can adapt without schema rigidity.
 *
 * See: docs/adr/0009-mastra-memory.md
 */

import { Memory } from "@mastra/memory";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("mastra/memory");

/**
 * Number of recent messages Mastra carries into the next prompt.
 * 20 is the documented Mastra default for chat agents · enough for
 * multi-turn refinement, small enough to keep prompts tight.
 */
const LAST_MESSAGES = 20;

/**
 * Working memory template · resource-scoped (operator-wide, not
 * per-conversation). Mastra hydrates this into the system prompt
 * each turn and updates it via tool calls as the conversation reveals
 * new operator state. Stays compact · the operator's full identity
 * lives in BrainMemory (read via the existing recall layer).
 */
const WORKING_MEMORY_TEMPLATE = `
# Operator working memory

## Current focus
- [active project or initiative]

## In-flight commitments
- [things the operator has committed to and not yet closed]

## Recently surfaced concerns
- [items the operator flagged this conversation but hasn't resolved]

## Communication preferences observed
- [voice + style cues picked up this conversation that should persist]
`.trim();

let _memoryPromise: Promise<Memory> | null = null;

/**
 * Lazy promise-based singleton · same race-safe pattern as
 * getNickAgent / getMastra. Construction failure clears the promise
 * so the next request can retry.
 */
export function getNickMemory(): Promise<Memory> {
  if (_memoryPromise) return _memoryPromise;
  _memoryPromise = (async () => {
    try {
      const memory = new Memory({
        // No `storage` · Mastra in-process default for Phase 1.2.
        // Phase 1.3 will add `storage: new PgStore({...})` here.
        options: {
          lastMessages: LAST_MESSAGES,
          workingMemory: {
            enabled: true,
            scope: "resource", // operator-wide, not per-thread
            template: WORKING_MEMORY_TEMPLATE,
          },
        },
      });
      log.info("nick_memory_ready", {
        lastMessages: LAST_MESSAGES,
        workingMemory: true,
        storage: "in-process",
      });
      return memory;
    } catch (err) {
      _memoryPromise = null;
      log.error("nick_memory_construct_failed", {
        message: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      throw err;
    }
  })();
  return _memoryPromise;
}
