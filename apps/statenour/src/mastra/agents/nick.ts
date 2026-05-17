/**
 * `nick` agent · Wave-200 Phase 0 placeholder (2026-05-17)
 *
 * NOT WIRED. This file demonstrates the intended shape but is NOT
 * registered in `src/mastra/index.ts` yet. The Phase 1 implementation
 * will replace this stub with the real agent.
 *
 * Intended Phase 1 shape (commented out below for type-check safety):
 *
 *   import { Agent } from "@mastra/core/agent";
 *   import { Memory } from "@mastra/memory";
 *   import { openai } from "@ai-sdk/openai";
 *   import { createTask } from "../tools/create-task";
 *   import { snoozeTask } from "../tools/snooze-task";
 *   import { closeLoop } from "../tools/close-loop";
 *   import { pinMemory } from "../tools/pin-memory";
 *   import { sendOperatorAlert } from "../tools/send-operator-alert";
 *
 *   export const nick = new Agent({
 *     name: "nick",
 *     instructions: `... operator system prompt (Nour-voice profile · BRAIN_CONTEXT_INTERPOLATED) ...`,
 *     model: openai("gpt-4o"),  // routes through our provider chain (Venice/Ollama primary · OpenAI fallback)
 *     tools: { createTask, snoozeTask, closeLoop, pinMemory, sendOperatorAlert },
 *     memory: new Memory({
 *       options: {
 *         lastMessages: 10,
 *         semanticRecall: { topK: 5, messageRange: 2 },
 *         workingMemory: { enabled: true },
 *       },
 *       // Storage adapter wired to our existing BrainMemory Postgres table in Phase 1
 *     }),
 *   });
 *
 * See: `docs/WAVE-200-PLAN.md` Phase 1 · `docs/adr/0001-mastra-adoption.md`
 */

// Phase 0 · export a type marker so this file is referenced somewhere.
// Phase 1 replaces with the actual Agent export above.
export type NickAgentPlaceholder = "not-implemented-yet";
