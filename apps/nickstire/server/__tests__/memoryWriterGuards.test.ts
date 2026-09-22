/**
 * memoryWriterGuards — the rows that filled Nick's prompt must not be written again.
 * Each guard is asserted on the exact live offender (2026-09-22 counterfactual)
 * and on a positive control that must still be remembered.
 */
import { describe, expect, it } from "vitest";
import { alertOutcomeMemoryContent, capacityMemoryContent, pulledMemoryText } from "../services/memoryWriterGuards";

describe("capacityMemoryContent", () => {
  it("writes nothing for a shop with no bays configured (the live '0% (0/0 bays) FULL' row)", () => {
    expect(capacityMemoryContent({ etHour: 20, totalBays: 0, freeBays: 0, clockedIn: 0 })).toBeNull();
  });

  it("POSITIVE CONTROL: a real reading is remembered with the right label", () => {
    expect(capacityMemoryContent({ etHour: 14, totalBays: 4, freeBays: 0, clockedIn: 3 })).toBe(
      "Bay utilization at 14:00: 100% (4/4 bays, 3 techs). FULL — consider expanding hours.",
    );
    expect(capacityMemoryContent({ etHour: 9, totalBays: 4, freeBays: 4, clockedIn: 2 })).toBe(
      "Bay utilization at 9:00: 0% (0/4 bays, 2 techs). EMPTY — need more traffic.",
    );
    expect(capacityMemoryContent({ etHour: 11, totalBays: 4, freeBays: 2, clockedIn: 2 })).toMatch(/50% \(2\/4 bays, 2 techs\)\. Normal utilization\.$/);
  });
});

describe("alertOutcomeMemoryContent", () => {
  it("an unknown outcome is not a lesson (the live 'Outcome unknown.' rows, 2,517 and 147 uses)", () => {
    expect(alertOutcomeMemoryContent("proactive", "unknown")).toBeNull();
  });

  it("POSITIVE CONTROL: acted and ignored are remembered", () => {
    expect(alertOutcomeMemoryContent("slow_day_push", "acted")).toBe('Alert "slow_day_push" was acted. This type of alert drives action — keep sending.');
    expect(alertOutcomeMemoryContent("slow_day_push", "ignored")).toBe('Alert "slow_day_push" was ignored. This alert type may need a different approach or timing.');
  });
});

describe("pulledMemoryText", () => {
  it("empty text writes nothing (the live '[statenour-commitment]  — deadline: tomorrow' rows)", () => {
    expect(pulledMemoryText("[statenour-commitment]", "", " — deadline: tomorrow, status: active")).toBeNull();
    expect(pulledMemoryText("[statenour]", undefined)).toBeNull();
    expect(pulledMemoryText("[statenour]", "   ")).toBeNull();
  });

  it("a statement about Nick's own memory store writes nothing (the live 4,904-use row)", () => {
    expect(pulledMemoryText("[statenour]", "Nick AI has 30 learned memories")).toBeNull();
    expect(pulledMemoryText("[From statenour brain]", "Nick has 1 learned memory now")).toBeNull();
  });

  it("POSITIVE CONTROL: a real insight is remembered with prefix and suffix, capped at 500", () => {
    expect(pulledMemoryText("[statenour]", "Tuesdays are the slowest day for walk-ins")).toBe("[statenour] Tuesdays are the slowest day for walk-ins");
    expect(pulledMemoryText("[statenour-commitment]", "Call the Firestone rep", " — deadline: 2026-09-25, status: active")).toBe(
      "[statenour-commitment] Call the Firestone rep — deadline: 2026-09-25, status: active",
    );
    expect(pulledMemoryText("[statenour]", "x".repeat(600))).toHaveLength(500);
  });
});
