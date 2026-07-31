/**
 * cron-flag-gate.test.ts · 2026-07-31
 *
 * Locks the `requiresFlag` gate contract.
 *
 * Why this exists: `requiresEnv` is a TRUTHINESS check, but the reel stages
 * gate on `REEL_GENERATION_ENABLED === "true"` exactly
 * (reelPipeline.ts:312/537/673). With the var set to `1` / `yes` / `TRUE`,
 * the scheduler ran reel-pipeline every pulse while every stage returned
 * `{processed:false}` — no error, no skip row, no signal anywhere. A cron
 * that looks healthy and does nothing.
 *
 * `requiresFlag` closes that: the gate now matches the consumer exactly, and
 * a near-miss value skips LOUDLY with the observed value in the reason.
 */
import { describe, it, expect } from "vitest";
import { unarmedFlagReason } from "../cron/scheduler";

describe("requiresFlag gate · matches the service-layer contract", () => {
  it("arms on exactly \"true\"", () => {
    expect(unarmedFlagReason("REEL_GENERATION_ENABLED", "true")).toBeNull();
  });

  it.each(["1", "yes", "TRUE", "True", "true ", " true", "on", "enabled"])(
    "does NOT arm on truthy-but-wrong %j — the silent-no-op case",
    (raw) => {
      const reason = unarmedFlagReason("REEL_GENERATION_ENABLED", raw);
      expect(reason).not.toBeNull();
      // The observed value must appear so the typo is legible from cron_log
      // alone, without shell access to the environment.
      expect(reason).toContain("must be exactly");
      expect(reason).toContain("REEL_GENERATION_ENABLED");
    },
  );

  it("reports an unset flag as 'not set', not as a bad value", () => {
    expect(unarmedFlagReason("X_ENABLED", undefined)).toBe("requiresFlag:X_ENABLED (not set)");
    expect(unarmedFlagReason("X_ENABLED", "")).toBe("requiresFlag:X_ENABLED (not set)");
  });

  it("truncates a long value so a mis-set secret cannot leak into cron_log", () => {
    const reason = unarmedFlagReason("X_ENABLED", "sk-live-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(reason).toContain("…");
    expect(reason).not.toContain("0123456789");
  });

  it("is case-sensitive — \"TRUE\" is a misconfiguration, not an alias", () => {
    expect(unarmedFlagReason("X_ENABLED", "TRUE")).not.toBeNull();
  });
});
