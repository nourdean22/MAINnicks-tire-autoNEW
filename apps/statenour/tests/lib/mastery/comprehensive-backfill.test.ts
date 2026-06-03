/**
 * comprehensive-backfill orchestration tests · 2026-06-03.
 *
 * Pins the SAFETY invariants of the all-source backfill (deps mocked — prisma,
 * the AI attributor, and creditStatXp are proven elsewhere):
 *   1. Already-credited rows are SKIPPED before any AI call (no double-count,
 *      no wasted spend on re-runs).
 *   2. dryRun attributes but NEVER writes (creditStatXp not called).
 *   3. A real run credits only the UNCREDITED rows, passing the run marker
 *      so the run is reversible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// hoisted so the (hoisted) vi.mock factory below can reference them.
const { findManyDefault, chatFindMany, brainFindMany } = vi.hoisted(() => ({
  findManyDefault: vi.fn(async () => [] as unknown[]),
  chatFindMany: vi.fn(),
  brainFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findMany: chatFindMany },
    brainMemory: { findMany: brainFindMany },
    brainDump: { findMany: findManyDefault },
    reflection: { findMany: findManyDefault },
    situationLog: { findMany: findManyDefault },
    decisionReplay: { findMany: findManyDefault },
    captureInboxItem: { findMany: findManyDefault },
    masteryDecision: { findMany: findManyDefault },
    lifeGoal: { findMany: findManyDefault },
    bodyTracking: { findMany: findManyDefault },
  },
}));

vi.mock("@/lib/mastery/attribution", () => ({
  attributeText: vi.fn(),
}));

vi.mock("@/lib/mastery/credit", () => ({
  MASTERY_XP_CATEGORY: "mastery_xp_event",
  creditStatXp: vi.fn(async () => true),
}));

vi.mock("@/lib/mastery/people-credit", () => ({
  backfillPeopleXp: vi.fn(async () => ({ deposits: 0, plays: 0 })),
}));

import { runComprehensiveBackfill } from "@/lib/mastery/comprehensive-backfill";
import { attributeText } from "@/lib/mastery/attribution";
import { creditStatXp } from "@/lib/mastery/credit";

const mockText = vi.mocked(attributeText);
const mockCredit = vi.mocked(creditStatXp);

describe("runComprehensiveBackfill · safety invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // two substantive chat messages; c1 will already be credited.
    chatFindMany.mockResolvedValue([
      { id: "c1", content: "a substantive note about pricing brake jobs higher" },
      { id: "c2", content: "another real message about closing the fleet deal" },
    ]);
    // existingKeys() query → chat:c1 already has a mastery_xp_event row.
    brainFindMany.mockResolvedValue([{ key: "chat:c1" }]);
    mockText.mockResolvedValue({ stat: "sales", xp: 1, evidence: "priced up" });
    mockCredit.mockResolvedValue(true);
  });

  it("skips already-credited rows BEFORE any AI call (no double-count, no spend)", async () => {
    const res = await runComprehensiveBackfill({ sources: ["chat"], runTag: "t1" });
    // c1 is already credited → never attributed; only c2 hits the AI.
    expect(mockText).toHaveBeenCalledTimes(1);
    expect(mockText).toHaveBeenCalledWith(
      expect.stringContaining("fleet deal"),
      "chat",
    );
    expect(res.bySource.chat.scanned).toBe(2);
    expect(res.bySource.chat.credited).toBe(1);
    expect(res.aiCalls).toBe(1);
  });

  it("credits the uncredited row with the run marker (reversible)", async () => {
    await runComprehensiveBackfill({ sources: ["chat"], runTag: "run-XYZ" });
    expect(mockCredit).toHaveBeenCalledTimes(1);
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: "chat:c2",
        stat: "sales",
        signal: "chat",
        backfillRun: "run-XYZ",
      }),
    );
  });

  it("dryRun attributes but NEVER writes", async () => {
    const res = await runComprehensiveBackfill({
      sources: ["chat"],
      runTag: "t2",
      dryRun: true,
    });
    expect(mockText).toHaveBeenCalledTimes(1); // still previews attribution
    expect(mockCredit).not.toHaveBeenCalled(); // but writes nothing
    expect(res.dryRun).toBe(true);
    expect(res.credited).toBe(1); // tallied what WOULD be credited
    expect(res.xpAdded).toBe(1);
    expect(res.byStat.sales).toBe(1);
  });

  it("does not run people-backfill in dryRun", async () => {
    const { backfillPeopleXp } = await import("@/lib/mastery/people-credit");
    await runComprehensiveBackfill({ sources: ["people"], runTag: "t3", dryRun: true });
    expect(vi.mocked(backfillPeopleXp)).not.toHaveBeenCalled();
  });
});
