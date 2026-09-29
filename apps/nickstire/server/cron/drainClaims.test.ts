/**
 * F5 · no cron slot is spent while the SIGTERM drain runs.
 *
 * runTier starts nothing once draining (Q-10), so a slot claimed after
 * SIGTERM is a pass that never happens — and the replacement container then
 * reads the slot as taken, so that tick's jobs are lost. Two ways it happened
 * on origin/main 91ab0048:
 *   1. the boot-pass stagger timers (startTieredScheduler) are not cleared by
 *      stopTieredScheduler, and claimed without looking at the drain flag;
 *   2. a wall-clock check already awaiting its claim when SIGTERM landed went
 *      on to stamp the slot, then runTier no-opped.
 *
 * Positive control: on origin/main every block below except the CONTROL cases
 * failed — the claim ignored `isDraining` (extra argument dropped), the
 * wall-clock runner had no drain dep, and the scheduler's boot timers issued
 * the claim SQL after stop.
 *
 * The store executes the REAL claim SQL shapes (same approach as
 * wallClockTiers.test.ts), plus the release UPDATE this change adds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimStartupPass, type StartupExecutor } from "./tierStartup";
import { createWallClockRunner } from "./wallClockTiers";

/** Render a drizzle `sql` object as the driver would: text with `?`, bound values in order. */
function render(q: unknown): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (node: unknown): string => {
    if (node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
      return (node as { queryChunks: unknown[] }).queryChunks.map(walk).join("");
    }
    if (node && typeof node === "object" && Array.isArray((node as { value?: unknown }).value)) {
      return (node as { value: string[] }).value.join("");
    }
    params.push(node);
    return "?";
  };
  return { text: walk(q).replace(/\s+/g, " ").trim(), params };
}
const header = (affectedRows: number) => [{ affectedRows, insertId: 0, warningStatus: 0 }, []];

const INSERT_RE = /^INSERT IGNORE INTO cron_tier_skip_state \(tier_name, consecutive_skips, last_run_at, updated_at\) VALUES \(\?, 0, NOW\(\), NOW\(\)\)$/;
const CLAIM_RE =
  /^UPDATE cron_tier_skip_state SET last_run_at = NOW\(\), updated_at = NOW\(\) WHERE tier_name = \? AND \(last_run_at IS NULL OR TIMESTAMPDIFF\(SECOND, last_run_at, NOW\(\)\) >= \?\)$/;
const RELEASE_RE =
  /^UPDATE cron_tier_skip_state SET last_run_at = DATE_SUB\(NOW\(\), INTERVAL (\d+) SECOND\), updated_at = NOW\(\) WHERE tier_name = \? AND TIMESTAMPDIFF\(SECOND, last_run_at, NOW\(\)\) < \?$/;

/** cron_tier_skip_state in memory. `onQuery` runs before each statement (to land a SIGTERM mid-claim). */
function fakeStore(seed: Record<string, number> = {}) {
  const rows = new Map<string, number>(Object.entries(seed));
  const nowSec = () => Math.floor(Date.now() / 1000);
  const queries: string[] = [];
  const hooks = { onQuery: (_text: string) => {} };
  const db: StartupExecutor = {
    async execute(q) {
      const r = render(q);
      queries.push(r.text);
      hooks.onQuery(r.text);
      if (INSERT_RE.test(r.text)) {
        const key = r.params[0] as string;
        if (rows.has(key)) return header(0);
        rows.set(key, nowSec());
        return header(1);
      }
      if (CLAIM_RE.test(r.text)) {
        const [key, allowanceSec] = r.params as [string, number];
        const last = rows.get(key);
        if (last === undefined || nowSec() - last < allowanceSec) return header(0);
        rows.set(key, nowSec());
        return header(1);
      }
      const rel = RELEASE_RE.exec(r.text);
      if (rel) {
        const [key, allowanceSec] = r.params as [string, number];
        const last = rows.get(key);
        if (last === undefined || nowSec() - last >= allowanceSec) return header(0);
        rows.set(key, nowSec() - Number(rel[1]));
        return header(1);
      }
      throw new Error(`unexpected query: ${r.text}`);
    },
  };
  return { db, rows, queries, hooks };
}

const H = 3600_000;

