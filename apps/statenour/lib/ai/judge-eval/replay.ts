/**
 * lib/ai/judge-eval/replay.ts · Phase X (2026-05-18 PM)
 *
 * Replays a single prompt through BOTH the V1 and V2 prompt builders
 * + fires the same LLM call against each system prompt to produce
 * matched-pair replies. This is the corpus-building engine the
 * shadow-execute cron uses.
 *
 *   V1 path · `buildSystemPromptUncached("full", prompt)` + aiChat
 *   V2 path · `buildSystemPromptV2()` + aiChat
 *
 * Both calls go through the same provider chain (Venice → Ollama →
 * OpenAI → Anthropic per the policy matrix). Same temperature ·
 * same model selection · same conversation context (zero history).
 * The ONLY thing that differs is the system prompt · which is the
 * whole point of the migration we're evaluating.
 *
 * Trade-offs · this is NOT a full chat-pipeline replay:
 *   · NO tool calls (V1 path would run them, V2 (Mastra) too)
 *   · NO memory recall (V1's hybrid-memory injection skipped)
 *   · NO history (every replay is turn-1 in a fresh conversation)
 *
 * Those simplifications make the comparison FAIR · isolating
 * prompt-builder differences without confounding factors. The
 * downside is the replies aren't 1:1 with what /chat would produce
 * for the same prompt · they're "what each prompt-builder's text
 * generation looks like in isolation". For the migration's intent
 * (which builder produces better reply quality?) that's the right
 * abstraction level.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/judge-eval/replay");

export interface ReplayPair {
  v1Reply: string;
  v2Reply: string;
  /** True iff both calls succeeded · false if either errored / empty. */
  bothSucceeded: boolean;
  /** Total wall-clock ms for the pair (V1 + V2 in parallel). */
  durationMs: number;
}

const REPLAY_TIMEOUT_MS = 30_000;

/**
 * Fire the same prompt through V1 and V2 prompt builders. Best-effort
 * · failures return empty strings (caller decides whether to skip
 * persistence or record as a failed pair).
 *
 * Parallelized via Promise.all · the two paths share no mutable state
 * so concurrency is safe.
 */
/**
 * 2026-05-23 · audit follow-up · accept optional system-prompt
 * overrides. Used by the Q2 shadow-judge queue drain to score the
 * EXACT prompts that were live at capture-time, not the current
 * builder output. Without these overrides, the queue's stored
 * v1Prompt/v2Prompt fields were silently ignored and the drain
 * effectively re-ran the sampler-driven judgement on a different
 * sample pool · the queue's whole purpose (capture historical
 * prompt-pair) was nullified.
 *
 * Backwards-compatible · existing sampler-driven callers pass only
 * `{ prompt }` and get the original behavior (fresh-build prompts).
 */
export async function replayPair(args: {
  prompt: string;
  v1SystemPrompt?: string;
  v2SystemPrompt?: string;
}): Promise<ReplayPair> {
  const startedAt = Date.now();
  const { aiChat } = await import("@/lib/ai/provider");

  // Phase CC bug-fix · use AbortSignal.timeout instead of Promise.race +
  // setTimeout. The pre-fix pattern created a setTimeout per call that
  // NEVER cleared when aiChat() won the race · the timer fired later
  // with a rejected promise no one listened to · TIMER LEAK held
  // memory for up to REPLAY_TIMEOUT_MS after each successful call.
  // The cron fires 5 pairs/run = 10 leaks per tick.
  //
  // Phase FF precision · the previous comment said "V8 auto-cleans on
  // settle" · imprecise. AbortSignal.timeout schedules an internal
  // setTimeout that fires regardless of whether anyone listens. Node's
  // GC reclaims the underlying timer when the signal becomes
  // unreferenced (e.g. when nothing holds it after aiChat resolves).
  // So the practical outcome IS no leak in our usage pattern · we
  // create + hand off the signal · don't retain a reference after
  // aiChat resolves · GC takes care of the timer. Still an
  // improvement over Promise.race + bare setTimeout which holds a
  // closure reference until the timer fires.
  //
  // aiChat() already honors the signal (L.1 wiring · merged with its
  // internal per-attempt timeout via AbortSignal.any).

  const v1 = (async () => {
    try {
      let sys: string;
      if (args.v1SystemPrompt) {
        // 2026-05-23 · audit follow-up · use the queued historical prompt.
        sys = args.v1SystemPrompt;
      } else {
        const { buildSystemPromptUncached } = await import("@/lib/ai/system-prompt");
        sys = await buildSystemPromptUncached("full", args.prompt);
      }
      const reply = await aiChat(
        [
          { role: "system", content: sys },
          { role: "user", content: args.prompt },
        ],
        "reason",
        { signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS) },
      );
      return (reply?.content ?? "").trim();
    } catch (e) {
      log.warn("v1_replay_failed", { err: (e as Error).message?.slice(0, 200) });
      return "";
    }
  })();

  const v2 = (async () => {
    try {
      let sys: string;
      if (args.v2SystemPrompt) {
        // 2026-05-23 · audit follow-up · use the queued historical prompt.
        sys = args.v2SystemPrompt;
      } else {
        const { buildSystemPromptV2 } = await import("@/lib/ai/prompt/v2");
        const out = await buildSystemPromptV2();
        sys = out.prompt;
      }
      const reply = await aiChat(
        [
          { role: "system", content: sys },
          { role: "user", content: args.prompt },
        ],
        "reason",
        { signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS) },
      );
      return (reply?.content ?? "").trim();
    } catch (e) {
      log.warn("v2_replay_failed", { err: (e as Error).message?.slice(0, 200) });
      return "";
    }
  })();

  const [v1Reply, v2Reply] = await Promise.all([v1, v2]);
  return {
    v1Reply,
    v2Reply,
    bothSucceeded: Boolean(v1Reply) && Boolean(v2Reply),
    durationMs: Date.now() - startedAt,
  };
}
