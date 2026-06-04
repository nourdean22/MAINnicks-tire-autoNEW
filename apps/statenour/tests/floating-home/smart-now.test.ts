/**
 * smart-now picker corpus · v10.0.348 · locks in the priority order
 * for the floating-home "DO THIS NOW" suggestion. Per docs/glitch-
 * taxonomy.md Cat 3 (NLU misses) · this is the same regression-armor
 * pattern applied to UX heuristics.
 */

import { describe, expect, it } from "vitest";
import { pickSmartNow } from "@/lib/floating-home/smart-now";
import type { SystemPulse } from "@/lib/hooks/use-system-pulse";

function pulse(overrides: Partial<SystemPulse> = {}): SystemPulse {
  return {
    cronFails24h: 0,
    cronsDrifted: 0,
    errors24h: 0,
    errorsFatal24h: 0,
    aiCalls24h: 0,
    aiFailures24h: 0,
    aiErrorRate: 0,
    actionsPending: 0,
    actionsFailed24h: 0,
    devicesOffline: 0,
    devicesTotal: 0,
    generatedAt: "2026-05-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("pickSmartNow · priority order", () => {
  it("returns critical health-grid suggestion when fatal errors present", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse({ errorsFatal24h: 3, errorsFatal6h: 3 }),
    });
    expect(result?.href).toBe("/system/health");
    expect(result?.urgency).toBe("high");
    expect(result?.label).toMatch(/3 system issues/);
  });

  it("returns critical when cron fails in last hour", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse({ cronFails1h: 2 }),
    });
    expect(result?.href).toBe("/system/health");
    expect(result?.urgency).toBe("high");
  });

  it("returns pending actions suggestion when actionsPending > 0", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse({ actionsPending: 5 }),
    });
    expect(result?.href).toBe("/system/actions");
    expect(result?.urgency).toBe("high");
    expect(result?.label).toMatch(/5 pending/);
  });

  it("returns AI quality suggestion when error rate spikes", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse({ aiErrorRate1h: 45 }),
    });
    expect(result?.href).toBe("/system/health");
    expect(result?.urgency).toBe("medium");
    expect(result?.label).toMatch(/45% AI errors/);
  });

  it("critical beats pending · pending beats quality", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse({
        errorsFatal6h: 1, // critical
        actionsPending: 5, // pending
        aiErrorRate1h: 50, // quality
      }),
    });
    expect(result?.href).toBe("/system/health"); // critical wins
  });

  it("pending beats quality when no critical", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse({
        actionsPending: 3,
        aiErrorRate1h: 50,
      }),
    });
    expect(result?.href).toBe("/system/actions");
  });
});

describe("pickSmartNow · time-of-day defaults", () => {
  it("morning (5-10am) suggests planning", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse(),
      hour: 7,
    });
    // Wave 2 consolidation · /plan → /stats (next.config redirect, permanent).
    expect(result?.href).toBe("/stats");
    expect(result?.label).toMatch(/Plan today/);
  });

  it("afternoon (10am-5pm) suggests tasks", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse(),
      hour: 14,
    });
    // Wave 2 consolidation · /tasks → /missions (next.config redirect).
    expect(result?.href).toBe("/missions");
    expect(result?.label).toMatch(/Active tasks/);
  });

  it("evening (5-10pm) suggests journal", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse(),
      hour: 19,
    });
    expect(result?.href).toBe("/journal");
    expect(result?.label).toMatch(/Journal today/);
  });

  it("late night (10pm-5am) defaults to chat", () => {
    const result = pickSmartNow({
      pathname: "/tasks",
      pulse: pulse(),
      hour: 23,
    });
    expect(result?.href).toBe("/chat");
    expect(result?.label).toMatch(/Ask Nick/);
  });
});

describe("pickSmartNow · skip when already on target", () => {
  it("returns null when on /system/health-grid with critical issue", () => {
    const result = pickSmartNow({
      pathname: "/system/health",
      pulse: pulse({ errorsFatal6h: 3 }),
    });
    // Critical suggests health-grid · skip + fall through to time-of-day
    // (or null if no other applicable signal)
    expect(result?.href).not.toBe("/system/health");
  });

  it("returns null when on /missions during afternoon (already executing)", () => {
    const result = pickSmartNow({
      pathname: "/missions",
      pulse: pulse(),
      hour: 14,
    });
    // Afternoon → /missions (Wave 2: was /tasks) · already there · should
    // fall through to default chat.
    expect(result?.href).toBe("/chat");
  });

  it("falls through to a different suggestion when on the time-of-day target", () => {
    // Morning + on /plan + AI errors · should suggest diagnostics
    const result = pickSmartNow({
      pathname: "/plan",
      pulse: pulse({ aiErrorRate1h: 45 }),
      hour: 7,
    });
    expect(result?.href).toBe("/system/health");
  });

  it("returns null when on /chat at late night with no signals", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: pulse(),
      hour: 23,
    });
    expect(result).toBeNull();
  });
});

describe("pickSmartNow · null pulse", () => {
  it("falls through to time-of-day with null pulse", () => {
    const result = pickSmartNow({
      pathname: "/chat",
      pulse: null,
      hour: 7,
    });
    // Wave 2 consolidation · /plan → /stats.
    expect(result?.href).toBe("/stats");
  });
});
