/**
 * W7 silent-failure read, P2 #6 · the feed groups entries under ET day headers (dumps carry an ET `date`), and the
 * day view under each header reads that ET day. Situation, decision and retro rows were keyed by their UTC date,
 * so an entry after 7-8 PM ET sat under the NEXT day's header and its day view read the wrong day.
 */
import { describe, expect, it, vi } from "vitest";

const LATE = new Date("2026-11-03T03:30:00Z"); // 10:30 PM ET on Monday 2026-11-02

const h = vi.hoisted(() => ({ situations: vi.fn(), decisions: vi.fn(), memories: vi.fn() }));
const { empty, zero } = vi.hoisted(() => ({ empty: () => vi.fn(async () => []), zero: () => vi.fn(async () => 0) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainDump: { findMany: empty(), count: zero() },
    reflection: { findMany: empty(), count: zero() },
    situationLog: { findMany: (a: unknown) => h.situations(a), count: zero() },
    decisionReplay: { findMany: (a: unknown) => h.decisions(a), count: zero() },
    brainMemory: { findMany: (a: unknown) => h.memories(a), count: zero() },
    lifeGoal: { findMany: empty() },
    personProfile: { findMany: empty() },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }) } }));

import { buildJournalFeed } from "@/lib/services/journal-feed";

const link = { goalId: null, missionId: null, linkStatus: null, linkConfidence: null };

describe("journal feed · every silo is keyed by its ET day", () => {
  it("a situation, a decision and a retro logged at 10:30 PM ET sit under that ET day, not the next UTC day", async () => {
    h.situations.mockResolvedValue([
      { id: "s1", createdAt: LATE, situation: "Hard talk with the landlord", aiAnalysis: null, emotion: null, context: "work", law: null, ...link },
    ]);
    h.decisions.mockResolvedValue([
      { id: "dc1", createdAt: LATE, title: "Keep the second bay", context: null, lesson: null, reasoning: null, reviewed: false, ...link },
    ]);
    h.memories.mockResolvedValue([
      { id: "m1", createdAt: LATE, content: "Retro text", metadata: { missionTitle: "Bay two" }, confidence: 0.8 },
    ]);
    const view = await buildJournalFeed({});
    const dates = Object.fromEntries(view.entries.map((e) => [e.id, e.date]));
    expect(dates.s1).toBe("2026-11-02");
    expect(dates.dc1).toBe("2026-11-02");
    expect(dates.m1).toBe("2026-11-02");
  });
});
