/**
 * Reality Control — the three-axis validator that stops incomplete work being
 * called complete. Red-green over evidence gates, cross-axis promotion rules,
 * and evidence expiry; the repo's own ledger must pass its own law.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs module, no type declarations by design
import { validateLedger, assessFreshness } from "../scripts/check-capability-ledger.mjs";

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

const deployed = (over: Record<string, unknown> = {}) =>
  cap({
    operationalState: "deployed",
    exposure: "internal",
    evidence: { tests: ["t"], codeCommit: "c", deploymentId: "d" },
    verificationExpiresAt: "2026-12-01",
    ...over,
  });

describe("freshness is DECIDED, not defaulted", () => {
  // The bug this closes: verificationExpiresAt existed, was implemented, was
  // tested — and was set by 0 of 48 capabilities. The consumer was proven and
  // the producer was silent, so the suite stayed green for a mechanism that
  // had never once fired. Requiring the field is what makes that impossible.
  it("deployed+ cannot stay silent about how long its claim survives", () => {
    const { verificationExpiresAt: _omit, ...rest } = deployed().capabilities[0];
    expect(validateLedger({ capabilities: [rest] })).toEqual(
      expect.arrayContaining([expect.stringContaining("requires verificationExpiresAt")]),
    );
  });

  it("an unparseable expiry is a lie, not a doubt", () => {
    expect(validateLedger(deployed({ verificationExpiresAt: "soon" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("not a parseable date")]),
    );
  });

  it("below deployed the field stays optional — those claims re-prove themselves every CI run", () => {
    const { verificationExpiresAt: _omit, ...rest } = deployed({
      operationalState: "integration_verified",
      evidence: { tests: ["t"], codeCommit: "c" },
    }).capabilities[0];
    expect(validateLedger({ capabilities: [rest] })).toEqual([]);
  });
});

describe("staleness is a doubt, not a violation", () => {
  const expired = { verificationExpiresAt: "2026-01-01" };
  const now = new Date("2026-08-10");

  it("being past the date is NOT a validity error — the two questions are separate", () => {
    // Previously this produced "REVERIFICATION REQUIRED" from validateLedger,
    // which fused "evidence I never had" with "evidence I had a month ago".
    expect(validateLedger(deployed(expired), now)).toEqual([]);
  });

  it("surfaces the doubt with how long we have been assuming", () => {
    const [f] = assessFreshness(deployed(expired), now);
    expect(f).toMatchObject({ capabilityId: "x", expiresAt: "2026-01-01", daysOverdue: 221 });
  });

  it("blocks only where something other than the operator can act on the stale claim", () => {
    const reachable = assessFreshness(
      deployed({ ...expired, exposure: "production", operationalState: "live_verified", evidence: { tests: ["t"], codeCommit: "c", deploymentId: "d", liveRuns: ["r"] } }),
      now,
    );
    expect(reachable[0].blocking).toBe(true);
    expect(assessFreshness(deployed({ ...expired, exposure: "internal" }), now)[0].blocking).toBe(false);
    expect(assessFreshness(deployed({ ...expired, exposure: "operator_only", operationalState: "integration_verified", evidence: { tests: ["t"], codeCommit: "c" } }), now)[0].blocking).toBe(false);
  });

  it("says nothing about a claim that is still inside its horizon, or makes none", () => {
    expect(assessFreshness(deployed({ verificationExpiresAt: "2026-12-01" }), now)).toEqual([]);
    const { verificationExpiresAt: _omit, ...rest } = deployed().capabilities[0];
    expect(assessFreshness({ capabilities: [rest] }, now)).toEqual([]);
  });
});

describe("the rendered ledger may not know what day it is", () => {
  it("render-reality-ledger.mjs reads no clock — CI diffs it, so a tick must never rewrite it", () => {
    const src = readFileSync(resolve(process.cwd(), "scripts/render-reality-ledger.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/new Date|Date\.now|assessFreshness/);
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

  it("every deployed+ capability has named a horizon, and they are NOT uniform", () => {
    const ORDER = ["unverified", "unit_verified", "integration_verified", "deployed", "live_verified", "visually_verified", "business_verified"];
    const ledger = JSON.parse(readFileSync(resolve(process.cwd(), "docs/operations/capability-ledger.json"), "utf8"));
    const perishable = ledger.capabilities.filter(
      (c: { operationalState: string }) => ORDER.indexOf(c.operationalState) >= ORDER.indexOf("deployed"),
    );
    expect(perishable.length).toBeGreaterThan(0);
    expect(perishable.every((c: { verificationExpiresAt?: string }) => Boolean(c.verificationExpiresAt))).toBe(true);

    // Unevenness is the design, not an accident: a horizon is how long a claim
    // survives with no commit, and a Google OAuth token does not rot at the same
    // rate as a deterministic puppeteer render. One shared date would mean the
    // question was answered by policy instead of by looking at each thing.
    const horizons = new Set(perishable.map((c: { verificationExpiresAt: string }) => c.verificationExpiresAt));
    expect(horizons.size).toBeGreaterThan(2);
  });
});
