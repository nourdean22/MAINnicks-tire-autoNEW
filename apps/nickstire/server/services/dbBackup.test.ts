/**
 * Q-29 · the "db-backup" job is a counts-only daily digest.
 *
 * It was never a restorable backup: it POSTed row counts PLUS every lead,
 * booking and invoice row from the last 24 h into StateNour's `audit_events`,
 * which put customer names, phones and amounts in a second store that nothing
 * ever read back. These tests pin the digest contract:
 *
 *   - the POST body carries counts and nothing else (no row arrays, no row
 *     fields), even when the 24 h window holds rows with contact details;
 *   - the counts still arrive and still add up;
 *   - an archive failure still fails the run (safetyMonitor reads cron_log).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getDbMock, sendTelegramMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  sendTelegramMock: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: getDbMock }));
vi.mock("./telegram", () => ({ sendTelegram: sendTelegramMock }));

// A row shaped like a real lead/booking/invoice. If any of these markers reach
// the POST body, customer data left the shop's database.
const ROW = {
  id: 4242,
  name: "Digest Canary Person",
  phone: "2165550142",
  email: "digest.canary@example.test",
  vehicle: "2011 Canary Sedan",
  totalAmount: 51234,
};
const MARKERS = ["Digest Canary Person", "2165550142", "digest.canary@example.test", "2011 Canary Sedan"];

const TOTAL = 7;
const RECENT = 3;

/**
 * Minimal drizzle stand-in. `select({ count })` answers counts; a bare
 * `select()` answers full rows. Both the whole-table and the `.where()` form
 * are awaitable, so the fake serves the old (row-copying) and the new
 * (counts-only) query shapes alike — the positive control depends on that.
 */
function fakeDb() {
  return {
    select(projection?: Record<string, unknown>) {
      const isCount = projection !== undefined;
      return {
        from() {
          const whole = Promise.resolve(isCount ? [{ count: TOTAL }] : [ROW]);
          return Object.assign(whole, {
            where: () => Promise.resolve(isCount ? [{ count: RECENT }] : [ROW, ROW, ROW]),
          });
        },
      };
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(fakeDb());
  sendTelegramMock.mockResolvedValue(true);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function postedBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  expect(url).toMatch(/\/api\/sync\/backup$/);
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("runDailyBackup · counts-only digest (Q-29)", () => {
  it("posts no customer row data, even when the last 24 h holds rows with contact details", async () => {
    const { runDailyBackup } = await import("./dbBackup");
    await runDailyBackup();

    const raw = JSON.stringify(postedBody());
    for (const marker of MARKERS) expect(raw).not.toContain(marker);
    expect(raw).not.toMatch(/leadsData|bookingsData|invoicesData/);
  });

  it("posts only the digest keys, and every value under them is a number", async () => {
    const { runDailyBackup } = await import("./dbBackup");
    await runDailyBackup();

    const body = postedBody();
    expect(Object.keys(body).sort()).toEqual(["counts", "date", "kind", "recent24h", "timestamp"]);
    expect(body.kind).toBe("daily_digest");
    expect(body.counts).toEqual({ leads: TOTAL, bookings: TOTAL, invoices: TOTAL, customers: TOTAL, tireOrders: TOTAL });
    expect(body.recent24h).toEqual({ leads: RECENT, bookings: RECENT, invoices: RECENT });
  });

  it("reports the counts it posted (records = new rows in the last 24 h)", async () => {
    const { runDailyBackup } = await import("./dbBackup");
    const out = await runDailyBackup();

    expect(out.recordsProcessed).toBe(RECENT * 3);
    expect(out.details).toContain(`${RECENT * 3} new in 24h`);
    expect(out.details).toContain(`${TOTAL * 5} total`);
    const telegram = String(sendTelegramMock.mock.calls[0]?.[0] ?? "");
    expect(telegram).toContain("DAILY DIGEST");
    expect(telegram).toMatch(/not a restorable backup/i);
    for (const marker of MARKERS) expect(telegram).not.toContain(marker);
  });

  it("still fails the run when the archive rejects the POST", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    const { runDailyBackup } = await import("./dbBackup");

    await expect(runDailyBackup()).rejects.toThrow(/401/);
  });
});
