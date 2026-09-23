/**
 * Wall-clock tiers · daily and briefings run at a fixed ET time, once per ET day (2026-09-23)
 *
 * WHAT WAS WRONG. The daily (24 h) and briefings (12 h) tiers were setIntervals
 * counted from process boot; with 32 deploys overnight they never ticked and
 * ran only from the boot claim, at whatever time a deploy landed — 04:29 ET on
 * 2026-09-22, outside every customer lane's send window.
 *
 * HOW THIS TESTS IT. Processes are simulated with Vitest fake timers: each
 * "process" is the real `startWallClockLoop` + `createWallClockRunner` with its
 * own in-memory state (a restart loses it), all sharing one fake
 * cron_tier_skip_state that executes the REAL claim SQL from tierStartup.ts —
 * INSERT IGNORE and the conditional UPDATE — with DB NOW() at whole seconds,
 * as the TIMESTAMP column stores it. Times are written as explicit ET offsets.
 *
 * POSITIVE CONTROL. The first block drives the OLD rule (boot claim with the
 * 20 h daily allowance, then a 24 h setInterval) through the same harness and
 * shows it firing the daily tier at 04:29 ET — so the harness can see drift.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sliceBlock } from "../testUtils/sourceBlock";
import { claimStartupPass, startupAllowanceMs, type StartupExecutor } from "./tierStartup";
import { createWallClockRunner, startWallClockLoop } from "./wallClockTiers";

const MIN = 60_000;
const H = 60 * MIN;

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
const UPDATE_RE =
  /^UPDATE cron_tier_skip_state SET last_run_at = NOW\(\), updated_at = NOW\(\) WHERE tier_name = \? AND \(last_run_at IS NULL OR TIMESTAMPDIFF\(SECOND, last_run_at, NOW\(\)\) >= \?\)$/;

/** cron_tier_skip_state, executing the claim SQL for real. `down` makes every query throw. */
function fakeStore(seed: Record<string, Date> = {}) {
  const rows = new Map<string, number>(Object.entries(seed).map(([k, d]) => [k, Math.floor(d.getTime() / 1000)]));
  const nowSec = () => Math.floor(Date.now() / 1000); // TIMESTAMP has no fraction
  const state = { down: false };
  const db: StartupExecutor = {
    async execute(q) {
      if (state.down) throw new Error("connect ETIMEDOUT");
      const r = render(q);
      if (INSERT_RE.test(r.text)) {
        const key = r.params[0] as string;
        if (rows.has(key)) return header(0);
        rows.set(key, nowSec());
        return header(1);
      }
      if (UPDATE_RE.test(r.text)) {
        const [key, allowanceSec] = r.params as [string, number];
        const last = rows.get(key);
        if (last === undefined) return header(0);
        if (nowSec() - last >= allowanceSec) {
          rows.set(key, nowSec());
          return header(1);
        }
        return header(0);
      }
      throw new Error(`unexpected query: ${r.text}`);
    },
  };
  return { db, rows, state };
}

type Store = ReturnType<typeof fakeStore>;
type Run = { tier: string; at: Date; pid: number };

let pidSeq = 0;
/** One server process: the real loop and runner, fresh in-memory state, shared store. */
function bootProcess(store: Store, runs: Run[], opts: { passMs?: number; running?: Set<string> } = {}) {
  const pid = ++pidSeq;
  const running = opts.running ?? new Set<string>();
  const runner = createWallClockRunner({
    getDb: async () => store.db,
    runTier: async (tier) => {
      running.add(tier);
      runs.push({ tier, at: new Date(Date.now()), pid });
      if (opts.passMs) await new Promise((r) => setTimeout(r, opts.passMs));
      running.delete(tier);
    },
    isTierRunning: (t) => running.has(t),
    log: { info: () => {}, warn: () => {} },
  });
  const stop = startWallClockLoop(runner, ["daily", "briefings"], {
    bootDelayMs: 5 * 30_000, // the scheduler's: tiers.length × 30 s stagger
    onError: (_t, err) => {
      throw err;
    },
  });
  return { kill: stop, runner, pid };
}

