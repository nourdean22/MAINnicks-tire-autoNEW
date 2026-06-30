/**
 * v9.1.3 · Contract tests for the buildSystemPrompt routing logic.
 *
 * Verifies that buildSystemPrompt now always routes directly to buildSystemPromptV2
 * since V2 is default and V1 has been deprecated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the v2 builder so we can detect when it's called.
const buildSystemPromptV2Mock = vi.fn(async () => ({
  prompt: "## V2 PROMPT\n\nfrom NickPrimeContext",
  sections: { commands: "", proof: "", risks: "", decisions: "", health: "", totalChars: 0 },
  meta: { builderVersion: "v2", contextChars: 32, builtAt: "2026-04-30T00:00:00Z" },
}));

vi.mock("@/lib/ai/prompt/v2", () => ({
  buildSystemPromptV2: buildSystemPromptV2Mock,
  isPromptV2Enabled: () => true,
}));

vi.mock("@/lib/utils/cache", () => ({
  cached: vi.fn(async (_key: string, _ttl: number, build: () => Promise<string>) => {
    return await build();
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("prompt v2 routing", () => {
  it("always routes buildSystemPrompt to v2 regardless of NICK_PRIME_PROMPT env", async () => {
    process.env.NICK_PRIME_PROMPT = "off";
    const { buildSystemPrompt } = await import("@/lib/ai/system-prompt");

    const res = await buildSystemPrompt("core", null);
    expect(buildSystemPromptV2Mock).toHaveBeenCalledTimes(1);
    expect(res).toContain("V2 PROMPT");
  });

  it("always routes buildSystemPromptUncached to v2", async () => {
    const { buildSystemPromptUncached } = await import("@/lib/ai/system-prompt");

    const res = await buildSystemPromptUncached("full", null);
    expect(buildSystemPromptV2Mock).toHaveBeenCalledTimes(1);
    expect(res).toContain("V2 PROMPT");
  });

  it("routes to stitch_prompt slot and appends Stitch capability instructions when Stitch intent is matched", async () => {
    const { buildSystemPrompt } = await import("@/lib/ai/system-prompt");

    const res = await buildSystemPrompt("core", "enhance prompt for my dashboard");
    expect(res).toContain("V2 PROMPT");
    expect(res).toContain("## Capability: Stitch Prompt Engineering");
  });

  it("does not load Stitch capability instructions for unrelated tasks", async () => {
    const { buildSystemPrompt } = await import("@/lib/ai/system-prompt");

    const res = await buildSystemPrompt("core", "write me an Instagram caption");
    expect(res).toContain("V2 PROMPT");
    expect(res).not.toContain("## Capability: Stitch Prompt Engineering");
  });
});
