/**
 * 2026-10-09 · the Reel lane neither published nor produced.
 *
 * Production read (cron_log, 10:10Z-10:55Z, ET 06:00 production hour):
 *   "production held: usable READY buffer 2 (hold_above_low_watermark)"
 * while every drain pulse logged both READY jobs as skipped:
 *   2040001 qa_parked:needs_paid_repair, 1770004 repost:caption.
 * The READY count re-derived three of the drain's six checks, so it counted two
 * jobs the drain would never publish. Fix: the count reuses the drain's verdict.
 *
 * Same day, same job: the paid beat-2 repair of 2040001 (12 credits, 17:27Z on
 * 2026-10-08) could never clear a verdict with blocks on beats 1, 2, 4, 5 and
 * three asset-level blocks. Fix: spend only on a repair that can clear the verdict,
 * and repair the lowest blocked beat first.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { decideReadyBuffer, readyCandidateIsUsable } from "@shared/reelQueue";
import { paidRepairCanClearVerdict, pickRepairTarget } from "./services/repairRouter";
import type { RenderedFinding } from "./services/renderedQa";

const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");

const f = (code: string, severity: "block" | "warn", beatNumber: number | null): RenderedFinding =>
  ({ code, severity, beatNumber, description: code, preserve: [], change: [], confidence: 1 }) as unknown as RenderedFinding;

// Job 2040001's persisted verdict, 2026-10-08T17:44:09Z (production reel_jobs.payload.renderedQa).
const JOB_2040001: RenderedFinding[] = [
  f("BEAT_SEMANTIC_MISMATCH", "block", null),
  f("MECHANICAL_MISREPRESENTATION", "block", null),
  f("SUBJECT_CONTINUITY", "block", null),
  f("MECHANICAL_MISREPRESENTATION", "block", 1),
  f("MALFORMED_GEOMETRY", "block", 1),
  f("PLASTIC_AI_LOOK", "warn", 1),
  f("SUBJECT_CONTINUITY", "block", 2),
  f("BEAT_SEMANTIC_MISMATCH", "block", 2),
  f("MECHANICAL_MISREPRESENTATION", "block", 2),
  f("LIGHTING_DRIFT", "warn", 2),
  f("CAPTION_OBSTRUCTION", "warn", 3),
  f("BEAT_SEMANTIC_MISMATCH", "block", 4),
  f("SUBJECT_CONTINUITY", "block", 4),
  f("BEAT_SEMANTIC_MISMATCH", "block", 5),
];

describe("READY count agrees with the drain", () => {
  const approvedAssembled = { status: "assembled", hasAsset: true, hasBlockingError: false, hasLiveApproval: true };

  it("POSITIVE CONTROL: an approved, assembled job the drain did not refuse is usable", () => {
    expect(readyCandidateIsUsable(approvedAssembled)).toBe(true);
    expect(readyCandidateIsUsable({ ...approvedAssembled, skippedByDrain: false })).toBe(true);
  });

  it("a job the drain refused this pulse is not usable inventory", () => {
    expect(readyCandidateIsUsable({ ...approvedAssembled, skippedByDrain: true })).toBe(false);
    expect(readyCandidateIsUsable({ status: "assets_ready", hasAsset: true, hasBlockingError: false, hasLiveApproval: false, skippedByDrain: true })).toBe(false);
  });

  it("reproduces 2026-10-09: two drain-refused jobs held production before, refill now", () => {
    const rows = [approvedAssembled, approvedAssembled]; // 2040001 + 1770004 as the count saw them
    const before = rows.filter((r) => readyCandidateIsUsable(r)).length;
    const after = rows.filter((r) => readyCandidateIsUsable({ ...r, skippedByDrain: true })).length;
    expect(decideReadyBuffer(before, 3, 1)).toBe("hold_above_low_watermark");
    expect(decideReadyBuffer(after, 3, 1)).toBe("refill");
  });

  it("the cron hands the drain's refusals to the count, after the drain has scanned", () => {
    const declared = CRON.indexOf("let drainSkippedIds: ReadonlySet<number> = new Set();");
    const scanStart = CRON.indexOf("const skipped: Array<{ jobId: number; code: string }> = [];");
    const assigned = CRON.indexOf("drainSkippedIds = new Set(skipped.map((s) => s.jobId));");
    const reported = CRON.indexOf("if (skipped.length) {");
    const counted = CRON.indexOf("await countUsableReadyEpisodes(d, drainSkippedIds)");
    for (const i of [declared, scanStart, assigned, reported, counted]) expect(i).toBeGreaterThan(-1);
    expect(declared).toBeLessThan(scanStart);
    expect(assigned).toBeGreaterThan(scanStart);
    expect(assigned).toBeLessThan(reported);
    expect(counted).toBeGreaterThan(assigned);
    expect(CRON).toContain("hasLiveApproval, skippedByDrain })) usable += 1;");
    expect(CRON).not.toContain("await countUsableReadyEpisodes(d);");
  });
});

describe("paid repair only when it can clear the verdict", () => {
  it("job 2040001's verdict is not clearable: asset-level blocks", () => {
    const p = paidRepairCanClearVerdict(JOB_2040001, { repairAttempts: 0, maxRepairAttempts: 2 });
    expect(p.clearable).toBe(false);
    expect(p.assetLevelBlocks).toBe(3);
    expect(p.blockedBeats).toEqual([1, 2, 4, 5]);
    expect(p.reason).toContain("name no beat");
  });

  it("more blocked beats than attempts left is not clearable", () => {
    const beatsOnly = JOB_2040001.filter((x) => x.beatNumber != null);
    const p = paidRepairCanClearVerdict(beatsOnly, { repairAttempts: 1, maxRepairAttempts: 2 });
    expect(p.clearable).toBe(false);
    expect(p.remainingAttempts).toBe(1);
    expect(p.reason).toContain("beat(s) 1, 2, 4, 5 need 4 regeneration(s); 1 repair attempt(s) remain");
  });

  it("POSITIVE CONTROL: one blocked beat with budget left is clearable", () => {
    const p = paidRepairCanClearVerdict([f("MALFORMED_GEOMETRY", "block", 3), f("LIGHTING_DRIFT", "warn", 3)], { repairAttempts: 0, maxRepairAttempts: 2 });
    expect(p.clearable).toBe(true);
    expect(p.blockedBeats).toEqual([3]);
  });

  it("free-route blocks cost no attempt; an exhausted budget is never clearable", () => {
    const findings = [f("SUBJECT_CONTINUITY", "block", 2), f("CAPTION_OBSTRUCTION", "block", 4)];
    expect(paidRepairCanClearVerdict(findings, { repairAttempts: 1, maxRepairAttempts: 2 }).clearable).toBe(true);
    expect(paidRepairCanClearVerdict(findings, { repairAttempts: 2, maxRepairAttempts: 2 }).clearable).toBe(false);
    expect(paidRepairCanClearVerdict([], { repairAttempts: 0, maxRepairAttempts: 2 }).clearable).toBe(false);
  });

  it("repairs the lowest blocked beat first, never a free-route or beatless finding", () => {
    const listedOutOfOrder = [f("SUBJECT_CONTINUITY", "block", 2), f("MALFORMED_GEOMETRY", "block", 1)];
    expect(pickRepairTarget(listedOutOfOrder)?.beatNumber).toBe(1);
    expect(pickRepairTarget(JOB_2040001)?.beatNumber).toBe(1);
    expect(pickRepairTarget([f("CAPTION_OBSTRUCTION", "block", 1), f("SUBJECT_CONTINUITY", "block", null)])).toBeUndefined();
  });

  it("the cron checks clearability before it spends, and only on the paid gate", () => {
    const guard = CRON.indexOf("paidRepairCanClearVerdict(g.findings, { repairAttempts: g.repairAttempts, maxRepairAttempts: paidRepairCap })");
    const paidOnly = CRON.lastIndexOf('if (g.gate === "needs_paid_repair") {', guard);
    const spend = CRON.indexOf("await requestBeatRepair({", guard);
    const target = CRON.indexOf("const target = pickRepairTarget(g.findings);");
    for (const i of [guard, paidOnly, spend, target]) expect(i).toBeGreaterThan(-1);
    expect(guard - paidOnly).toBeLessThan(200);
    expect(spend).toBeGreaterThan(guard);
    expect(target).toBeGreaterThan(guard);
    expect(CRON).toContain("rebuild or retire it; index not advanced");
  });
});