/** Advance the fake clock to an absolute instant, flushing timers and microtasks on the way. */
async function advanceTo(iso: string) {
  const target = new Date(iso).getTime();
  const delta = target - Date.now();
  if (delta < 0) throw new Error(`advanceTo ${iso} is in the past`);
  await vi.advanceTimersByTimeAsync(delta);
}

/** "HH:MM" on the ET clock (an independent Intl read, not the module's own). */
const etHm = (d: Date) =>
  d.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
/** "YYYY-MM-DD" on the ET clock. */
const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
/** Which slot state `check` sees at an instant, with no database: an open slot reads "no-db". */
const slotAt = async (tier: string, iso: string) => {
  const r = createWallClockRunner({
    getDb: async () => null,
    runTier: async () => {},
    isTierRunning: () => false,
    log: { info: () => {}, warn: () => {} },
  });
  return (await r.check(tier, new Date(iso))) === "no-db" ? "open" : "closed";
};
const of = (runs: Run[], tier: string) => runs.filter((r) => r.tier === tier);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POSITIVE CONTROL — the harness sees the old boot-claim drift", () => {
  it("old rule: a deploy at 04:29 ET fires the daily tier at 04:29 ET, outside retention's 09–18 window", async () => {
    vi.setSystemTime(new Date("2026-09-22T04:29:00-04:00"));
    const store = fakeStore({ daily: new Date("2026-09-21T06:10:00-04:00") }); // ~22 h ago
    const runs: Run[] = [];
    // the pre-2026-09-23 startTieredScheduler path for the daily tier
    const boot = setTimeout(async () => {
      const claim = await claimStartupPass(store.db, "daily", startupAllowanceMs("daily", 24 * H));
      if (claim.claimed) runs.push({ tier: "daily", at: new Date(Date.now()), pid: 0 });
    }, 4 * 30_000);
    const handle = setInterval(() => runs.push({ tier: "daily", at: new Date(Date.now()), pid: 0 }), 24 * H);
    await advanceTo("2026-09-22T05:00:00-04:00"); // next deploy
    clearTimeout(boot);
    clearInterval(handle);
    expect(of(runs, "daily").map((r) => etHm(r.at))).toEqual(["04:31"]);
  });

  it("new rule, same morning: nothing fires before the 09:30 ET slot", async () => {
    vi.setSystemTime(new Date("2026-09-22T04:29:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": new Date("2026-09-21T09:30:00-04:00") });
    const runs: Run[] = [];
    const p = bootProcess(store, runs);
    await advanceTo("2026-09-22T09:29:59-04:00");
    expect(of(runs, "daily")).toEqual([]);
    await advanceTo("2026-09-22T10:00:00-04:00");
    p.kill();
    expect(of(runs, "daily").map((r) => etHm(r.at))).toEqual(["09:30"]);
  });
});

