/**
 * A tier keeps its cadence across redeploys (2026-10-08).
 *
 * WHAT WAS WRONG. A tier that was not due at boot did nothing until a
 * `setInterval` started AT BOOT ticked a full interval later, and a deploy
 * before that tick reset the wait. On 2026-10-08 the 2-hour tier
 * (missed-call recovery, callback escalation, stale-lead follow-up,
 * confirmation calls) ran at 10:17, 12:28, 15:17 and 18:26Z: 131, 168 and 189
 * minutes apart, across fourteen boots.
 *
 * WHAT THIS PINS. firstTickDelayMs schedules one claimed check for the moment
 * the tier falls due, and the interval starts from it. A replay of that day's
 * real boot times through a model of the scheduler reproduces the three
 * production runs under the old rule (the model's positive control) and keeps
 * every gap within the interval under the new one. A seeded month of random
 * deploys does the same. Then the wiring in scheduler.ts, comment-stripped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describeDueCheck, firstTickDelayMs, type StartupClaim } from "./tierStartup";
import { sliceBlock } from "../testUtils/sourceBlock";

const MIN = 60_000;
const H = 60 * MIN;
const INTERVAL = 2 * H; // the "hourly" tier
const STAGGER = MIN; // the hourly tier's boot stagger (third tier × 30 s)
const OVERLAP = 30_000; // an old container outlives its replacement's boot by this much
const notDue: StartupClaim = { claimed: false, via: "not-due" };
// The slack the due check waits past the due instant, read from behaviour (one
// minute short of due -> one minute + slack) rather than from an export.
const DUE_CHECK_SLACK_MS = (firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs: INTERVAL - MIN, claim: notDue }) ?? NaN) - MIN;

describe("firstTickDelayMs", () => {
  it("a tier that was not due waits only until it falls due, plus the slack", () => {
    // Positive, so the claim lands after the allowance has elapsed; small, so
    // the cadence stays two hours rather than drifting by the slack each boot.
    expect(DUE_CHECK_SLACK_MS).toBeGreaterThan(0);
    expect(DUE_CHECK_SLACK_MS).toBeLessThanOrEqual(30_000);
    for (const ageMin of [10, 100, 119]) {
      expect(firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs: ageMin * MIN, claim: notDue })).toBe((120 - ageMin) * MIN + DUE_CHECK_SLACK_MS);
    }
  });

  it("nothing to align to means the old behaviour (null: start the interval now)", () => {
    expect(firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs: 121 * MIN, claim: { claimed: true, via: "stamped" } })).toBeNull();
    expect(firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs: null, claim: { claimed: true, via: "created" } })).toBeNull();
    expect(firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs: 30 * MIN, claim: null })).toBeNull(); // claim not attempted
    expect(firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs: 30 * MIN, claim: { claimed: false, via: "draining" } })).toBeNull();
    expect(firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs: null, claim: notDue })).toBeNull(); // age unread
    expect(firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs: 125 * MIN, claim: notDue })).toBeNull(); // someone else claimed first
  });

  it("describeDueCheck: only a claim fires", () => {
    expect(describeDueCheck({ claimed: true, via: "stamped" }, null).fire).toBe(true);
    expect(describeDueCheck(notDue, null)).toEqual({ fire: false, reason: "another process ran it first — the interval timer starts now" });
    expect(describeDueCheck({ claimed: false, via: "draining" }, null).fire).toBe(false);
    expect(describeDueCheck(null, "connect ETIMEDOUT")).toEqual({
      fire: false,
      reason: "could not claim (connect ETIMEDOUT) — no claim, no fire; the interval timer starts now",
    });
  });
});

/**
 * The scheduler as far as one tier is concerned. `last_run_at` is a single
 * stamp; a claim is the conditional UPDATE (stamp only when age ≥ allowance);
 * an interval tick runs unclaimed and runTier stamps at pass start. Containers
 * live from boot to their replacement's boot plus OVERLAP; their timers die
 * with them. "old" is the pre-2026-10-08 rule, "new" is firstTickDelayMs.
 */
interface Container { boot: number; startup: number; death: number }
function simulate(rule: "old" | "new", containers: Container[], firstStamp: number, endAt: number): number[] {
  let stamp = firstStamp;
  const runs: number[] = [];
  const claim = (t: number) => (t - stamp >= INTERVAL ? ((stamp = t), true) : false);
  type Ev = { t: number; c: Container; kind: "startup" | "due" | "tick" };
  const queue: Ev[] = containers.map((c) => ({ t: c.startup, c, kind: "startup" as const }));
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t);
    const ev = queue.shift()!;
    if (ev.t >= ev.c.death || ev.t > endAt) continue;
    if (ev.kind === "startup") {
      const lastRunAgeMs = ev.t - stamp;
      const claimed = claim(ev.t);
      if (claimed) runs.push(ev.t);
      if (rule === "old") {
        queue.push({ t: ev.c.boot + INTERVAL, c: ev.c, kind: "tick" });
        continue;
      }
      const delay = firstTickDelayMs({ allowanceMs: INTERVAL, lastRunAgeMs, claim: claimed ? { claimed: true, via: "stamped" } : notDue });
      queue.push(delay === null ? { t: ev.t + INTERVAL, c: ev.c, kind: "tick" } : { t: ev.t + delay, c: ev.c, kind: "due" });
    } else if (ev.kind === "due") {
      if (claim(ev.t)) runs.push(ev.t);
      queue.push({ t: ev.t + INTERVAL, c: ev.c, kind: "tick" });
    } else {
      stamp = ev.t;
      runs.push(ev.t);
      queue.push({ t: ev.t + INTERVAL, c: ev.c, kind: "tick" });
    }
  }
  return runs;
}

