/**
 * Today's picks carry one maxim fitted to the situation (people W3, 2026-10-30).
 *
 * Real pickRelationshipsForToday, model failing (heuristic fallback): a person
 * whose ledger is down 3 in 30 days gets a "boundaries" maxim, an ordinary
 * pick a "people" one. Drop the attach in relationships-pick-today.ts and
 * both cases go red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  memFindFirst: vi.fn(),
  memFindMany: vi.fn(),
  memCreate: vi.fn(),
  peopleFindMany: vi.fn(),
  ledgerFindMany: vi.fn(),
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findFirst: h.memFindFirst, findMany: h.memFindMany, create: h.memCreate, update: vi.fn() },
    personProfile: { findMany: h.peopleFindMany },
    relationshipLedger: { findMany: h.ledgerFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: h.aiChat }));

import { pickRelationshipsForToday } from "@/lib/ai/relationships-pick-today";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";

const tagsOf = (text: string | undefined) => MAXIM_POOL.find((m) => m.text === text)?.tags ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T16:00:00Z"));
  h.memFindFirst.mockResolvedValue(null);
  h.memFindMany.mockResolvedValue([]);
  h.memCreate.mockResolvedValue({});
  h.aiChat.mockRejectedValue(new Error("model down"));
  h.peopleFindMany.mockResolvedValue([
    { id: "drain", name: "Person D", role: "friend", lastInteraction: new Date("2026-10-28T12:00:00Z"), birthday: null },
    { id: "plain", name: "Person P", role: "friend", lastInteraction: new Date("2026-08-01T12:00:00Z"), birthday: null },
  ]);
  h.ledgerFindMany.mockResolvedValue([
    { personId: "drain", amount: -3, createdAt: new Date("2026-10-20T12:00:00Z"), metadata: null },
  ]);
});
afterEach(() => vi.useRealTimers());

describe("pickRelationshipsForToday maxims", () => {
  it("a draining relationship's pick carries a boundaries maxim, an ordinary one a people maxim", async () => {
    const out = await pickRelationshipsForToday();
    const drain = out.picks.find((p) => p.personId === "drain");
    const plain = out.picks.find((p) => p.personId === "plain");
    expect(drain?.maxim?.text).toBeTruthy();
    expect(tagsOf(drain?.maxim?.text)).toContain("boundaries");
    expect(tagsOf(plain?.maxim?.text)).toContain("people");
    expect(drain?.maxim?.source).toBeTruthy();
  });
});
