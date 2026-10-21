/**
 * The public lot band is withheld while the counter-trust check says UNDERCOUNTING (job
 * 2026-10-21-shop-eyes-ears-pro, S3). 2026-10-21 production: the band published "light,
 * 0 vehicles" with a fresh sensor while the camera had counted 1 arrival in a week of 30
 * billed jobs. OK and UNKNOWN keep the old behaviour: a failed invoice read is not evidence
 * that the camera is wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  trust: async (): Promise<unknown> => [[], []],
  info: vi.fn(),
}));

vi.mock("./featureFlags", () => ({ isEnabled: async () => true }));
vi.mock("./shopStatus", () => ({ getShopStatus: async () => { throw new Error("no bookings in this test"); } }));
vi.mock("../weather", () => ({ getWeather: async () => null }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ info: h.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../lib/db-helper", () => ({
  db: async () => ({
    execute: async (q: { queryChunks: unknown[] }) => {
      const text = JSON.stringify(q.queryChunks);
      if (text.includes("FROM invoices")) return h.trust();
      if (text.includes("activeVisits")) return [[{ activeVisits: 0 }], []];
      if (text.includes("lastHeartbeatAt")) return [[{ lastHeartbeatAt: new Date(Date.now() - 60_000) }], []];
      return [[], []];
    },
  }),
}));

import { getShopState } from "./shopState";

const trustRow = (arrivals: number, billed: number) => async () => [[{ fromDay: "2026-10-14", toDay: "2026-10-20", arrivals, billed }], []];

let day = 1;
beforeEach(() => {
  h.info.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  // A fresh ET day per test so neither the trust memo nor the once-a-day log carries over.
  vi.setSystemTime(new Date(Date.UTC(2027, 0, day++, 17, 0, 0)));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("shop-state lot band vs counter trust", () => {
  it("UNDERCOUNTING withholds the band (unknown), and logs once per ET day with counts only", async () => {
    h.trust = trustRow(1, 30);
    const a = await getShopState(new Date());
    expect(a.lot.band).toBe("unknown");
    await getShopState(new Date());
    const withheld = h.info.mock.calls.filter((c) => String(c[0]).includes("lot band withheld: counter undercounting"));
    expect(withheld).toHaveLength(1);
    expect(withheld[0][1]).toMatchObject({ arrivals: 1, billed: 30 });
  });

  it("OK keeps the camera band", async () => {
    h.trust = trustRow(40, 30);
    expect((await getShopState(new Date())).lot).toEqual({ band: "light", sensorHealth: "fresh" });
  });

  it("UNKNOWN (the invoice read failed) keeps the camera band too", async () => {
    h.trust = async () => { throw new Error("invoices read failed"); };
    expect((await getShopState(new Date())).lot).toEqual({ band: "light", sensorHealth: "fresh" });
  });
});
