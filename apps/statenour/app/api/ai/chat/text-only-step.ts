/**
 * app/api/ai/chat/text-only-step.ts: the prepareStep result for the last allowed
 * step of a chat turn, shared by the streaming config (build-stream-config.ts) and
 * the buffered pre-flush lane (alternate-paths.ts) so the two cannot drift.
 *
 * 2026-10-26 · tool_choice "none" is only a request. Ollama's OpenAI-compat surface
 * ignores it: an ollama/minimax-m3 turn called tools on its last step and ended
 * "tool-calls" with no prose. So the last step also sends NO tools (activeTools: []),
 * which no provider can ignore. Anthropic, Gemini and OpenAI honour "none" natively
 * and keep their tool definitions (Anthropic rejects tool history without them).
 *
 * 2026-10-28 · the strip sends NO toolChoice: ai@6.0.314+ throws ToolChoiceViolationError
 * when a model calls a tool on a "none" step instead of looping to the extra text-only
 * step, and these providers do exactly that. With no tools active a stray call parses as
 * an invalid call and the loop moves on.
 *
 * 2026-10-30 · with no tools on the request minimax-m3 still wrote tool calls on this step
 * in 4 of 13 turns, and 3 of those ended with no prose. The stripped step now also says,
 * in words, that the tools are done. Stray calls that still come are recorded as not run
 * (ai-sdk-tool-observation.ts `notRun`), not as failures.
 *
 * 2026-11-01 · on Ollama the stripped step also turns thinking off. Live 12:57Z: after
 * two tool steps (3,459 and 5,691 output tokens, all hidden thinking) the text-only step
 * spent the whole 6,000-token cap thinking at 42k input tokens and wrote nothing.
 * Probed the same day: Ollama's /v1 endpoint honours reasoning_effort for minimax-m3;
 * "none" wrote a full reply at a 37k context in 619 tokens, "low" spent more than the
 * default. The @ai-sdk/openai chat adapter sends providerOptions.openai.reasoningEffort
 * as reasoning_effort for any model id. Every live Ollama lane model accepts "none"
 * (200 from glm-5.3, glm-5.3-flash, kimi-k3, kimi-k2.6, deepseek-v4-pro, gemma4:31b,
 * gpt-oss:120b/20b; gpt-oss still thinks briefly), so a fallback model cannot 400 here.
 */
import type { ModelMessage } from "ai";

const TOOLS_DONE_NOTE =
  "No tools are available for the rest of this reply. Answer now in plain prose from the tool results above; do not call any tool.";

export function textOnlyStep(provider: string | null | undefined, messages?: ModelMessage[]) {
  if (provider === "anthropic" || provider === "gemini" || provider === "openai") {
    return { toolChoice: "none" as const };
  }
  return {
    activeTools: [] as string[],
    ...(provider === "ollama" ? { providerOptions: { openai: { reasoningEffort: "none" as const } } } : {}),
    // ai@6.0.309 rebuilds each step's messages, so this adds one note per stripped step; the
    // check keeps it to one if a later SDK carries an override forward.
    ...(messages && !messages.some((m) => m.content === TOOLS_DONE_NOTE)
      ? { messages: [...messages, { role: "system" as const, content: TOOLS_DONE_NOTE }] }
      : {}),
  };
}
