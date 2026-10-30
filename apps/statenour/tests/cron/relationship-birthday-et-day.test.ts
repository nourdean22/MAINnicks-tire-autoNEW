/**
 * The birthday push matches on the New York date (people W0, 2026-10-30).
 *
 * It took today's month-day from toISOString() (UTC). The 09:00 UTC slot hides
 * it, but a manual run after 20:00 ET matched tomorrow's birthdays.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ peopleFindMany: vi.fn() }));

vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: () => unknown) => fn }));
vi.mock("@/lib/prisma", () => ({ prisma: { personProfile: { findMany: h.peopleFindMany } } }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));

import { GET } from "@/app/api/cron/relationship-birthday/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.peopleFindMany.mockResolvedValue([]);
});

describe("relationship-birthday cron", () => {
  it("an evening run in New York looks for today's month-day, not tomorrow's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T01:30:00Z")); // Oct 30, 21:30 ET
    const out = (await (GET as unknown as () => Promise<{ todayMmdd: string }>)()) as { todayMmdd: string };
    vi.useRealTimers();

    const where = h.peopleFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ birthday: { endsWith: "10-30" } }, { anniversary: { endsWith: "10-30" } }]);
    expect(out.todayMmdd).toBe("10-30");
  });
});
