/**
 * ROS-083 · the ALG / ShopDriver freshness card must not render emerald "Fresh"
 * through a live authentication outage.
 *
 * The card is classified from the AGE OF THE LAST SUCCESS against
 * staleAfterMinutes = 24h (OverviewSection.tsx:260). The server read selected
 * only `outcome = 'success'` rows. Put those two together and a total auth
 * outage beginning at 9am reads emerald "Fresh · 12m old" at 9:12, "Fresh ·
 * 300m old" at 2pm, and does not go amber until 9am the NEXT DAY — while every
 * probe in between writes an `auth_failed` row the query never selected.
 *
 * Recency of the last success and health right now are different questions.
 * These pin that the classifier can now be asked the second one, and that
 * asking it does not disturb the answers to the first.
 */
import { describe, expect, it } from "vitest";
import { classifyIntegrationFreshness } from "@/lib/integrationFreshness";

const NOW = new Date("2026-08-03T15:00:00Z");

describe("a live auth failure is not freshness", () => {
  it("reports failing even when the last success is minutes old", () => {
    const r = classifyIntegrationFreshness({
      connected: true,
      lastSuccessfulAt: "2026-08-03T14:48:00Z", // 12 minutes ago
      staleAfterMinutes: 24 * 60,
      now: NOW,
      readable: true,
      failuresSinceLastSuccess: 6,
      lastAttemptOutcome: "auth_failed",
    });
    expect(r.state).toBe("failing");
    expect(r.state).not.toBe("fresh");
    expect(r.label).toMatch(/auth failing/i);
    expect(r.label).toMatch(/6 failed probes/);
  });

  it("names an erroring probe differently from an auth failure", () => {
    const r = classifyIntegrationFreshness({
      connected: true,
      lastSuccessfulAt: "2026-08-03T14:48:00Z",
      staleAfterMinutes: 24 * 60,
      now: NOW,
      readable: true,
      failuresSinceLastSuccess: 1,
      lastAttemptOutcome: "error",
    });
    expect(r.state).toBe("failing");
    expect(r.label).toMatch(/probe erroring · 1 failed probe /i);
  });

  it("returns to fresh once a good probe lands — the streak, not the history", () => {
    const r = classifyIntegrationFreshness({
      connected: true,
      lastSuccessfulAt: "2026-08-03T14:48:00Z",
      staleAfterMinutes: 24 * 60,
      now: NOW,
      readable: true,
      failuresSinceLastSuccess: 0, // server stops counting at the first non-failing attempt
      lastAttemptOutcome: "success",
    });
    expect(r.state).toBe("fresh");
  });
});

describe("an unreadable probe log is not an ALG outage", () => {
  it("says unknown rather than blaming the integration", () => {
    const r = classifyIntegrationFreshness({
      connected: null,
      lastSuccessfulAt: null,
      staleAfterMinutes: 24 * 60,
      now: NOW,
      readable: false,
    });
    expect(r.state).toBe("unknown");
    expect(r.label).toMatch(/could not be read/i);
    // Previously this branch returned connected:false, which the classifier
    // rendered as "Offline" — a confident claim about ALG, made on evidence
    // about OUR database.
    expect(r.state).not.toBe("offline");
  });

  it("outranks a failure streak — nothing was measured, so nothing is claimed", () => {
    const r = classifyIntegrationFreshness({
      staleAfterMinutes: 24 * 60,
      now: NOW,
      readable: false,
      failuresSinceLastSuccess: 9,
      lastAttemptOutcome: "auth_failed",
    });
    expect(r.state).toBe("unknown");
  });
});

describe("the pre-existing contract is unchanged", () => {
  it("still distinguishes fresh, stale, offline and unknown on the old inputs", () => {
    const now = new Date("2026-07-16T15:00:00Z");
    expect(classifyIntegrationFreshness({ connected: true, lastSuccessfulAt: "2026-07-16T14:55:00Z", staleAfterMinutes: 30, now }).state).toBe("fresh");
    expect(classifyIntegrationFreshness({ connected: true, lastSuccessfulAt: "2026-07-16T13:00:00Z", staleAfterMinutes: 30, now }).state).toBe("stale");
    expect(classifyIntegrationFreshness({ connected: false, staleAfterMinutes: 30, now }).state).toBe("offline");
    expect(classifyIntegrationFreshness({ connected: true, staleAfterMinutes: 30, now }).state).toBe("unknown");
  });

  it("treats a missing failure count as no failures, so old callers are unaffected", () => {
    const r = classifyIntegrationFreshness({
      connected: true,
      lastSuccessfulAt: "2026-08-03T14:55:00Z",
      staleAfterMinutes: 30,
      now: NOW,
    });
    expect(r.state).toBe("fresh");
  });
});