/** Startup-line times are boot + STAGGER; each container dies OVERLAP after the next one boots. */
function containersFromStartupLines(lines: number[], lastDeath: number): Container[] {
  return lines.map((startup, i) => ({
    boot: startup - STAGGER,
    startup,
    death: i + 1 < lines.length ? lines[i + 1] - STAGGER + OVERLAP : lastDeath,
  }));
}

const maxGap = (first: number, runs: number[]) => Math.max(...[first, ...runs].slice(1).map((t, i) => t - [first, ...runs][i]));
const at = (hhmmss: string) => Date.parse(`2026-10-08T${hhmmss}Z`);

describe("replay of 2026-10-08: the day's real boots", () => {
  // Every "hourly tier startup" line in Railway's deploy log that day, and the
  // pass start behind "Tier hourly: 10 completed, 27 skipped (3341ms)" at 10:17:39.
  const startupLines = [
    "10:39:16", "10:58:37", "11:29:26", "11:44:46", "12:03:13", "12:13:17", "12:28:52", "12:31:17",
    "14:22:33", "15:17:19", "16:16:11", "16:37:05", "16:46:37", "16:58:54", "18:26:00",
  ].map(at);
  const firstStamp = at("10:17:36");
  const containers = containersFromStartupLines(startupLines, at("18:39:00"));
  const endAt = at("18:30:00");

  it("POSITIVE CONTROL — the old rule reproduces production's three runs exactly", () => {
    expect(simulate("old", containers, firstStamp, endAt)).toEqual([at("12:28:52"), at("15:17:19"), at("18:26:00")]);
  });

  it("the new rule runs every two hours plus the slack on the same boots", () => {
    const runs = simulate("new", containers, firstStamp, endAt);
    expect(runs).toEqual([1, 2, 3, 4].map((k) => firstStamp + k * (INTERVAL + DUE_CHECK_SLACK_MS)));
    expect(maxGap(firstStamp, runs)).toBe(INTERVAL + DUE_CHECK_SLACK_MS);
  });
});

describe("a seeded month of random deploys", () => {
  // mulberry32: deterministic, so a failure reproduces.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it("busy days and quiet days: the new rule never lets a gap exceed interval + slack + stagger", () => {
    const next = rng(20261008);
    const start = at("00:00:00");
    const endAt = start + 30 * 24 * H;
    const lines: number[] = [];
    for (let t = start + 5 * MIN; t < endAt; ) {
      lines.push(t);
      // bursts of deploys minutes apart, and lulls of up to four hours
      t += (next() < 0.6 ? 2 + next() * 38 : 40 + next() * 200) * MIN;
    }
    const containers = containersFromStartupLines(lines, endAt + H);
    const oldGap = maxGap(start, simulate("old", containers, start, endAt));
    const newRuns = simulate("new", containers, start, endAt);
    expect(lines.length).toBeGreaterThan(400);
    expect(oldGap).toBeGreaterThan(INTERVAL + 30 * MIN); // CONTROL: this timeline does stress the old rule
    expect(maxGap(start, newRuns)).toBeLessThanOrEqual(INTERVAL + DUE_CHECK_SLACK_MS + STAGGER);
    expect(newRuns.length).toBeGreaterThanOrEqual(Math.floor((30 * 24 * H) / (INTERVAL + DUE_CHECK_SLACK_MS + STAGGER)));
  });
});

describe("scheduler.ts wires it", () => {
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = stripComments(readFileSync(resolve(__dirname, "./scheduler.ts"), "utf8"));
  const loop = sliceBlock(src, "for (const tier of tiers) {", "const wallClockTierNames", { label: "scheduler.ts" });

  it("the interval starts only through startRecurring, once the phase is known", () => {
    expect(src.split("tier.handle = setInterval(").length - 1).toBe(1);
    const recurring = sliceBlock(loop, "const startRecurring = () => {", "setTimeout(async () => {", { label: "scheduler.ts tier loop" });
    expect(recurring).toContain("if (isCronDraining() || tier.handle) return;");
    expect(recurring).toContain("tier.handle = setInterval(");
  });

  it("a not-due tier gets a claimed due check; the run comes only after the claim", () => {
    const delayAt = loop.indexOf("const dueInMs = firstTickDelayMs({ allowanceMs, lastRunAgeMs, claim });");
    const nullAt = loop.indexOf("if (dueInMs === null) {\n        startRecurring();");
    const dueAt = loop.indexOf("tier.dueCheck = setTimeout(async () => {");
    const claimAt = loop.indexOf("dueClaim = await claimStartupPass(d, tier.name, allowanceMs);");
    const describeAt = loop.indexOf("const due = describeDueCheck(dueClaim, dueError);");
    const gateAt = loop.indexOf("if (!due.fire) return;");
    const runAt = loop.indexOf("Tier ${tier.name} due check failed:");
    expect(delayAt).toBeGreaterThan(0);
    expect(nullAt).toBeGreaterThan(delayAt);
    expect(dueAt).toBeGreaterThan(nullAt);
    expect(claimAt).toBeGreaterThan(dueAt);
    expect(describeAt).toBeGreaterThan(claimAt);
    expect(gateAt).toBeGreaterThan(describeAt);
    expect(runAt).toBeGreaterThan(gateAt);
    expect(loop.slice(describeAt, gateAt)).toContain("startRecurring();");
  });

  it("stopping the scheduler clears a pending due check", () => {
    const stop = sliceBlock(src, "export function stopTieredScheduler", "Tiered scheduler stopped", { label: "scheduler.ts" });
    expect(stop).toContain("if (tier.dueCheck) clearTimeout(tier.dueCheck);");
  });
});
