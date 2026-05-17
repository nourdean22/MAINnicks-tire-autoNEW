/**
 * `nick` agent · Wave-200 Phase 1 (2026-05-17)
 *
 * REAL Mastra agent · wraps the existing 138-tool catalog + provider chain.
 *
 * Activation: gated behind `AGENT_V2=true` env var on Railway statenour-web.
 * When OFF (default), this file is imported but the agent isn't called from
 * the live chat route — the existing 1801-LOC pipeline keeps running.
 *
 * When ON, the chat route uses `handleChatStream({ mastra, agentId: 'nick', ... })`
 * from `@mastra/ai-sdk` instead of the raw `streamText({ model, tools, ...})`
 * call. The agent loops over tool calls internally using AI SDK v6 under the
 * hood (Mastra is built on it).
 *
 * What this gives us beyond the legacy path:
 *   · Memory adapter wired to BrainMemory Postgres (Phase 1.2 · semantic recall + working memory)
 *   · Eval hooks (Mastra-evals) and Braintrust scoring on every call
 *   · `.suspend()/.resume()` for human-in-loop confirmation flows
 *   · A clean abstraction to register MORE agents later (morning-brief, etc.)
 *
 * Provider: routes through `getModel("reason")` which honors the existing
 * Venice → Ollama → Anthropic → OpenAI fallback chain. Same provider, same
 * cost profile. The model is wrapped with Braintrust if BRAINTRUST_API_KEY
 * is set (no-op otherwise · graceful for the operator-account-pending case).
 *
 * Tools: imports `nourTools` (138 tools across brain/tasks/business/content/
 * social/system/meta). Mastra accepts AI SDK v6 `tool()` objects directly
 * because Mastra IS built on AI SDK v6.
 *
 * Type-level note: Mastra@1.35 bundles its OWN copy of @ai-sdk/provider-v6
 * (4.0.27) which has a slightly different internal LanguageModelV2 shape
 * than ai@6.0.162's bundled provider (4.x). The runtime is fully compatible
 * (Mastra explicitly supports AI SDK v6 LanguageModelV2) — only the
 * structural type-check sees them as distinct. We cast to bypass · runtime
 * verified via the /api/agent test endpoint.
 *
 * See: docs/adr/0001-mastra-adoption.md · docs/WAVE-200-PLAN.md Phase 1
 */

import { Agent } from "@mastra/core/agent";
import { getModel } from "@/lib/ai/provider";
import { nourTools } from "@/lib/ai/tools";
import { wrapWithBraintrust } from "@/lib/ai/braintrust-wrap";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("mastra/agents/nick");

// Minimal default instructions — the chat route passes a FULL assembled
// system prompt (8-12K tokens, with brain context, citations, voice profile,
// etc.) at call-time via `agent.stream({ instructions: finalSystemPrompt })`.
// These defaults are only used when the agent runs outside the chat route
// (e.g. the test endpoint at /api/agent for dev).
const DEFAULT_INSTRUCTIONS = `You are Nick, the operator's personal AI · part of the NOUR OS personal operating system.
You speak directly and concisely. Lead with signal, never filler.
You have 138 tools across brain, tasks, business, content, social, system, and meta domains.
When the operator asks you to DO something, use a tool. Don't narrate what you would do — do it.
When the operator asks you to KNOW something, query the relevant tool, then summarize.
Refuse to fabricate. If a tool returns nothing or errors, say so plainly.`;

/**
 * Build the agent lazily so we only instantiate the model + memory on
 * first use. Module-load-time instantiation would force every cold-start
 * (Next.js dev mode, Railway boot) to load the entire provider chain
 * even if AGENT_V2 is off.
 *
 * 2026-05-17 follow-up · pre-fix this used `let _nick: Agent | null`
 * which on a cold container with two concurrent first-requests could
 * race-construct two Agent instances · the Braintrust wrapper would
 * register duplicate trace contexts. Replaced with a promise-based
 * singleton: the FIRST caller starts construction and every concurrent
 * caller awaits the same promise. If construction THROWS, we clear the
 * promise so the next request can retry instead of caching a rejected
 * promise that poisons every subsequent call. Errors get a one-line
 * structured log so the operator can see "agent failed to construct"
 * without grep'ing for stack traces.
 */
let _nickPromise: Promise<Agent> | null = null;

export function getNickAgent(): Promise<Agent> {
  if (_nickPromise) return _nickPromise;
  _nickPromise = (async () => {
    try {
      // wrapWithBraintrust no-ops if BRAINTRUST_API_KEY is unset, so this
      // is safe to call unconditionally. When the key is set, every
      // model call becomes a Braintrust span.
      const model = wrapWithBraintrust(getModel("reason"));

      const agent = new Agent({
        id: "nick",
        name: "nick",
        instructions: DEFAULT_INSTRUCTIONS,
        // Type cast: Mastra 1.35's MastraLanguageModelV2 is structurally
        // identical to ai@6's LanguageModelV2 at runtime but defined in
        // a sibling package path, so TS sees them as nominally distinct.
        // Documented in the file header above. Replace with the native
        // type when @mastra/core upgrades to consume ai@6's provider
        // directly.
        model: model as never,
        tools: nourTools as never,
        // Memory wiring lands in Phase 1.2 (when the storage adapter is
        // pointed at BrainMemory Postgres). For Phase 1.1 we run without
        // Mastra's built-in memory — the existing chat route already
        // does its own brain recall and prompt assembly, so no gap.
        // memory: nickMemory(),
      });

      log.info("nick_agent_ready", {});
      return agent;
    } catch (err) {
      // Clear the failed promise so the next request retries instead of
      // forever-returning the rejected promise.
      _nickPromise = null;
      log.error("nick_agent_construct_failed", {
        message: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      throw err;
    }
  })();
  return _nickPromise;
}

/**
 * Whether the AGENT_V2 cutover is enabled on this deploy.
 * Read once at module load · changes require a redeploy (intentional ·
 * we don't want runtime env flips between requests in the middle of a
 * conversation).
 */
export const AGENT_V2_ENABLED = (process.env.AGENT_V2 ?? "").trim().toLowerCase() === "true";
