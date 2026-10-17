/**
 * Brain follow-up 1 (FSRS #3115): learning a topic again in the Learn tab keeps that
 * topic's FSRS card. ensureLearnCard (lib/brain/tutor-pack.ts) replaces the Learn tab's
 * recordMemory upsert, which overwrote a mature card with a new one due tomorrow.
 *
 * Missing row -> a new card through brainMemory.remember (admission still applies).
 * Soft-deleted row -> a new card, never the old state. Live row with a readable fsrs
 * state -> schedule untouched, summary and topic refreshed through a compare-and-swap.
 * Live row without fsrs -> untouched and nothing created. A lost swap -> `lost`, no date.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  prisma: { brainMemory: { findUnique: vi.fn(), updateMany: vi.fn() } },
  remember: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: h.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// tutor-pack's other collaborators: never reached by ensureLearnCard.
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: h.remember } }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShown: vi.fn(), recordDecision: vi.fn(), recordOutcomeResult: vi.fn() }));
vi.mock("@/lib/services/decision-replay-coach", () => ({ markReplayed: vi.fn() }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn(), sendTelegramWithButtons: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { ensureLearnCard } from "@/lib/brain/tutor-pack";
import { learnReviewRow, nextReview, Rating, type FsrsState } from "@/lib/brain/fsrs-schedule";

const DAY = 86_400_000;
const T0 = new Date("2026-08-01T12:00:00.000Z");
const NOW = new Date("2026-10-17T12:00:00.000Z");
const TOPIC = "Opportunity cost";
const KEY = "review_Opportunity_cost";

/** A card reviewed Good four times: stability, reps and due all well past a new card's. */
function matureState(): { state: FsrsState; content: string } {
  let s = nextReview(null, Rating.Good, T0);
  for (let k = 0; k < 3; k++) s = nextReview(s.state, Rating.Good, s.due);
  const content = JSON.stringify({
    topic: TOPIC,
    summary: "Old explanation.",
    reviewAt: s.due.toISOString(),
    interval: s.state.scheduled_days,
    completed: false,
    fsrs: s.state,
  });
  return { state: s.state, content };
}

const written = () => JSON.parse(h.prisma.brainMemory.updateMany.mock.calls[0][0].data.content);

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks does not drain a mockResolvedValueOnce queue: a failing test would leak it into the next.
  h.prisma.brainMemory.findUnique.mockReset();
  h.prisma.brainMemory.updateMany.mockResolvedValue({ count: 1 });
  h.remember.mockResolvedValue({ id: "new" });
});