describe("daily tier — restarts never move the time of day and never cause a second run", () => {
  it("a restart at 04:00 ET does not run the daily tier before its window", async () => {
    vi.setSystemTime(new Date("2026-09-23T04:00:00-04:00"));
    const store = fakeStore();
    const runs: Run[] = [];
    const p = bootProcess(store, runs);
    await advanceTo("2026-09-23T09:29:00-04:00");
    expect(of(runs, "daily")).toEqual([]);
    await advanceTo("2026-09-23T12:00:00-04:00");
    p.kill();
    expect(of(runs, "daily").map((r) => etHm(r.at))).toEqual(["09:30"]);
  });

  it("a restart inside the window runs it once, promptly, even with no process alive at 09:30", async () => {
    vi.setSystemTime(new Date("2026-09-23T04:00:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": new Date("2026-09-22T09:30:00-04:00") });
    const runs: Run[] = [];
    const a = bootProcess(store, runs);
    await advanceTo("2026-09-23T09:00:00-04:00");
    a.kill(); // down across 09:30
    await advanceTo("2026-09-23T10:15:00-04:00");
    const b = bootProcess(store, runs);
    await advanceTo("2026-09-23T11:00:00-04:00");
    b.kill();
    expect(of(runs, "daily")).toHaveLength(1);
    expect(etHm(of(runs, "daily")[0].at)).toBe("10:16"); // the first check after boot, not a later slot
  });

  it("a second restart the same day does not re-run it; the next day runs again at 09:30", async () => {
    vi.setSystemTime(new Date("2026-09-23T09:20:00-04:00"));
    const store = fakeStore();
    const runs: Run[] = [];
    const a = bootProcess(store, runs);
    await advanceTo("2026-09-23T09:45:00-04:00");
    a.kill();
    const b = bootProcess(store, runs);
    await advanceTo("2026-09-23T13:00:00-04:00");
    b.kill();
    const c = bootProcess(store, runs);
    await advanceTo("2026-09-24T12:00:00-04:00");
    c.kill();
    expect(of(runs, "daily").map((r) => [r.pid, r.at.toISOString()])).toEqual([
      [a.pid, "2026-09-23T13:30:00.000Z"],
      [c.pid, "2026-09-24T13:30:00.000Z"],
    ]);
  });

  it("the run happens even if the process only lived 30 minutes around the window", async () => {
    vi.setSystemTime(new Date("2026-09-23T09:10:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": new Date("2026-09-22T09:30:00-04:00") });
    const runs: Run[] = [];
    const p = bootProcess(store, runs);
    await advanceTo("2026-09-23T09:40:00-04:00");
    p.kill();
    expect(of(runs, "daily").map((r) => etHm(r.at))).toEqual(["09:30"]);
  });

  it("32 deploys in a day (one every 45 min): daily exactly once at 09:30, briefings exactly at 07:00 and 19:00", async () => {
    vi.setSystemTime(new Date("2026-09-23T00:00:00-04:00"));
    const store = fakeStore();
    const runs: Run[] = [];
    let p = bootProcess(store, runs);
    for (let i = 1; i <= 32; i++) {
      await vi.advanceTimersByTimeAsync(45 * MIN);
      p.kill();
      p = bootProcess(store, runs);
    }
    await advanceTo("2026-09-24T00:00:00-04:00");
    p.kill();
    expect(of(runs, "daily").map((r) => etHm(r.at))).toEqual(["09:30"]);
    expect(of(runs, "briefings").map((r) => etHm(r.at))).toEqual(["07:00", "19:00"]);
  });

  it("two containers overlapping across the opening (deploy overlap): exactly one runs it", async () => {
    vi.setSystemTime(new Date("2026-09-23T09:25:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": new Date("2026-09-22T09:30:00-04:00") });
    const runs: Run[] = [];
    const oldC = bootProcess(store, runs);
    await vi.advanceTimersByTimeAsync(20_000); // new container boots 20 s later
    const newC = bootProcess(store, runs);
    await advanceTo("2026-09-23T09:50:00-04:00");
    oldC.kill();
    await advanceTo("2026-09-23T11:00:00-04:00");
    newC.kill();
    expect(of(runs, "daily")).toHaveLength(1);
  });

  it("a claim stamped in the opening second is never read as 'before the opening' by a caller one second later", async () => {
    vi.setSystemTime(new Date("2026-09-23T09:30:00.900-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": new Date("2026-09-22T09:30:00-04:00") });
    const runs: Run[] = [];
    const a = bootProcess(store, runs);
    const b = bootProcess(store, runs);
    expect(await a.runner.check("daily")).toBe("fired");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await b.runner.check("daily")).toBe("lost");
    a.kill();
    b.kill();
    expect(of(runs, "daily")).toHaveLength(1);
  });

  it("NO CLAIM, NO FIRE: the database is down at 09:30 → nothing; back at 09:45 → one run at 09:45", async () => {
    vi.setSystemTime(new Date("2026-09-23T09:00:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": new Date("2026-09-22T09:30:00-04:00") });
    store.state.down = true;
    const runs: Run[] = [];
    const p = bootProcess(store, runs);
    await advanceTo("2026-09-23T09:44:30-04:00");
    expect(runs).toEqual([]);
    store.state.down = false;
    await advanceTo("2026-09-23T12:00:00-04:00");
    p.kill();
    expect(of(runs, "daily").map((r) => etHm(r.at))).toEqual(["09:45"]);
  });

  it("a tier already mid-pass is not claimed over: the slot waits instead of being spent on runTier's skip", async () => {
    vi.setSystemTime(new Date("2026-09-23T09:25:00-04:00"));
    const store = fakeStore({ "wallclock-slot:daily": new Date("2026-09-22T09:30:00-04:00") });
    const runs: Run[] = [];
    const running = new Set<string>(["daily"]); // e.g. a manual pass still in flight
    const p = bootProcess(store, runs, { running });
    await advanceTo("2026-09-23T09:40:30-04:00");
    expect(of(runs, "daily")).toEqual([]);
    expect(store.rows.get("wallclock-slot:daily")).toBe(new Date("2026-09-22T09:30:00-04:00").getTime() / 1000); // unspent
    running.delete("daily");
    await advanceTo("2026-09-23T12:00:00-04:00");
    p.kill();
    expect(of(runs, "daily").map((r) => etHm(r.at))).toEqual(["09:41"]);
  });

  it("a slow pass (20 min) is claimed once and not re-entered by later checks", async () => {
    vi.setSystemTime(new Date("2026-09-23T09:29:00-04:00"));
    const store = fakeStore();
    const runs: Run[] = [];
    const p = bootProcess(store, runs, { passMs: 20 * MIN });
    await advanceTo("2026-09-23T10:30:00-04:00");
    p.kill();
    expect(of(runs, "daily")).toHaveLength(1);
  });
});

