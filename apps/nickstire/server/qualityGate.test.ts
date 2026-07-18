/**
 * evaluateReelPublishGate — the consolidated reel publish gate (persisted
 * Quality Decision Record). Reads the persisted rendered-QA verdict + the real
 * per-job repair-attempt count + the policy cap, and returns the publish permit.
 * The DB + policy are mocked; postQaOrchestrator/qualityAutomation run for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let jobRow: { id: number; payload: string } | null = null;
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (jobRow ? [jobRow] : []) }) }) }),
  }),
}));
vi.mock("./services/autonomyControl", () => ({
  getActivePolicy: async () => ({ limits: { maxRepairAttemptsPerAsset: 2 } }),
}));

import { evaluateReelPublishGate } from "./services/qualityGate";

const verdict = (findings: unknown[]) => ({ decision: "approve", findings, framesEvaluated: 8, evaluatedAt: "", critic: "vision" });
const block = { beatNumber: 1, code: "GENERATED_TEXT_ARTIFACT", severity: "block", description: "x", preserve: [], change: [] };

describe("evaluateReelPublishGate", () => {
  beforeEach(() => { jobRow = null; process.env.RENDERED_QA_ENABLED = "true"; });

  it("proceeds on a clean persisted verdict (0 findings)", async () => {
    jobRow = { id: 1, payload: JSON.stringify({ renderedQa: verdict([]) }) };
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(true);
    expect(g.gate).toBe("proceed");
    expect(g.source).toBe("persisted");
  });

  it("HOLDS on a rendered block finding (needs_paid_repair, not publishable)", async () => {
    jobRow = { id: 1, payload: JSON.stringify({ renderedQa: verdict([block]) }) };
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("needs_paid_repair");
  });

  it("REJECTS once the repair cap is reached (real repairQueue count wired in)", async () => {
    jobRow = { id: 1, payload: JSON.stringify({ renderedQa: verdict([block]), repairQueue: [{}, {}] }) };
    const g = await evaluateReelPublishGate(1);
    expect(g.repairAttempts).toBe(2); // wired from payload.repairQueue (previously hardcoded 0)
    expect(g.gate).toBe("reject");    // repairAttempts >= maxRepairAttempts -> REJECT_OUTPUT
    expect(g.allowed).toBe(false);
  });

  it("allows (does not hard-block) when rendered QA is unavailable", async () => {
    process.env.RENDERED_QA_ENABLED = "false";
    jobRow = { id: 1, payload: JSON.stringify({}) };
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(true);
    expect(g.source).toBe("unavailable");
  });

  it("allows when the job is missing (nothing to gate)", async () => {
    jobRow = null;
    const g = await evaluateReelPublishGate(999);
    expect(g.allowed).toBe(true);
    expect(g.source).toBe("unavailable");
  });
});
