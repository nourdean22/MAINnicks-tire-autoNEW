/**
 * Self-healing writes NOTHING to Nick's durable memory (2026-09-22)
 *
 * WHAT WAS WRONG. Every 5-minute pass handed each open issue to
 * nickMemory.remember() as a `pattern`. The first fix that day (#2504) gave
 * each issue a stable identity so a standing condition reinforced one row
 * instead of inserting a new one every pass. The live log after that deploy
 * still showed "Memory stored" ×10 every five minutes: the store is 721 rows
 * over its 500 cap, eviction at the cap is confidence ASC, and the ten health
 * rows at 0.85 were the lowest — so each insert evicted the health row
 * written seconds earlier, and the next pass inserted it again. A memory the
 * store cannot keep is not a memory; and health state is operational, not
 * knowledge — it belongs in cron_log, the Telegram alert and the watchdog,
 * not in the store the chat prompt recalls from. The bridge is gone.
 *
 * WHAT THIS PINS. Through the real runSelfHealingChecks, with a rig that
 * produces three standing issues (a stale hourly job, no database, the
 * wiring probe): remember() is never called, on two passes on two days.
 * POSITIVE CONTROL: the same rig still produces the issues — the return
 * value counts them and the alert carries the stale cron — so "never called"
 * is not "nothing happened". And the source pin: selfHealing.ts does not
 * import nickMemory at all, comment-stripped.
 *
 * Mocks are NOT spread from the real modules on purpose: the scheduler and the
 * cron registry are the heaviest imports in the server, and this test needs
 * two functions from them. Each doMock is undone in afterEach so nothing leaks
 * across files under singleFork.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Remembered = { type: string; content: string; source: string; confidence?: number };
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("self-healing keeps health state out of Nick's memory", () => {
  const remembered: Remembered[] = [];
  const alerted: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    remembered.length = 0;
    alerted.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock("./nickMemory");
    vi.doUnmock("./telegram");
    vi.doUnmock("../db");
    vi.doUnmock("../cron/scheduler");
    vi.doUnmock("../cron/index");
    vi.doUnmock("../cron/cron-status");
    vi.doUnmock("../cron/registry-tier-map");
    vi.doUnmock("./eventBus");
  });

  function armHarness() {
    // If the bridge came back, this is where it would land.
    vi.doMock("./nickMemory", () => ({
      remember: async (p: Remembered) => {
        remembered.push(p);
      },
    }));
    vi.doMock("./telegram", () => ({
      alertSystem: async (_title: string, body: string) => {
        alerted.push(body);
      },
    }));
    // getDb() → null is itself an issue (DATABASE_UNAVAILABLE).
    vi.doMock("../db", () => ({ getDb: async () => null, resetDbConnection: () => {} }));
    // ONE stale hourly job, so the pass has a CRON STALE issue whose live
    // minutes move between the two passes below.
    vi.doMock("../cron/scheduler", () => ({
      getJobCadences: () =>
        new Map([["voice-recovery", { intervalMin: 60, businessHoursOnly: false, oncePerShopDay: false, tier: "hourly", scheduledAutomatically: true }]]),
    }));
    vi.doMock("../cron/index", () => ({ getRegisteredJobNames: () => [] }));
    vi.doMock("../cron/cron-status", () => ({
      loadLastCompletions: async () => new Map([["voice-recovery", "2026-09-10T00:00:00.000Z"]]),
    }));
    vi.doMock("../cron/registry-tier-map", () => ({ findCronWiringFaults: () => [] }));
    vi.doMock("./eventBus", () => ({ getEventBusStatus: () => ({ initialized: true }) }));
    vi.stubEnv("OPENAI_API_KEY", "canary");
  }

  it("two passes with standing issues: remember() is never called — and the issues were real (positive control)", async () => {
    armHarness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T14:00:00Z"));
    const { runSelfHealingChecks } = await import("./selfHealing");

    const day1 = await runSelfHealingChecks();
    // POSITIVE CONTROL — the rig produced issues: the pass counted them and
    // the alert carried the stale cron. A pass that found nothing would also
    // "never remember", and that is not what this test proves.
    expect(day1.recordsProcessed).toBeGreaterThanOrEqual(2);
    expect(day1.details).toMatch(/CRON STALE: voice-recovery/);
    expect(day1.details).toMatch(/DATABASE: getDb\(\) returned null/);
    expect(alerted.join("\n")).toMatch(/CRON STALE: voice-recovery/);
    expect(remembered).toEqual([]);

    vi.setSystemTime(new Date("2026-09-23T14:00:00Z"));
    const day2 = await runSelfHealingChecks();
    expect(day2.recordsProcessed).toBe(day1.recordsProcessed);
    expect(remembered).toEqual([]);
  });

  it("selfHealing.ts does not import nickMemory at all (comment-stripped)", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "./selfHealing.ts"), "utf8"));
    expect(src).not.toContain("nickMemory");
    expect(src).not.toContain("remember(");
    expect(src).not.toContain("healthMemoryContent");
  });
});
