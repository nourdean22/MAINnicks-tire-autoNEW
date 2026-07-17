/**
 * Completion Authority — the validator that stops incomplete work being
 * called complete. Red-green over the evidence gates, plus the repo's own
 * ledger must pass its own law.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs module, no type declarations by design
import { validateLedger } from "../scripts/check-capability-ledger.mjs";

const base = (state: string, evidence: Record<string, unknown> = {}, blockers: Array<{ severity: string; description: string; source: string }> = []) => ({
  capabilities: [
    { capabilityId: "x", name: "X", owner: "op", state, evidence, blockers, deferredScope: [] },
  ],
});

describe("validateLedger evidence gates", () => {
  it("a state cannot stand without the evidence it requires", () => {
    expect(validateLedger(base("unit_verified", {}))).toEqual(
      expect.arrayContaining([expect.stringContaining("requires evidence.tests")]),
    );
    expect(validateLedger(base("live_verified", { tests: ["t"], codeCommit: "c", deploymentId: "d" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("requires evidence.liveRuns or evidence.databaseAssertions")]),
    );
    expect(
      validateLedger(base("production_ready", { tests: ["t"], codeCommit: "c", deploymentId: "d", liveRuns: ["r"], renderedAssets: ["a"], businessMetrics: ["m"] })),
    ).toEqual(expect.arrayContaining([expect.stringContaining("requires evidence.operatorApprovalId")]));
  });

  it("elevated states cannot carry P0/P1 blockers — resolve or demote", () => {
    const errs = validateLedger(
      base("deployed", { tests: ["t"], codeCommit: "c", deploymentId: "d" }, [
        { severity: "P1", description: "broken path", source: "review" },
      ]),
    );
    expect(errs).toEqual(expect.arrayContaining([expect.stringContaining("cannot carry P0/P1 blockers")]));
  });

  it("a fully evidenced state passes", () => {
    expect(validateLedger(base("integrated", { tests: ["t"], codeCommit: "abc" }))).toEqual([]);
  });

  it("the repo's OWN ledger passes its own law", () => {
    const ledger = JSON.parse(readFileSync(resolve(process.cwd(), "docs/operations/capability-ledger.json"), "utf8"));
    expect(validateLedger(ledger)).toEqual([]);
    // and the honest floor: nothing in this repo may claim production_ready yet
    expect(ledger.capabilities.every((c: { state: string }) => c.state !== "production_ready")).toBe(true);
  });
});
