/**
 * The recovery ledger's contract: an honest gap is the product.
 *
 * The failure this guards against is not a wrong number — it is a session
 * concluding "nothing was paid for" from an ABSENCE of evidence, and then
 * spending again. Every field here is either read from a row or named as
 * UNKNOWN, and the module must never close a gap by inference.
 *
 * The provider-op retention is asserted against the pipeline source, because it
 * is the fix that makes the ledger possible at all: the paid handle used to be
 * deleted on the happy path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const pipeline = read("server/services/reelPipeline.ts");
const ledger = read("server/services/reelRecoveryLedger.ts");

describe("the paid handle survives its own success", () => {
  it("records history BEFORE deleting the active higgsfield handle, on success", () => {
    const idx = pipeline.indexOf('recordProviderOp(beat, "higgsfield", beat.higgsfieldRequestId, "succeeded")');
    const del = pipeline.indexOf("delete beat.higgsfieldRequestId", idx);
    expect(idx).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(idx); // order is the whole point
  });

  it("records history before deleting it on a terminal remote failure", () => {
    const idx = pipeline.indexOf('recordProviderOp(beat, "higgsfield", beat.higgsfieldRequestId, "failed")');
    const del = pipeline.indexOf("delete beat.higgsfieldRequestId", idx);
    expect(idx).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(idx);
  });

  it("records an ABANDONED veo op before resubmitting, so two paid ops are not one", () => {
    const idx = pipeline.indexOf('recordProviderOp(beat, "veo", opName, "abandoned")');
    expect(idx).toBeGreaterThan(-1);
    // The resubmit clears opName immediately after; without the record above,
    // the first submission would vanish and the job would look half as expensive.
    expect(pipeline.slice(idx, idx + 200)).toMatch(/opName = undefined/);
  });

  it("persists the payload when a veo op succeeds, or the history is lost on restart", () => {
    // The veo success path wrote only clipUrlsJson; beat.providerOps lives in
    // `payload`, so it had to start being written too.
    const idx = pipeline.indexOf('recordProviderOp(beat, "veo", opName, "succeeded")');
    expect(pipeline.slice(idx, idx + 400)).toMatch(/payload: JSON\.stringify\(brief\)/);
  });

  it("history is append-only and bounded, so a retry loop cannot grow the payload without limit", () => {
    expect(pipeline).toMatch(/if \(beat\.providerOps\.length >= 50\) return;/);
  });

  it("bookkeeping never fails a clip — a bad id is skipped, not thrown", () => {
    // Scoped to the function BODY: a fixed character window runs past the
    // closing brace into unrelated code that legitimately throws, which is how
    // the first version of this assertion failed on its neighbour.
    const start = pipeline.indexOf("function recordProviderOp");
    const body = pipeline.slice(start, pipeline.indexOf("\n}", start) + 2);
    expect(body).toMatch(/if \(typeof opId !== "string" \|\| !opId\.trim\(\)\) return;/);
    expect(body).toMatch(/beat\.providerOps\.push\(/); // sanity: this is the right function
    expect(body).not.toMatch(/throw /);
  });

  it("does NOT change resume semantics — nothing reads providerOps to decide a resubmit", () => {
    // The active handles are what gate a resubmit. If providerOps ever gained
    // that role, a completed op would start suppressing legitimate work.
    // Anchored INSIDE renderHiggsfieldBeat with a from-index: the old end anchor
    // (`clipUrls[i] = finalClipUrl;`) first occurs in the template_stock branch,
    // BEFORE the resume area, so the slice was empty and the pin vacuous.
    const resumeStart = pipeline.indexOf("const { higgsfieldRequestId } = beat;");
    const resumeEnd = pipeline.indexOf('recordProviderOp(beat, "higgsfield", beat.higgsfieldRequestId, "succeeded")', resumeStart);
    expect(resumeStart).toBeGreaterThan(-1);
    expect(resumeEnd).toBeGreaterThan(resumeStart);
    const resumeArea = pipeline.slice(resumeStart, resumeEnd);
    expect(resumeArea).toContain("pollHiggsfieldCliJob"); // sanity: this IS the resume area
    expect(resumeArea.replace(/recordProviderOp\([^)]*\)/g, "")).not.toMatch(/providerOps/);
  });
});

describe("the ledger reports gaps instead of closing them", () => {
  it("is read-only: it never publishes, spends, or calls a provider", () => {
    expect(ledger).not.toMatch(/publishToSocial|generateReelClipVideo|submitVeoRequest|storagePut/);
  });

  it("flags an outstanding op as possibly still live", () => {
    expect(ledger).toMatch(/stillOutstanding: true/);
    expect(ledger).toMatch(/outstandingOps/);
  });

  it("refuses to read 'no op recorded' as 'nothing was paid for'", () => {
    expect(ledger).toMatch(/NOT evidence that nothing was paid for/);
  });

  it("states that clip reachability was not probed rather than implying clips survive", () => {
    expect(ledger).toMatch(/clip reachability NOT probed/);
  });

  it("labels cost as an estimate and explains why there is only one row per job", () => {
    expect(ledger).toMatch(/isEstimate: true/);
    expect(ledger).toMatch(/UNIQUE per job/);
    expect(ledger).toMatch(/no USD feed/);
  });

  it("returns a discriminated union, so an unreadable ledger has no entries to misread", () => {
    expect(ledger).toMatch(/\{ available: false; reason: string \}/);
    expect(ledger).toMatch(/return \{ available: false, reason: "Database not available" \}/);
  });

  it("is bounded — an unbounded scan over a MEDIUMTEXT payload is a way to hurt the database", () => {
    expect(ledger).toMatch(/Math\.min\(Math\.max\(opts\?\.limit \?\? 50, 1\), 200\)/);
  });
});
