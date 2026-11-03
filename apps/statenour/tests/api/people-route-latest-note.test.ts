/**
 * Nour 2026-11-01 13:24Z: "/people ... the people backfill ... it all still shows the same". The backfill wrote 36
 * relationship_ledger rows (2026-10-31), but the /people list reads only profile columns (relationship, leverage
 * notes, counters), so a ledger note was visible only inside a person's detail panel. Each person now carries the
 * newest CONTACT note (contactRowsOnly: a status flip or a synthetic mention is not a note about the person).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { personProfile: { findMany: h.findMany } },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));

import { GET } from "@/app/api/people/route";

const base = {
  id: "p1",
  name: "Person One",
  role: "friend",
  relationship: "friend",
  trustScore: 0.5,
  leverageNotes: null,
  lastInteraction: null,
  interactionCount: 0,
  cadenceDays: null,
};

type Body = { data?: { people: Array<{ latestNote: { note: string; at: string; source: string } | null }> } };
async function people() {
  const res = (await GET(new Request("https://x.test/api/people"), undefined as never)) as Response;
  return ((await res.json()) as Body).data?.people ?? [];
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/people · the newest contact note per person", () => {
  // W8b (audit B10): the card said the same thing twice (a journal contact row IS the journal line beneath it) and
  // showed the backfill's "interaction reported in chat (...)" boilerplate as the newest thing known about a person.
  it("skips a journal-source row (the journal line shows that entry) and the generic backfill note", async () => {
    h.findMany.mockResolvedValue([
      {
        ...base,
        ledger: [
          { note: "Talked to P about the move", createdAt: new Date("2026-11-02T14:00:00Z"), source: "journal", metadata: { via: "journal_ingest" } },
          { note: "Interaction reported in chat (2026-10-20)", createdAt: new Date("2026-10-31T12:00:00Z"), source: "chat", metadata: null },
          { note: "Helped move the couch", createdAt: new Date("2026-10-20T12:00:00Z"), source: "chat", metadata: null },
        ],
      },
    ]);
    expect((await people())[0].latestNote).toEqual({ note: "Helped move the couch", at: "2026-10-20T12:00:00.000Z", source: "chat" });
  });

  it("only journal and generic rows: null, never the boilerplate", async () => {
    h.findMany.mockResolvedValue([
      { ...base, ledger: [{ note: "interaction reported in chat (x)", createdAt: new Date(), source: "chat", metadata: null }] },
    ]);
    expect((await people())[0].latestNote).toBeNull();
  });

  it("a backfilled chat note shows on the list row; a newer status flip is skipped", async () => {
    h.findMany.mockResolvedValue([
      {
        ...base,
        ledger: [
          { note: "status: cooling", createdAt: new Date("2026-10-31T12:00:00Z"), source: "manual", metadata: { kind: "status_flip" } },
          { note: "Talked about his move to Austin", createdAt: new Date("2026-10-12T15:00:00Z"), source: "chat", metadata: { conversationId: "c1" } },
        ],
      },
    ]);
    const [p] = await people();
    expect(p.latestNote).toEqual({ note: "Talked about his move to Austin", at: "2026-10-12T15:00:00.000Z", source: "chat" });
    // The mock ignores `select`, so pin the request itself: a relation nobody selects arrives as undefined in prod.
    const select = h.findMany.mock.calls[0][0].select;
    expect(select.ledger).toMatchObject({ orderBy: { createdAt: "desc" }, select: { note: true, createdAt: true, source: true, metadata: true } });
  });

  it("a row with NULL metadata (most prod rows) is a contact; a synthetic mention is not", async () => {
    h.findMany.mockResolvedValue([
      {
        ...base,
        ledger: [
          { note: "mentioned in chat", createdAt: new Date("2026-10-30T12:00:00Z"), source: "chat", metadata: { synthetic: true } },
          { note: "Coffee on Euclid", createdAt: new Date("2026-10-20T12:00:00Z"), source: "manual", metadata: null },
        ],
      },
    ]);
    const [p] = await people();
    expect(p.latestNote?.note).toBe("Coffee on Euclid");
  });

  it("control: a person with no ledger rows reads null, never an invented note", async () => {
    h.findMany.mockResolvedValue([{ ...base, ledger: [] }]);
    const [p] = await people();
    expect(p.latestNote).toBeNull();
  });
});
