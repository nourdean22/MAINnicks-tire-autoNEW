/**
 * A job parked earlier in a pulse is not re-selected by the rest of that pulse (F4).
 *
 * The drain (runDailyReelPost) keeps one set per pulse. When a pass parks a reel,
 * it records the reel and runs the pass again. The candidate loop then skips that
 * reel before any caption, originality or gate work, so a clean reel behind it is
 * examined in the same pulse instead of being blocked by a re-park. A repeated park
 * returns rather than looping.
 *
 * Source-contract assertions, bounded to the drain and to the candidate loop with
 * sliceBlock (a moved anchor fails loud), each with a positive control. Driving the
 * skip end to end needs the whole gate chain mocked, so these pin the structure the
 * behavior depends on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sliceBlock } from "./testUtils/sourceBlock";

const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");

const SKIP = "if (parkedThisPulse.has(Number(candidate.id))) {";

/** The drain: from its declaration up to the single-pass function it calls. */
function drain(): string {
  return sliceBlock(
    CRON,
    "export async function runDailyReelPost(): Promise<DailyReelResult> {",
    "\nasync function runDailyReelPostOnce(",
    { label: "dailyReelPost.ts" },
  );
}

/** The candidate loop, from its head up to the first caption read, which comes after the skip. */
function candidateLoopHead(): string {
  return sliceBlock(CRON, "for (const candidate of candidates) {", "const caption = typeof candidate.caption", {
    label: "dailyReelPost.ts",
  });
}

describe("a job parked earlier in a pulse is skipped by the rest of that pulse", () => {
  it("one parked-set per pulse, declared above the drain loop and shared by every pass", () => {
    const body = drain();
    const setAt = body.indexOf("const parkedThisPulse = new Set<number>();");
    const loopAt = body.indexOf("for (;;) {");
    expect(setAt, "per-pulse set not found, anchor moved").toBeGreaterThan(-1);
    expect(loopAt, "drain loop not found, anchor moved").toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(loopAt);
    expect(body.indexOf("const parkedThisPulse = new Set<number>();", setAt + 1)).toBe(-1);
    expect(body).toContain("await runDailyReelPostOnce(parkedThisPulse);");
  });

  it("a park is recorded in that set before the pass runs again", () => {
    const body = drain();
    // CONTROL: the branch is the real park check, keyed on the id the pass returns.
    expect(body).toContain("if (parkedJobId !== undefined) {");
    const addAt = body.indexOf("parkedThisPulse.add(parkedJobId);");
    expect(addAt, "record-the-park line missing, anchor moved").toBeGreaterThan(-1);
    expect(body.indexOf("continue;", addAt)).toBeGreaterThan(addAt);
  });

  it("a repeated park returns instead of looping, and the scan window bounds the pulse", () => {
    expect(drain()).toContain(
      "if (parkedThisPulse.has(parkedJobId) || parkedThisPulse.size >= DRAIN_SCAN_LIMIT) return result;",
    );
  });

  it("the candidate loop skips a parked reel before caption, originality or gate work", () => {
    const head = candidateLoopHead();
    expect(head).toContain(SKIP);
    expect(head).toContain('skipped.push({ jobId: candidate.id, code: "parked_this_pulse" });');
    // The skip must end the iteration. Without this continue, a parked reel falls through to the gates.
    expect(head).toContain("continue;");
    // CONTROL: the gate calls the skip must precede really are later in the file, so the ordering is not vacuous.
    const skipAt = CRON.indexOf(SKIP);
    expect(skipAt, "skip not found in the file, anchor moved").toBeGreaterThan(-1);
    expect(CRON.indexOf("originalityProblem(")).toBeGreaterThan(skipAt);
    expect(CRON.indexOf("evaluateReelPublishGate(candidate.id")).toBeGreaterThan(skipAt);
  });

  it("CONTROL: the park verdict hands the drain the job id it records", () => {
    expect(CRON).toContain("parkedJobId: job.id };");
  });
});
