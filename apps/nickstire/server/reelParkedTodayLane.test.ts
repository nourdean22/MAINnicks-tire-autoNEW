/**
 * A parked today's job must not hold the daily lane (2026-10-13).
 *
 * Before this change, a today's job parked on needs_paid_repair / reject /
 * stock_fallback made runDailyReelPost RETURN from the today's-job branch, so
 * no approved pack was ever selected again for the rest of the ET day. The
 * parked job stays parked (no repair is started here); the lane moves on to the
 * next approved pack through the enqueue branch, which already advances the
 * rotation past a pack whose episode already has a job (dedupe path). With no
 * approved pack in rotation, the day still holds, and the miner lane never runs
 * on top of a parked job.
 *
 * Source-contract assertions bounded to the two blocks they describe, with
 * positive controls so a moved anchor fails loudly instead of passing vacuously.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");

/** The today's-job branch, bounded to itself (ends where the enqueue branch starts). */
function todaysJobBranch(): string {
  const start = CRON.indexOf("if (!job && todaysJob) {");
  expect(start, "today's-job branch not found — anchor moved").toBeGreaterThan(-1);
  const end = CRON.indexOf("if (!job) {", start);
  expect(end, "enqueue branch not found after today's-job branch").toBeGreaterThan(start);
  return CRON.slice(start, end);
}

/** From the approved-pack selection to the ready-buffer gate: the enqueue head. */
function enqueueHead(): string {
  const start = CRON.indexOf('const approvedPackCursor = await getKv("reel_approved_pack_rotation_index");');
  expect(start, "approved-pack selection not found — anchor moved").toBeGreaterThan(-1);
  const end = CRON.indexOf("const usableReadyCount", start);
  expect(end, "ready-buffer gate not found after pack selection").toBeGreaterThan(start);
  return CRON.slice(start, end);
}

describe("a parked today's job no longer ends the lane", () => {
  it("the parked branch does NOT return — the run continues into the enqueue branch", () => {
    const branch = todaysJobBranch();
    // CONTROL: the branch is the real parked-QA check, not an empty stub.
    expect(branch).toContain("evaluateReelPublishGate(todaysJob.id");
    expect(branch).toContain("PARKED_QA_GATES.has(g.gate)");
    // THE FIX: the old `return { ... details: "...index not advanced" }` is gone.
    expect(branch).not.toContain("return {");
  });

  it("the parked job is recorded so the enqueue branch can tell a parked day apart", () => {
    const branch = todaysJobBranch();
    expect(branch).toContain("parkedToday = { jobId: Number(todaysJob.id), gate: parked };");
    // A parked today's job is never handed to the publish path as today's job.
    expect(branch).toContain("} else {");
    expect(branch).toContain("job = todaysJob;");
  });

  it("with no approved pack in rotation, a parked day still holds (the miner lane never runs on it)", () => {
    const head = enqueueHead();
    // CONTROL: the enqueue head is the real pack selection, not a stub.
    expect(head).toContain("resolveApprovedPackSelection(approvedPackIndex, activeSlate)");
    expect(head).toContain("const approvedPack = packSelection.pack;");
    const guardAt = head.indexOf("if (parkedToday && !approvedPack) {");
    expect(guardAt, "miner-lane guard on a parked day is missing").toBeGreaterThan(-1);
    expect(head.slice(guardAt, guardAt + 400)).toContain("return { recordsProcessed: 0");
  });

  it("the approved-pack path still moves past a pack whose episode already has a job", () => {
    // Unchanged mechanism, asserted so the parked fix cannot quietly rely on
    // something removed: a deduped pack advances the cursor and retries.
    const dedupe = CRON.slice(CRON.indexOf("if (deduped && approvedPack) {"));
    expect(dedupe.slice(0, 900)).toContain("advanceRotationPastRefusedPack({");
    expect(dedupe.slice(0, 1400)).toContain("packAlreadyQueued: true as const");
  });
});
