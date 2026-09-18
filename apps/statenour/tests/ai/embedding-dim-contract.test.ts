/**
 * tests/ai/embedding-dim-contract.test.ts — 2026-09-18.
 *
 * Every provider in the embedding chain is pinned to 1024 dims "so the vector
 * space never desyncs on fallover" (provider.ts). That contract was enforced on
 * the COHERE branch only — HuggingFace and OpenAI returned whatever arrived.
 *
 * Why an unchecked width is worse than an error: `padToVectorDim` silently
 * truncates or ZERO-PADS, deliberately, because the store has two vector spaces
 * (1024 and 1536) and padding 1024 -> 1536 is intended. So an off-contract
 * vector from a PROVIDER is repaired into nonsense with no signal — a 768-dim
 * vector zero-padded to 1024 carries 256 dead dimensions and ranks essentially
 * at random against real neighbours. Recall degrades; nothing throws.
 *
 * Prod is clean today (97,622 of 97,622 stored vectors at 1024). This is
 * preventive, and the realistic trigger is near: Ollama Cloud refuses embeddings
 * (401/404), HF has no credits (402) and the OpenAI key is bad — leaving Cohere
 * as the ONLY live embedder. The next event is someone adding a replacement in a
 * hurry, which is exactly when an unchecked width lands.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enforceEmbeddingDim, EMBEDDING_CONTRACT_DIM } from "@/lib/ai/provider";

describe("enforceEmbeddingDim holds the 1024 contract at the provider boundary", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("the contract dim is 1024", () => {
    expect(EMBEDDING_CONTRACT_DIM).toBe(1024);
  });

  it("CONTROL: an on-contract vector passes through UNCHANGED and silently", async () => {
    // Without this, an implementation that padded/warned on every call would
    // satisfy every other assertion here while spamming logs and copying arrays
    // on the hot path.
    const vec = Array.from({ length: 1024 }, (_, i) => i / 1024);
    const out = await enforceEmbeddingDim(vec, "Cohere");
    expect(out).toBe(vec); // same reference — no copy
    expect(warn).not.toHaveBeenCalled();
  });

  it("★ a SHORT vector is zero-padded to 1024 AND warns", async () => {
    const out = await enforceEmbeddingDim(new Array(768).fill(0.5), "HuggingFace");
    expect(out).toHaveLength(1024);
    expect(out[767]).toBe(0.5);
    expect(out[768]).toBe(0); // the dead tail
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("768-dim");
    expect(String(warn.mock.calls[0][0])).toContain("HuggingFace");
  });

  it("★ a LONG vector is truncated to 1024 AND warns", async () => {
    const out = await enforceEmbeddingDim(new Array(3072).fill(0.25), "OpenAI");
    expect(out).toHaveLength(1024);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("3072-dim");
    expect(String(warn.mock.calls[0][0])).toContain("OpenAI");
  });

  it("★ CANARY: the warning NAMES THE PROVIDER", async () => {
    // A generic "embedding was normalized" line cannot be acted on — with three
    // branches sharing one helper, the provider name is the only thing that says
    // WHICH backend broke its contract. Losing it makes the signal unusable
    // while keeping every other assertion above green.
    await enforceEmbeddingDim(new Array(512).fill(1), "SomeNewProvider");
    expect(String(warn.mock.calls[0][0])).toContain("SomeNewProvider");
  });

  it("repairs rather than throwing — a degraded embedding beats none on a live turn", async () => {
    await expect(enforceEmbeddingDim(new Array(1).fill(1), "X")).resolves.toHaveLength(1024);
  });
});
