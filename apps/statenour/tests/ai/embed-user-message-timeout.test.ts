/**
 * embedUserMessage must be bounded by a WALL-CLOCK deadline, not only by the
 * per-hop timeouts inside the provider cascade.
 *
 * THE BUG (fixed 2026-08-09). getEmbedding walks a SERIAL chain — Cohere →
 * HuggingFace → OpenAI → OpenRouter — where every hop carries its own
 * AbortSignal but the CHAIN carries none, so the worst case runs well past
 * 40s. This function sits on the chat route's pre-stream path and the
 * brain-context stage chains on it, so a SLOW (not failed) cascade held the
 * whole turn with zero bytes on the wire — past the client's 90s stall abort.
 * Operator-reported: long messages that never answer. It failed open on error
 * and not on slowness; these tests pin that slowness now degrades too.
 *
 * [] is the function's documented contract on failure ("callers can safely
 * fall back to the keyword path"), so the bound adds no new failure mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getEmbedding = vi.fn();

vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: (...args: unknown[]) => getEmbedding(...args),
}));
vi.mock("@/lib/ai/tools", () => ({ nourTools: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  getEmbedding.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("embedUserMessage · aggregate deadline", () => {
  it("degrades to [] when the provider cascade hangs, instead of blocking the turn", async () => {
    // A cascade that never settles — the exact shape of a stalled provider.
    getEmbedding.mockImplementation(() => new Promise(() => {}));
    const { embedUserMessage } = await import("@/lib/ai/tool-embeddings");

    const pending = embedUserMessage("a message long enough to be embedded");
    // Advance past the bound. Without it, this promise never settles and the
    // test would time out — which is precisely what the chat turn did.
    await vi.advanceTimersByTimeAsync(13_000);

    await expect(pending).resolves.toEqual([]);
  });

  it("returns the embedding when the provider answers inside the bound", async () => {
    getEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    const { embedUserMessage } = await import("@/lib/ai/tool-embeddings");

    const pending = embedUserMessage("a message long enough to be embedded");
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toEqual([0.1, 0.2, 0.3]);
  });

  it("still short-circuits trivially short input without calling the provider", async () => {
    const { embedUserMessage } = await import("@/lib/ai/tool-embeddings");
    await expect(embedUserMessage("hi")).resolves.toEqual([]);
    expect(getEmbedding).not.toHaveBeenCalled();
  });
});
