/**
 * 2026-10-02 · the declared-degradation convention both sides of the cron truth use:
 * lib/inngest/cron-lifecycle.ts writes the prefix when a job's output declares
 * degradation; lib/system/owner-panel.ts pages only on it. A plain `partial` (a
 * fan-out parent with failed children; mega-evening alone has 1,248) must read as
 * NOT declared, or the Owner Panel becomes a wall of amber.
 */
import { describe, expect, it } from "vitest";

import {
  DECLARED_DEGRADATION_PREFIX,
  declaredDegradationReason,
  isDeclaredDegradation,
} from "@/lib/services/cron-status";

describe("declared degradation", () => {
  it("is a partial row whose error starts with the prefix, and nothing else", () => {
    expect(isDeclaredDegradation("partial", `${DECLARED_DEGRADATION_PREFIX}compose timed out`)).toBe(true);
    expect(isDeclaredDegradation("partial", "3 of 40 children failed")).toBe(false);
    expect(isDeclaredDegradation("partial", null)).toBe(false);
    expect(isDeclaredDegradation("partial", undefined)).toBe(false);
    expect(isDeclaredDegradation("success", `${DECLARED_DEGRADATION_PREFIX}x`)).toBe(false);
    expect(isDeclaredDegradation("failed", `${DECLARED_DEGRADATION_PREFIX}x`)).toBe(false);
  });

  it("returns the job's own reason without the prefix, trimmed", () => {
    expect(declaredDegradationReason(`${DECLARED_DEGRADATION_PREFIX}compose timed out after 90s `)).toBe("compose timed out after 90s");
    expect(declaredDegradationReason(DECLARED_DEGRADATION_PREFIX)).toBe("");
    expect(declaredDegradationReason("plain text")).toBe("plain text");
  });
});
