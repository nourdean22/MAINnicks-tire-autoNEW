/**
 * GET /api/people reads the cadence he set (people W0, 2026-10-30).
 *
 * neglect.ts is tested on its own; this pins the consumer: drop
 * `cadenceDays: true` from the route's select and the first case goes red
 * (pr-test-analyzer on 3400; the mock ignores `select`, so the select itself
 * is asserted too).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { personProfile: { findMany: h.findMany } },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));

import { GET } from "@/app/api/people/route";

const DAY = 86_400_000;
const row = (cadenceDays: number | null) => ({
  id: "p1",
  name: "Person One",
  role: "friend",
  relationship: "friend",
  trustScore: 0.5,
  leverageNotes: "notes",
  lastInteraction: new Date(Date.now() - 20 * DAY),
  interactionCount: 2,
  cadenceDays,
});

async function people() {
  const res = (await GET(new Request("https://x.test/api/people"), undefined as never)) as Response;
  const body = (await res.json()) as { data?: { people: Array<{ isNeglected: boolean }> } };
  return body.data?.people ?? [];
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/people neglect", () => {
  it("a monthly person 20 days quiet is not neglected, and the select asks for cadenceDays", async () => {
    h.findMany.mockResolvedValue([row(30)]);
    const list = await people();
    expect(list[0].isNeglected).toBe(false);
    expect(h.findMany.mock.calls[0][0].select.cadenceDays).toBe(true);
  });

  it("POSITIVE CONTROL: with no cadence the 14-day default still calls it neglected", async () => {
    h.findMany.mockResolvedValue([row(null)]);
    const list = await people();
    expect(list[0].isNeglected).toBe(true);
  });
});
