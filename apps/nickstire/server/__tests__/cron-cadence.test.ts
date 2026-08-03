/**
 * cron-cadence.test.ts · 2026-08-03 · ROS-081
 *
 * Pins the fix for the boot-phase starvation that silently killed four
 * business-hours cron jobs.
 *
 * THE DEFECT: the daily tier is a 24h `setInterval` whose PHASE is set by
 * process start. A pod that booted at 03:00 ET fired that tier at 03:00 ET
 * every day — outside 07:00-20:59, so `runTier()` skipped every
 * `businessHoursOnly` job in it, every day, indefinitely. Four jobs were
 * affected, two of them customer SMS rails (`referral-loop-closer`,
 * `vip-auto-recognition`). Prod cron_log 2026-07-29:
 *
 *   shape:missing — opportunity-queue-refresh ran 1 times in 7 days,
 *   expected about 7
 *
 * Worse, the 03:00 pass still stamped `cron_tier_skip_state` for the TIER
 * before the job loop, so it also told the boot guard "daily already ran
 * today" and suppressed the next startup fire. The tier reported a
 * completed run having produced nothing — the ROS-078 class, where a
 * completion status is mistaken for an output.
 *
 * WHY IT SURVIVED SO LONG: it is phase-dependent. Prod happened to boot at
 * 09:09 ET on 2026-08-03, inside business hours, so a spot check that day
 * showed all four jobs running normally. The bug is invisible exactly when
 * you go looking for it after a daytime deploy.
 *
 * THE FIX has two halves and BOTH are load-bearing — section 3 proves
 * neither one alone is sufficient.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hasRunThisShopDay, shopDayStartMs } from "../cron/scheduler";

const SOURCE = readFileSync(join(process.cwd(), "server/cron/scheduler.ts"), "utf-8");

/** The four jobs ROS-081 found starved. */
const STARVED_JOBS = [
  "referral-loop-closer",
  "vip-auto-recognition",
  "opportunity-queue-refresh",
  "promise-sweep",
] as const;

