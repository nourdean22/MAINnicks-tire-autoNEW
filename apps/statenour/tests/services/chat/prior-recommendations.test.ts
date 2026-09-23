/**
 * loadPriorRecommendations · the exclusion contract (review on PR #2485).
 *
 * The reply-side novelty shadow runs AFTER the current assistant reply is
 * persisted. Without `excludeMessageId`, the newest-first scan's first row IS
 * the draft being judged, so every name it used is "already recommended".
 * This pins the where-clause the loader sends to Prisma; the recorder's own
 * test pins that it passes the id; the wiring test pins that the live site
 * binds this loader. Three seams, one contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { chatMessage: { findMany: (a: unknown) => findMany(a) } },
}));

import { loadPriorRecommendations } from "@/lib/services/chat/prior-recommendations";

// A row the REAL extractor recognises (same fixture the recorder test uses).
const ROW = {
  content: "You should listen to the Acquired podcast.",
  createdAt: new Date("2026-09-20T00:00:00.000Z"),
};

type FindManyArg = { where: Record<string, unknown>; take?: number };
function whereSent(): Record<string, unknown> {
  const arg = findMany.mock.calls[0]?.[0] as FindManyArg | undefined;
  expect(arg, "findMany was not called").toBeDefined();
  return arg!.where;
}

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([ROW]);
});

describe("loadPriorRecommendations", () => {
  it("POSITIVE CONTROL: rows reach the extractor and come back as OK priors", async () => {
    const result = await loadPriorRecommendations();
    expect(result.provenance).toBe("OK");
    expect(result.priors.length).toBeGreaterThanOrEqual(1);
    expect(result.priors[0]?.timesSurfaced).toBe(1);
  });

  it("excludeMessageId lands in the where clause as id: { not }, beside the existing filters", async () => {
    await loadPriorRecommendations({ excludeMessageId: "m_reply" });
    const where = whereSent();
    expect(where.id).toEqual({ not: "m_reply" });
    expect(where.role).toBe("assistant");
    expect(where.createdAt).toBeDefined();
  });

  it("no option, and an explicit null, add no id filter — the prompt-side caller is unchanged", async () => {
    await loadPriorRecommendations();
    expect(whereSent().id).toBeUndefined();

    findMany.mockClear();
    await loadPriorRecommendations({ excludeMessageId: null });
    expect(whereSent().id).toBeUndefined();
  });

  it("EMPTY IS NOT ERROR: a failed query is ERROR with no priors, never ZERO", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    const result = await loadPriorRecommendations({ excludeMessageId: "m_reply" });
    expect(result).toEqual({ priors: [], provenance: "ERROR" });
  });
});
