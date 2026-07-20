/**
 * The admin shell was half-connected in production, permanently, and silently.
 *
 * `adminReady` required `mfaEnabled === true` unconditionally. The server reports
 * `mfaEnabled: false, mfaVerified: true` when enforcement is OFF
 * (adminSecurity.ts:33-39), and ADMIN_MFA_REQUIRED is unset in production — so
 * the flag was FALSE for every admin session that has ever run.
 *
 * That disabled the overview bundle (Admin.tsx:117), shop-floor work orders
 * (:123), and <AdminSSEProvider enabled> (:247) — i.e. every real-time
 * invalidation for leads, bookings, callbacks, invoices, payments, work orders
 * and reviews.
 *
 * The admin still LOOKED fine because individual sections fetch their own data.
 * A half-connected shell that renders correctly is the hardest kind of defect to
 * notice, which is why it lasted.
 */
import { describe, it, expect } from "vitest";
import { readCode, readSource } from "./testUtils/sourceAssertions";

const admin = readSource("client/src/pages/Admin.tsx");

/** The shipped predicate, mirrored so the states below are executable. */
const adminReady = (
  isAdmin: boolean,
  security: { mfaRequired: boolean; mfaEnabled: boolean; mfaVerified: boolean } | undefined,
) => isAdmin && !!security && (!security.mfaRequired || (security.mfaEnabled === true && security.mfaVerified === true));

describe("readiness follows the bar the SERVER is enforcing", () => {
  it("MFA NOT required — the live production shape — is READY", () => {
    // adminSecurity.ts:33-39 returns exactly this when ADMIN_MFA_REQUIRED is unset.
    // Under the old predicate this was false, which is the entire bug.
    expect(adminReady(true, { mfaRequired: false, mfaEnabled: false, mfaVerified: true })).toBe(true);
  });

  it("MFA required and fully verified is READY", () => {
    expect(adminReady(true, { mfaRequired: true, mfaEnabled: true, mfaVerified: true })).toBe(true);
  });

  it("MFA required but NOT enrolled is not ready", () => {
    expect(adminReady(true, { mfaRequired: true, mfaEnabled: false, mfaVerified: false })).toBe(false);
  });

  it("MFA required, enrolled, but verification STALE is not ready", () => {
    expect(adminReady(true, { mfaRequired: true, mfaEnabled: true, mfaVerified: false })).toBe(false);
  });

  it("a non-admin is never ready, whatever the MFA state", () => {
    expect(adminReady(false, { mfaRequired: false, mfaEnabled: true, mfaVerified: true })).toBe(false);
  });

  it("status not yet loaded is not ready — loading is not permission", () => {
    expect(adminReady(true, undefined)).toBe(false);
  });
});

describe("the shipped predicate is the one tested here", () => {
  it("keys off mfaRequired, not mfaEnabled alone", () => {
    expect(admin).toMatch(/!security\.mfaRequired \|\| \(security\.mfaEnabled === true && security\.mfaVerified === true\)/);
  });

  it("no longer demands mfaEnabled unconditionally", () => {
    expect(readCode("client/src/pages/Admin.tsx"))
      .not.toMatch(/adminReady = isAdmin && security\?\.mfaEnabled === true && security\.mfaVerified === true/);
  });

  it("still gates the three things it is supposed to gate", () => {
    // If a future edit drops adminReady from any of these, the shell silently
    // starts loading data it should not — the opposite failure, equally quiet.
    const uses = admin.match(/enabled: adminReady|enabled=\{adminReady\}/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });
});
