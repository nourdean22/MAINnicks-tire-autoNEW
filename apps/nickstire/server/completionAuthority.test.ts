/**
 * Reality Control — the three-axis validator that stops incomplete work being
 * called complete. Red-green over evidence gates, cross-axis promotion rules,
 * and evidence expiry; the repo's own ledger must pass its own law.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs module, no type declarations by design
import { validateLedger } from "../scripts/check-capability-ledger.mjs";

const cap = (over: Record<string, unknown>) => ({
  capabilities: [
    {
      capabilityId: "x",
      name: "X",
      owner: "op",
      codeState: "merged",
      operationalState: "unverified",
      exposure: "disabled",
      evidence: {},
      blockers: [],
      deferredScope: [],
      ...over,
    },
  ],
});

describe("operational evidence gates", () => {
  it("operational states cannot stand without their evidence", () => {
    expect(validateLedger(cap({ operationalState: "unit_verified" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("requires evidence.tests")]),
    );
    expect(
      validateLedger(cap({ operationalState: "live_verified", evidence: { tests: ["t"], codeCommit: "c", deploymentId: "d" } })),
    ).toEqual(expect.arrayContaining([expect.stringContaining("requires evidence.liveRuns or evidence.databaseAssertions")]));
  });

  it("deployed+ cannot carry P0/P1 blockers", () => {
    const errs = validateLedger(
      cap({
        operationalState: "deployed",
        evidence: { tests: ["t"], codeCommit: "c", deploymentId: "d" },
        blockers: [{ severity: "P1", description: "broken", source: "review" }],
      }),
    );
    expect(errs).toEqual(expect.arrayContaining([expect.stringContaining("cannot carry P0/P1 blockers")]));
  });
});

describe("cross-axis promotion rules", () => {
  it("exposure production requires live verification — merged code alone is not enough", () => {
    const errs = validateLedger(
      cap({ exposure: "production", operationalState: "integration_verified", evidence: { tests: ["t"], codeCommit: "c" } }),
    );
    expect(errs).toEqual(expect.arrayContaining([expect.stringContaining("exposure production requires operationalState >= live_verified")]));
  });

  it("nothing may be exposed beyond disabled without merged code", () => {
    const errs = validateLedger(cap({ codeState: "in_progress", exposure: "operator_only", operationalState: "unverified" }));
    expect(errs).toEqual(expect.arrayContaining([expect.stringContaining("requires codeState merged")]));
  });

  it("a fully evidenced, correctly exposed capability passes", () => {
    expect(
      validateLedger(cap({ operationalState: "integration_verified", exposure: "operator_only", evidence: { tests: ["t"], codeCommit: "c" } })),
    ).toEqual([]);
  });
});

describe("evidence expiry", () => {
  it("expired verification regresses loudly", () => {
    const errs = validateLedger(
      cap({
        operationalState: "integration_verified",
        evidence: { tests: ["t"], codeCommit: "c" },
        verificationExpiresAt: "2020-01-01",
      }),
      new Date("2026-07-17"),
    );
    expect(errs).toEqual(expect.arrayContaining([expect.stringContaining("REVERIFICATION REQUIRED")]));
  });
});

describe("the repo's own ledger", () => {
  it("passes its own law, and nothing claims business verification or production exposure beyond the reel pipeline", () => {
    const ledger = JSON.parse(readFileSync(resolve(process.cwd(), "docs/operations/capability-ledger.json"), "utf8"));
    expect(validateLedger(ledger)).toEqual([]);
    expect(ledger.capabilities.every((c: { operationalState: string }) => c.operationalState !== "business_verified")).toBe(true);
    const production = ledger.capabilities.filter((c: { exposure: string }) => c.exposure === "production");
    expect(production.map((c: { capabilityId: string }) => c.capabilityId)).toEqual(["reel-pipeline-assembly"]);
  });
});