describe("claimStartupPass · drain-aware", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-29T14:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("CONTROL: not draining → claims a due slot, and a second claimant is refused", async () => {
    const store = fakeStore({ hourly: Math.floor(Date.now() / 1000) - 3 * 3600 });
    expect(await claimStartupPass(store.db, "hourly", 2 * H, () => false)).toEqual({ claimed: true, via: "stamped" });
    expect(await claimStartupPass(store.db, "hourly", 2 * H, () => false)).toEqual({ claimed: false, via: "not-due" });
  });

  it("draining before the claim → not a single statement is sent", async () => {
    const store = fakeStore({ hourly: Math.floor(Date.now() / 1000) - 3 * 3600 });
    expect(await claimStartupPass(store.db, "hourly", 2 * H, () => true)).toEqual({ claimed: false, via: "draining" });
    expect(store.queries).toEqual([]);
  });

  it("SIGTERM lands during the claim's own queries → the slot is handed back; the next container claims it", async () => {
    const before = Math.floor(Date.now() / 1000) - 3 * 3600;
    const store = fakeStore({ hourly: before });
    let draining = false;
    store.hooks.onQuery = (text) => { if (CLAIM_RE.test(text)) draining = true; }; // SIGTERM mid-claim
    expect(await claimStartupPass(store.db, "hourly", 2 * H, () => draining)).toEqual({ claimed: false, via: "draining" });
    expect(store.queries.some((q) => RELEASE_RE.test(q))).toBe(true);

    // the replacement container, a minute later
    vi.advanceTimersByTime(60_000);
    store.hooks.onQuery = () => {};
    expect(await claimStartupPass(store.db, "hourly", 2 * H, () => false)).toEqual({ claimed: true, via: "stamped" });
  });

  it("a never-run tier (row created by the claim) is handed back the same way", async () => {
    const store = fakeStore();
    let draining = false;
    store.hooks.onQuery = (text) => { if (INSERT_RE.test(text)) draining = true; };
    expect(await claimStartupPass(store.db, "briefings", 12 * H, () => draining)).toEqual({ claimed: false, via: "draining" });
    store.hooks.onQuery = () => {};
    expect(await claimStartupPass(store.db, "briefings", 12 * H, () => false)).toEqual({ claimed: true, via: "stamped" });
  });
});

describe("wall-clock slot · a check in flight at SIGTERM does not burn the day's slot", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function container(store: ReturnType<typeof fakeStore>, opts: { draining: () => boolean; onGetDb?: () => void }) {
    const ran: string[] = [];
    const runner = createWallClockRunner({
      getDb: async () => { opts.onGetDb?.(); return store.db; },
      // production runTier: starts nothing once draining (scheduler.ts)
      runTier: async (t) => { if (!opts.draining()) ran.push(t); },
      isTierRunning: () => false,
      isDraining: opts.draining,
      log: { info: () => {}, warn: () => {} },
    });
    return { runner, ran };
  }

  it("CONTROL: no SIGTERM → the 09:30 ET daily slot fires once, a second container sees it taken", async () => {
    vi.setSystemTime(new Date("2026-09-29T09:31:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": Math.floor(Date.now() / 1000) - 24 * 3600 });
    const a = container(store, { draining: () => false });
    expect(await a.runner.check("daily")).toBe("fired");
    const b = container(store, { draining: () => false });
    expect(await b.runner.check("daily")).toBe("lost");
    expect([...a.ran, ...b.ran]).toEqual(["daily"]);
  }, 10_000);

  it("SIGTERM while the check awaits the DB → no statement, no pass, and the replacement container fires the slot", async () => {
    vi.setSystemTime(new Date("2026-09-29T09:31:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": Math.floor(Date.now() / 1000) - 24 * 3600 });
    let aDraining = false;
    const a = container(store, { draining: () => aDraining, onGetDb: () => { aDraining = true; } });
    expect(await a.runner.check("daily")).toBe("draining");
    expect(a.ran).toEqual([]);
    expect(store.queries).toEqual([]);

    vi.advanceTimersByTime(90_000); // the new container boots
    const b = container(store, { draining: () => false });
    expect(await b.runner.check("daily")).toBe("fired");
    expect(b.ran).toEqual(["daily"]);
  }, 10_000);

  it("SIGTERM during the slot claim's own UPDATE → handed back, and the replacement container fires the slot", async () => {
    vi.setSystemTime(new Date("2026-09-29T09:31:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": Math.floor(Date.now() / 1000) - 24 * 3600 });
    let aDraining = false;
    store.hooks.onQuery = (text) => { if (CLAIM_RE.test(text)) aDraining = true; };
    const a = container(store, { draining: () => aDraining });
    expect(await a.runner.check("daily")).toBe("draining");
    expect(a.ran).toEqual([]);
    // the claim really ran against the slot's row, and was released
    expect(store.queries.filter((q) => CLAIM_RE.test(q) || RELEASE_RE.test(q))).toHaveLength(2);
    store.hooks.onQuery = () => {};

    vi.advanceTimersByTime(90_000); // the new container boots
    const b = container(store, { draining: () => false });
    expect(await b.runner.check("daily")).toBe("fired");
    expect(b.ran).toEqual(["daily"]);
  }, 10_000);
});

