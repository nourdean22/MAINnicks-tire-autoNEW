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
    const byName = new Map(surface.map((t) => [t.name, t]));

    // Shell execution on the operator's machine.
    expect(byName.get("run_device_command")?.riskClass).toBe("critical");

    // Anything that can reach a customer or the shop's public feed.
    for (const name of [
      "send_opportunity_sms",
      "send_telegram",
      "stage_customer_alert",
      "trigger_instagram_autopost",
    ]) {
      expect(byName.get(name)?.riskClass, `${name} must not be low`).toBe("high");
    }
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
