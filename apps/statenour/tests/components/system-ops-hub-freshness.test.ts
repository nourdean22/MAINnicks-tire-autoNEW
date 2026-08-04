/**
 * The System-ops header may not claim "live · last refresh HH:MM:SS" while
 * the quota circuit is feeding it fabricated zeros.
 *
 * buildSystemPulse's quota short-circuit sets a genuinely FRESH generatedAt
 * on the same object that carries dbQuotaExhausted — so the timestamp was
 * true, the freshness claim it implied ("these counts were just read") was
 * false. #1346 fixed the home strip, one of dbQuotaExhausted's two
 * consumers; this pins the second (components/settings/system-ops-hub.tsx).
 * Mirrors tests/components/home-state-pulse-tone.test.ts.
 */
import { describe, expect, it } from "vitest";

import { opsHubFreshness } from "@/components/settings/system-ops-hub";

describe("opsHubFreshness", () => {
  it("no pulse yet → loading", () => {
    expect(opsHubFreshness(null)).toBe("loading");
    expect(opsHubFreshness(undefined)).toBe("loading");
    expect(opsHubFreshness({})).toBe("loading");
  });

  it("quota circuit open → degraded, even with a fresh generatedAt", () => {
    expect(
      opsHubFreshness({
        generatedAt: new Date().toISOString(),
        dbQuotaExhausted: true,
      }),
    ).toBe("degraded");
  });

  it("normal pulse → live", () => {
    expect(
      opsHubFreshness({
        generatedAt: "2026-08-04T12:00:00.000Z",
        dbQuotaExhausted: false,
      }),
    ).toBe("live");
  });

  it("an ABSENT flag stays live — the field is optional and additive", () => {
    expect(opsHubFreshness({ generatedAt: "2026-08-04T12:00:00.000Z" })).toBe("live");
  });
});
