import { describe, expect, it } from "vitest";
import { getBusinessDateKey, isBusinessDate } from "@/lib/businessDate";
import { classifyIntegrationFreshness } from "@/lib/integrationFreshness";
import { getQueueActionDefinition } from "@/pages/admin/today/queueActions";
import { hasAdminPermission } from "@shared/adminPermissions";
import { generateTotpCode, generateTotpSecret, verifyTotpCode } from "../../../server/lib/totp";

describe("Cleveland business date", () => {
  it("does not roll to tomorrow at 8pm Eastern", () => {
    expect(getBusinessDateKey(new Date("2026-07-17T00:30:00.000Z"))).toBe("2026-07-16");
    expect(isBusinessDate("2026-07-17T00:30:00.000Z", "2026-07-16")).toBe(true);
  });
});

describe("truthful queue actions", () => {
  it("never describes callback completion or work-order navigation as deletion", () => {
    expect(getQueueActionDefinition("callback").secondaryLabel).toBe("Open callback");
    expect(getQueueActionDefinition("workOrder").primaryLabel).toBe("Open work order");
  });
  it("uses entity-specific primary labels", () => {
    expect(getQueueActionDefinition("booking").primaryLabel).toBe("Confirm booking");
    expect(getQueueActionDefinition("lead").primaryLabel).toBe("Mark contacted");
  });
});

describe("integration freshness", () => {
  it("distinguishes fresh, stale, offline, and unknown", () => {
    const now = new Date("2026-07-16T15:00:00Z");
    expect(classifyIntegrationFreshness({ connected: true, lastSuccessfulAt: "2026-07-16T14:55:00Z", staleAfterMinutes: 30, now }).state).toBe("fresh");
    expect(classifyIntegrationFreshness({ connected: true, lastSuccessfulAt: "2026-07-16T13:00:00Z", staleAfterMinutes: 30, now }).state).toBe("stale");
    expect(classifyIntegrationFreshness({ connected: false, staleAfterMinutes: 30, now }).state).toBe("offline");
    expect(classifyIntegrationFreshness({ connected: true, staleAfterMinutes: 30, now }).state).toBe("unknown");
  });
});

describe("admin permissions", () => {
  it("reserves security management for the owner", () => {
    expect(hasAdminPermission("owner", "security.manage")).toBe(true);
    expect(hasAdminPermission("manager", "security.manage")).toBe(false);
  });
  it("keeps front desk out of money management", () => {
    expect(hasAdminPermission("front_desk", "bookings.manage")).toBe(true);
    expect(hasAdminPermission("front_desk", "money.manage")).toBe(false);
  });
});

describe("TOTP", () => {
  it("generates and verifies a time-bound six-digit code", () => {
    const secret = generateTotpSecret();
    const timeMs = Date.parse("2026-07-16T15:00:00Z");
    const code = generateTotpCode(secret, timeMs);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, { timeMs, window: 0 })).toBe(true);
    expect(verifyTotpCode(secret, "000000", { timeMs, window: 0 })).toBe(false);
  });
});
