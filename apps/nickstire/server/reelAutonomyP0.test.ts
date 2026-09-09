/**
 * Three defects an adversarial audit found on 2026-09-09, two of them in code
 * shipped that same day. All three are on paths that spend money or publish.
 *
 * 1 · AMBIGUOUS DISPATCH WAS TREATED AS FAILURE. metaSocial returns
 *     { success:false, ambiguous:true } when media_publish was sent and nothing
 *     came back ("the reel may be LIVE"). The autonomous door read only
 *     !ig.success, recorded FAILED, and reset the row to `assembled` — which the
 *     next pulse republishes. Instagram exposes NO idempotency key, NO request
 *     id and NO "already published" error code (verified against Meta's error
 *     reference, 2026-09-09), so the platform cannot dedupe the retry. Every
 *     other publish surface already parked it.
 *
 * 2 · THE RESUME RE-BOUGHT WORK IT MIGHT ALREADY OWN. resumeTimedOutReelJobs
 *     never read the stamped error class, so LOCAL_TIMEOUT_REMOTE_UNKNOWN —
 *     marked { action: "RECONCILE_BEFORE_RETRY", mayDoubleSpend: true } in the
 *     repo's own table — was auto-requeued.
 *
 * 3 · THE CRON SPENT AS AN OPERATOR. requestBeatRepair hardcoded
 *     { type: "operator" } at enforceAtBoundary, where an operator's tap is
 *     self-approval and an unreachable policy store proceeds LOUD instead of
 *     failing closed. When the cron began paying for repairs on its own it
 *     inherited both.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
const REPAIR = readFileSync(path.join(__dirname, "services", "selectiveRepair.ts"), "utf8");
const PIPELINE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");
const ERRORS = readFileSync(path.join(__dirname, "..", "shared", "providerErrors.ts"), "utf8");

describe("1 · an ambiguous publish is parked, never retried", () => {
  it("branches on ig.ambiguous BEFORE the generic failure branch", () => {
    const amb = CRON.indexOf("if (!ig?.success && ig?.ambiguous)");
    const fail = CRON.indexOf("if (!ig?.success) {", CRON.indexOf("const ig = outcome.results"));
    expect(amb, "ambiguous branch missing").toBeGreaterThan(-1);
    expect(fail).toBeGreaterThan(-1);
    expect(amb, "ambiguous must be checked first, or the failure branch swallows it").toBeLessThan(fail);
  });

  it("parks it in publish_ambiguous and NEVER back to assembled", () => {
    const block = CRON.slice(CRON.indexOf("if (!ig?.success && ig?.ambiguous)"));
    const body = block.slice(0, block.indexOf("await recordPublishOutcome(attemptId, ig?.success"));
    expect(body).toContain('status: "publish_ambiguous"');
    expect(body).not.toContain('status: "assembled"');
    expect(body).toContain("OUTCOME.ambiguous");
    // It must return, so nothing downstream can publish or advance the rotation.
    expect(body).toContain("return {");
  });

  it("PLANTED CANARY: the pre-fix shape would fail the ordering pin", () => {
    const old = CRON.replace("if (!ig?.success && ig?.ambiguous)", "if (false && ig?.ambiguous)");
    expect(old.indexOf("if (!ig?.success && ig?.ambiguous)")).toBe(-1);
  });

  it("the source of the flag still exists — this pin is not guarding a dead field", () => {
    const META = readFileSync(path.join(__dirname, "services", "metaSocial.ts"), "utf8");
    expect(META).toContain("ambiguous: true");
  });
});

describe("2 · a job whose remote state is unknown is quarantined, not re-bought", () => {
  it("the resume reads the STAMPED class and skips anything that may double-spend", () => {
    const fn = PIPELINE.slice(PIPELINE.indexOf("export async function resumeTimedOutReelJobs"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).toContain("parseErrorClass(job.error)");
    expect(body).toContain("policyForErrorClass(cls).mayDoubleSpend");
    expect(body).toContain("reconcile_first:");
  });

  it("the class it must refuse is still marked mayDoubleSpend in the policy table", () => {
    // If someone flips this to false, the guard above silently stops guarding.
    const row = ERRORS.slice(ERRORS.indexOf("LOCAL_TIMEOUT_REMOTE_UNKNOWN:"));
    expect(row.slice(0, 140)).toContain("mayDoubleSpend: true");
    expect(row.slice(0, 140)).toContain('action: "RECONCILE_BEFORE_RETRY"');
  });

  it("the class WITH a handle is not quarantined — resumable work must still resume", () => {
    const row = ERRORS.slice(ERRORS.indexOf("LOCAL_TIMEOUT_REMOTE_RUNNING:"));
    expect(row.slice(0, 140)).toContain("mayDoubleSpend: false");
  });

  it("policyForErrorClass is exported, so the stamp alone is enough to decide", () => {
    expect(ERRORS).toContain("export function policyForErrorClass");
  });
});

describe("3 · the cron spends as itself, not as a human", () => {
  it("requestBeatRepair accepts an actor and uses it at the boundary", () => {
    expect(REPAIR).toContain("actor?: BoundaryActorContext");
    expect(REPAIR).toContain('input.actor ?? { type: "operator", id: `repair_request_job_${input.jobId}` }');
  });

  it("the autonomous caller passes type cron", () => {
    const call = CRON.slice(CRON.indexOf("await requestBeatRepair({"));
    expect(call.slice(0, 300)).toContain('actor: { type: "cron"');
  });

  it("PLANTED CANARY: the hardcoded operator literal is gone from the boundary call", () => {
    // The default remains for the admin button, but it must be a DEFAULT, not
    // the only value the boundary can ever see.
    const boundary = REPAIR.slice(REPAIR.indexOf("await enforceAtBoundary("));
    const args = boundary.slice(0, boundary.indexOf("payload.genomeId"));
    expect(args).toContain("input.actor ??");
  });

  it("the boundary still treats operator and cron differently — the fix is meaningful", () => {
    const CONTROL = readFileSync(path.join(__dirname, "services", "autonomyControl.ts"), "utf8");
    expect(CONTROL).toContain("APPROVED_BY_OPERATOR");
    expect(CONTROL).toMatch(/cron\/autonomous (actors are\s*\n?\s*\*\s*)?BLOCKED|cron\/autonomous paths FAIL CLOSED/);
  });
});
