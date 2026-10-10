/**
 * evaluateReelPublishGate — the consolidated reel publish gate.
 *
 * CORE RULE under test: only a COMPLETED, CURRENT, COMPLETE evaluation may
 * authorize a publish. A critic outage, a stale-after-repair verdict, or
 * incomplete evidence must HOLD — absence of evidence is not evidence of
 * quality (audit: skipped-critic-as-approval).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

let jobRow: { id: number; payload: string } | null = null;
/** The QA runner the gate may call to re-run a persisted non-evaluation. */
let rerunMock = vi.fn();
// Partial mock: the orchestrator's repair planner imports the defect registry
// from the same module, so the real exports stay and only the runner is seamed.
vi.mock("./services/renderedQa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/renderedQa")>()),
  runRenderedQaOnJob: (...args: unknown[]) => rerunMock(...args),
}));
/** How many reel jobs the provider-health probe should see as recently failed. */
let recentFailures = 0;
/** The on-demand audio measurement the gate may call when payload.audioQa is missing. */
let measureAudioMock = vi.fn(async () => null as unknown);
vi.mock("./services/audioQa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/audioQa")>()),
  measureJobAudioQa: (...args: unknown[]) => measureAudioMock(...(args as [])),
}));
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

  it("MEASURES audio on first contact when the verdict is missing and the door may produce evidence (2026-10-10, job 2070001)", async () => {
    jobRow = { id: 1, payload: JSON.stringify({ renderedQa: completed([]) }) };
    measureAudioMock = vi.fn(async () => ({ hasAudio: true, integratedLufs: -14, truePeakDb: -1.5, channels: 2, sampleRate: 48000, clipping: false, findings: [], decision: "approve", qaState: "completed", evaluatedAt: "2026-10-10T00:00:00Z", masterSha256: "a".repeat(64), measuredOn: "test" }));
    try {
      const g = await evaluateReelPublishGate(1);
      expect(measureAudioMock).toHaveBeenCalledTimes(1);
      expect(g.reason).not.toMatch(/no audio QA verdict/);
      expect(g.gate).not.toBe("unavailable");
    } finally { measureAudioMock = vi.fn(async () => null); }
  });

  it("does NOT measure under runIfMissing:false — the read-only pre-filter still reports 'not evaluated'", async () => {
    jobRow = { id: 1, payload: JSON.stringify({ renderedQa: completed([]) }) };
    measureAudioMock = vi.fn(async () => null);
    const g = await evaluateReelPublishGate(1, { runIfMissing: false });
    expect(measureAudioMock).not.toHaveBeenCalled();
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/audio/i);
  });

  it("a failed measurement leaves the hold in place (null is not a pass)", async () => {
    jobRow = { id: 1, payload: JSON.stringify({ renderedQa: completed([]) }) };
    measureAudioMock = vi.fn(async () => null);
    const g = await evaluateReelPublishGate(1);
    expect(measureAudioMock).toHaveBeenCalledTimes(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/no audio QA verdict/);
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

describe("a persisted NON-evaluation is re-run by a publish door, bounded (job 2040001, 2026-10-08)", () => {
  // Job 2040001: one "no complete JSON object" at 10:33Z was persisted as a
  // skipped verdict, and every drain pulse until 13:30Z read it back as THE
  // verdict — the critic was never asked again. A publish door may now re-run
  // it: at most 3 critic runs per asset, never inside 30 minutes of the last.
  const skippedAt = (minutesAgo: number, attempts?: number) => {
    const skipped = {
      decision: "approve", findings: [], framesEvaluated: 8, critic: "skipped", qaState: "unavailable",
      evaluatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    };
    setJob(skipped, attempts === undefined ? {} : { renderedQaAttempts: attempts });
  };
  beforeEach(() => { rerunMock = vi.fn(); process.env.RENDERED_QA_ENABLED = "true"; });

  it("asks the critic again once the spacing has passed and decides on the FRESH verdict", async () => {
    skippedAt(31, 1);
    rerunMock.mockResolvedValue(completed([]));
    const g = await evaluateReelPublishGate(1);
    expect(rerunMock).toHaveBeenCalledTimes(1);
    expect(rerunMock).toHaveBeenCalledWith(1);
    expect(g.allowed).toBe(true);
    expect(g.gate).toBe("proceed");
    expect(g.source).toBe("fresh");
  });

  it("does not re-run inside the 30-minute spacing — the hold names the next re-run", async () => {
    skippedAt(5, 1);
    const g = await evaluateReelPublishGate(1);
    expect(rerunMock).not.toHaveBeenCalled();
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/1 critic run\(s\); next automatic re-run after 20/);
  });

  it("stops after 3 critic runs — the hold says the budget is spent and points at the admin re-run", async () => {
    skippedAt(60, 3);
    const g = await evaluateReelPublishGate(1);
    expect(rerunMock).not.toHaveBeenCalled();
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/3 critic runs, re-run budget spent/);
  });

  it("a verdict that predates the counter counts as one run; a re-run that produced nothing is the same hold, counted", async () => {
    skippedAt(60); // no renderedQaAttempts on the payload
    rerunMock.mockResolvedValue(null);
    const g = await evaluateReelPublishGate(1);
    expect(rerunMock).toHaveBeenCalledTimes(1);
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/critic run 2 of 3/);
  });

  it("a re-run that comes back skipped again is still a hold, never an approval", async () => {
    skippedAt(45, 1);
    rerunMock.mockResolvedValue({ ...completed([]), critic: "skipped", qaState: "unavailable" });
    const g = await evaluateReelPublishGate(1);
    expect(rerunMock).toHaveBeenCalledTimes(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/critic run 2 of 3/);
  });

  it("a read-only check never re-runs, whatever the age", async () => {
    skippedAt(600, 1);
    const g = await evaluateReelPublishGate(1, { runIfMissing: false });
    expect(rerunMock).not.toHaveBeenCalled();
    expect(g.gate).toBe("unavailable");
    expect(g.reason).toMatch(/a publish door re-runs it/);
  });

  it("a stale-after-repair verdict is not a re-run candidate (the repair path owns it)", async () => {
    setJob({ decision: "approve", findings: [], framesEvaluated: 8, critic: "skipped", qaState: "unavailable", staleAfterRepair: true, evaluatedAt: new Date(Date.now() - 3_600_000).toISOString() }, { renderedQaAttempts: 1 });
    const g = await evaluateReelPublishGate(1);
    expect(rerunMock).not.toHaveBeenCalled();
    expect(g.allowed).toBe(false);
  });

  it("assert-the-consumer: the runner and the gate count critic runs by the one shared rule, read before the overwrite", () => {
    // 2026-10-08 15:31Z: the gate counted a pre-counter verdict as one run and
    // the runner did not, so job 2040001's log said "critic run 2 of 3" and the
    // next pulse said "1 critic run(s)". Both now call renderedQaRunsSoFar, and
    // the runner must take it BEFORE the new verdict replaces the old one —
    // after the overwrite, a first-ever run would count itself twice.
    const runner = readFileSync(new URL("./services/renderedQa.ts", import.meta.url), "utf8");
    const gate = readFileSync(new URL("./services/qualityGate.ts", import.meta.url), "utf8");
    const readAt = runner.indexOf("const runsBefore = renderedQaRunsSoFar(payload);");
    const overwriteAt = runner.indexOf("payload.renderedQa = verdict;");
    expect(readAt).toBeGreaterThan(-1);
    expect(overwriteAt).toBeGreaterThan(readAt);
    expect(runner).toContain("payload.renderedQaAttempts = runsBefore + 1;");
    expect(gate).toContain("const attempts = renderedQaRunsSoFar(payload);");
  });
});
