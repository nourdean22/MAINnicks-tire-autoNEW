/**
 * greene-message-matcher · Wave AH Phase 1 · 2026-05-28.
 *
 * Tests cover:
 *   - Short messages skip (under 12 chars).
 *   - Empty corpus returns [].
 *   - Trigger match counting (1 hit, 2 hits, no hits).
 *   - minScore gate (top scorer below threshold → []).
 *   - Top-N capping.
 *   - renderGreeneBlock returns "" on empty input.
 *   - renderGreeneBlock shapes correctly with picks.
 *   - Cache TTL · second call within window doesn't re-hit DB.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: vi.fn(),
      // recordGreeneFire's fire-and-forget aggregate write path.
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    // AG-31 · vector-fallback namespace.
    vectorEmbedding: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  pickContextualLawsForMessage,
  renderGreeneBlock,
  _resetGreeneCorpusCache,
} from "@/lib/ai/greene-message-matcher";

function corpusRow(
  key: string,
  title: string,
  triggers: string[],
  extras: Partial<{ summary: string; book: string }> = {},
) {
  return {
    key,
    metadata: {
      title,
      triggers,
      summary: extras.summary ?? `${title} · short summary line.`,
      book: extras.book ?? "48 Laws of Power",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetGreeneCorpusCache();
});

describe("pickContextualLawsForMessage", () => {
  it("skips empty / too-short messages", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([] as never);
    expect(await pickContextualLawsForMessage("")).toEqual([]);
    expect(await pickContextualLawsForMessage("hi")).toEqual([]);
    expect(await pickContextualLawsForMessage("yo wassup")).toEqual([]);
    // Should NOT have queried the DB for these short cases (early return).
    expect(vi.mocked(prisma.brainMemory.findMany)).not.toHaveBeenCalled();
  });

  it("returns [] when corpus is empty", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([] as never);
    const r = await pickContextualLawsForMessage(
      "Should I push back on the boss or stay quiet?",
    );
    expect(r).toEqual([]);
  });

  it("returns [] when top hit count is below minScore threshold", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      corpusRow("law_4", "Always Say Less Than Necessary", [
        "say less",
      ]),
    ] as never);
    // Only 1 trigger fires · default minScore is 2 · should skip.
    const r = await pickContextualLawsForMessage(
      "Should I say less in this meeting tomorrow?",
    );
    expect(r).toEqual([]);
  });

  it("returns a single match when 2+ triggers fire", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      corpusRow("law_15", "Crush Your Enemy Totally", [
        "enemy",
        "rival",
        "crush",
      ]),
      corpusRow("law_3", "Conceal Your Intentions", [
        "intention",
        "hide",
        "decoy",
      ]),
    ] as never);
    const r = await pickContextualLawsForMessage(
      "My rival is openly an enemy now — what should I do?",
    );
    expect(r.length).toBe(1);
    expect(r[0].key).toBe("law_15");
    expect(r[0].score).toBeGreaterThanOrEqual(2);
    expect(r[0].hits).toEqual(expect.arrayContaining(["enemy", "rival"]));
  });

  it("caps the result list at maxLaws", async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      corpusRow(`law_${i + 1}`, `Law ${i + 1}`, ["leverage", "power"]),
    );
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue(rows as never);
    const r = await pickContextualLawsForMessage(
      "How do I use power and leverage in negotiations next week?",
    );
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it("respects custom maxLaws + minScore options", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      corpusRow("law_a", "Law A", ["alpha", "beta"]),
      corpusRow("law_b", "Law B", ["alpha"]),
      corpusRow("law_c", "Law C", ["beta"]),
    ] as never);
    // With minScore=1 + maxLaws=2, all 3 qualify but only top 2 returned.
    const r = await pickContextualLawsForMessage(
      "The alpha beta pattern is showing up everywhere lately.",
      { maxLaws: 2, minScore: 1 },
    );
    expect(r.length).toBe(2);
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
  });

  it("ranks higher score first", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      corpusRow("law_low", "Low", ["leverage"]),
      corpusRow("law_high", "High", ["power", "leverage", "negotiation"]),
    ] as never);
    const r = await pickContextualLawsForMessage(
      "How do I use power, leverage and negotiation here?",
      { minScore: 1 },
    );
    expect(r[0].key).toBe("law_high");
  });

  it("caches the corpus on second call (no second DB hit within TTL)", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      corpusRow("law_x", "X", ["alpha", "beta"]),
    ] as never);
    await pickContextualLawsForMessage("alpha and beta context here");
    await pickContextualLawsForMessage("more alpha and beta context");
    expect(vi.mocked(prisma.brainMemory.findMany)).toHaveBeenCalledTimes(1);
  });

  it("never throws on a DB failure", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockRejectedValue(
      new Error("connection lost"),
    );
    await expect(
      pickContextualLawsForMessage("any reasonable length message here"),
    ).resolves.toEqual([]);
  });

  it("filters out entries with no triggers", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      // No triggers · should be filtered out at load
      { key: "law_empty", metadata: { title: "Empty" } },
      corpusRow("law_good", "Good", ["leverage", "power"]),
    ] as never);
    const r = await pickContextualLawsForMessage(
      "I need leverage and power in this deal.",
    );
    expect(r.length).toBe(1);
    expect(r[0].key).toBe("law_good");
  });
});

describe("AG-31 · vector fallback", () => {
  it("fires on trigger miss when a userEmbedding is provided, flags source:'vector', carries actions", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      {
        key: "law_absence",
        metadata: {
          title: "Use Absence to Increase Respect",
          triggers: ["outshine"], // NOT present in the paraphrased message
          summary: "Scarcity of presence raises its value.",
          book: "48 Laws of Power",
          actions: ["Go quiet for 48 hours after the proposal lands"],
        },
      },
    ] as never);
    vi.mocked(prisma.vectorEmbedding.findMany).mockResolvedValue([
      { sourceId: "law_absence", embedding: "[1,0,0]" },
    ] as never);

    const picks = await pickContextualLawsForMessage(
      "my business partner takes credit for everything I build",
      { userEmbedding: [1, 0, 0] },
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].source).toBe("vector");
    expect(picks[0].key).toBe("law_absence");
    expect(picks[0].actions).toContain("Go quiet for 48 hours after the proposal lands");
  });

  it("stays deterministic-first: does NOT fire when triggers hit", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      {
        key: "law_power",
        metadata: {
          title: "Power Law",
          triggers: ["leverage", "power"],
          summary: "s",
          book: "48 Laws of Power",
          actions: [],
        },
      },
    ] as never);
    const picks = await pickContextualLawsForMessage(
      "how do I get leverage and power in this deal",
      { userEmbedding: [1, 0, 0] },
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].source).toBe("trigger");
    expect(vi.mocked(prisma.vectorEmbedding.findMany)).not.toHaveBeenCalled();
  });
});

describe("renderGreeneBlock", () => {
  it("returns empty string for empty picks", () => {
    expect(renderGreeneBlock([])).toBe("");
  });

  it("renders a labeled block with the picks", () => {
    const out = renderGreeneBlock([
      {
        key: "law_15",
        title: "Crush Your Enemy Totally",
        summary: "When your enemy is down, finish the rivalry.",
        book: "48 Laws of Power",
        score: 3,
        hits: ["enemy", "rival", "crush"],
      },
    ]);
    expect(out).toContain("STRATEGY FRAME");
    expect(out).toContain("Crush Your Enemy Totally");
    expect(out).toContain("48 Laws of Power");
    expect(out).toContain("frame · do NOT lecture");
    // No actions on the pick → no move lines (AG-14 defensive path)
    expect(out).not.toContain("→ move:");
  });

  it("renders '→ move:' lines when the pick carries corpus actions (AG-14)", () => {
    const out = renderGreeneBlock([
      {
        key: "law_16",
        title: "Use Absence to Increase Respect",
        summary: "Scarcity of presence raises its value.",
        book: "48 Laws of Power",
        score: 2,
        hits: ["absence"],
        actions: [
          "Go quiet for 48 hours after the proposal lands",
          "Let them make the next contact",
        ],
      },
    ]);
    expect(out).toContain("→ move: Go quiet for 48 hours after the proposal lands");
    expect(out).toContain("→ move: Let them make the next contact");
  });

  it("handles multiple picks with mixed books", () => {
    const out = renderGreeneBlock([
      {
        key: "law_15",
        title: "Crush Your Enemy",
        summary: "S1",
        book: "48 Laws",
        score: 3,
        hits: ["enemy"],
      },
      {
        key: "human_3",
        title: "Read People",
        summary: "S2",
        book: "Laws of Human Nature",
        score: 2,
        hits: ["read"],
      },
    ]);
    expect(out).toContain("Crush Your Enemy");
    expect(out).toContain("Read People");
    expect(out).toContain("48 Laws");
    expect(out).toContain("Laws of Human Nature");
  });
});
