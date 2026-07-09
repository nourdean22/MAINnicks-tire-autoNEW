/**
 * AG-31 · tactician next-move composer contract tests (mocked deps).
 *
 * Locks: intent self-gating, person power-state inclusion, the
 * exactly-ONE-move directive, corpus-action pass-through with
 * citations, empty-move self-suppression, and fail-closed behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPersonFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: {
      findMany: (...a: unknown[]) => mockPersonFindMany(...a),
    },
  },
}));

const mockGreenePicks = vi.fn();
vi.mock("@/lib/ai/greene-message-matcher", () => ({
  pickContextualLawsForMessage: (...a: unknown[]) => mockGreenePicks(...a),
}));

const mockDarkPicks = vi.fn();
vi.mock("@/lib/ai/dark-psychology-matcher", () => ({
  pickDarkPsychologyForMessage: (...a: unknown[]) => mockDarkPicks(...a),
}));

const mockPersonLaws = vi.fn();
vi.mock("@/lib/ai/contextual-greene-laws", () => ({
  pickContextualLawsForPerson: (...a: unknown[]) => mockPersonLaws(...a),
}));

import { buildNextMoveBlock, _resetTacticianCaches, TACTICIAN_INTENT } from "@/lib/ai/tactician/next-move";

beforeEach(() => {
  vi.clearAllMocks();
  _resetTacticianCaches();
  mockPersonFindMany.mockResolvedValue([]);
  mockGreenePicks.mockResolvedValue([]);
  mockDarkPicks.mockResolvedValue([]);
  mockPersonLaws.mockResolvedValue(null);
});

const TACTICAL_MSG = "Marcus keeps undercutting me in front of the client, how do I respond";

describe("buildNextMoveBlock", () => {
  it("self-gates: no tactical intent → empty, no queries fired", async () => {
    const out = await buildNextMoveBlock("what's the weather like for the shop tomorrow");
    expect(out).toBe("");
    expect(mockGreenePicks).not.toHaveBeenCalled();
  });

  it("relaxed (/battle) bypasses the intent gate", async () => {
    mockGreenePicks.mockResolvedValue([
      { key: "l1", title: "Law One", book: "48 Laws", score: 1, hits: [], actions: ["Go quiet for 48 hours"] },
    ]);
    const out = await buildNextMoveBlock("plan my week", { relaxed: true });
    expect(out).toContain("NEXT MOVE");
  });

  it("composes person power-state + corpus move + the ONE-move directive", async () => {
    mockPersonFindMany.mockResolvedValue([
      { id: "p1", name: "Marcus", powerBalance: -0.4 },
    ]);
    mockPersonLaws.mockResolvedValue({
      laws: [
        {
          key: "law_5",
          book: "48 Laws",
          title: "So Much Depends on Reputation",
          summary: "s",
          rationale: "r",
          actions: ["Correct the record with the client in writing within 24h"],
        },
      ],
      source: "cache",
      generatedAt: new Date().toISOString(),
    });
    const out = await buildNextMoveBlock(TACTICAL_MSG);
    expect(out).toContain("Marcus");
    expect(out).toContain("they hold the leverage");
    expect(out).toContain("Correct the record with the client in writing within 24h");
    expect(out).toContain("[48 Laws · So Much Depends on Reputation]");
    expect(out).toContain("exactly ONE concrete move");
  });

  it("suppresses entirely when no source yields an action", async () => {
    mockGreenePicks.mockResolvedValue([
      { key: "l1", title: "Law One", book: "48 Laws", score: 2, hits: ["undercut"], actions: [] },
    ]);
    const out = await buildNextMoveBlock(TACTICAL_MSG);
    expect(out).toBe("");
  });

  it("fails closed when a dependency throws", async () => {
    mockPersonFindMany.mockRejectedValue(new Error("db down"));
    mockGreenePicks.mockRejectedValue(new Error("db down"));
    const out = await buildNextMoveBlock(TACTICAL_MSG);
    expect(out).toBe("");
  });
});

describe("TACTICIAN_INTENT", () => {
  it("matches move-asking and power phrasings", () => {
    expect(TACTICIAN_INTENT.test("how do I counter their offer")).toBe(true);
    expect(TACTICIAN_INTENT.test("what's my next move with the vendor")).toBe(true);
    expect(TACTICIAN_INTENT.test("the power dynamics with this landlord")).toBe(true);
  });
  it("ignores casual/operational turns", () => {
    expect(TACTICIAN_INTENT.test("book the alignment for 3pm")).toBe(false);
    expect(TACTICIAN_INTENT.test("hey")).toBe(false);
  });
});
