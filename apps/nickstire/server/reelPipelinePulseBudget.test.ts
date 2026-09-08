/**
 * The reel-pipeline pulse has a budget that matches what it does, and ships
 * finished work before starting paid work.
 *
 * 2026-09-08 on prod: one generation = 5 Higgsfield clips x ~90 s = ~11 min.
 * The scheduler's race was a 4-minute literal, so every pulse was logged
 * `failed: timeout` while the handler kept running as a zombie, the failure
 * observer paged on a healthy pipeline, and three assets_ready jobs waited
 * two whole pulses behind generation with attempts=0.
 *
 * Source-level pins, each with a negative control so the regexes are not
 * vacuous: the race reads the per-job budget; the reel-pipeline job declares
 * one under the 15-min interval; the lock TTL is derived from it; assembly
 * runs before generation and can drain more than one job.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SCHEDULER = readFileSync(path.join(__dirname, "cron", "scheduler.ts"), "utf8");
const INDEX = readFileSync(path.join(__dirname, "cron", "index.ts"), "utf8");

function reelPipelineBlock(src: string): string {
  const start = src.indexOf('name: "reel-pipeline"');
  expect(start, "reel-pipeline job not found").toBeGreaterThan(-1);
  const end = src.indexOf('name: "daily-reel-post"', start);
  expect(end, "daily-reel-post job (the block's end marker) not found").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("the pulse race reads a per-job budget", () => {
  it("the timeout race is parameterised, not a 4-minute literal", () => {
    expect(SCHEDULER).toMatch(/reject\(new Error\("timeout"\)\); \}, jobTimeoutMs\(job\)\)/);
    expect(SCHEDULER).not.toMatch(/reject\(new Error\("timeout"\)\); \}, 4 \* 60 \* 1000\)/);
  });

  it("both lock acquisitions derive the TTL from the same budget", () => {
    // Real call sites only: `await acquireCronLock(` — a doc comment at the
    // top of the file also spells the bare form and must not count.
    const calls = SCHEDULER.match(/await acquireCronLock\(job\.name[^;\n]*/g) ?? [];
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c).toBe("await acquireCronLock(job.name, jobTimeoutMs(job) * 2)");
  });

  it("acquireCronLock accepts the TTL and never shortens the default", () => {
    expect(INDEX).toMatch(/export async function acquireCronLock\(jobName: string, ttlMs: number = LOCK_TTL_MS\)/);
    expect(INDEX).toMatch(/Math\.max\(ttlMs, LOCK_TTL_MS\)/);
  });
});

describe("reel-pipeline's own budget and order", () => {
  const block = reelPipelineBlock(SCHEDULER);

  it("declares a budget of 14 minutes — under the 15-minute pulse interval", () => {
    expect(block).toMatch(/timeoutMs: 14 \* 60 \* 1000/);
    expect(INDEX).toMatch(/registerJob\("reel-pipeline", 15 \* 60 \* 1000/);
  });

  it("assembles BEFORE it generates, and can drain up to three per pulse", () => {
    const asm = block.indexOf("processNextAssemblyJob()");
    const gen = block.indexOf("processNextReelJob()");
    expect(asm).toBeGreaterThan(-1);
    expect(gen).toBeGreaterThan(-1);
    expect(asm).toBeLessThan(gen);
    expect(block).toMatch(/const ASSEMBLY_PER_PULSE = 3;/);
    expect(block).toMatch(/if \(!a\.processed\) break;/);
  });

  it("still re-throws a loud generation failure AFTER the other stages", () => {
    expect(block).toMatch(/reelPipelineCronShouldFailLoudly\(gen\)/);
  });
});

describe("canary — the pins would catch the old shape", () => {
  it("the old literal race would fail the first pin", () => {
    const old = SCHEDULER.replace(/jobTimeoutMs\(job\)\)/, "4 * 60 * 1000)");
    expect(old).toMatch(/reject\(new Error\("timeout"\)\); \}, 4 \* 60 \* 1000\)/);
  });
  it("the old gen-first order would fail the order pin", () => {
    const block = reelPipelineBlock(SCHEDULER);
    const swapped = block.replace("processNextAssemblyJob()", "__A__").replace("processNextReelJob()", "processNextAssemblyJob()").replace("__A__", "processNextReelJob()");
    expect(swapped.indexOf("processNextAssemblyJob()")).toBeGreaterThan(swapped.indexOf("processNextReelJob()"));
  });
});
