/**
 * A failed watchlist read is an error, never "no one needs you" (people W0, 2026-10-30).
 *
 * The route caught the failure and answered 200 with `items: []`, so the page's
 * error state (relationships-watchlist.tsx, state "error") could never fire:
 * rawFetch only throws on a non-2xx. It now answers 500, and the birthday day
 * count reads America/New_York.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ peopleFindMany: vi.fn(), memFindMany: vi.fn(), ledgerFindMany: vi.fn() }));

vi.mock("@/lib/auth-guard", () => ({ requireSession: vi.fn(async () => ({ user: "owner" })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findMany: h.peopleFindMany },
    brainMemory: { findMany: h.memFindMany },
    relationshipLedger: { findMany: h.ledgerFindMany },
  },
}));
vi.mock("@/lib/services/people/contact-rows", () => ({ contactRowsOnly: (rows: unknown[]) => rows }));

import { GET } from "@/app/api/relationships/watchlist/route";

const req = () => new NextRequest("http://localhost/api/relationships/watchlist");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  h.memFindMany.mockResolvedValue([]);
  h.ledgerFindMany.mockResolvedValue([]);
});

describe("GET /api/relationships/watchlist", () => {
  it("answers 500 when the people read fails", async () => {
    h.peopleFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.items).toBeUndefined();
  });

  it("POSITIVE CONTROL: a good read answers 200, and an ET-evening birthday counts from today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T01:30:00Z")); // Oct 30, 21:30 in New York
    h.peopleFindMany.mockResolvedValue([
      { id: "p1", name: "P One", lastInteraction: new Date("2026-10-29T12:00:00Z"), birthday: "1985-10-31" },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    const bday = body.items.find((i: { kind: string }) => i.kind === "birthday_2w");
    expect(bday?.summary).toBe("birthday in 1d");
  });
});
