/**
 * brain.ensureLearnCard (brain follow-up 1, 2026-10-17): the Learn tab's "learned it"
 * write. Operator-only, validated input, and the result is the shared function's:
 * a re-learn keeps the card's schedule, never a fake date.
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
import { brainMemory } from "@/lib/brain/memory-manager";
import { learnReviewRow, nextReview, Rating } from "@/lib/brain/fsrs-schedule";

const DAY = 86_400_000;
const operator = () =>
  appRouter.createCaller({
    session: { id: "operator-1", email: "operator@statenour.local", role: "operator" },
    db: mockPrisma as never,
  });

const matureContent = () => {
  let s = nextReview(null, Rating.Good, new Date(Date.now() - 60 * DAY));
  for (let k = 0; k < 3; k++) s = nextReview(s.state, Rating.Good, s.due);
  return JSON.stringify({ topic: "Opportunity cost", summary: "Old.", reviewAt: s.due.toISOString(), interval: s.state.scheduled_days, completed: false, fsrs: s.state });
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content: matureContent() });
  mockPrisma.brainMemory.updateMany.mockResolvedValue({ count: 1 });
});

describe("brain.ensureLearnCard", () => {
  it("re-learn: the card is kept, the swap is on a live row, nothing else changes", async () => {
    const r = await operator().brain.ensureLearnCard({ topic: "Opportunity cost", summary: "Newest." });
    expect(r).toEqual({ status: "kept" });
    const call = mockPrisma.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ category: "spaced_review", key: "review_Opportunity_cost", deletedAt: null });
    expect(JSON.parse(call.data.content).summary).toBe("Newest.");
  });

  it("FU5: a legacy row is upgraded to an FSRS card in place, not left alone", async () => {
    const legacy = JSON.stringify({ topic: "Opportunity cost", summary: "s", streak: 1 });
    mockPrisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content: legacy });
    expect(await operator().brain.ensureLearnCard({ topic: "Opportunity cost", summary: "x" })).toEqual({ status: "reset" });
    expect(mockPrisma.brainMemory.updateMany).toHaveBeenCalledTimes(1);
    const card = JSON.parse(mockPrisma.brainMemory.updateMany.mock.calls[0][0].data.content);
    expect(card.fsrs.reps).toBe(0);
    expect(typeof card.legacy_upgraded_at).toBe("string");
  });

  it("a lost swap returns lost", async () => {
    mockPrisma.brainMemory.updateMany.mockResolvedValue({ count: 0 });
    expect(await operator().brain.ensureLearnCard({ topic: "Opportunity cost", summary: "x" })).toEqual({ status: "lost" });
  });

  it("P1: a long teach read and a long topic still create a card (the client sends them unclipped); the server clips the summary", async () => {
    const remember = vi.spyOn(brainMemory, "remember").mockResolvedValue({ id: "new" } as never);
    mockPrisma.brainMemory.findUnique.mockResolvedValue(null);
    const c = operator();
    expect(await c.brain.ensureLearnCard({ topic: "Opportunity cost", summary: "s".repeat(2001) })).toEqual({ status: "created" });
    expect(JSON.parse(remember.mock.calls[0][2]).summary).toHaveLength(300);
    expect(await c.brain.ensureLearnCard({ topic: "t".repeat(450), summary: "x" })).toEqual({ status: "created" });
    expect(JSON.parse(remember.mock.calls[1][2]).topic).toHaveLength(450);
    remember.mockRestore();
  });

  it("rejects an empty topic, a topic over 500, and a summary over 20000, before any read (positive control for the ceilings)", async () => {
    await expect(operator().brain.ensureLearnCard({ topic: "", summary: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(operator().brain.ensureLearnCard({ topic: "t".repeat(501), summary: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(operator().brain.ensureLearnCard({ topic: "t", summary: "s".repeat(20_001) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.brainMemory.findUnique).not.toHaveBeenCalled();
  });

  it("accepts the limits: topic 500, summary 20000, empty summary", async () => {
    mockPrisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content: JSON.stringify({ streak: 1 }) });
    const c = operator();
    expect(await c.brain.ensureLearnCard({ topic: "t".repeat(500), summary: "s".repeat(20_000) })).toEqual({ status: "reset" });
    expect(await c.brain.ensureLearnCard({ topic: "t", summary: "" })).toEqual({ status: "reset" });
  });

  it("is operator-only: no session is UNAUTHORIZED and nothing is read", async () => {
    const anon = appRouter.createCaller({ session: null, db: mockPrisma as never } as never);
    await expect(anon.brain.ensureLearnCard({ topic: "Opportunity cost", summary: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockPrisma.brainMemory.findUnique).not.toHaveBeenCalled();
  });

  it("sanity: the fixture row really carries learnReviewRow's key", () => {
    expect(learnReviewRow("Opportunity cost", "x", new Date()).key).toBe("review_Opportunity_cost");
  });
});
