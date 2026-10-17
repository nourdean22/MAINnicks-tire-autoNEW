/**
 * tests/brain/anticipatory-recall-parts.test.ts · 2026-10-17
 *
 * anticipateMemories builds its search query from the recent trajectory. It
 * read `m.content` only, but the chat route sends v6 UIMessages
 * (`{ id, role, parts: [{ type: "text", text }] }`, no `content`), so on the
 * live client the trajectory was empty and the lane returned "" on every turn.
 *
 * Behavioural: assert what semanticSearch (the embed + vector call) is handed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ semanticSearch: vi.fn() }));

vi.mock("@/lib/brain/embedding-utils", () => ({ semanticSearch: mocks.semanticSearch }));
vi.mock("@/lib/feature-flags", () => ({
  getFlag: (key: string) => ({ key, isOn: true }),
}));

import { anticipateMemories } from "@/lib/brain/anticipatory-recall";

const ui = (id: string, role: string, text: string) => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

beforeEach(() => {
  mocks.semanticSearch.mockReset();
  mocks.semanticSearch.mockResolvedValue([]);
});

describe("anticipateMemories · reads the v6 parts history", () => {
  it("a parts-shaped history reaches the embed query", async () => {
    await anticipateMemories([
      ui("m1", "user", "we moved the Instagram cadence to three reels a week"),
      ui("m2", "assistant", "Noted, three reels a week."),
    ] as never);

    expect(mocks.semanticSearch).toHaveBeenCalledTimes(1);
    const query = mocks.semanticSearch.mock.calls[0][0] as string;
    expect(query).toContain("three reels a week");
    expect(query).toContain("Noted");
  });

  it("a message with several text parts is joined, non-text parts are ignored", async () => {
    await anticipateMemories([
      {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "alpha topic" },
          { type: "tool-call", toolName: "x" },
          { type: "text", text: "beta topic" },
        ],
      },
    ] as never);

    const query = mocks.semanticSearch.mock.calls[0][0] as string;
    expect(query).toContain("alpha topic");
    expect(query).toContain("beta topic");
    expect(query).not.toContain("tool-call");
  });

  it("CONTROL · the legacy { role, content } history still builds the query", async () => {
    await anticipateMemories([
      { role: "user", content: "we moved the Instagram cadence to three reels a week" },
    ]);
    expect(mocks.semanticSearch).toHaveBeenCalledTimes(1);
    expect(mocks.semanticSearch.mock.calls[0][0]).toContain("three reels a week");
  });

  it("CONTROL · a history with no text anywhere stays a no-op (no embed call)", async () => {
    const out = await anticipateMemories([
      { id: "m1", role: "user", parts: [{ type: "tool-call" }] },
    ] as never);
    expect(out).toBe("");
    expect(mocks.semanticSearch).not.toHaveBeenCalled();
  });
});
