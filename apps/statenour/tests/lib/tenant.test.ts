/**
 * Tests for lib/db/tenant.ts (v8.5 BATCH 30).
 *
 * Skeleton-stage helper — pre-migration the helpers no-op. Tests
 * pin the contract so future-me doesn't accidentally regress the
 * adoption surface when the schema lands.
 */

import { describe, it, expect } from "vitest";
import {
  withTenant,
  currentTenantId,
  tenantScope,
  tenantStamp,
  isKnownTenant,
  MULTI_TENANT_ENABLED,
} from "@/lib/db/tenant";

describe("tenant skeleton", () => {
  it("currentTenantId defaults to 'single' outside withTenant scope", () => {
    expect(currentTenantId()).toBe("single");
  });

  it("withTenant sets the active tenant", async () => {
    let inner: string = "";
    await withTenant("single", () => {
      inner = currentTenantId();
    });
    expect(inner).toBe("single");
  });

  it("withTenant restores the prior tenant after scope ends", async () => {
    expect(currentTenantId()).toBe("single");
    await withTenant("single", () => {
      // nested scope
    });
    expect(currentTenantId()).toBe("single");
  });

  it("tenantScope returns empty object pre-migration", () => {
    expect(tenantScope()).toEqual({});
  });

  it("tenantStamp returns empty object pre-migration", () => {
    expect(tenantStamp()).toEqual({});
  });

  it("isKnownTenant accepts 'single' and rejects others", () => {
    expect(isKnownTenant("single")).toBe(true);
    expect(isKnownTenant("hacker-attempt")).toBe(false);
    expect(isKnownTenant("")).toBe(false);
  });

  it("MULTI_TENANT_ENABLED is false today (will flip when migration lands)", () => {
    expect(MULTI_TENANT_ENABLED).toBe(false);
  });
});
