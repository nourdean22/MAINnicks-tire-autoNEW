/**
 * The MIT day key is the ET day (audit 03-F1, 2026-10-10).
 *
 * lib/services/mit.ts keyed the row by the UTC date, so from 8pm ET on (EDT)
 * a MIT set "today" landed on tomorrow's key and every ET reader (MITSlot,
 * Telegram /mit, the briefs) saw no MIT until midnight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ upsert: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { upsert: h.upsert, findFirst: h.findFirst } } }));

import { getMit, setMit } from "@/lib/services/mit";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  h.upsert.mockReset().mockResolvedValue({ content: "Call Mike" });
  h.findFirst.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe("MIT day key", () => {
  it("9:30pm ET on Oct 10 (01:30Z Oct 11) writes and reads key 2026-10-10", async () => {
    vi.setSystemTime(new Date("2026-10-11T01:30:00Z"));
    const res = await setMit("Call Mike");
    expect(res.key).toBe("2026-10-10");
    expect(h.upsert.mock.calls[0][0].where.category_key.key).toBe("2026-10-10");
    expect((await getMit()).key).toBe("2026-10-10");
  });

  it("CONTROL: midday ET keys the same calendar day either way", async () => {
    vi.setSystemTime(new Date("2026-10-10T16:00:00Z"));
    expect((await setMit("Call Mike")).key).toBe("2026-10-10");
  });
});
