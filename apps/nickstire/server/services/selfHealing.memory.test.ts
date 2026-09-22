/**
 * Self-healing → Nick memory · one row per standing issue (2026-09-22)
 *
 * WHAT WAS WRONG. Every 5-minute pass wrote each open issue to Nick's memory
 * as `System health: <message>. Detected at <today>. <auto-fixes>` — the date
 * changes daily, the auto-fix list per run, and the CRON STALE message every
 * pass ("hasn't completed in 1234min"). remember() dedupes on a hash of the
 * content, so none of those ever matched an existing row: each pass INSERTED.
 * The store's 500-row cap evicts the lowest-confidence, least-recently-
 * reinforced memory on every insert — i.e. Nick's oldest real insight, not the
 * chatter. Measured 2026-09-22: 721 rows, 168 of them "System health", the
 * store pinned one-in-one-out; the Railway log showed "Memory stored:
 * pattern — System health: CRON STALE: voice-recovery…" every five minutes.
 *
 * WHAT THIS PINS.
 *   · cronStalenessIssues: the minutes move, `message` moves with them,
 *     `stable` does not (the exported evaluator, real fixtures).
 *   · the bridge, through the real runSelfHealingChecks: two passes on two
 *     different days hand remember() the SAME content — no date, no auto-fix
 *     list, no live numbers — so the second pass reinforces instead of
 *     inserting.
 *   · POSITIVE CONTROL: the harness does produce issues and remember() is
 *     called at all; a bridge that stopped remembering would also "never
 *     insert".
 *
 * Mocks are NOT spread from the real modules on purpose: the scheduler and the
 * cron registry are the heaviest imports in the server, and this test needs
 * two functions from them. Each doMock is undone in afterEach so nothing leaks
 * across files under singleFork.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Remembered = { type: string; content: string; source: string; confidence?: number };

describe("self-healing → Nick memory", () => {
  const remembered: Remembered[] = [];

  beforeEach(() => {
    vi.resetModules();
    remembered.length = 0;
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
    vi.doMock("./nickMemory", () => ({
      remember: async (p: Remembered) => {
        remembered.push(p);
      },
    }));
    vi.doMock("./telegram", () => ({ alertSystem: async () => {} }));
    // getDb() → null is itself an issue (DATABASE_UNAVAILABLE), which is the
    // point: a stable message the bridge must not decorate.
    vi.doMock("../db", () => ({ getDb: async () => null, resetDbConnection: () => {} }));
    // ONE stale hourly job. Its CRON STALE message carries the LIVE minutes
    // figure, which moves between the two passes below — the case that proves
    // the bridge remembers `stable` and not `message`. (A harness with only
    // already-stable messages cannot tell the two apart: mutation M3 survived
    // exactly that harness on 2026-09-22.)
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

  it("cronStalenessIssues: the minutes move, the stable identity does not", async () => {
    const { cronStalenessIssues } = await import("./selfHealing");
    // The real cadence shape (getJobCadences): an hourly job, scheduled automatically.
    const cadences = new Map([["voice-recovery", { intervalMin: 60, businessHoursOnly: false, oncePerShopDay: false, tier: "hourly", scheduledAutomatically: true }]]);
    const now = Date.now();
    const at = (hoursAgo: number) => new Map([["voice-recovery", new Date(now - hoursAgo * 60 * 60 * 1000).toISOString()]]);
    // Wide enough to be stale under any allowance the evaluator derives.
    const a = cronStalenessIssues(cadences, at(200), now).find((i) => i.category === "CRON_STALE");
    const b = cronStalenessIssues(cadences, at(400), now).find((i) => i.category === "CRON_STALE");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.message).not.toBe(b!.message); // the live number moved…
    expect(a!.stable).toBe(b!.stable); // …the identity did not
    expect(a!.stable).toMatch(/^CRON STALE: voice-recovery /);
    // The staleness figure lives in the message and NOT in the identity (the
    // cadence label may legitimately carry its own minutes, e.g. "every 60min").
    const staleMinutes = a!.message.match(/in (\d+)min/)![1];
    expect(a!.stable).not.toContain(`${staleMinutes}min`);
    expect(a!.stable).not.toMatch(/hasn't completed in/);
  });

  it("two passes on two different days remember the SAME content — no date, no auto-fix list", async () => {
    armHarness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T14:00:00Z"));
    const { runSelfHealingChecks } = await import("./selfHealing");
    await runSelfHealingChecks();
    const day1 = remembered.map((r) => r.content).sort();

    // POSITIVE CONTROL — the rig produced issues and the bridge ran, including
    // the stale cron whose live message would otherwise change every pass.
    expect(day1.length).toBeGreaterThan(0);
    expect(day1).toContain("System health: DATABASE: getDb() returned null");
    const stale = day1.find((c) => c.startsWith("System health: CRON STALE: voice-recovery"));
    expect(stale).toBeDefined();
    expect(stale).not.toContain("hasn't completed in");

    remembered.length = 0;
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z"));
    await runSelfHealingChecks();
    const day2 = remembered.map((r) => r.content).sort();

    expect(day2).toEqual(day1);
    for (const c of day1) {
      expect(c).toMatch(/^System health: /);
      expect(c).not.toMatch(/Detected at/);
      expect(c).not.toMatch(/Auto-fix/);
      expect(c).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
    for (const r of remembered) {
      expect(r.type).toBe("pattern");
      expect(r.source).toBe("self_healing");
    }
  });
});
