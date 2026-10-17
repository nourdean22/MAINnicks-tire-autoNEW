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
  function runners() {
    const claimed = new Set<string>();
    const fired: string[] = [];
    const claim = async (_d: unknown, key: string): Promise<StartupClaim> => {
      if (claimed.has(key)) return { claimed: false, via: "held" } as StartupClaim;
      claimed.add(key);
      return { claimed: true, via: "stamped" } as StartupClaim;
    };
    const mk = (id: string) =>
      createWallClockRunner({
        getDb: async () => ({}) as never,
        runTier: async (t) => { fired.push(`${id}:${t}`); },
        isTierRunning: () => false,
        isDraining: () => false,
        log: { info: () => {}, warn: () => {} },
        claim: claim as never,
      });
    return { a: mk("a"), b: mk("b"), fired };
  }

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
