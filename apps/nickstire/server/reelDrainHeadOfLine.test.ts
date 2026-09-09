/**
 * A permanently-refused APPROVED job jammed the drain for everything behind it.
 *
 * The drain picks the first candidate that passes `reelApprovalProblem` and
 * breaks. The gate chain then runs on that one job and RETURNS from the handler
 * when it refuses — it does not try the next candidate. So an approved job that
 * a downstream gate refuses with a verdict that never changes was re-selected on
 * every pulse (~100/day, measured in cron_log) and nothing else could drain.
 *
 * Live example this was written against: job 1740003 was approved by the
 * operator on 2026-09-07 and is a 0.99 caption repost of a published post. The
 * approval check passed it, originality refused it, the handler returned, and
 * the next pulse selected it again.
 *
 * The fix pre-checks the two PURE, PERMANENT verdicts during selection so a dead
 * candidate is skipped rather than selected. It cannot let anything THROUGH —
 * the gate chain still runs on whatever is selected and remains the authority.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");

/** The drain's candidate-selection loop, bounded to itself. */
function selectionLoop(): string {
  const start = SRC.indexOf("const skipped: Array<{ jobId: number; code: string }> = [];");
  expect(start, "selection loop not found").toBeGreaterThan(-1);
  const rest = SRC.slice(start);
  const end = rest.indexOf("if (skipped.length) {");
  expect(end, "loop end marker not found").toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("the drain skips permanently-refused candidates instead of jamming on them", () => {
  const LOOP = selectionLoop();

  it("pre-checks the condemned-script verdict during selection", () => {
    expect(LOOP).toContain("condemnedContentProblem(");
    expect(LOOP).toContain('code: "condemned_script"');
  });

  it("pre-checks the repost verdict during selection", () => {
    expect(LOOP).toContain("originalityProblem(");
    expect(LOOP).toContain("code: `repost:${cDupe.surface}`");
  });

  it("both use `continue`, so the scan moves to the next candidate", () => {
    // The whole defect was a control-flow one: the old code had no way to
    // reject a candidate after the approval check, so the first approved job
    // won regardless of what came later.
    const afterCondemned = LOOP.slice(LOOP.indexOf('code: "condemned_script"'));
    expect(afterCondemned.slice(0, 80)).toContain("continue;");
    const afterRepost = LOOP.slice(LOOP.indexOf("code: `repost:${cDupe.surface}`"));
    expect(afterRepost.slice(0, 80)).toContain("continue;");
  });

  it("excludes the candidate from its own corpus — a job must not be its own duplicate", () => {
    expect(LOOP).toContain("p.label !== `reel job ${candidate.id}`");
  });

  it("loads the corpus once, and only when there is something to drain", () => {
    expect(LOOP).toContain("candidates.length ? await loadPublishedCorpus() : []");
    // One load for the whole scan, not one per candidate.
    expect(LOOP.split("loadPublishedCorpus()").length - 1).toBe(1);
  });
});

describe("what it must NOT pre-check — the load-bearing half", () => {
  const LOOP = selectionLoop();

  /**
   * REVISED 2026-09-09, and the revision is the point.
   *
   * This test used to assert the loop never mentions evaluateReelPublishGate at
   * all, on the reasoning that "rendered-QA is transient — auto-repair can still
   * clear it". That is true of auto_repair and of a verdict not yet computed. It
   * is FALSE of the gate values that wait on a human: needs_paid_repair parks
   * until an operator authorizes spend, reject and stock_fallback until the reel
   * is regenerated. Nothing clears those on its own, so they read identically on
   * every pulse — which is the exact jam this whole file exists to prevent.
   *
   * Cost of the old belief: on 2026-09-09 job 1890002 came back needs_paid_repair
   * and was re-selected on every pulse; NOTHING posted that day while 29 reels
   * with a clean "approve" verdict sat behind it.
   *
   * So the invariant is no longer "never look at QA" — it is "only skip the
   * values a human has to clear, and read them without running QA".
   */
  it("skips ONLY the parked QA verdicts, never the ones that clear themselves", () => {
    expect(LOOP).toContain("evaluateReelPublishGate");
    expect(LOOP).toContain("PARKED_QA_GATES.has(cGate.gate)");
    // The parked set is exactly the human-blocked three.
    const set = SRC.slice(SRC.indexOf("const PARKED_QA_GATES"));
    const decl = set.slice(0, set.indexOf(";") + 1);
    expect(decl).toContain("needs_paid_repair");
    expect(decl).toContain("reject");
    expect(decl).toContain("stock_fallback");
    // These clear themselves and must NEVER be pre-filtered away.
    expect(decl).not.toContain("auto_repair");
    expect(decl).not.toContain("unavailable");
    expect(decl).not.toContain("needs_review");
  });

  it("reads the verdict WITHOUT running QA — a selection filter cannot spend money", () => {
    // runIfMissing:false is the whole safety property: evaluateReelPublishGate
    // will otherwise CALL runRenderedQaOnJob for a job with no persisted
    // verdict, which is ffmpeg + a vision-model call, per candidate, per pulse.
    expect(LOOP).toContain("runIfMissing: false");
    const call = LOOP.slice(LOOP.indexOf("evaluateReelPublishGate(candidate.id"));
    expect(call.slice(0, 120)).toContain("runIfMissing: false");
  });

  it("a candidate whose gate cannot be READ stays selectable — an unreadable gate is not a verdict", () => {
    // Failing closed HERE would be wrong in a way that is hard to see: it would
    // silently drop every candidate on a transient DB blip. The authoritative
    // chain below already fails closed on the same error.
    const call = LOOP.slice(LOOP.indexOf("evaluateReelPublishGate(candidate.id"));
    expect(call).toContain("parked-QA pre-filter read failed");
    expect(call.slice(0, 700)).not.toMatch(/catch[sS]{0,200}continue;/);
  });

  it("does not pre-check the disclosure gate — that is the chain's call, on the flag it will send", () => {
    expect(LOOP).not.toContain("publishDisclosureProblem");
  });

  it("the absence assertions are not vacuous — the same slice DOES contain the two it should", () => {
    // Positive control. Without this, deleting the whole loop would score green
    // on all three "not.toContain" assertions above.
    expect(LOOP).toContain("condemnedContentProblem(");
    expect(LOOP).toContain("originalityProblem(");
  });
});

describe("the gate chain is still the authority", () => {
  it("still runs its own originality and claim checks after selection", () => {
    // Pre-filtering is an optimisation of WHICH job is selected, never a
    // replacement for the door. Both checks must still exist downstream.
    const afterLoop = SRC.slice(SRC.indexOf("if (skipped.length) {"));
    expect(afterLoop).toContain("originalityProblem(");
    expect(afterLoop).toContain("condemnedContentProblem(");
    expect(afterLoop).toContain("auditPublishBlock(");
  });

  it("still refuses by returning, so nothing publishes on a refusal", () => {
    const afterLoop = SRC.slice(SRC.indexOf("if (skipped.length) {"));
    expect(afterLoop).toContain("index not advanced");
    expect(afterLoop).toContain("rotation advanced");
  });
});