/** Slice the source between two tier banners, so a pin cannot drift into a sibling tier. */
function tierBlock(from: string, to: string): string {
  const start = SOURCE.indexOf(from);
  const end = SOURCE.indexOf(to);
  expect(start, `tier banner not found: ${from}`).toBeGreaterThan(-1);
  expect(end, `tier banner not found: ${to}`).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

const HOURLY_BLOCK = () => tierBlock("TIER 3: HOURLY", "TIER 4: DAILY");
const DAILY_BLOCK = () => tierBlock("TIER 4: DAILY", "TIER 5: BRIEFINGS");

// ───────────────────────────────────────────────────────────────────────
// 1 · shopDayStartMs — the calendar boundary, read from the real ET clock
// ───────────────────────────────────────────────────────────────────────
describe("shopDayStartMs · resolves 07:00 ET without fixed-offset arithmetic", () => {
  it("resolves 07:00 EDT during summer", () => {
    // 13:09Z = 09:09 EDT — the actual prod boot instant on 2026-08-03.
    const now = new Date("2026-08-03T13:09:00Z");
    expect(new Date(shopDayStartMs(now)).toISOString()).toBe("2026-08-03T11:00:00.000Z");
  });

  it("resolves 07:00 EST during winter", () => {
    // 14:30Z = 09:30 EST.
    const now = new Date("2026-01-15T14:30:00Z");
    expect(new Date(shopDayStartMs(now)).toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("shifts with DST — a hardcoded -05:00 would be an hour wrong all summer", () => {
    const summer = new Date(shopDayStartMs(new Date("2026-08-03T13:09:00Z"))).getUTCHours();
    const winter = new Date(shopDayStartMs(new Date("2026-01-15T14:30:00Z"))).getUTCHours();
    expect(summer).toBe(11);
    expect(winter).toBe(12);
    expect(summer).not.toBe(winter);
  });

  it("returns the instant itself at exactly 07:00 ET", () => {
    const sevenEt = new Date("2026-08-03T11:00:00Z");
    expect(shopDayStartMs(sevenEt)).toBe(sevenEt.getTime());
  });
});

// ───────────────────────────────────────────────────────────────────────
// 2 · hasRunThisShopDay — "already ran" vs "never ran" vs "ran yesterday"
// ───────────────────────────────────────────────────────────────────────
describe("hasRunThisShopDay · null is not 'ran long ago'", () => {
  const now = new Date("2026-08-03T17:00:00Z"); // 13:00 EDT

  it("treats a job that has never run as NOT having run today", () => {
    expect(hasRunThisShopDay(null, now)).toBe(false);
  });

  it("a run earlier in the same shop day blocks a second run", () => {
    expect(hasRunThisShopDay(new Date("2026-08-03T11:30:00Z"), now)).toBe(true);
  });

  it("a run at 06:59 ET — before the shop day opened — does NOT block today", () => {
    expect(hasRunThisShopDay(new Date("2026-08-03T10:59:00Z"), now)).toBe(false);
  });

  it("yesterday evening's run does NOT block today — this is the starvation regression", () => {
    // 2026-08-02T23:00Z = 19:00 EDT yesterday. Only 18h ago, but a
    // different shop day, so the job must be allowed to run again.
    expect(hasRunThisShopDay(new Date("2026-08-02T23:00:00Z"), now)).toBe(false);
  });

  it("is exclusive at the boundary — a run AT 07:00 ET counts as today", () => {
    expect(hasRunThisShopDay(new Date("2026-08-03T11:00:00Z"), now)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 3 · The starvation itself — and why BOTH halves of the fix are needed
// ───────────────────────────────────────────────────────────────────────
describe("ROS-081 · a businessHoursOnly job in a 24h tier starves on boot phase", () => {
  /** ET hours at which a tier fires over one day, given its boot phase. */
  const firingHours = (bootHourEt: number, intervalHours: number): number[] => {
    const out: number[] = [];
    for (let h = bootHourEt; h < bootHourEt + 24; h += intervalHours) out.push(h % 24);
    return out;
  };
  // Mirrors isBusinessHours(): etHour >= 7 && etHour < 21.
  const everRunnable = (hours: number[]) => hours.some((h) => h >= 7 && h < 21);

  it("a 24h tier booted at 03:00 ET NEVER runs its business-hours jobs", () => {
    expect(everRunnable(firingHours(3, 24))).toBe(false);
  });

  it("the same tier booted at 09:00 ET runs fine — which is why prod looked healthy", () => {
    expect(everRunnable(firingHours(9, 24))).toBe(true);
  });

  it("a 24h tier is starved from 10 of 24 possible boot hours", () => {
    const starved = Array.from({ length: 24 }, (_, h) => h).filter((h) => !everRunnable(firingHours(h, 24)));
    expect(starved).toEqual([21, 22, 23, 0, 1, 2, 3, 4, 5, 6].sort((a, b) => a - b));
    expect(starved).toHaveLength(10);
  });

  it("the 2h tier lands inside business hours from EVERY boot hour — half 1 of the fix", () => {
    for (let boot = 0; boot < 24; boot++) {
      expect(everRunnable(firingHours(boot, 2)), `boot hour ${boot}`).toBe(true);
    }
  });

  it("half 1 alone would over-fire: the 2h tier offers ~7 slots inside business hours", () => {
    const inWindow = firingHours(3, 2).filter((h) => h >= 7 && h < 21);
    expect(inWindow.length).toBeGreaterThan(1);
    // …which is precisely why the per-job once-per-shop-day claim (half 2)
    // is not optional. Two SMS rails live on this path.
  });
});

// ───────────────────────────────────────────────────────────────────────
// 4 · Tier placement — the invariant that keeps the bug from returning
// ───────────────────────────────────────────────────────────────────────
describe("tier placement · no businessHoursOnly job may sit in the 24h daily tier", () => {
  it("the daily tier declares NO businessHoursOnly job", () => {
    // Scoped to the daily block on purpose: the same literal is correct
    // and expected in the 15min and 2h tiers.
    expect(DAILY_BLOCK()).not.toMatch(/businessHoursOnly:\s*true/);
  });

  it.each(STARVED_JOBS)("%s now lives in the 2h hourly tier", (job) => {
    expect(HOURLY_BLOCK()).toContain(`name: "${job}"`);
    expect(DAILY_BLOCK()).not.toContain(`name: "${job}"`);
  });

  it.each(STARVED_JOBS)("%s claims its slot once per shop day", (job) => {
    const block = HOURLY_BLOCK();
    const at = block.indexOf(`name: "${job}"`);
    expect(at).toBeGreaterThan(-1);
    // Look only at this job's own object literal, not the next one's.
    const declaration = block.slice(at, block.indexOf("handler:", at));
    expect(declaration).toMatch(/oncePerShopDay:\s*true/);
    expect(declaration).toMatch(/businessHoursOnly:\s*true/);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 5 · The v1.7 duplicate-SMS guarantee must survive per-job claiming
// ───────────────────────────────────────────────────────────────────────
describe("the once-per-day claim runs INSIDE the cross-dyno lock", () => {
  it("claimOncePerShopDay is called after acquireCronLock, not before", () => {
    const lockAt = SOURCE.indexOf("const lockResult = await acquireCronLock(job.name)");
    const claimAt = SOURCE.indexOf("job.oncePerShopDay && !(await claimOncePerShopDay(job.name))");
    expect(lockAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(-1);
    // Two pods that each read "not yet run today" would both claim and both
    // fire. The lock is what makes the read-then-write safe; ordering these
    // the other way silently reintroduces the v1.7 duplicate-SMS bug.
    expect(claimAt).toBeGreaterThan(lockAt);
  });

  it("releases the lock when the claim is declined, so the slot is not held all day", () => {
    const claimAt = SOURCE.indexOf("job.oncePerShopDay && !(await claimOncePerShopDay(job.name))");
    const block = SOURCE.slice(claimAt, claimAt + 400);
    expect(block).toContain("releaseCronLock(lockResult)");
  });

  it("fails CLOSED — an unreadable claim must not run the job", () => {
    // A DB blip that returned `true` here would fire customer SMS on every
    // pass of the 2h tier.
    const fn = SOURCE.slice(
      SOURCE.indexOf("async function claimOncePerShopDay"),
      SOURCE.indexOf("async function runTier"),
    );
    expect(fn).toContain("if (!d) return false;");
    expect(fn).toMatch(/catch[\s\S]*return false;/);
  });
});