describe("DST — the slot keeps its ET time on both transition days", () => {
  it("spring forward (2026-03-08): daily at 09:30 EDT = 13:30Z; briefings 11:00Z and 23:00Z", async () => {
    vi.setSystemTime(new Date("2026-03-08T00:00:00-05:00"));
    const store = fakeStore();
    const runs: Run[] = [];
    const p = bootProcess(store, runs);
    await advanceTo("2026-03-09T00:00:00-04:00");
    p.kill();
    expect(of(runs, "daily").map((r) => r.at.toISOString())).toEqual(["2026-03-08T13:30:00.000Z"]);
    expect(of(runs, "briefings").map((r) => r.at.toISOString())).toEqual([
      "2026-03-08T11:00:00.000Z",
      "2026-03-08T23:00:00.000Z",
    ]);
  });

  it("fall back (2026-11-01): daily at 09:30 EST = 14:30Z; briefings 12:00Z and 00:00Z; the repeated 01:00 hour fires nothing", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00-04:00"));
    const store = fakeStore({
      "wallclock-slot:daily": new Date("2026-10-31T09:30:00-04:00"),
      "wallclock-slot:briefings-pm": new Date("2026-10-31T19:00:00-04:00"),
    });
    const runs: Run[] = [];
    const p = bootProcess(store, runs);
    await advanceTo("2026-11-02T00:00:00-05:00");
    p.kill();
    expect(of(runs, "daily").map((r) => r.at.toISOString())).toEqual(["2026-11-01T14:30:00.000Z"]);
    expect(of(runs, "briefings").map((r) => r.at.toISOString())).toEqual([
      "2026-11-01T12:00:00.000Z",
      "2026-11-02T00:00:00.000Z",
    ]);
  });
});

