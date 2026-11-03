/**
 * W4 (job 2026-11-02-nour-os-interconnect) · each person on GET /api/people carries the newest journal entry that
 * names them (brain_dumps.person_ids), so the /people card shows what he last wrote about them.
 *
 * Three states, never two (empty-vs-error): a person no entry names reads `latestJournal: null` with
 * `reads.journal: "ok"`; a FAILED journal read also nulls the field but says `reads.journal: "failed"`, so the page
 * can say "couldn't load" instead of "nothing written".
 *
 * Second reader P3-3 on PR 3522: the first cut read the 200 newest linked entries, so a person last named before
 * them read null while reads.journal said ok. The read is now ONE query that returns the newest entry PER person
 * (DISTINCT ON over unnest(person_ids)), however old it is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ people: vi.fn(), raw: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { personProfile: { findMany: h.people }, $queryRaw: h.raw },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));

import { GET } from "@/app/api/people/route";

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
/** The SQL text of a tagged-template call, placeholders joined back in. */
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

beforeEach(() => {
  vi.clearAllMocks();
  h.people.mockResolvedValue([person("p1"), person("p2"), person("p3")]);
});

describe("GET /api/people · latestJournal", () => {
  it("each person gets the newest entry naming them, however old; a person no entry names reads null", async () => {
    h.raw.mockResolvedValue([
      { person_id: "p1", id: "d2", created_at: new Date("2026-11-01T10:00:00Z"), raw_thoughts: "Talked to p1 about the move." },
      // Named once, two years back: the first cut's 200-row window would have missed this.
      { person_id: "p2", id: "d_old", created_at: new Date("2024-11-01T10:00:00Z"), raw_thoughts: "Met p2 at the shop." },
    ]);
    const body = await call();
    const by = Object.fromEntries(body.people.map((p) => [p.id, p.latestJournal]));
    expect(by.p1).toEqual({ at: "2026-11-01T10:00:00.000Z", excerpt: "Talked to p1 about the move.", dumpId: "d2" });
    expect(by.p2?.dumpId).toBe("d_old");
    expect(by.p3).toBeNull();
    expect(body.reads).toEqual({ journal: "ok" });
  });

  it("the read is ONE query: newest per person, live entries only, over the listed ids", async () => {
    h.raw.mockResolvedValue([]);
    await call();
    expect(h.raw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(h.raw.mock.calls[0]);
    expect(sql).toMatch(/DISTINCT ON \(pid\)/);
    expect(sql).toMatch(/unnest\(d\.person_ids\)/);
    expect(sql).toMatch(/d\.deleted_at IS NULL/);
    expect(sql).toMatch(/ORDER BY pid, d\.created_at DESC/);
    expect(h.raw.mock.calls[0][1]).toEqual(["p1", "p2", "p3"]);
  });

  it("a FAILED journal read is not an empty journal: null field AND reads.journal = failed, list still served", async () => {
    h.raw.mockRejectedValue(new Error("column person_ids does not exist"));
    const body = await call();
    expect(body.people).toHaveLength(3);
    expect(body.people.every((p) => p.latestJournal === null)).toBe(true);
    expect(body.reads).toEqual({ journal: "failed" });
  });

  it("control: no people means no journal query", async () => {
    h.people.mockResolvedValue([]);
    const body = await call();
    expect(h.raw).not.toHaveBeenCalled();
    expect(body.reads).toEqual({ journal: "ok" });
  });
});