describe("scheduler · the real startTieredScheduler takes no claim while draining", () => {
  let store = fakeStore();

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    store = fakeStore();
    vi.doMock("../db", () => ({ getDb: async () => store.db }));
    vi.doMock("../services/nickMemory", () => ({ remember: async () => undefined }));
  });
  afterEach(() => {
    vi.doUnmock("../db");
    vi.doUnmock("../services/nickMemory");
    vi.useRealTimers();
    vi.resetModules();
    delete (globalThis as { __nicksTieredSchedulerActive?: boolean }).__nicksTieredSchedulerActive;
  });

  it("SIGTERM inside the boot stagger → no cron_tier_skip_state claim is written", async () => {
    const { startTieredScheduler, stopTieredScheduler } = await import("./scheduler");
    startTieredScheduler();
    stopTieredScheduler(); // SIGTERM before the first 30 s stagger slot
    await vi.advanceTimersByTimeAsync(10 * 60_000); // every stagger timer, the wall-clock boot check, the seed
    const claims = store.queries.filter((q) => INSERT_RE.test(q) || CLAIM_RE.test(q));
    expect(claims).toEqual([]);
  }, 30_000);

  it("SIGTERM during the wall-clock daily slot claim → the slot is handed back, not spent", async () => {
    // 09:31 ET, inside the daily slot. Interval tiers ran recently (their boot
    // claims answer not-due, so no real tier pass starts); the slot is a day old.
    vi.setSystemTime(new Date("2026-09-29T09:31:00-04:00"));
    const now = Math.floor(Date.now() / 1000);
    store = fakeStore({
      heartbeat: now - 60, pulse: now - 60, hourly: now - 60,
      "wallclock-slot:daily": now - 24 * 3600, "wallclock-slot:briefings-am": now - 60,
    });
    const { startTieredScheduler, stopTieredScheduler } = await import("./scheduler");
    let slotParams: unknown[] | null = null;
    const claimed: string[] = [];
    const exec = store.db.execute.bind(store.db);
    store.db.execute = async (q) => {
      const r = render(q);
      if (CLAIM_RE.test(r.text) && r.params[0] === "wallclock-slot:daily") {
        // the daily slot's claim UPDATE is on the wire → SIGTERM lands now
        slotParams = r.params;
        stopTieredScheduler();
      }
      const out = await exec(q);
      if (CLAIM_RE.test(r.text) && (out as [{ affectedRows: number }])[0].affectedRows === 1) claimed.push(String(r.params[0]));
      return out;
    };
    try {
      startTieredScheduler();
      await vi.advanceTimersByTimeAsync(5 * 30_000 + 1_000); // the wall-clock boot check runs after the stagger
      expect(slotParams).not.toBeNull(); // the slot claim really went out
      expect(claimed).toEqual(["wallclock-slot:daily"]);
      expect(store.queries.some((q) => RELEASE_RE.test(q))).toBe(true);
      // handed back: at least one allowance old again, so the next container's claim succeeds
      expect(now - store.rows.get("wallclock-slot:daily")!).toBeGreaterThan(60);
    } finally {
      stopTieredScheduler();
    }
  }, 30_000);
});
