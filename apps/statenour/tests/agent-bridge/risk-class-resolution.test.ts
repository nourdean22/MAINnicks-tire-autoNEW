/**
 * The bridge must audit EFFECTIVE risk, not the raw catalog field.
 *
 * getToolRiskClass() has existed in lib/ai/tools/catalog.ts the whole time and
 * already encodes the right rules (explicit wins · runCode/runPython/
 * runDeviceCommand are critical · sideEffecting is high · write/comms
 * categories are high). It had exactly ONE importer — an admin tRPC query at
 * lib/trpc/routers/brain.ts:962 — while the three places that matter reached
 * past it for `meta.riskClass` directly:
 *
 *   mcp-server.ts        riskClass: tool.meta?.riskClass || "low"
 *   actions/[tool]       riskClass: tool.meta.riskClass  || "low"
 *   surface-digest.ts    riskClass: meta.riskClass ?? "(unset)"
 *
 * 138 of 177 published tools declare no riskClass, so `|| "low"` meant every
 * bridge SMS send was audited as low risk and runDeviceCommand — a shell on the
 * operator's machine — was audited as low risk. Not an authz hole (tool-policy
 * does not gate on riskClass at all; the execution gate is status:"inert" plus
 * getBridgeSafeTools), but it is the log an incident gets triaged from.
 *
 * The invariant worth pinning is the OUTCOME, not the call: assert that no
 * side-effecting published tool can be audited "low", so this stays true
 * however the code is later refactored.
 */
import { describe, it, expect } from "vitest";
import { computeMcpSurface } from "@/lib/agent-bridge/surface-digest";
import { getToolRiskClass, getToolMeta } from "@/lib/ai/tools/catalog";

const surface = computeMcpSurface();

describe("agent-bridge · effective risk classification", () => {
  it("publishes a non-empty surface (nothing below passes by vacuity)", () => {
    expect(surface.length).toBeGreaterThan(0);
  });

  it("no published tool is unclassified", () => {
    const unset = surface.filter((t) => t.riskClass === "(unset)" || !t.riskClass);
    expect(unset.map((t) => t.name)).toEqual([]);
  });

  it("no side-effecting tool can be audited as low risk", () => {
    // The exact defect: a tool that sends a customer SMS logged as "low".
    const understated = surface
      .filter((t) => t.sideEffecting)
      .filter((t) => t.riskClass !== "high" && t.riskClass !== "critical" && t.riskClass !== "medium");

    expect(
      understated.map((t) => `${t.name} -> ${t.riskClass}`),
      "a side-effecting tool resolved below medium risk",
    ).toEqual([]);
  });

  it("the customer-contacting and shell tools carry the classes they earned", () => {
    // 2026-08-27: these tools are now HARD_DENIED and no longer on the bridge
    // surface (that IS the hardening). Risk classification is a catalog
    // property independent of exposure, so assert it at the source —
    // getToolRiskClass on the catalog name — which is where the effective risk
    // an audit records comes from, and is more faithful than the old
    // surface-coupled check.
    expect(getToolRiskClass("runDeviceCommand", getToolMeta("runDeviceCommand"))).toBe("critical");
    for (const name of [
      "sendOpportunitySms",
      "sendTelegram",
      "stageCustomerAlert",
      "triggerInstagramAutopost",
    ]) {
      expect(getToolRiskClass(name, getToolMeta(name)), `${name} must not be low`).toBe("high");
    }
    // POSITIVE CONTROL: a plain read tool stays low — the classifier
    // discriminates, it is not stamping everything high.
    expect(getToolRiskClass("getTasks", getToolMeta("getTasks"))).toBe("low");
  });

  it("records whether a class was ratified or merely derived", () => {
    const declared = surface.filter((t) => t.riskDeclared);
    const derived = surface.filter((t) => !t.riskDeclared);

    // Both populations must be non-empty or the flag is not measuring anything.
    expect(declared.length).toBeGreaterThan(0);
    expect(derived.length).toBeGreaterThan(0);

    // riskDeclared must track the catalog, not the resolved value.
    for (const entry of surface) {
      expect(getToolMeta(entry.camelName)?.riskClass != null).toBe(entry.riskDeclared);
    }
  });

  it("resolution is name-sensitive — the snake name silently downgrades", () => {
    // Load-bearing, and the reason all three call sites pass camelName. The
    // critical branch matches on the CATALOG name; handed the published snake
    // form it falls through to the sideEffecting rule and returns "high" — a
    // wrong answer that still looks classified, so nothing would surface it.
    // If someone "simplifies" these calls to tool.name, this test states the cost.
    const meta = getToolMeta("runDeviceCommand");
    expect(meta).toBeTruthy();

    expect(getToolRiskClass("runDeviceCommand", meta)).toBe("critical");
    expect(getToolRiskClass("run_device_command", meta)).toBe("high");
  });
});
