/**
 * llm_calls lane attribution (2026-09-02).
 *
 * The first production read-back of the LLM ledger showed every row with
 * lane = "unlabeled": the only attribution path was a `[lane:<name>]` prefix
 * on the first system message, and none of the 40 invokeLLM call sites use
 * it. The wrapper now captures the CALLING FUNCTION'S NAME synchronously at
 * entry (function names survive the esbuild bundle; file names do not — prod
 * is one dist/index.js) and the ledger uses it when no label is present.
 *
 * Contract pinned here:
 *   1. a `[lane:x]` label still wins over the captured caller;
 *   2. the captured caller name is the fallback;
 *   3. no label and no caller → "unlabeled" (never a guess);
 *   4. the ledger is inert when LLM_LEDGER_ENABLED is unset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execute = vi.fn(async () => [{ affectedRows: 1 }]);
vi.mock("./db", () => ({ getDb: async () => ({ execute: (...a: unknown[]) => execute(...a) }) }));

/**
 * Positional params of a drizzle sql`` object, in template order. drizzle keeps
 * the literal text as StringChunk objects (`value: string[]`); everything else
 * in queryChunks is an interpolated value — a raw primitive/null, or a Param
 * wrapper with `.value` when one was used.
 */
function sqlParams(q: unknown): unknown[] {
  const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
  const isStringChunk = (c: unknown) => !!c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value);
  return chunks
    .filter((c) => !isStringChunk(c))
    .map((c) => (c && typeof c === "object" && "value" in (c as object) ? (c as { value: unknown }).value : c));
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const baseRecord = (messages: Array<{ role: string; content: string }>, lane?: string | null) => ({
  model: "deepseek-v4-pro",
  params: { messages } as never,
  ok: true,
  latencyMs: 42,
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  lane: lane ?? null,
});

describe("llm_calls lane attribution", () => {
  beforeEach(() => { execute.mockClear(); vi.stubEnv("LLM_LEDGER_ENABLED", "true"); });
  afterEach(() => vi.unstubAllEnvs());

  it("callerLane() names the first named function above it (test bodies are anonymous, so a named wrapper is needed)", async () => {
    const { callerLane } = await import("./services/llmLedger");
    function reviewDraftForTest() { return callerLane(); }
    expect(reviewDraftForTest()).toBe("reviewdraftfortest");
  });

  it("a [lane:x] label on the first system message wins over the captured caller", async () => {
    const { recordLlmCall } = await import("./services/llmLedger");
    recordLlmCall(baseRecord([{ role: "system", content: "[lane:review_reply] You are Nick." }], "somecaller"));
    await tick(); await tick();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sqlParams(execute.mock.calls[0][0])[2]).toBe("review_reply");
  });

  it("with no label, the wrapper-captured caller name is the lane", async () => {
    const { recordLlmCall } = await import("./services/llmLedger");
    recordLlmCall(baseRecord([{ role: "system", content: "You are Nick." }], "critiquesocialdraft"));
    await tick(); await tick();
    expect(sqlParams(execute.mock.calls[0][0])[2]).toBe("critiquesocialdraft");
  });

  it("no label and no caller → unlabeled, never a guess; and the ledger is inert when the flag is unset", async () => {
    const { recordLlmCall } = await import("./services/llmLedger");
    recordLlmCall(baseRecord([{ role: "system", content: "You are Nick." }], null));
    await tick(); await tick();
    expect(sqlParams(execute.mock.calls[0][0])[2]).toBe("unlabeled");

    execute.mockClear();
    vi.stubEnv("LLM_LEDGER_ENABLED", "");
    recordLlmCall(baseRecord([{ role: "system", content: "You are Nick." }], "anything"));
    await tick(); await tick();
    expect(execute).not.toHaveBeenCalled();
  });
});
