/**
 * Telegram alert diet · the three repeating business-hours alerts send once per
 * Cleveland day per STATE, not once per tick.
 *
 * Before: revenue-pulse (every 15 min once the day was big), promise-risk and
 * stale-estimate (every 2 h) re-sent the same message while the state never
 * changed. Now each claims a cron_alerts_fired row (INSERT IGNORE, the camera
 * pattern) BEFORE sending; the key names the state and fired_for is the ET day.
 *
 * The fake db implements the INSERT IGNORE semantics (first insert of a
 * (alert_key, fired_for) pair affects 1 row, a repeat affects 0), so the claim SQL
 * and the dedupe decision are both exercised. Only the clock and the transport
 * are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sends: [] as string[],
  classes: [] as string[],
  claims: new Set<string>(),
  claimFails: false,
  todayRevenue: 100_000,
  atRisk: [{ risk: "overdue", orderNumber: "WO-1", workOrderId: 1, customerName: "Ann" }] as Array<Record<string, unknown>>,
  stale: [{ customerName: "Bob", totalAmount: 25_000, invoiceDate: "2026-10-01", daysOld: 9 }] as Array<Record<string, unknown>>,
}));

vi.mock("./services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/telegram")>()),
  sendTelegram: vi.fn(async (text: string, cls?: string) => {
    h.sends.push(text);
    h.classes.push(cls ?? "(none)");
    return true;
  }),
}));
vi.mock("./services/intelligenceEngines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/intelligenceEngines")>()),
  forecastRevenue: vi.fn(async () => ({ today: { soFar: h.todayRevenue } })),
}));
vi.mock("./services/promiseRisk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/promiseRisk")>()),
  getPromiseRiskSummary: vi.fn(async () => ({ jobs: h.atRisk })),
}));

/** The strings of a drizzle sql`` template: its text chunks and its bound string params. */
function sqlParts(query: unknown): { text: string; params: string[] } {
  const chunks = (query as { queryChunks: unknown[] }).queryChunks;
  let text = "";
  const params: string[] = [];
  for (const c of chunks) {
    if (typeof c === "string") params.push(c);
    else if (c && typeof c === "object" && "value" in c) text += (c as { value: string[] }).value.join("");
  }
  return { text, params };
}
const fakeDb = {
  execute: async (query: unknown) => {
    const { text, params } = sqlParts(query);
    if (/INSERT IGNORE INTO cron_alerts_fired/i.test(text)) {
      if (h.claimFails) throw new Error("db down");
      const k = `${params[0]}|${params[1]}`;
      if (h.claims.has(k)) return [{ affectedRows: 0 }];
      h.claims.add(k);
      return [{ affectedRows: 1 }];
    }
    return [h.stale, []];
  },
};
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: async () => fakeDb,
}));

import { getJobCadences, runTierJobHandlerUnlocked } from "./cron/scheduler";

const TUE_11AM_ET = "2026-10-13T15:00:00Z";
const TUE_2330_ET = "2026-10-14T03:30:00Z"; // still Tuesday in Cleveland
const WED_0030_ET = "2026-10-14T04:30:00Z"; // Wednesday in Cleveland

const JOBS = [
  { name: "revenue-pulse", marker: "Big day building" },
  { name: "promise-risk-check", marker: "PROMISE RISK" },
  { name: "stale-estimate-alert", marker: "STALE ESTIMATES" },
] as const;

function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

describe("repeating business-hours alerts claim before they send", () => {
  beforeEach(() => {
    getJobCadences(); // builds the tiers (idempotent)
    vi.useFakeTimers({ toFake: ["Date"] });
    at(TUE_11AM_ET);
    h.sends.length = 0;
    h.classes.length = 0;
    h.claims.clear();
    h.claimFails = false;
    h.todayRevenue = 100_000;
    h.atRisk = [{ risk: "overdue", orderNumber: "WO-1", workOrderId: 1, customerName: "Ann" }];
    h.stale = [{ customerName: "Bob", totalAmount: 25_000, invoiceDate: "2026-10-01", daysOld: 9 }];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe.each(JOBS)("$name", ({ name, marker }) => {
    it("sends once, and a second run in the same state sends nothing", async () => {
      await runTierJobHandlerUnlocked(name);
      await runTierJobHandlerUnlocked(name);
      await runTierJobHandlerUnlocked(name);
      expect(h.sends).toHaveLength(1);
      expect(h.sends[0]).toContain(marker);
      // a once-per-state status is a digest: Nour can mute it from the admin flags
      expect(h.classes).toEqual(["digest"]);
    });

    it("sends again after the Cleveland day rolls over, not at the UTC midnight", async () => {
      await runTierJobHandlerUnlocked(name);
      at(TUE_2330_ET); // past UTC midnight, same ET day
      await runTierJobHandlerUnlocked(name);
      expect(h.sends).toHaveLength(1);
      at(WED_0030_ET); // new ET day
      await runTierJobHandlerUnlocked(name);
      expect(h.sends).toHaveLength(2);
    });

    it("still sends when the claim table is unreadable (fail open: an alert beats silence)", async () => {
      h.claimFails = true;
      await runTierJobHandlerUnlocked(name);
      expect(h.sends).toHaveLength(1);
    });
  });

  it("revenue-pulse: a bigger band of the same day is a new state and sends once", async () => {
    await runTierJobHandlerUnlocked("revenue-pulse");
    h.todayRevenue = 900_000; // many multiples of the daily target: a different band
    await runTierJobHandlerUnlocked("revenue-pulse");
    await runTierJobHandlerUnlocked("revenue-pulse");
    expect(h.sends).toHaveLength(2);
  });

  it("revenue-pulse: below the threshold nothing is claimed or sent", async () => {
    h.todayRevenue = 400;
    await runTierJobHandlerUnlocked("revenue-pulse");
    expect(h.sends).toHaveLength(0);
    expect(h.claims.size).toBe(0);
  });

  it("promise-risk: a different set of at-risk orders is a new state and sends once", async () => {
    await runTierJobHandlerUnlocked("promise-risk-check");
    h.atRisk = [...h.atRisk, { risk: "likely_late", orderNumber: "WO-2", workOrderId: 2, customerName: "Cy" }];
    await runTierJobHandlerUnlocked("promise-risk-check");
    await runTierJobHandlerUnlocked("promise-risk-check");
    expect(h.sends).toHaveLength(2);
    expect(h.sends[1]).toContain("WO-2");
  });

  it("stale-estimate: a changed list is a new state and sends once", async () => {
    await runTierJobHandlerUnlocked("stale-estimate-alert");
    h.stale = [{ customerName: "Dee", totalAmount: 99_000, invoiceDate: "2026-10-02", daysOld: 8 }, ...h.stale];
    await runTierJobHandlerUnlocked("stale-estimate-alert");
    await runTierJobHandlerUnlocked("stale-estimate-alert");
    expect(h.sends).toHaveLength(2);
  });
});