describe("ensureLearnCard", () => {
  it("re-learn of a topic whose card has fsrs state keeps stability, reps and due, and updates the summary", async () => {
    const { state, content } = matureState();
    expect(state.reps).toBeGreaterThan(1); // the fixture really is a mature card
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content });

    const r = await ensureLearnCard(TOPIC, "The newest explanation.", NOW);

    expect(r).toEqual({ status: "kept" });
    const next = written();
    expect(next.fsrs).toEqual(state);
    expect(next.fsrs.stability).toBe(state.stability);
    expect(next.fsrs.reps).toBe(state.reps);
    expect(next.fsrs.due).toBe(state.due);
    const prev = JSON.parse(content);
    expect(next.reviewAt).toBe(prev.reviewAt);
    expect(next.interval).toBe(prev.interval);
    expect(next.completed).toBe(false);
    expect(next.summary).toBe("The newest explanation.");
    expect(next.topic).toBe(TOPIC);
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("the kept update is a compare-and-swap on the previous content, live rows only, content and lastSeen only", async () => {
    const { content } = matureState();
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content });
    await ensureLearnCard(TOPIC, "New.", NOW);
    expect(h.prisma.brainMemory.updateMany).toHaveBeenCalledTimes(1);
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "m1", category: "spaced_review", key: KEY, content, deletedAt: null, supersededById: null });
    expect(Object.keys(call.data).sort()).toEqual(["content", "lastSeen"]);
  });

  it("a fresh Learn card (reps 0) is kept as well: the summary refreshes, the schedule does not move", async () => {
    const fresh = learnReviewRow(TOPIC, "First.", new Date(NOW.getTime() - DAY));
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content: fresh.content });
    expect(await ensureLearnCard(TOPIC, "Second.", NOW)).toEqual({ status: "kept" });
    expect(written().fsrs).toEqual(JSON.parse(fresh.content).fsrs);
    expect(written().reviewAt).toBe(JSON.parse(fresh.content).reviewAt);
  });

  it("a missing row creates a new card due +1 day through brainMemory.remember", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue(null);
    const r = await ensureLearnCard(TOPIC, "Cost of the next best option.", NOW);
    expect(r).toEqual({ status: "created" });
    const expected = learnReviewRow(TOPIC, "Cost of the next best option.", NOW);
    expect(h.remember).toHaveBeenCalledTimes(1);
    expect(h.remember).toHaveBeenCalledWith("spaced_review", KEY, expected.content, "learn_mode");
    const card = JSON.parse(h.remember.mock.calls[0][2]);
    expect(new Date(card.reviewAt).getTime() - NOW.getTime()).toBe(DAY);
    expect(card.fsrs.reps).toBe(0);
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("a soft-deleted row gets a new card, not a revive of the old state", async () => {
    const { content } = matureState();
    const deletedAt = new Date("2026-10-01T00:00:00.000Z");
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt, supersededById: null, content });
    const r = await ensureLearnCard(TOPIC, "Again.", NOW);
    expect(r).toEqual({ status: "created" });
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    // swap pinned to the observed tombstone, and the row comes back to life with a new card
    expect(call.where).toEqual({ id: "m1", category: "spaced_review", key: KEY, content, deletedAt, supersededById: null });
    expect(call.data.deletedAt).toBeNull();
    expect(call.data.content).toBe(learnReviewRow(TOPIC, "Again.", NOW).content);
    expect(written().fsrs.reps).toBe(0);
    expect(new Date(written().reviewAt).getTime() - NOW.getTime()).toBe(DAY);
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("a lost swap on a soft-deleted row returns lost", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: new Date(), content: "{}" });
    h.prisma.brainMemory.updateMany.mockResolvedValue({ count: 0 });
    expect(await ensureLearnCard(TOPIC, "x", NOW)).toEqual({ status: "lost" });
    expect(h.prisma.brainMemory.updateMany).toHaveBeenCalledTimes(1);
  });

  it("a legacy row without fsrs is untouched and no second row is written", async () => {
    const content = JSON.stringify({ topic: TOPIC, summary: "s", reviewAt: NOW.toISOString(), interval: 3, completed: false, streak: 2 });
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content });
    expect(await ensureLearnCard(TOPIC, "New explanation.", NOW)).toEqual({ status: "legacy" });
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("P2-2: a live row whose fsrs state cannot be scheduled resets to a new card, pinned to the content read, with one info line", async () => {
    const bad = { ...matureState().state, stability: 0.0001 };
    const content = JSON.stringify({ topic: TOPIC, summary: "s", reviewAt: NOW.toISOString(), interval: 9, completed: false, fsrs: bad });
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, supersededById: null, content });
    expect(await ensureLearnCard(TOPIC, "Fresh.", NOW)).toEqual({ status: "reset" });
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "m1", category: "spaced_review", key: KEY, content, deletedAt: null, supersededById: null });
    expect(call.data.content).toBe(learnReviewRow(TOPIC, "Fresh.", NOW).content);
    expect(written().fsrs.reps).toBe(0);
    expect(h.info).toHaveBeenCalledTimes(1);
    expect(h.info).toHaveBeenCalledWith("spaced_review_fsrs_reset", { key: KEY, reason: expect.stringMatching(/stability/) });
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("P2-2: a row whose content is not JSON resets too (a NaN reviewAt would hide it from the Learn list)", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, supersededById: null, content: "not json" });
    expect(await ensureLearnCard(TOPIC, "Fresh.", NOW)).toEqual({ status: "reset" });
    expect(h.prisma.brainMemory.updateMany.mock.calls[0][0].where.content).toBe("not json");
    expect(written().fsrs.reps).toBe(0);
    expect(h.info).toHaveBeenCalledWith("spaced_review_fsrs_reset", { key: KEY, reason: "content is not JSON" });
  });

  it("P2-2: a lost reset swap returns lost, nothing else is written", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, supersededById: null, content: "not json" });
    h.prisma.brainMemory.updateMany.mockResolvedValue({ count: 0 });
    expect(await ensureLearnCard(TOPIC, "x", NOW)).toEqual({ status: "lost" });
    expect(h.prisma.brainMemory.updateMany).toHaveBeenCalledTimes(1);
  });

  it("P2-4: a superseded row is not live: a new card through a swap pinned to supersededById, clearing it and validUntil", async () => {
    const { content } = matureState();
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, supersededById: "m2", content });
    expect(await ensureLearnCard(TOPIC, "Again.", NOW)).toEqual({ status: "created" });
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "m1", category: "spaced_review", key: KEY, content, deletedAt: null, supersededById: "m2" });
    expect(call.data).toMatchObject({ content: learnReviewRow(TOPIC, "Again.", NOW).content, deletedAt: null, supersededById: null, validUntil: null });
    expect(written().fsrs.reps).toBe(0);
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("P2-3: two first learns at once: the loser's create throws P2002, the row is re-read, and the result is kept (no throw)", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "m9", deletedAt: null, content: "{}" });
    h.remember.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(await ensureLearnCard(TOPIC, "x", NOW)).toEqual({ status: "kept" });
    expect(h.prisma.brainMemory.findUnique).toHaveBeenCalledTimes(2);
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("P2-3: a P2002 with no row to re-read, or any other create error, still throws", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue(null);
    h.remember.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    await expect(ensureLearnCard(TOPIC, "x", NOW)).rejects.toThrow(/Unique constraint/);
    h.remember.mockRejectedValue(new Error("db down"));
    await expect(ensureLearnCard(TOPIC, "x", NOW)).rejects.toThrow("db down");
  });

  it("a lost swap writes nothing else and returns lost, never a date", async () => {
    const { content } = matureState();
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content });
    h.prisma.brainMemory.updateMany.mockResolvedValue({ count: 0 });
    const r = await ensureLearnCard(TOPIC, "New.", NOW);
    expect(r).toEqual({ status: "lost" });
    expect(h.prisma.brainMemory.updateMany).toHaveBeenCalledTimes(1);
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("reads only the spaced_review category by the same key learnReviewRow uses", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue(null);
    await ensureLearnCard(TOPIC, "x", NOW);
    expect(h.prisma.brainMemory.findUnique.mock.calls[0][0].where).toEqual({ category_key: { category: "spaced_review", key: KEY } });
  });

  it("the stored summary is clipped to 300 characters, as a new card's is", async () => {
    const { content } = matureState();
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "m1", deletedAt: null, content });
    await ensureLearnCard(TOPIC, "y".repeat(1500), NOW);
    expect(written().summary).toHaveLength(300);
  });
});
