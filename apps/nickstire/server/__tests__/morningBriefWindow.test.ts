/**
 * nick-morning-brief · the shop-TZ morning window, and its fail-closed edge.
 *
 * WHY THE GATE EXISTS. This job sits on the 12-hour "briefings" tier and had
 * NO clock gate at all — unlike its own tier-mate daily-report, which skips its
 * morning run with `if (etHour < 18) return`. So it fired on BOTH ticks: two
 * "morning" briefs a day, phased on process start (runOnStartup excludes this
 * tier), drifting with every redeploy.
 *
 * WHY FAIL-CLOSED MATTERS HERE. The hour comes from
 * `parseInt(toLocaleString(...))`. If that ever returns NaN — locale shape
 * change, unresolvable timezone — then NaN fails BOTH comparisons, so a naive
 * `hour < 6 || hour >= 12` SENDS. For a proactive push that is the wrong
 * direction: a brief that does not arrive is a missed glance; a brief that
 * arrives at 3am is exactly what the gate exists to prevent.
 *
 * These drive the REAL job through a mocked clock rather than asserting on
 * source text, so the window is proven by behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Force `new Date().toLocaleString(...)` to report a given shop-TZ hour. */
function pinShopHour(value: string) {
  return vi
    .spyOn(Date.prototype, "toLocaleString")
    .mockImplementation(function (this: Date, ...args: unknown[]) {
      const opts = args[1] as Intl.DateTimeFormatOptions | undefined;
      // Only intercept the hour probe; leave date formatting alone.
      if (opts && opts.hour === "numeric" && opts.hour12 === false) return value;
      return "1/1/2026";
    } as typeof Date.prototype.toLocaleString);
}

/** The job short-circuits before any DB call, so no DB mock is needed for the
 *  skip paths. getDb is stubbed anyway so an accidental fall-through is loud. */
vi.mock("../db", () => ({
  getDb: async () => null,
  db: async () => null,
}));
vi.mock("../services/telegram", () => ({
  sendTelegram: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("morning brief · shop-TZ window", () => {
  it.each([
    ["3", "middle of the night"],
    ["5", "just before the window"],
    ["12", "just after the window"],
    ["18", "the daily-report slot"],
    ["23", "late evening"],
  ])("skips at %s:00 ET (%s)", async (hour) => {
    pinShopHour(hour);
    const { sendMorningBrief } = await import("../cron/jobs/morningBrief");
    const res = await sendMorningBrief();
    expect(res.details, `expected a skip at ${hour}:00 ET`).toMatch(/skipped/i);
    expect(res.recordsProcessed).toBe(0);
  });

  it.each([["6"], ["9"], ["11"]])("does NOT skip on the window at %s:00 ET", async (hour) => {
    pinShopHour(hour);
    const { sendMorningBrief } = await import("../cron/jobs/morningBrief");
    const res = await sendMorningBrief();
    // getDb is mocked to null, so it stops at the DB guard — the point is that
    // it got PAST the window check rather than being turned away by it.
    expect(res.details).not.toMatch(/Outside the morning window/i);
  });

  it("FAILS CLOSED when the shop-TZ hour is unresolvable", async () => {
    // The regression this pins: NaN fails both `< 6` and `>= 12`, so an
    // unguarded window would fall through and SEND at an unknown hour.
    pinShopHour("not-a-number");
    const { sendMorningBrief } = await import("../cron/jobs/morningBrief");
    const res = await sendMorningBrief();
    expect(res.details).toMatch(/unresolvable/i);
    expect(res.details).toMatch(/fail-closed/i);
    expect(res.recordsProcessed).toBe(0);
  });

  it("the scheduler entry also claims the day, so the window is not the only guard", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "server", "cron", "scheduler.ts"), "utf8");
    const entry = src.slice(src.indexOf('name: "nick-morning-brief"'));
    const decl = entry.slice(0, entry.indexOf("},"));
    expect(
      decl,
      "nick-morning-brief lost its oncePerShopDay claim — a 12h tier will fire it twice again",
    ).toContain("oncePerShopDay: true");
  });
});
