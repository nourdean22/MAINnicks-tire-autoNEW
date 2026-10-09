/**
 * 2026-10-09 · the Reel lane neither published nor produced.
 *
 * Production read (cron_log, 10:10Z-10:55Z, ET 06:00 production hour):
 *   "production held: usable READY buffer 2 (hold_above_low_watermark)"
 * while every drain pulse logged both READY jobs as skipped:
 *   2040001 qa_parked:needs_paid_repair, 1770004 repost:caption.
 * The READY count re-derived three of the drain's six checks, so it counted two
 * jobs the drain would never publish. Fix: the count reuses the drain's verdict,
 * and trusts only assembled jobs the drain actually evaluated (bounded window).
 *
 * Same day, same job: the paid beat-2 repair of 2040001 (12 credits, 17:27Z on
 * 2026-10-08) could never clear a verdict with blocks on beats 1, 2, 4, 5 and
 * three asset-level blocks. Fix: an autonomous paid repair runs only for a
 * single blocked, executor-repairable beat; targets skip beats the executor
 * would refuse (PR #2940 review).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { decideReadyBuffer, readyCandidateIsUsable } from "@shared/reelQueue";
import { paidRepairCanClearVerdict, pickRepairTarget } from "./services/repairRouter";
import { beatRepairRefusal } from "./services/selectiveRepair";
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

const PAYLOAD = {
  storyboardBeats: [
    { beatNumber: 1, visual: "Extreme macro of a worn tire tread with a copper penny head-down in the groove", source: "real" },
    { beatNumber: 2, visual: "Extreme macro of a deep fresh groove, the copper coin settling between tall rubber walls" },
    { beatNumber: 3, visual: "Extreme macro of the physical subject" },
    { beatNumber: 4, visual: "Tread depth card with three readings", source: "deterministic" },
    { beatNumber: 5, visual: "Macro tracking across one tire from inner shoulder to outer shoulder" },
  ],
  promptPack: [{ beatNumber: 1, prompt: "p1" }, { beatNumber: 2, prompt: "p2" }, { beatNumber: 3, prompt: "p3" }, { beatNumber: 4, prompt: "p4" }],
};

describe("READY count agrees with the drain", () => {
  const approvedAssembled = { status: "assembled", hasAsset: true, hasBlockingError: false, hasLiveApproval: true };

  it("POSITIVE CONTROL: an approved, assembled job the drain evaluated and did not refuse is usable", () => {
    expect(readyCandidateIsUsable(approvedAssembled)).toBe(true);
    expect(readyCandidateIsUsable({ ...approvedAssembled, skippedByDrain: false, evaluatedByDrain: true })).toBe(true);
  });

  it("a job the drain refused this pulse is not usable inventory", () => {
    expect(readyCandidateIsUsable({ ...approvedAssembled, skippedByDrain: true, evaluatedByDrain: true })).toBe(false);
    expect(readyCandidateIsUsable({ status: "assets_ready", hasAsset: true, hasBlockingError: false, hasLiveApproval: false, skippedByDrain: true })).toBe(false);
  });

  it("an assembled job outside the drain's scan window is unproven, not usable", () => {
    expect(readyCandidateIsUsable({ ...approvedAssembled, skippedByDrain: false, evaluatedByDrain: false })).toBe(false);
    // assets_ready rows are never in the drain's scan; the window does not apply to them.
    expect(readyCandidateIsUsable({ status: "assets_ready", hasAsset: true, hasBlockingError: false, hasLiveApproval: false, evaluatedByDrain: false })).toBe(true);
  });

  it("reproduces 2026-10-09: two drain-refused jobs held production before, refill now", () => {
    const rows = [approvedAssembled, approvedAssembled]; // 2040001 + 1770004 as the count saw them
    const before = rows.filter((r) => readyCandidateIsUsable(r)).length;
    const after = rows.filter((r) => readyCandidateIsUsable({ ...r, skippedByDrain: true, evaluatedByDrain: true })).length;
    expect(decideReadyBuffer(before, 3, 1)).toBe("hold_above_low_watermark");
    expect(decideReadyBuffer(after, 3, 1)).toBe("refill");
  });

  it("27 approved jobs, the drain scans 25 and refuses them all: the 2 beyond the window do not hold production", () => {
    const rows = Array.from({ length: 27 }, (_, i) => ({ ...approvedAssembled, skippedByDrain: i < 25, evaluatedByDrain: i < 25 }));
    expect(decideReadyBuffer(rows.filter((r) => readyCandidateIsUsable(r)).length, 3, 1)).toBe("refill");
  });

  it("the cron hands the drain's refusals and scan window to the count, after the drain has scanned", () => {
    const declared = CRON.indexOf("let drainSkippedIds: ReadonlySet<number> = new Set();");
    const declaredEval = CRON.indexOf("let drainEvaluatedIds: ReadonlySet<number> = new Set();");
    const scanStart = CRON.indexOf("const skipped: Array<{ jobId: number; code: string }> = [];");
    const assigned = CRON.indexOf("drainSkippedIds = new Set(skipped.map((s) => s.jobId));");
    const assignedEval = CRON.indexOf("drainEvaluatedIds = new Set(candidates.map(");
    const reported = CRON.indexOf("if (skipped.length) {");
    const counted = CRON.indexOf("await countUsableReadyEpisodes(d, drainSkippedIds, drainEvaluatedIds)");
    for (const i of [declared, declaredEval, scanStart, assigned, assignedEval, reported, counted]) expect(i).toBeGreaterThan(-1);
    expect(declared).toBeLessThan(scanStart);
    expect(declaredEval).toBeLessThan(scanStart);
    expect(assigned).toBeGreaterThan(scanStart);
    expect(assignedEval).toBeGreaterThan(scanStart);
    expect(assigned).toBeLessThan(reported);
    expect(counted).toBeGreaterThan(assigned);
    expect(CRON).toContain("hasLiveApproval, skippedByDrain, evaluatedByDrain })) usable += 1;");
    expect(CRON).not.toContain("await countUsableReadyEpisodes(d);");
  });
});

describe("the executor's per-beat rule, shared with the cron", () => {
  it("POSITIVE CONTROL: a generated beat with a prompt is repairable", () => {
    expect(beatRepairRefusal(PAYLOAD, 2, 9)).toBeNull();
  });

  it("refuses real, deterministic, placeholder, prompt-less and missing beats with the executor's own words", () => {
    expect(beatRepairRefusal(PAYLOAD, 1, 9)).toBe("beat 1 of job 9 is declared real — a provider never regenerates it");
    expect(beatRepairRefusal(PAYLOAD, 4, 9)).toBe("beat 4 of job 9 is declared deterministic — a provider never regenerates it");
    expect(beatRepairRefusal(PAYLOAD, 3, 9)).toBe("beat 3 of job 9 names no object (a placeholder visual) — a provider never regenerates it");
    expect(beatRepairRefusal(PAYLOAD, 5, 9)).toBe("no prompt for beat 5 in job 9");
    expect(beatRepairRefusal(PAYLOAD, 7, 9)).toBe("beat 7 not in job 9");
    expect(beatRepairRefusal(null, 1, 9)).toBe("beat 1 not in job 9");
  });
});

describe("autonomous paid repair only when one repair can clear the verdict", () => {
  const repairable = (beat: number) => beatRepairRefusal(PAYLOAD, beat, 9) === null;

  it("job 2040001's verdict is not clearable: asset-level blocks", () => {
    const p = paidRepairCanClearVerdict(JOB_2040001, { repairAttempts: 0, maxRepairAttempts: 2 });
    expect(p.clearable).toBe(false);
    expect(p.assetLevelBlocks).toBe(3);
    expect(p.blockedBeats).toEqual([1, 2, 4, 5]);
    expect(p.reason).toContain("name no beat");
  });

  it("more than one blocked beat is not clearable, even when the budget would cover it", () => {
    const two = [f("SUBJECT_CONTINUITY", "block", 2), f("MALFORMED_GEOMETRY", "block", 5)];
    const p = paidRepairCanClearVerdict(two, { repairAttempts: 0, maxRepairAttempts: 2 });
    expect(p.clearable).toBe(false);
    expect(p.reason).toBe("blocks on beats 2, 5 need 2 repairs; one autonomous repair cannot clear them");
  });

  it("POSITIVE CONTROL: one blocked, repairable beat with budget left is clearable", () => {
    const p = paidRepairCanClearVerdict([f("MALFORMED_GEOMETRY", "block", 2), f("LIGHTING_DRIFT", "warn", 2)], { repairAttempts: 0, maxRepairAttempts: 2 }, {}, repairable);
    expect(p.clearable).toBe(true);
    expect(p.blockedBeats).toEqual([2]);
  });

  it("a single blocked beat the executor would refuse is not clearable", () => {
    const p = paidRepairCanClearVerdict([f("MALFORMED_GEOMETRY", "block", 1)], { repairAttempts: 0, maxRepairAttempts: 2 }, {}, repairable);
    expect(p.clearable).toBe(false);
    expect(p.reason).toBe("beat 1 cannot be regenerated by a provider");
  });

  it("free-route blocks cost no attempt; an exhausted budget or an empty verdict is never clearable", () => {
    const findings = [f("SUBJECT_CONTINUITY", "block", 2), f("CAPTION_OBSTRUCTION", "block", 4)];
    expect(paidRepairCanClearVerdict(findings, { repairAttempts: 1, maxRepairAttempts: 2 }).clearable).toBe(true);
    expect(paidRepairCanClearVerdict(findings, { repairAttempts: 2, maxRepairAttempts: 2 }).clearable).toBe(false);
    expect(paidRepairCanClearVerdict([], { repairAttempts: 0, maxRepairAttempts: 2 }).clearable).toBe(false);
  });

  it("repairs the lowest repairable blocked beat first, never a refused, free-route or beatless finding", () => {
    const listedOutOfOrder = [f("SUBJECT_CONTINUITY", "block", 5), f("MALFORMED_GEOMETRY", "block", 2)];
    expect(pickRepairTarget(listedOutOfOrder)?.beatNumber).toBe(2);
    // beat 1 is declared real: the executor would refuse it, so beat 2 is chosen.
    expect(pickRepairTarget(JOB_2040001, {}, repairable)?.beatNumber).toBe(2);
    expect(pickRepairTarget([f("CAPTION_OBSTRUCTION", "block", 1), f("SUBJECT_CONTINUITY", "block", null)])).toBeUndefined();
    expect(pickRepairTarget([f("MALFORMED_GEOMETRY", "block", 1)], {}, repairable)).toBeUndefined();
  });

  it("the cron uses the executor's rule for the target and the clearability check, before it spends, on the paid gate only", () => {
    const rule = CRON.indexOf("const isRepairable = (beat: number) => beatRepairRefusal(parseReelJobPayload(job.payload), beat, job.id) === null;");
    const guard = CRON.indexOf("paidRepairCanClearVerdict(g.findings, { repairAttempts: g.repairAttempts, maxRepairAttempts: paidRepairCap }, {}, isRepairable)");
    const paidOnly = CRON.lastIndexOf('if (g.gate === "needs_paid_repair") {', guard);
    const spend = CRON.indexOf("await requestBeatRepair({", guard);
    const target = CRON.indexOf("const target = pickRepairTarget(g.findings, {}, isRepairable);");
    for (const i of [rule, guard, paidOnly, spend, target]) expect(i).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(guard);
    expect(guard - paidOnly).toBeLessThan(200);
    expect(spend).toBeGreaterThan(guard);
    expect(target).toBeGreaterThan(guard);
    expect(CRON).toContain("rebuild or retire it; index not advanced");
  });
});
