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

  it("must NOT carry oncePerShopDay — the claim runs before the handler and would strand the brief", async () => {
    // Review caught this on #1479. `runTier` calls claimOncePerShopDay BEFORE
    // the handler, so a tick inside business hours but outside the morning
    // window (e.g. a 14:00 phase) claims the day's only slot and THEN skips on
    // the window — blocking the 12h partner tick. This tier is excluded from
    // runOnStartup, so the phase never moves and the brief stops firing
    // entirely. The window gate alone is sufficient: two ticks 12h apart cannot
    // both land inside a 6h window.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "server", "cron", "scheduler.ts"), "utf8");
    const entry = src.slice(src.indexOf('name: "nick-morning-brief"'));
    const decl = entry.slice(0, entry.indexOf("},"));
    // Strip comments — the explanation above deliberately names the flag.
    const code = decl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "nick-morning-brief regained oncePerShopDay — the claim precedes the window gate and will strand the brief",
    ).not.toContain("oncePerShopDay");
  });
});
