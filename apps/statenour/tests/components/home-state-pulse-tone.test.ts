/**
 * The home strip must not print "calm" from queries that never ran.
 *
 * When the Neon quota circuit is open, buildSystemPulse returns WITHOUT running
 * a single query — cronFails 0, errorsFatal 0, actionsPending 0, all fabricated.
 * Those zeros fell straight through to "calm", so the operator's most-seen
 * status signal rendered a green dot and the literal word CALM while asserting
 * zero cron failures, zero fatal errors and zero pending autonomous actions —
 * at the exact moment none of them had been looked at.
 *
 * The server has always sent `dbQuotaExhausted`; the client interface simply
 * never declared it, and the hook casts with a plain `as`, so no consumer could
 * see it. No server change was needed.
 *
 * Pure function, node env — no React, no jsdom, no hook cache.
 */
import { describe, it, expect } from "vitest";
import { deriveStatePulseTone } from "@/components/home/home-state-pulse";
import type { SystemPulse } from "@/lib/hooks/use-system-pulse";

/** The exact shape buildSystemPulse returns on the quota short-circuit. */
function pulse(over: Partial<SystemPulse> = {}): SystemPulse {
  return {
    cronFails24h: 0,
    cronFails1h: 0,
    cronsDrifted: 0,
    errors24h: 0,
    errorsFatal24h: 0,
    errorsFatal6h: 0,
    aiCalls24h: 0,
    aiFailures24h: 0,
    aiErrorRate: 0,
    actionsPending: 0,
    actionsFailed24h: 0,
    devicesOffline: 0,
    devicesTotal: 0,
    generatedAt: "2026-08-04T00:00:00.000Z",
    ...over,
  };
}

describe("deriveStatePulseTone", () => {
  it("says DEGRADED, not calm, when nothing was measured", () => {
    const tone = deriveStatePulseTone(pulse({ dbQuotaExhausted: true }));
    expect(tone).toBe("degraded");
    // The defect, stated as an assertion.
    expect(tone).not.toBe("calm");
  });

  it("still says CALM when the zeros are real measurements", () => {
    // Both directions. A fix that always returns "degraded" would satisfy the
    // case above while destroying the signal.
    expect(deriveStatePulseTone(pulse({ dbQuotaExhausted: false }))).toBe("calm");
  });

  it("treats an ABSENT flag as measured — a cached pre-deploy payload is not degraded", () => {
    expect(deriveStatePulseTone(pulse())).toBe("calm");
  });

  it("lets a REAL alarm outrank 'we could not measure'", () => {
    // Precedence is a deliberate decision, so it gets a pin. A recorded fatal
    // error is worse news than an unread table; burying it under a degraded
    // badge would be a new false-green.
    expect(deriveStatePulseTone(pulse({ errorsFatal6h: 1, dbQuotaExhausted: true }))).toBe("alert");
    expect(deriveStatePulseTone(pulse({ cronFails1h: 2, dbQuotaExhausted: true }))).toBe("alert");
  });

  it("outranks WATCH — an unmeasured system is not a mildly busy one", () => {
    // With the circuit open these counters are fabricated zeros anyway, so
    // reaching the watch branch at all would mean reading invented numbers.
    expect(deriveStatePulseTone(pulse({ errors24h: 3, dbQuotaExhausted: true }))).toBe("degraded");
  });

  it("keeps the existing watch and alert behaviour when the DB was readable", () => {
    expect(deriveStatePulseTone(pulse({ errors24h: 1 }))).toBe("watch");
    expect(deriveStatePulseTone(pulse({ actionsPending: 2 }))).toBe("watch");
    expect(deriveStatePulseTone(pulse({ aiErrorRate: 9 }))).toBe("watch");
    expect(deriveStatePulseTone(pulse({ errorsFatal6h: 1 }))).toBe("alert");
  });

  it("renders nothing at all when there is no pulse", () => {
    expect(deriveStatePulseTone(null)).toBeNull();
  });
});
