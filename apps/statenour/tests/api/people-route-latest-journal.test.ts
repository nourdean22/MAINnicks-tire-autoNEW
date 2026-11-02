/**
 * W4 (job 2026-11-02-nour-os-interconnect) · each person on GET /api/people carries the newest journal entry that
 * names them (brain_dumps.person_ids), so the /people card shows what he last wrote about them.
 *
 * Three states, never two (empty-vs-error): a person no entry names reads `latestJournal: null` with
 * `reads.journal: "ok"`; a FAILED journal read also nulls the field but says `reads.journal: "failed"`, so the page
 * can say "couldn't load" instead of "nothing written".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ people: vi.fn(), dumps: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { personProfile: { findMany: h.people }, brainDump: { findMany: h.dumps } },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));

import { GET } from "@/app/api/people/route";
import { JOURNAL_EXCERPT_CHARS } from "@/lib/services/people/journal-link";

const person = (id: string) => ({
  id,
  name: id,
  role: "friend",
  relationship: "friend",
  trustScore: 0.5,
  leverageNotes: null,
  lastInteraction: null,
  interactionCount: 0,
  cadenceDays: null,
  ledger: [],
});

type LJ = { at: string; excerpt: string; dumpId: string } | null;
type Body = { data?: { people: Array<{ id: string; latestJournal: LJ }>; reads: { journal: "ok" | "failed" } } };
async function call() {
  const res = (await GET(new Request("https://x.test/api/people"), undefined as never)) as Response;
  return ((await res.json()) as Body).data!;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.people.mockResolvedValue([person("p1"), person("p2"), person("p3")]);
});

describe("GET /api/people · latestJournal", () => {
  it("each person gets the NEWEST entry naming them; a person no entry names reads null", async () => {
    h.dumps.mockResolvedValue([
      { id: "d3", createdAt: new Date("2026-11-02T10:00:00Z"), rawThoughts: "Lunch with p2 today.", personIds: ["p2"] },
      { id: "d2", createdAt: new Date("2026-11-01T10:00:00Z"), rawThoughts: "Talked to p1 about the move.", personIds: ["p1", "p2"] },
      { id: "d1", createdAt: new Date("2026-10-30T10:00:00Z"), rawThoughts: "Older p1 note.", personIds: ["p1"] },
    ]);
    const body = await call();
    const by = Object.fromEntries(body.people.map((p) => [p.id, p.latestJournal]));
    expect(by.p1).toEqual({ at: "2026-11-01T10:00:00.000Z", excerpt: "Talked to p1 about the move.", dumpId: "d2" });
    expect(by.p2?.dumpId).toBe("d3");
    expect(by.p3).toBeNull();
    expect(body.reads).toEqual({ journal: "ok" });
  });

  it("the read is one query over the listed ids, live entries only, newest first", async () => {
    h.dumps.mockResolvedValue([]);
    await call();
    expect(h.dumps).toHaveBeenCalledTimes(1);
    const args = h.dumps.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: null, personIds: { hasSome: ["p1", "p2", "p3"] } });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.select).toMatchObject({ id: true, createdAt: true, rawThoughts: true, personIds: true });
  });

  it("the excerpt is capped at JOURNAL_EXCERPT_CHARS", async () => {
    h.dumps.mockResolvedValue([{ id: "d1", createdAt: new Date(), rawThoughts: `p1 ${"word ".repeat(80)}`, personIds: ["p1"] }]);
    const body = await call();
    const lj = body.people.find((p) => p.id === "p1")!.latestJournal!;
    expect(JOURNAL_EXCERPT_CHARS).toBe(120);
    expect(lj.excerpt.length).toBeLessThanOrEqual(JOURNAL_EXCERPT_CHARS + 1);
  });

  it("a FAILED journal read is not an empty journal: null field AND reads.journal = failed, list still served", async () => {
    h.dumps.mockRejectedValue(new Error("column person_ids does not exist"));
    const body = await call();
    expect(body.people).toHaveLength(3);
    expect(body.people.every((p) => p.latestJournal === null)).toBe(true);
    expect(body.reads).toEqual({ journal: "failed" });
  });

  it("control: no people means no journal query", async () => {
    h.people.mockResolvedValue([]);
    const body = await call();
    expect(h.dumps).not.toHaveBeenCalled();
    expect(body.reads).toEqual({ journal: "ok" });
  });
});
