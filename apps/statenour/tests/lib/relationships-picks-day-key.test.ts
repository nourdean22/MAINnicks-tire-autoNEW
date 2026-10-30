/**
 * Today's picks are cached under the New York date (people W2b, 2026-10-30).
 *
 * The cache key was toISOString().slice(0, 10), the UTC date, so from 20:00 ET
 * (19:00 in winter) the evening read a fresh "tomorrow" row: a second paid
 * re-rank, and a log-outreach that edited a different row from the one the
 * page showed. One helper, picksDayKey, for the writer and every reader.
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

import { picksDayKey, pickRelationshipsForToday } from "@/lib/ai/relationships-pick-today";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T01:30:00Z")); // Oct 30, 21:30 in New York
  h.memFindFirst.mockResolvedValue(null);
  h.memFindMany.mockResolvedValue([]);
  h.memCreate.mockResolvedValue({});
  h.ledgerFindMany.mockResolvedValue([]);
  h.aiChat.mockRejectedValue(new Error("model down"));
  h.peopleFindMany.mockResolvedValue([
    { id: "p1", name: "Person One", role: "friend", lastInteraction: new Date("2026-08-01T12:00:00Z"), birthday: null },
  ]);
});
afterEach(() => vi.useRealTimers());

describe("picksDayKey", () => {
  it("is the New York date", () => {
    expect(picksDayKey(new Date("2026-10-31T01:30:00Z"))).toBe("2026-10-30");
    expect(picksDayKey(new Date("2026-10-30T16:00:00Z"))).toBe("2026-10-30");
  });
});

describe("pickRelationshipsForToday cache key", () => {
  it("reads and writes today's ET row in the evening", async () => {
    await pickRelationshipsForToday();
    expect((h.memFindFirst.mock.calls[0][0] as { where: { key: string } }).where.key).toBe("2026-10-30");
    const created = h.memCreate.mock.calls.map((c) => (c[0] as { data: { key: string } }).data.key);
    expect(created).toEqual(["2026-10-30"]);
  });
});
