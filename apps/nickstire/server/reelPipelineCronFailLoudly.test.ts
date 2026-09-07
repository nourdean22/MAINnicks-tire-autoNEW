/**
 * The reel-pipeline cron job fails LOUDLY when the preflight proves the
 * Higgsfield session is dead — instead of reporting "no reel jobs to
 * process" forever, indistinguishable from a healthy empty queue.
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation, Phase 2 "fail the cron
 * loudly" requirement (self-audit finding — caught by reading the ACTUAL
 * scheduler.ts source, not by trusting the earlier claim that "the preflight
 * satisfies this requirement" — it did not, until this fix).
 *
 * The mechanism this pins: processNextReelJob's preflight returns
 * processed:false WITH an error string ONLY when it proved the session is
 * dead — every OTHER processed:false path (flag off, DB down, empty queue,
 * lost claim race) carries no error and must stay silent, ordinary idle.
 * gen.processed ? ... : null already drops the preflight case from the
 * "completed" cron_log row's details string, and a "completed" row's
 * details is not what runCronFailureObserver reads anyway (it reads
 * errorMessage on a "failed" row) — so the scheduler must explicitly
 * re-throw to reach that path. reelPipelineCronShouldFailLoudly is the
 * single unambiguous signal for exactly when to do that.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { reelPipelineCronShouldFailLoudly } from "./cron/scheduler";

describe("reelPipelineCronShouldFailLoudly", () => {
  it("fails loudly on the preflight's dead-session signal (processed:false + a truthy error)", () => {
    expect(reelPipelineCronShouldFailLoudly({ processed: false, error: "preflight: higgsfield session dead — re-login required" })).toBe(true);
  });

  it("stays silent when REEL_GENERATION_ENABLED is off (processed:false, no error)", () => {
    expect(reelPipelineCronShouldFailLoudly({ processed: false })).toBe(false);
  });

  it("stays silent on an ordinary empty queue (processed:false, no error)", () => {
    expect(reelPipelineCronShouldFailLoudly({ processed: false, error: undefined })).toBe(false);
  });

  it("stays silent when a job WAS actually claimed and processed, even if it settled as an error", () => {
    // settle()'s catch produces processed:true/status:"error" for a genuine
    // mid-run exception — that path already reaches `details` via the
    // gen.processed ternary and must NOT also trigger a second, redundant throw.
    expect(reelPipelineCronShouldFailLoudly({ processed: true, error: "some mid-run exception" })).toBe(false);
  });

  it("stays silent on a normal successful claim (processed:true, no error)", () => {
    expect(reelPipelineCronShouldFailLoudly({ processed: true })).toBe(false);
  });
});

describe("the reel-pipeline job handler actually wires the loud-failure check", () => {
  const SCHEDULER = fs.readFileSync(path.join(__dirname, "cron", "scheduler.ts"), "utf8");

  it("re-throws using the shared predicate, AFTER assembly/repair have already run", () => {
    // Anchor updated 2026-09-07: generation became CONDITIONAL on the active
    // provider having credentials, so the old literal no longer exists. The
    // ordering property below is the actual invariant and is unchanged.
    const genIdx = SCHEDULER.indexOf('await settle(processNextReelJob())');
    const asmIdx = SCHEDULER.indexOf('const asm = await settle(processNextAssemblyJob());');
    const repIdx = SCHEDULER.indexOf('const rep = await settle(processNextRepairJob());');
    const throwIdx = SCHEDULER.indexOf('if (reelPipelineCronShouldFailLoudly(gen)) {');
    expect(genIdx).toBeGreaterThan(-1);
    expect(asmIdx).toBeGreaterThan(-1);
    expect(repIdx).toBeGreaterThan(-1);
    expect(throwIdx).toBeGreaterThan(-1);
    // Ordering is the property, not mere presence: throwing BEFORE assembly/
    // repair have run would skip them for this pulse, defeating settle()'s
    // whole reason for existing (documented at the settle() definition).
    expect(throwIdx).toBeGreaterThan(asmIdx);
    expect(throwIdx).toBeGreaterThan(repIdx);
  });

  it("throws the real error message, not a generic string", () => {
    expect(SCHEDULER).toMatch(/throw new Error\(gen\.error\);/);
  });

  it("a provider-credential SKIP cannot trip the loud failure", () => {
    // The guard added 2026-09-07 substitutes a synthetic result when the active
    // provider has no credentials. reelPipelineCronShouldFailLoudly is
    // `!processed && Boolean(error)`, so that object must carry NO error field —
    // otherwise a deliberate, expected skip would throw and page every 15
    // minutes, which is the failure the guard exists to prevent.
    expect(reelPipelineCronShouldFailLoudly({ processed: false })).toBe(false);
    expect(SCHEDULER).toContain('status: `generation skipped: REEL_VIDEO_PROVIDER=');
    const skip = SCHEDULER.slice(SCHEDULER.indexOf('generation skipped: REEL_VIDEO_PROVIDER='));
    expect(skip.slice(0, 160)).not.toContain('error:');
    // Positive control: a genuine generation failure still throws.
    expect(reelPipelineCronShouldFailLoudly({ processed: false, error: "boom" })).toBe(true);
  });
});
