/**
 * W4 (job 2026-11-02-nour-os-interconnect) · journal feed rows carry the people the entry names, so the row can show
 * them as links to their dossier. Names come from ONE findMany over every id on the page (no N+1), live people only.
 * A failed name read is `people: null` (couldn't load), never `[]` (names no one).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dumps: vi.fn(), people: vi.fn() }));
const { empty, zero } = vi.hoisted(() => ({ empty: () => vi.fn(async () => []), zero: () => vi.fn(async () => 0) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainDump: { findMany: (a: unknown) => h.dumps(a), count: zero() },
    reflection: { findMany: empty(), count: zero() },
    situationLog: { findMany: empty(), count: zero() },
    decisionReplay: { findMany: empty(), count: zero() },
    brainMemory: { findMany: empty(), count: zero() },
    lifeGoal: { findMany: empty() },
    personProfile: { findMany: (a: unknown) => h.people(a) },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }) } }));

import { buildJournalFeed } from "@/lib/services/journal-feed";

const dump = (id: string, personIds: string[] | undefined) => ({
  id,
  date: "2026-11-02",
  createdAt: new Date(`2026-11-02T1${id.length}:00:00Z`),
  rawThoughts: `thought ${id}`,
  summary: null,
  extractedItems: null,
  patterns: null,
  moodBefore: null,
  actionsTaken: 0,
  entryType: null,
  goalId: null,
  missionId: null,
  linkConfidence: null,
  linkStatus: null,
  enrichedAt: null,
  ...(personIds ? { personIds } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildJournalFeed · people on journal rows", () => {
  it("resolves names in one query over every id, live people only, in the entry's order", async () => {
    h.dumps.mockResolvedValue([dump("d1", ["p2", "p1"]), dump("d22", ["p1"]), dump("d333", [])]);
    h.people.mockResolvedValue([
      { id: "p1", name: "Dania" },
      { id: "p2", name: "Samir" },
    ]);
    const view = await buildJournalFeed({});
    expect(h.people).toHaveBeenCalledTimes(1);
    const args = h.people.mock.calls[0][0] as { where: { id: { in: string[] }; deletedAt: null } };
    expect(args.where.deletedAt).toBeNull();
    expect([...args.where.id.in].sort()).toEqual(["p1", "p2"]);
    const by = Object.fromEntries(view.entries.map((e) => [e.id, e.people]));
    expect(by.d1).toEqual([{ id: "p2", name: "Samir" }, { id: "p1", name: "Dania" }]);
    expect(by.d22).toEqual([{ id: "p1", name: "Dania" }]);
    expect(by.d333).toEqual([]);
  });

  it("a soft-deleted person (not returned by the query) is dropped from the row, not shown as a bare id", async () => {
    h.dumps.mockResolvedValue([dump("d1", ["p1", "gone"])]);
    h.people.mockResolvedValue([{ id: "p1", name: "Dania" }]);
    const view = await buildJournalFeed({});
    expect(view.entries[0].people).toEqual([{ id: "p1", name: "Dania" }]);
  });

  it("a FAILED name read is people: null on rows that have ids, not an empty list", async () => {
    h.dumps.mockResolvedValue([dump("d1", ["p1"]), dump("d22", [])]);
    h.people.mockRejectedValue(new Error("db"));
    const view = await buildJournalFeed({});
    const by = Object.fromEntries(view.entries.map((e) => [e.id, e.people]));
    expect(by.d1).toBeNull();
    expect(by.d22).toEqual([]);
  });

  it("control: no ids on the page means no people query; legacy rows without the column read []", async () => {
    h.dumps.mockResolvedValue([dump("d1", undefined)]);
    const view = await buildJournalFeed({});
    expect(h.people).not.toHaveBeenCalled();
    expect(view.entries[0].people).toEqual([]);
  });
});
