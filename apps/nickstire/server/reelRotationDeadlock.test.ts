/**
 * The deadlock that produced the whole unpublishable backlog.
 *
 * `setApprovedPackProgress` — the only writer of the rotation cursor before
 * this change — is called exclusively inside dailyReelPost's successful-publish
 * branch, after "Successfully posted dynamic reel". So the rotation advanced
 * only when a reel actually reached Instagram:
 *
 *   cursor frozen -> tomorrow regenerates the SAME pack's topic -> the new reel
 *   closely duplicates the last attempt -> originality refuses it as a repost
 *   -> nothing publishes -> cursor stays frozen.
 *
 * Measured in production 2026-09-07: the cursor had sat at index 1
 * (`2026-08-16-check-engine-light`) since the last successful post on
 * 2026-08-29, and the held queue is that one topic attempted repeatedly —
 * 1740001, 1770005 and 1830003 are all check-engine / E-Check reels.
 *
 * These tests pin the SOURCE, because the behaviour lives in a cron handler
 * whose runtime path needs a database, a rendered asset and a live Instagram
 * call. Asserting the wiring is what is available; each assertion is bounded to
 * the construct it names so it cannot drift onto unrelated code (a previous
 * test in this repo sliced to end-of-file and passed with the field deleted).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"),
  "utf8",
);

/** The body of a named top-level function, bounded at the next top-level construct. */
function functionBody(name: string): string {
  const start = SRC.indexOf(`async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = SRC.slice(start);
  const end = rest.search(/\n(?:async function |function |export |const |\/\*\*)/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the cursor can now advance without a successful publish", () => {
  it("advancePastRefusedPack exists and writes the rotation index", () => {
    const body = functionBody("advancePastRefusedPack");
    expect(body).toContain("reel_approved_pack_rotation_index");
    expect(body).toContain("String(idx + 1)");
  });

  it("it does NOT stamp the one-post-per-day date — that would spend the day's slot", () => {
    // setApprovedPackProgress writes both keys in one transaction. Skipping a
    // refused pack must move only the index; stamping reel_autopost_last_date
    // here would mark the day as posted for a reel that never posted.
    const body = functionBody("advancePastRefusedPack");
    expect(body).not.toContain("reel_autopost_last_date");
  });

  it("it holds the index when the cursor has moved on — the concurrency guard", () => {
    const body = functionBody("advancePastRefusedPack");
    expect(body).toContain("approvedReelPackAt(idx)?.slug !== slug");
    expect(body).toContain("index held");
  });

  it("a miner- or manifest-sourced job has no rotation to advance", () => {
    const body = functionBody("advancePastRefusedPack");
    expect(body).toContain("if (!slug) return;");
  });

  it("an already-exhausted rotation is left alone — the miner is authority there", () => {
    const body = functionBody("advancePastRefusedPack");
    expect(body).toContain("if (idx === null) return;");
  });
});

describe("it fires on TERMINAL refusals only", () => {
  const CALLS = SRC.split("await advancePastRefusedPack(").slice(1).map((s) => s.slice(0, 80));

  it("is called exactly three times — repost, condemned content, claim audit", () => {
    expect(CALLS).toHaveLength(3);
    const joined = CALLS.join(" | ");
    expect(joined).toContain("repost of");
    expect(joined).toContain("condemned script (content)");
    expect(joined).toContain("claim audit veto");
  });

  /**
   * The canary. A gate that advanced on EVERY hold would silently burn the
   * whole 32-pack rotation in one day over a transient QA failure or while
   * waiting for an operator — and would still pass every assertion above.
   * These two holds must NOT advance, and asserting their absence is the only
   * thing standing between "skips a dead pack" and "skips everything".
   */
  it("does NOT advance while awaiting human approval — that hold is the system working", () => {
    const idx = SRC.indexOf("held: awaiting human approval");
    expect(idx).toBeGreaterThan(-1);
    // Look back over the approval branch only, not the whole file.
    const branch = SRC.slice(Math.max(0, idx - 1400), idx);
    expect(branch).not.toContain("advancePastRefusedPack");
  });

  it("does NOT advance on a rendered-QA hold — auto-repair can still clear it", () => {
    const idx = SRC.indexOf("held by rendered-QA gate");
    expect(idx).toBeGreaterThan(-1);
    const branch = SRC.slice(Math.max(0, idx - 1400), idx);
    expect(branch).not.toContain("advancePastRefusedPack");
  });

  it("the absence assertions are not vacuous — the same window around a terminal refusal DOES contain it", () => {
    // Positive control for the two negatives above: prove the window technique
    // finds the call when it is genuinely there.
    const idx = SRC.indexOf("duplicates ${dupe.label}");
    expect(idx).toBeGreaterThan(-1);
    const branch = SRC.slice(Math.max(0, idx - 1400), idx);
    expect(branch).toContain("advancePastRefusedPack");
  });
});

describe("the success path is unchanged", () => {
  it("still advances via setApprovedPackProgress after a real post", () => {
    expect(SRC).toContain("await setApprovedPackProgress(approvedPackIndex + 1, date)");
    expect(SRC).toContain("Successfully posted dynamic reel");
  });

  it("setApprovedPackProgress still stamps BOTH keys — this change did not touch it", () => {
    const body = functionBody("setApprovedPackProgress");
    expect(body).toContain("reel_approved_pack_rotation_index");
    expect(body).toContain("reel_autopost_last_date");
  });
});
