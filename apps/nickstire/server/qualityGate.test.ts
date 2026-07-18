/**
 * evaluateReelPublishGate — the consolidated reel publish gate.
 *
 * CORE RULE under test: only a COMPLETED, CURRENT, COMPLETE evaluation may
 * authorize a publish. A critic outage, a stale-after-repair verdict, or
 * incomplete evidence must HOLD — absence of evidence is not evidence of
 * quality (audit: skipped-critic-as-approval).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let jobRow: { id: number; payload: string } | null = null;
/** How many reel jobs the provider-health probe should see as recently failed. */
let recentFailures = 0;
vi.mock("./db", () => ({
  getDb: async () => ({
    // Two shapes share this chain: the job lookup ends in .limit(), the
    // provider-health count is awaited straight off .where(). The thenable lets
    // one fake serve both without the count query silently no-op'ing (which is
    // what made the first version of these tests pass while covering nothing).
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (jobRow ? [jobRow] : []),
          then: (resolve: (v: unknown) => unknown) => resolve([{ n: recentFailures }]),
        }),
      }),
    }),
  }),
}));
vi.mock("./services/autonomyControl", () => ({
  getActivePolicy: async () => ({ limits: { maxRepairAttemptsPerAsset: 2 } }),
}));

import { evaluateReelPublishGate } from "./services/qualityGate";

const completed = (findings: unknown[], extra: Record<string, unknown> = {}) => ({
  decision: findings.length ? "repair" : "approve",
  findings, framesEvaluated: 8, evaluatedAt: "", critic: "vision", qaState: "completed", droppedUnknownCodes: 0, ...extra,
});
const block = { beatNumber: 1, code: "GENERATED_TEXT_ARTIFACT", severity: "block", description: "x", preserve: [], change: [] };
// Audio is now a REQUIRED evidence source (it was silently defaulting to pass),
// so the default fixture carries a completed audio verdict. Its absence is tested
// explicitly below rather than being the accidental baseline.
const audioOk = { decision: "approve", qaState: "completed" };
const setJob = (renderedQa: unknown, rest: Record<string, unknown> = {}) => {
  jobRow = { id: 1, payload: JSON.stringify({ renderedQa, audioQa: audioOk, ...rest }) };
};

describe("evaluateReelPublishGate", () => {
  beforeEach(() => { jobRow = null; recentFailures = 0; process.env.RENDERED_QA_ENABLED = "true"; delete process.env.AUDIO_QA_ENABLED; });

  it("proceeds on a clean COMPLETED verdict", async () => {
    setJob(completed([]));
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(true);
    expect(g.gate).toBe("proceed");
  });

  it("HOLDS a skipped critic — an approve-shaped NON-evaluation is not an approval", async () => {
    // exactly what evaluateRenderedReel persists on a vision-provider outage
    setJob({ decision: "approve", findings: [], framesEvaluated: 8, evaluatedAt: "", critic: "skipped", qaState: "unavailable" });
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/did not evaluate/i);
  });

  it("HOLDS a legacy skipped verdict that predates qaState (critic field still catches it)", async () => {
    setJob({ decision: "approve", findings: [], framesEvaluated: 8, evaluatedAt: "", critic: "skipped" });
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
  });

  it("HOLDS a verdict marked stale after a repair re-render", async () => {
    setJob(completed([], { staleAfterRepair: true }));
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("stale");
  });

  it("HOLDS when unknown defect codes were dropped (incomplete evidence)", async () => {
    setJob(completed([], { droppedUnknownCodes: 1 }));
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("needs_review");
  });

  it("HOLDS when the critic said repair but no findings were classifiable", async () => {
    setJob({ ...completed([]), decision: "repair" });
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("needs_review");
  });

  it("HOLDS a rendered block finding (needs_paid_repair)", async () => {
    setJob(completed([block]));
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("needs_paid_repair");
  });

  it("REJECTS once the repair cap is reached (real repairQueue count)", async () => {
    setJob(completed([block]), { repairQueue: [{}, {}] });
    const g = await evaluateReelPublishGate(1);
    expect(g.repairAttempts).toBe(2);
    expect(g.gate).toBe("reject");
    expect(g.allowed).toBe(false);
  });

  it("HOLDS when the job is missing — no evidence is not permission", async () => {
    jobRow = null;
    const g = await evaluateReelPublishGate(999);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
  });

  it("allows only when rendered QA is EXPLICITLY disabled (operator policy, not a failure)", async () => {
    process.env.RENDERED_QA_ENABLED = "false";
    jobRow = null;
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(true);
    expect(g.gate).toBe("disabled");
    expect(g.source).toBe("disabled");
  });

  // The two safety branches decideAutomation has always had and no caller ever
  // armed — they were unreachable code until the gate started passing them.
  it("PAUSES when a completed verdict judged ZERO frames (evidence-shaped, empty)", async () => {
    setJob({ ...completed([]), framesEvaluated: 0 });
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/evidence/i);
  });

  it("PAUSES a PAID repair while the generation provider is failing", async () => {
    recentFailures = 5; // 5 reel jobs failed in the last hour
    setJob(completed([block]));
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/provider/i);
  });

  it("still queues the paid repair when the provider is healthy", async () => {
    recentFailures = 0;
    setJob(completed([block]));
    const g = await evaluateReelPublishGate(1);
    expect(g.gate).toBe("needs_paid_repair");
  });

  // AUDIO — production proved payload.audioQa has never existed on any job, so the
  // old ternary made "never ran" indistinguishable from "passed".
  it("HOLDS when audio QA is ABSENT — a stage that never ran is not a pass", async () => {
    jobRow = { id: 1, payload: JSON.stringify({ renderedQa: completed([]) }) }; // no audioQa key at all
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/audio/i);
  });

  it("HOLDS when audio QA ran but did not complete", async () => {
    setJob(completed([]), { audioQa: { decision: "approve", qaState: "unavailable" } });
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
  });

  it("HOLDS when audio QA asks for a repair", async () => {
    setJob(completed([]), { audioQa: { decision: "repair", qaState: "completed" } });
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
  });

  it("publishes without audio ONLY when explicitly disabled by policy", async () => {
    process.env.AUDIO_QA_ENABLED = "false";
    jobRow = { id: 1, payload: JSON.stringify({ renderedQa: completed([]) }) };
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(true);
    expect(g.gate).toBe("proceed");
  });

  // A LIST view must never trigger rendered QA: it downloads the master, extracts
  // frames and calls the vision model. The attention endpoint's first live call
  // timed out doing exactly that for three jobs.
  it("runIfMissing:false reports 'not evaluated' instead of RUNNING QA", async () => {
    jobRow = { id: 1, payload: JSON.stringify({}) }; // no renderedQa persisted
    const g = await evaluateReelPublishGate(1, { runIfMissing: false });
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/has not been run/i);
  });

  it("still evaluates a PERSISTED verdict under runIfMissing:false — it only skips PRODUCING one", async () => {
    setJob(completed([]));
    const g = await evaluateReelPublishGate(1, { runIfMissing: false });
    expect(g.allowed).toBe(true);
    expect(g.gate).toBe("proceed");
  });
});
