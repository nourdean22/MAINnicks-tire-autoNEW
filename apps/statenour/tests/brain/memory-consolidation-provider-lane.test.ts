/**
 * The merge lane must stay on the FUNDED provider and must not mistake a dead
 * provider chain for "nothing to merge".
 *
 * WHY THIS FILE EXISTS — measured in production 2026-09-17:
 *
 *   · 106 Ollama calls for this lane in 24h; **53 returned ZERO completion
 *     tokens** and 46 had empty output. The observed max was exactly 1500,
 *     i.e. the `fast`/`classify` ceiling truncating JSON mid-structure.
 *   · Each empty result made the provider chain fall through to the METERED
 *     rescue tail, where gemini/openrouter/openai failed on billing —
 *     2,963 Langfuse ERROR observations in 7d across six brain surfaces.
 *
 * The cause was a TASK-TYPE MISMATCH INSIDE THE FUNDED LANE: this call reads
 * 30 memories and must emit a JSON array of full merged prose, but asked for
 * `fast` — OLLAMA_FAST_MODEL, a light-filter model under a 1500-token / 45s cap
 * that `provider.ts` documents as "terse responses". A spend failure was the
 * downstream symptom of a routing choice, not a billing problem.
 *
 * ⚠ AND IT WAS INVISIBLE. `aiChat` never throws on total provider failure; it
 * returns a SENTINEL. Without a `provider` check the sentinel text merely fails
 * to parse and the loop `continue`s, so a dead chain and "nothing to merge"
 * are the SAME observable — which is why seven days of total brain failure
 * looked like a quiet system.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { groupBy: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  aiChat: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => mocks.aiChat }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { mergeMemories } from "@/lib/brain/memory-consolidation";

/** Enough rows to clear the `memories.length < 4` guard. */
const ROWS = Array.from({ length: 6 }, (_, i) => ({
  id: `m${i}`,
  key: `k${i}`,
  content: `memory ${i}`,
  confidence: 0.9,
  seenCount: 2,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.groupBy.mockResolvedValue([{ category: "wisdom", _count: { id: 6 } }]);
  mocks.brainMemory.findMany.mockResolvedValue(ROWS);
});

describe("mergeMemories · provider lane", () => {
  // POSITIVE CONTROL — every assertion below reads the aiChat call. If the
  // fixtures stop reaching it, they all pass vacuously on `undefined`.
  it("reaches the merge LLM at all", async () => {
    mocks.aiChat.mockResolvedValue({ content: "[]", provider: "ollama", model: "minimax-m3" });
    await mergeMemories();
    expect(mocks.aiChat).toHaveBeenCalled();
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // `fast` is the shipped defect. It resolves to the light-filter model under
  // a 1500-token cap and produced zero tokens on half of all production runs.
  it("CANARY — does NOT request the terse `fast` lane for a structured merge", async () => {
    mocks.aiChat.mockResolvedValue({ content: "[]", provider: "ollama", model: "minimax-m3" });
    await mergeMemories();
    const taskType = mocks.aiChat.mock.calls[0][1];
    expect(taskType).not.toBe("fast");
    expect(taskType).not.toBe("classify");
  });

  it("asks for a long-form lane, which carries the 8000-token budget", async () => {
    mocks.aiChat.mockResolvedValue({ content: "[]", provider: "ollama", model: "minimax-m3" });
    await mergeMemories();
    // provider.ts: longForm = deep | reason | code | math | creative
    expect(["deep", "reason", "code", "math", "creative"]).toContain(
      mocks.aiChat.mock.calls[0][1],
    );
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // A sentinel must be recognised as a DEAD CHAIN, not parsed as content.
  // Without the guard this path is indistinguishable from "nothing to merge".
  it("CANARY — a sentinel provider is reported, not silently treated as no-op", async () => {
    mocks.aiChat.mockResolvedValue({ content: "not json", provider: "none", model: "-" });
    await mergeMemories();
    expect(mocks.warn).toHaveBeenCalledWith(
      "consolidation_provider_exhausted",
      expect.objectContaining({ provider: "none" }),
    );
  });

  it("treats the emergency stub lane the same way", async () => {
    mocks.aiChat.mockResolvedValue({ content: "stub", provider: "emergency", model: "-" });
    await mergeMemories();
    expect(mocks.warn).toHaveBeenCalledWith(
      "consolidation_provider_exhausted",
      expect.objectContaining({ provider: "emergency" }),
    );
  });

  // A real provider returning an empty array is a genuine "nothing to merge"
  // and must NOT be reported as an outage — the two were conflated before.
  it("does NOT report exhaustion when a real provider returns an empty result", async () => {
    mocks.aiChat.mockResolvedValue({ content: "[]", provider: "ollama", model: "minimax-m3" });
    await mergeMemories();
    expect(mocks.warn).not.toHaveBeenCalledWith(
      "consolidation_provider_exhausted",
      expect.anything(),
    );
  });
});
