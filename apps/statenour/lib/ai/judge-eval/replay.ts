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
export async function replayPair(args: { prompt: string }): Promise<ReplayPair> {
  const startedAt = Date.now();
  const { aiChat } = await import("@/lib/ai/provider");

  const v1 = (async () => {
    try {
      const { buildSystemPromptUncached } = await import("@/lib/ai/system-prompt");
      const sys = await buildSystemPromptUncached("full", args.prompt);
      const reply = await Promise.race([
        aiChat(
          [
            { role: "system", content: sys },
            { role: "user", content: args.prompt },
          ],
          "reason",
        ),
        new Promise<{ content: string } | null>((_, reject) =>
          setTimeout(() => reject(new Error("v1_replay_timeout")), REPLAY_TIMEOUT_MS),
        ),
      ]);
      return (reply?.content ?? "").trim();
    } catch (e) {
      log.warn("v1_replay_failed", { err: (e as Error).message?.slice(0, 200) });
      return "";
    }
  })();

  const v2 = (async () => {
    try {
      const { buildSystemPromptV2 } = await import("@/lib/ai/prompt/v2");
      const out = await buildSystemPromptV2();
      const reply = await Promise.race([
        aiChat(
          [
            { role: "system", content: out.prompt },
            { role: "user", content: args.prompt },
          ],
          "reason",
        ),
        new Promise<{ content: string } | null>((_, reject) =>
          setTimeout(() => reject(new Error("v2_replay_timeout")), REPLAY_TIMEOUT_MS),
        ),
      ]);
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