describe("briefings — twice a day, at the times its own jobs accept", () => {
  it("three days with a restart every 40 min: 07:00 and 19:00 each day, nothing else", async () => {
    vi.setSystemTime(new Date("2026-09-23T00:00:00-04:00"));
    const store = fakeStore();
    const runs: Run[] = [];
    let p = bootProcess(store, runs);
    while (Date.now() < new Date("2026-09-26T00:00:00-04:00").getTime()) {
      await vi.advanceTimersByTimeAsync(40 * MIN);
      p.kill();
      p = bootProcess(store, runs);
    }
    p.kill();
    expect(of(runs, "briefings").map((r) => `${etDay(r.at)} ${etHm(r.at)}`)).toEqual([
      "2026-09-23 07:00",
      "2026-09-23 19:00",
      "2026-09-24 07:00",
      "2026-09-24 19:00",
      "2026-09-25 07:00",
      "2026-09-25 19:00",
    ]);
  });

  it("slot windows match the jobs' own gates: morning brief 06–11 ET, daily-report ≥18, wins digest 18–21", async () => {
    expect(await slotAt("briefings", "2026-09-23T06:59:59-04:00")).toBe("closed");
    expect(await slotAt("briefings", "2026-09-23T07:00:00-04:00")).toBe("open");
    expect(await slotAt("briefings", "2026-09-23T11:59:59-04:00")).toBe("open");
    expect(await slotAt("briefings", "2026-09-23T12:00:00-04:00")).toBe("closed");
    expect(await slotAt("briefings", "2026-09-23T18:59:59-04:00")).toBe("closed");
    expect(await slotAt("briefings", "2026-09-23T19:00:00-04:00")).toBe("open");
    expect(await slotAt("briefings", "2026-09-23T21:59:59-04:00")).toBe("open");
    expect(await slotAt("briefings", "2026-09-23T22:00:00-04:00")).toBe("closed");
  });

  it("the daily slot opens at 09:30 ET — inside retention (09–17) and declined/unpaid (08–19) — and stays due until midnight", async () => {
    expect(await slotAt("daily", "2026-09-23T09:29:59-04:00")).toBe("closed");
    expect(await slotAt("daily", "2026-09-23T09:30:00-04:00")).toBe("open");
    expect(await slotAt("daily", "2026-09-23T23:59:59-04:00")).toBe("open");
    expect(await slotAt("daily", "2026-09-24T00:00:00-04:00")).toBe("closed");
    expect(await slotAt("heartbeat", "2026-09-23T10:00:00-04:00")).toBe("closed"); // interval tiers are not wall-clock
  });
});

describe("the scheduler wires it: daily and briefings have no boot claim and no setInterval", () => {
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = stripComments(readFileSync(resolve(__dirname, "./scheduler.ts"), "utf8"));

  it("the per-tier boot/interval loop skips wall-clock tiers before any claim or timer", () => {
    const start = sliceBlock(src, "export function startTieredScheduler", "\nexport function stopTieredScheduler", { label: "scheduler.ts" });
    const loop = sliceBlock(start, "for (const tier of tiers) {", "log.info(`Tiered scheduler started", { label: "startTieredScheduler" });
    const skipAt = loop.indexOf("if (isWallClockTier(tier.name)) continue;");
    const claimAt = loop.indexOf("claimStartupPass(d, tier.name, allowanceMs)");
    const timerAt = loop.indexOf("tier.handle = setInterval(");
    expect(skipAt).toBeGreaterThan(0);
    expect(claimAt).toBeGreaterThan(skipAt);
    expect(timerAt).toBeGreaterThan(skipAt);
  });

  it("the wall-clock loop is started over the wall-clock tiers with the real runTier, and stopped with the scheduler", () => {
    expect(src).toContain("const wallClockTierNames = tiers.filter((t) => isWallClockTier(t.name)).map((t) => t.name);");
    expect(src).toContain("stopWallClockLoop = startWallClockLoop(wallClockRunner, wallClockTierNames, {");
    expect(src).toMatch(/runTier: async \(tierName\) => \{\s*const tier = tiers\.find\(\(t\) => t\.name === tierName\);\s*if \(tier\) await runTier\(tier\);/);
    expect(sliceBlock(src, "export function stopTieredScheduler", "\n}", { label: "scheduler.ts" })).toContain("stopWallClockLoop?.();");
  });

  it("the ALG probes throw on failure instead of returning a 'completed' details string", () => {
    expect(src).not.toMatch(/return \{ details: `(overnight|evening) probe failed/);
    expect(src).toContain("throw new Error(`overnight probe failed:");
    expect(src).toContain("throw new Error(`evening probe failed:");
  });
});
