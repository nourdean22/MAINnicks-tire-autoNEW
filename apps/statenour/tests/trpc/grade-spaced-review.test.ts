/**
 * brain.gradeSpacedReview (round 2, 2026-10-17): the Learn tab's "Got it" on an
 * FSRS card reschedules it instead of soft-deleting it. Operator-only, like
 * forgetMemoryByKey; the result is the shared grader's, never a fake date.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/feature-flags", () => ({
  getFlag: () => null,
  FLAG_REGISTRY: [],
  getAllFlags: () => [],
  loadFeatureFlagOverrides: vi.fn().mockResolvedValue(undefined),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    brainMemory: { findUnique: vi.fn(), updateMany: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { appRouter } from "@/lib/trpc/root";
import { learnReviewRow } from "@/lib/brain/fsrs-schedule";

const DAY = 86_400_000;
const operator = () =>
  appRouter.createCaller({
    session: { id: "operator-1", email: "operator@statenour.local", role: "operator" },
    db: mockPrisma as never,
  });

beforeEach(() => {
  vi.clearAllMocks();
  const row = learnReviewRow("Opportunity cost", "Cost of the next best option.", new Date(Date.now() - DAY));
  mockPrisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content: row.content });
  mockPrisma.brainMemory.updateMany.mockResolvedValue({ count: 1 });
});

describe("brain.gradeSpacedReview", () => {
  it("good: the card is rescheduled days out, nothing is deleted", async () => {
    const r = await operator().brain.gradeSpacedReview({ key: "review_Opportunity_cost", rating: "good" });
    expect(r.status).toBe("graded");
    if (r.status !== "graded") return;
    expect(r.days).toBe(3);
    expect(new Date(r.due).getTime()).toBeGreaterThan(Date.now() + 2 * DAY);
    const call = mockPrisma.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ category: "spaced_review", key: "review_Opportunity_cost", deletedAt: null });
    expect("deletedAt" in call.data).toBe(false);
  });

  it("again: graded as a lapse-or-relearn, due tomorrow for a new card", async () => {
    const r = await operator().brain.gradeSpacedReview({ key: "review_Opportunity_cost", rating: "again" });
    expect(r).toMatchObject({ status: "graded", days: 1 });
  });

  it("a lost swap returns lost, not a date", async () => {
    mockPrisma.brainMemory.updateMany.mockResolvedValue({ count: 0 });
    expect(await operator().brain.gradeSpacedReview({ key: "review_Opportunity_cost", rating: "good" })).toEqual({ status: "lost" });
  });

  it("a soft-deleted card is not revived", async () => {
    mockPrisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: new Date(), content: "{}" });
    expect(await operator().brain.gradeSpacedReview({ key: "review_Opportunity_cost", rating: "good" })).toEqual({ status: "cleared" });
    expect(mockPrisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a rating outside good | again", async () => {
    await expect(
      operator().brain.gradeSpacedReview({ key: "review_x", rating: "easy" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.brainMemory.findUnique).not.toHaveBeenCalled();
  });
});
