import { invokeLLM } from "../_core/llm";
import { createLogger } from "../lib/logger";

const log = createLogger("services:ig-posting-llm");

/**
 * Live IG posting LLM calls get foreground priority, a 120s timeout, and one
 * transport/empty-output retry. The retry is strictly pre-publish.
 */
export async function invokeLLMForPosting(
  params: Parameters<typeof invokeLLM>[0],
): ReturnType<typeof invokeLLM> {
  const withGuards = { timeoutMs: 120_000, priority: 1 as const, ...params };
  const attempt = async () => {
    const res = await invokeLLM(withGuards);
    const content = res.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("LLM returned no caption content");
    }
    return res;
  };

  try {
    return await attempt();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("IG posting LLM call failed once - retrying", { err: msg.slice(0, 120) });
    return attempt();
  }
}

/** Parse one JSON object and make truncation/operator failures explicit. */
export function parseJsonObject<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  } else if (first >= 0) {
    throw new Error(
      `LLM response truncated before the JSON object closed (${raw.length} chars received) - raise max_tokens for this call`,
    );
  }

  try {
    return JSON.parse(s) as T;
  } catch (err) {
    throw new Error(
      `LLM response was not valid JSON (${raw.length} chars received): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Retry malformed/truncated structured output once at the parse boundary.
 * No image generation or publish side effect is reachable until this returns.
 */
export async function invokeStructuredPosting<T>(
  params: Parameters<typeof invokeLLM>[0],
  label: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await invokeLLMForPosting(params);
    const content = res.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      lastError = new Error(`${label}: LLM returned no structured content`);
    } else {
      try {
        return parseJsonObject<T>(content);
      } catch (err) {
        lastError = err;
      }
    }

    if (attempt < 2) {
      log.warn("IG posting structured output invalid - retrying before side effects", {
        label,
        err: lastError instanceof Error ? lastError.message.slice(0, 180) : String(lastError).slice(0, 180),
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label}: structured output failed`);
}
