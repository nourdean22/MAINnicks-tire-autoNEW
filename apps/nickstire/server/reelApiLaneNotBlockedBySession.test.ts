/**
 * A dead browser session must not block the key-based API lane.
 *
 * REVIEW P1 ON #2170, and it made the documented remedy inert.
 * `processNextReelJob` aborted before claiming a job whenever the selected
 * provider was `higgsfield` and `higgsfieldSessionHealth()` said the CLI
 * session was dead. But `higgsfieldStudio.generateReelClipVideo` PREFERS the
 * Cloud API whenever `getHiggsfieldApiCredentials()` resolves — its own comment
 * reads "PURCHASED, setting the two env vars switches lanes with no caller
 * change."
 *
 * So in the exact configuration the API lane exists to rescue — API credentials
 * set, browser session expired — generation still refused to start, and the
 * abort reason talked about a session the render was never going to use.
 * Buying Cloud API credits would have unblocked nothing.
 *
 * The session check now gates the SESSION lane only. A dead session is
 * disqualifying only when the session is the sole lane available.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");

/** The higgsfield session preflight block, bounded to itself. */
function preflight(): string {
  const i = SRC.indexOf('if (preflightProvider === "higgsfield")');
  expect(i, "preflight block not found").toBeGreaterThan(-1);
  const rest = SRC.slice(i);
  // Bound at the db handle acquisition that follows it.
  const end = rest.indexOf('const { getDb }');
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("the API lane is not gated on the CLI session", () => {
  it("resolves the API credentials before deciding", () => {
    expect(preflight()).toContain("getHiggsfieldApiCredentials");
  });

  it("skips the session probe when the API lane is configured", () => {
    const p = preflight();
    expect(p).toContain("apiLaneConfigured");
    // The session probe must be CONDITIONAL. An unconditional
    // higgsfieldSessionHealth() call is the whole defect.
    expect(p).toMatch(/apiLaneConfigured\s*\?[\s\S]*?:\s*await higgsfieldSessionHealth\(\)/);
  });

  it("says so, rather than skipping silently", () => {
    expect(preflight()).toContain("CLI session health is not disqualifying");
  });
});

describe("what must NOT change", () => {
  /**
   * The load-bearing half. This preflight exists because a dead session used to
   * burn an attempt per pulse; removing it outright would restore that. It must
   * still abort when the session lane is the only one available.
   */
  it("still aborts on a dead session when the API lane is NOT configured", () => {
    const p = preflight();
    expect(p).toContain("health.healthy === false");
    expect(p).toContain("aborting the batch before claiming a job");
    // `healthy === false` only — null means not-knowable and must never block a
    // working provider on a blind spot. That distinction predates this change
    // and must survive it.
    expect(p).not.toMatch(/if\s*\(\s*!\s*health\.healthy\s*\)/);
  });

  it("still runs BEFORE the job is claimed, so a dead lane costs no attempt", () => {
    // Anchor on the CLAIM QUERY, not on the first mention of scopeJobId — that
    // string first appears in a doc comment 570 lines earlier, so anchoring on
    // it asserted the opposite of the intent and failed for a reason unrelated
    // to its subject.
    const i = SRC.indexOf('if (preflightProvider === "higgsfield")');
    const claim = SRC.indexOf("const where = scopeJobId");
    expect(i).toBeGreaterThan(-1);
    expect(claim, "claim query not found").toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(i);
  });

  it("the negative assertion is not vacuous — the guarded form IS present", () => {
    // Positive control for the `not.toMatch` above.
    expect(preflight()).toMatch(/health\.healthy === false/);
  });
});
