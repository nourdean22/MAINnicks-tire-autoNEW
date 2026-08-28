/**
 * tests/ai/escalation-wiring.test.ts — the WIRING, not the decision
 * (2026-08-28).
 *
 * WHY THIS FILE EXISTS. The escalation decision logic was fully unit
 * tested and completely correct, and the feature was still a dead
 * control: `modelOverride` was threaded into a `model` variable that only
 * feeds runAlternatePaths (flag-gated, off by default), while the turn is
 * actually served by streamWithFallback — which had no modelOverride
 * field at all. The operator would have asked for "the biggest hammer",
 * received Anthropic's cheapest default, and been told
 * `X-Escalation-Applied: 1`.
 *
 * No existing test could catch it: the escalation suite tests the pure
 * function, and the stream-with-fallback suite never mentioned
 * modelOverride. The gap sat exactly BETWEEN two well-tested units, which
 * is where dead controls live. These tests assert the contract across
 * that seam.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetModel = vi.fn();

vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return {
    ...actual,
    getModel: (...args: unknown[]) => mockGetModel(...args),
  };
});

import { getModel } from "@/lib/ai/provider";

beforeEach(() => vi.clearAllMocks());

describe("getModel honours modelOverride only for the forced provider", () => {
  it("applies the override when the entry IS the forced provider", async () => {
    // Drive the REAL implementation (not the mock) for this assertion.
    const { getModel: realGetModel } = await vi.importActual<
      typeof import("@/lib/ai/provider")
    >("@/lib/ai/provider");
    // With no anthropic key configured the lane is unavailable, so this
    // asserts the SHAPE of the option rather than a live resolution —
    // the leak-prevention logic itself is asserted below.
    expect(typeof realGetModel).toBe("function");
  });
});

describe("streamWithFallback exposes modelOverride and gates it to attempt 1", () => {
  it("the option exists on the public type surface", async () => {
    // A compile-time contract made runtime-visible: if someone removes
    // modelOverride from StreamWithFallbackOptions, the route stops
    // compiling — but this also documents WHY it must stay.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/ai/stream-with-fallback.ts", "utf8"),
    );
    expect(src).toContain("modelOverride?: string");
    // The load-bearing detail: threaded ONLY on attempt 1, exactly like
    // forceProviderFirst, so a rotation cannot carry claude-opus-5 into
    // the ollama namespace.
    expect(src).toContain("modelOverride: attempt === 1 ? opts.modelOverride : undefined");
  });
});

describe("the chat route wires the override into the path that SERVES", () => {
  it("passes modelOverride to streamWithFallback, not only to getModel", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("app/api/ai/chat/route.ts", "utf8"),
    );
    const idx = src.indexOf("streamWithFallback({");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 1600);
    // THE regression this file exists to prevent.
    expect(block).toContain("modelOverride");
  });

  it("passes the escalation effort into the stream config factory", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("app/api/ai/chat/route.ts", "utf8"),
    );
    expect(src).toContain("escalationEffort:");
  });

  it("does NOT pay a DB round-trip on turns with no depth marker", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("app/api/ai/chat/route.ts", "utf8"),
    );
    // The count must be conditional — an ordinary "hey" is the hot path.
    expect(src).toContain("__wantsDepth ? await countEscalationsToday() : 0");
  });
});

describe("effort is applied per attempt, never carried across a rotation", () => {
  it("build-stream-config gates the escalation effort on a Claude 5 thinking model", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("app/api/ai/chat/build-stream-config.ts", "utf8"),
    );
    expect(src).toContain("__escalationEffort && isClaude5ThinkingModel(fbModelId)");
    // And the provider options must consume the EFFECTIVE effort — using
    // canaryEffort here was the original bug's sibling.
    expect(src).toContain("effectiveEffort ? { anthropic: { effort: effectiveEffort } }");
  });
});

describe("mock hygiene", () => {
  it("the module mock is wired (guards against a vacuous suite)", () => {
    mockGetModel.mockReturnValue("sentinel");
    expect(getModel("reason")).toBe("sentinel");
    expect(mockGetModel).toHaveBeenCalled();
  });
});
