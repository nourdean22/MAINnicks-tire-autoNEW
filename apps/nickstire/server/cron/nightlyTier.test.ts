/**
 * The TiDB backup runs once a night, after the shop's day and before its next,
 * claimed per ET night so two containers (a deploy overlap, two replicas) cannot
 * both run it. The claim is the existing wall-clock slot CAS (wallClockTiers.ts);
 * these tests pin that the backup sits behind it, behind its kill switch, and
 * with a budget long enough for a full pass.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createWallClockRunner, isWallClockTier } from "./wallClockTiers";
import type { StartupClaim } from "./tierStartup";

const schedulerSrc = readFileSync(join(__dirname, "scheduler.ts"), "utf8");
const indexSrc = readFileSync(join(__dirname, "index.ts"), "utf8");

function tierBlock(name: string): string {
  const start = schedulerSrc.indexOf(`name: "${name}",\n    intervalMs:`);
  expect(start, `tier ${name} not declared`).toBeGreaterThan(-1);
  const end = schedulerSrc.indexOf("tiers.push({", start);
  return schedulerSrc.slice(start, end === -1 ? undefined : end);
}

describe("nightly tier · the TiDB backup's home", () => {
  it("is a wall-clock tier, so it fires from a claimed ET slot, not a boot timer", () => {
    expect(isWallClockTier("nightly")).toBe(true);
  });

  it("holds tidb-backup behind TIDB_BACKUP_ENABLED with a 30-minute budget", () => {
    const block = tierBlock("nightly");
    const job = block.slice(block.indexOf('name: "tidb-backup"'));
    expect(block).toContain('name: "tidb-backup"');
    expect(job).toMatch(/requiresFlag: "TIDB_BACKUP_ENABLED"/);
    expect(job).toMatch(/timeoutMs: 30 \* 60 \* 1000/);
  });

  it("the manual-run registry carries the same budget, so a manual run cannot outlive its lock", () => {
    const at = indexSrc.indexOf('registerJob("tidb-backup"');
    expect(at).toBeGreaterThan(-1);
    expect(indexSrc.slice(at, at + 900)).toContain("30 * 60 * 1000");
  });
});

describe("nightly slot · 03:30 to 06:00 ET, one claimant per night", () => {
  /**
   * A claim store with the real CAS rule: a key is claimable when it has no
   * stamp or its stamp is older than `allowanceMs` before the shared clock.
   */
  function runners(opts: { complete?: (tier: string, day: string) => boolean } = {}) {
    const stamps = new Map<string, number>();
    const clock = { now: 0 };
    const fired: string[] = [];
    const completeAsked: string[] = [];
    const claim = async (_d: unknown, key: string, allowanceMs: number): Promise<StartupClaim> => {
      const last = stamps.get(key);
      if (last !== undefined && clock.now - last <= allowanceMs) return { claimed: false, via: "held" } as StartupClaim;
      stamps.set(key, clock.now);
      return { claimed: true, via: "stamped" } as StartupClaim;
    };
    const mk = (id: string) => {
      const r = createWallClockRunner({
        getDb: async () => ({}) as never,
        runTier: async (t) => { fired.push(`${id}:${t}`); },
        isTierRunning: () => false,
        isDraining: () => false,
        log: { info: () => {}, warn: () => {} },
        claim: claim as never,
        isSlotComplete: async (tier, day) => {
          completeAsked.push(tier);
          return opts.complete ? opts.complete(tier, day) : true;
        },
      });
      return { check: (tier: string, at: string) => { clock.now = new Date(at).getTime(); return r.check(tier, new Date(at)); } };
    };
    return { a: mk("a"), b: mk("b"), fired, completeAsked };
  }

  it("is closed before 03:30 ET and after 06:00 ET", async () => {
    const { a } = runners();
    expect(await a.check("nightly", "2026-10-18T03:29:59-04:00")).toBe("not-open");
    expect(await a.check("nightly", "2026-10-18T06:00:00-04:00")).toBe("not-open");
  });

  it("two containers in the open slot: exactly one fires", async () => {
    const { a, b, fired } = runners();
    const at = "2026-10-18T03:31:00-04:00";
    const results = await Promise.all([a.check("nightly", at), b.check("nightly", at)]);
    expect(results.sort()).toEqual(["fired", "lost"]);
    expect(fired).toHaveLength(1);
  });

  it("a failed first pass (no manifest) is retried by a later container once the claim is older than the 30-min budget (fix 2)", async () => {
    const { a, b, fired } = runners({ complete: () => false });
    expect(await a.check("nightly", "2026-10-18T03:31:00-04:00")).toBe("fired");
    // still inside the budget: the first pass may be running elsewhere
    expect(await b.check("nightly", "2026-10-18T03:55:00-04:00")).toBe("lost");
    expect(await b.check("nightly", "2026-10-18T04:05:00-04:00")).toBe("fired");
    expect(fired).toEqual(["a:nightly", "b:nightly"]);
  });

  it("a completed night (manifest present) is never re-run in the window", async () => {
    const { a, b, fired } = runners({ complete: () => true });
    expect(await a.check("nightly", "2026-10-18T03:31:00-04:00")).toBe("fired");
    expect(await a.check("nightly", "2026-10-18T04:30:00-04:00")).toBe("settled");
    expect(await b.check("nightly", "2026-10-18T03:32:00-04:00")).toBe("lost");
    expect(await b.check("nightly", "2026-10-18T05:00:00-04:00")).toBe("settled");
    expect(fired).toEqual(["a:nightly"]);
  });

  it("control: daily and briefings keep stamp-at-start; a repeat there would resend customer messages", async () => {
    const { a, b, fired, completeAsked } = runners({ complete: () => false });
    expect(await a.check("daily", "2026-10-18T09:31:00-04:00")).toBe("fired");
    expect(await b.check("daily", "2026-10-18T11:30:00-04:00")).toBe("lost");
    expect(await b.check("daily", "2026-10-18T23:00:00-04:00")).toBe("settled");
    expect(await a.check("briefings", "2026-10-18T07:01:00-04:00")).toBe("fired");
    expect(await b.check("briefings", "2026-10-18T11:00:00-04:00")).toBe("lost");
    expect(fired).toEqual(["a:daily", "a:briefings"]);
    expect(completeAsked).toEqual([]);
  });


  it("is closed before 03:30 ET and after 06:00 ET", async () => {
    const { a } = runners();
    expect(await a.check("nightly", new Date("2026-10-18T03:29:59-04:00"))).toBe("not-open");
    expect(await a.check("nightly", new Date("2026-10-18T06:00:00-04:00"))).toBe("not-open");
  });

  it("two containers in the open slot: exactly one fires", async () => {
    const { a, b, fired } = runners();
    const at = new Date("2026-10-18T03:31:00-04:00");
    const results = await Promise.all([a.check("nightly", at), b.check("nightly", at)]);
    expect(results.sort()).toEqual(["fired", "lost"]);
    expect(fired).toHaveLength(1);
  });
});
