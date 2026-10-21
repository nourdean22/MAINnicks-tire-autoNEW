/**
 * readVehicleCounterTrust: the SQL glue behind the counter-trust verdict (job
 * 2026-10-21-shop-eyes-ears-pro, S3). Pins: the ET day window is computed in SQL (never JS),
 * arrivals use the lot.now definition (PRODUCTION, not preexisting, not a drive-by, one per
 * episode), billed counts every invoice, a failed read is UNKNOWN with null counts (never 0),
 * and a good read is memoized for the ET day while a failed one is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readVehicleCounterTrust } from "./vehicleCounterTrust";

function flat(q: unknown): string {
  const text: string[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else text.push("?");
    }
  };
  walk((q as { queryChunks: unknown[] }).queryChunks);
  return text.join("").replace(/\s+/g, " ").trim();
}

const row = (arrivals: unknown, billed: unknown) => [[{ fromDay: "2026-10-14", toDay: "2026-10-20", arrivals, billed }], []];

// Each test runs on its own ET day so the per-day memo of one test never answers another.
let day = 1;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, day++, 17, 0, 0)));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("readVehicleCounterTrust", () => {
  it("counts arrivals and billed jobs over the 7 complete ET days before today, bucketed in SQL", async () => {
    const execute = vi.fn(async () => row(9, 32));
    const t = await readVehicleCounterTrust({ execute });
    expect(t).toMatchObject({ level: "UNDERCOUNTING", arrivals: 9, billed: 32, days: 7, fromDay: "2026-10-14", toDay: "2026-10-20" });
    const text = flat(execute.mock.calls[0][0]);
    expect(text).toContain("CONVERT_TZ(NOW(), '+00:00', 'America/New_York')");
    expect(text).toContain("INTERVAL 7 DAY");
    // arrivals: the lot.now definition
    expect(text).toContain("COUNT(DISTINCT COALESCE(episodeId, visitId))");
    expect(text).toContain("dataClass = 'PRODUCTION'");
    expect(text).toContain("preexisting = 0");
    expect(text).toContain("state <> 'PASS_THROUGH'");
    // billed: every invoice in the same days, any source
    expect(text).toMatch(/SELECT COUNT\(\*\) FROM invoices WHERE/);
    expect(text).not.toMatch(/source\s*=/);
  });

  it("a read error is UNKNOWN with null counts, never zero, and is NOT memoized", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValueOnce(row(40, 30));
    const failed = await readVehicleCounterTrust({ execute });
    expect(failed).toMatchObject({ level: "UNKNOWN", arrivals: null, billed: null });
    const next = await readVehicleCounterTrust({ execute });
    expect(next.level).toBe("OK");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("an empty or NULL result row is UNKNOWN, not zero", async () => {
    expect((await readVehicleCounterTrust({ execute: async () => [[], []] })).level).toBe("UNKNOWN");
    vi.setSystemTime(new Date(Date.UTC(2026, 10, day++, 17, 0, 0)));
    const execute = vi.fn().mockResolvedValueOnce(row(null, 30)).mockResolvedValueOnce(row(40, 30));
    const nul = await readVehicleCounterTrust({ execute });
    expect(nul).toMatchObject({ level: "UNKNOWN", arrivals: null });
    // a NULL count is a failed read too: not memoized, the next call asks again
    expect((await readVehicleCounterTrust({ execute })).level).toBe("OK");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("a good read is memoized for 10 minutes within the ET day, then read again", async () => {
    const execute = vi.fn(async () => row(40, 30));
    await readVehicleCounterTrust({ execute });
    vi.setSystemTime(Date.now() + 9 * 60_000);
    await readVehicleCounterTrust({ execute });
    expect(execute).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await readVehicleCounterTrust({ execute });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("the memo does not cross an ET midnight", async () => {
    // 23:58 EST (04:58Z) then 00:01 EST: a new day, a new window.
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 2, 4, 58, 0)));
    const execute = vi.fn(async () => row(40, 30));
    await readVehicleCounterTrust({ execute });
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 2, 5, 1, 0)));
    await readVehicleCounterTrust({ execute });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
