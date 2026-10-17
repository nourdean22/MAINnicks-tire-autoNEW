/**
 * One grader for a spaced_review row (round 2, 2026-10-17): the Daily Tutor
 * (tutor-pack.ts) and the Learn tab's "Got it" (brain.gradeSpacedReview) both
 * reschedule through gradeSpacedReview. Compare-and-swap on the row's previous
 * content with deletedAt: null, schedule fields only, a cleared card stays cleared,
 * and a result names what happened: never a date that was not written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  prisma: { brainMemory: { findUnique: vi.fn(), updateMany: vi.fn() } },
  info: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: h.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// tutor-pack's other collaborators: never reached by gradeSpacedReview.
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShown: vi.fn(), recordDecision: vi.fn(), recordOutcomeResult: vi.fn() }));
vi.mock("@/lib/services/decision-replay-coach", () => ({ markReplayed: vi.fn() }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn(), sendTelegramWithButtons: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { gradeSpacedReview } from "@/lib/brain/tutor-pack";
import { learnReviewRow, nextReview, Rating } from "@/lib/brain/fsrs-schedule";

const T0 = new Date("2026-10-16T12:00:00.000Z");
const NOW = new Date("2026-10-17T12:00:00.000Z");
const DAY = 86_400_000;
const learnRow = () => ({ id: "m1", deletedAt: null, content: learnReviewRow("Opportunity cost", "Cost of the next best option.", T0).content });
const written = () => JSON.parse(h.prisma.brainMemory.updateMany.mock.calls[0][0].data.content);

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.brainMemory.findUnique.mockResolvedValue(learnRow());
  h.prisma.brainMemory.updateMany.mockResolvedValue({ count: 1 });
});

describe("gradeSpacedReview", () => {
  it("good on a Learn card: due moves out, schedule fields only, through the swap", async () => {
    const row = learnRow();
    h.prisma.brainMemory.findUnique.mockResolvedValue(row);
    const r = await gradeSpacedReview("review_Opportunity_cost", Rating.Good, NOW);
    const prevState = JSON.parse(row.content).fsrs;
    const expected = nextReview(prevState, Rating.Good, NOW);
    expect(r).toEqual({ status: "graded", due: expected.due.toISOString(), days: expected.state.scheduled_days });
    expect(r.status === "graded" && r.days).toBeGreaterThan(1);
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "m1", category: "spaced_review", key: "review_Opportunity_cost", content: row.content, deletedAt: null });
    expect(Object.keys(call.data).sort()).toEqual(["content", "expiresAt", "lastSeen"]);
    const next = written();
    expect(next).toMatchObject({ topic: "Opportunity cost", summary: "Cost of the next best option.", completed: false, interval: expected.state.scheduled_days, reviewAt: expected.due.toISOString() });
    expect(next.fsrs).toEqual(expected.state);
    expect(new Date(next.reviewAt).getTime() - NOW.getTime()).toBe(expected.state.scheduled_days * DAY);
  });

  it("again on a mature card: a lapse, and the interval shrinks", async () => {
    let s = nextReview(null, Rating.Good, new Date(NOW.getTime() - 90 * DAY));
    for (let k = 0; k < 3; k++) s = nextReview(s.state, Rating.Good, s.due);
    const content = JSON.stringify({ topic: "t", summary: "s", reviewAt: s.due.toISOString(), interval: s.state.scheduled_days, completed: false, fsrs: s.state });
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content });
    const r = await gradeSpacedReview("review_t", Rating.Again, NOW);
    expect(written().fsrs.lapses).toBe(s.state.lapses + 1);
    expect(r.status === "graded" && r.days).toBeLessThan(s.state.scheduled_days);
  });

  it("a lost swap writes nothing else and returns lost, never a date", async () => {
    h.prisma.brainMemory.updateMany.mockResolvedValue({ count: 0 });
    expect(await gradeSpacedReview("review_Opportunity_cost", Rating.Good, NOW)).toEqual({ status: "lost" });
    expect(h.prisma.brainMemory.updateMany).toHaveBeenCalledTimes(1);
  });

  it("a soft-deleted row is not revived: cleared, no write", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue({ ...learnRow(), deletedAt: new Date("2026-10-16T00:00:00Z") });
    expect(await gradeSpacedReview("review_Opportunity_cost", Rating.Good, NOW)).toEqual({ status: "cleared" });
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("no row: missing, no write (the tutor creates it; the Learn tab has nothing to grade)", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue(null);
    expect(await gradeSpacedReview("review_x", Rating.Good, NOW)).toEqual({ status: "missing" });
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("unreadable content and no seed: unreadable, no write (never a card with no topic)", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content: "not json" });
    expect(await gradeSpacedReview("review_x", Rating.Good, NOW)).toEqual({ status: "unreadable" });
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("(P2-4) an unreadable stored fsrs state resets to a new card and logs one info line (key, reason)", async () => {
    const content = JSON.stringify({ topic: "t", summary: "s", reviewAt: NOW.toISOString(), interval: 9, completed: false, fsrs: { ...nextReview(null, Rating.Good, T0).state, stability: 0.0001 } });
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content });
    const r = await gradeSpacedReview("review_t", Rating.Good, NOW);
    expect(written().fsrs).toEqual(nextReview(null, Rating.Good, NOW).state);
    expect(r).toMatchObject({ status: "graded", days: 3 });
    expect(h.info).toHaveBeenCalledTimes(1);
    expect(h.info).toHaveBeenCalledWith("spaced_review_fsrs_reset", { key: "review_t", reason: expect.stringMatching(/stability/) });
  });

  it("(P2-4) a valid state and a legacy row with no fsrs key log nothing", async () => {
    await gradeSpacedReview("review_Opportunity_cost", Rating.Good, NOW);
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content: JSON.stringify({ topic: "t", summary: "s", streak: 2 }) });
    await gradeSpacedReview("review_legacy", Rating.Good, NOW);
    expect(h.info).not.toHaveBeenCalled();
  });

  it("reads only the spaced_review category by key", async () => {
    await gradeSpacedReview("review_Opportunity_cost", Rating.Good, NOW);
    expect(h.prisma.brainMemory.findUnique.mock.calls[0][0].where).toEqual({ category_key: { category: "spaced_review", key: "review_Opportunity_cost" } });
  });
});
