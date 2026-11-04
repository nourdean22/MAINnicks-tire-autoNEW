/**
 * W8b Codex round, finding 4 · a link to one journal entry must land on it. /journal shows the newest 50 of the last
 * 365 days, so `/journal#bd-<id>` missed any older entry. `journalEntry` reads that one entry, any age, from either
 * table a person link can point at. A failed read throws, so the page says "couldn't load", never "not found".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dumps: vi.fn(), refls: vi.fn(), people: vi.fn(), situations: vi.fn(), decisions: vi.fn(), retros: vi.fn() }));
const { zero } = vi.hoisted(() => ({ zero: () => vi.fn(async () => 0) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainDump: { findMany: (a: unknown) => h.dumps(a), count: zero() },
    reflection: { findMany: (a: unknown) => h.refls(a), count: zero() },
    situationLog: { findMany: (a: unknown) => h.situations(a), count: zero() },
    decisionReplay: { findMany: (a: unknown) => h.decisions(a), count: zero() },
    brainMemory: { findMany: (a: unknown) => h.retros(a), count: zero() },
    lifeGoal: { findMany: vi.fn(async () => []) },
    personProfile: { findMany: (a: unknown) => h.people(a) },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }) } }));

import { journalEntry } from "@/lib/services/journal-feed";
import { journalEntryHref } from "@/lib/ui/journal-entry-href";

const oldDump = {
  id: "d-old",
  date: "2024-01-05",
  createdAt: new Date("2024-01-05T14:00:00Z"),
  rawThoughts: "an entry far past the first page",
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
  personIds: ["p_a"],
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(h)) fn.mockResolvedValue([]);
});

describe("journalEntry", () => {
  it("an entry older than the feed's window is found by id, with no date filter, people included", async () => {
    h.dumps.mockImplementation(async (a: { where: { id?: string; date?: unknown } }) => (a.where.id === "d-old" && !a.where.date ? [oldDump] : []));
    h.people.mockResolvedValue([{ id: "p_a", name: "Ana" }]);
    const e = await journalEntry("d-old");
    expect(e).toMatchObject({ id: "d-old", source: "dump", people: [{ id: "p_a", name: "Ana" }] });
    expect(h.dumps.mock.calls[0][0].where).toMatchObject({ id: "d-old", deletedAt: null });
    expect(h.refls.mock.calls[0][0].where).toMatchObject({ id: "d-old", deletedAt: null });
  });

  it("reads only the two tables an entry link can point at", async () => {
    await journalEntry("x");
    expect(h.situations).not.toHaveBeenCalled();
    expect(h.decisions).not.toHaveBeenCalled();
    expect(h.retros).not.toHaveBeenCalled();
  });

  it("no such live entry is null", async () => {
    expect(await journalEntry("gone")).toBeNull();
  });

  it("a failed read throws, it is never not-found", async () => {
    h.dumps.mockRejectedValue(new Error("db down"));
    await expect(journalEntry("d-old")).rejects.toThrow(/read failed/);
  });

  it("a hit in the table that answered wins over a failure in the other", async () => {
    h.dumps.mockResolvedValue([oldDump]);
    h.refls.mockRejectedValue(new Error("db down"));
    expect(await journalEntry("d-old")).toMatchObject({ id: "d-old" });
  });
});

describe("journalEntryHref", () => {
  it("names the entry for the page and keeps the anchor the chat bridge reads", () => {
    expect(journalEntryHref("d1")).toBe("/journal?entry=d1#bd-d1");
  });
});
