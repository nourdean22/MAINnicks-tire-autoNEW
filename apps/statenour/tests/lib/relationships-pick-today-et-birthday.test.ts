/**
 * Today's picks count birthdays on the New York date (people W0, 2026-10-30).
 *
 * relationships-pick-heuristic.test.ts mirrors the scoring instead of
 * importing it, so it cannot catch the module's own date math. This runs the
 * real pickRelationshipsForToday with the model failing (heuristic fallback,
 * whose rationale is the signal list): put the old UTC month-day back and it
 * reads "birthday in 0d".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  memFindFirst: vi.fn(),
  memFindMany: vi.fn(),
  memCreate: vi.fn(),
  memUpdate: vi.fn(),
  peopleFindMany: vi.fn(),
  ledgerFindMany: vi.fn(),
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findFirst: h.memFindFirst, findMany: h.memFindMany, create: h.memCreate, update: h.memUpdate },
    personProfile: { findMany: h.peopleFindMany },
    relationshipLedger: { findMany: h.ledgerFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: h.aiChat }));

import { pickRelationshipsForToday } from "@/lib/ai/relationships-pick-today";

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
    { id: "p1", name: "Person One", role: "friend", lastInteraction: new Date("2026-10-29T12:00:00Z"), birthday: "1985-10-31" },
  ]);
});
afterEach(() => vi.useRealTimers());

describe("pickRelationshipsForToday birthday signal", () => {
  it("an ET-evening run counts tomorrow's birthday as 1 day away", async () => {
    const out = await pickRelationshipsForToday();
    expect(out.picks[0]?.rationale).toContain("birthday in 1d");
  });
});
