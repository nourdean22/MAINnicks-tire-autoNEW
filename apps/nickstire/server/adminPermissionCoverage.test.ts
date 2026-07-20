/**
 * No admin MUTATION may fall through to the weakest permission.
 *
 * `permissionForAdminProcedure` ended with `return "admin.view"` — the weakest
 * permission, held by every role including `viewer`. Running the real resolver
 * over every key in the app router measured the blast radius: 49 of 85 routers
 * resolved there, including
 *
 *   nickActions      database migrations, customer CSV import, Meta token
 *                    reconnect (can return the Page token)
 *   adminDashboard   dbCleanupPrune — permanently deletes leads/bookings/callbacks
 *   adminSecurity    everything except setRole
 *   vapi, sms, gatewayTire, coupons, specials, adStudio
 *
 * adStudio's own router comment claims "every procedure is owner-gated". It was
 * resolving to admin.view.
 *
 * THE SEQUENCING TRAP THIS TEST EXISTS TO HOLD:
 * the fallback is currently DORMANT — _core/trpc.ts:90 early-returns when MFA is
 * not required and never reaches the resolver. So enabling RBAC (C2) WITHOUT this
 * fix would activate a fail-open default for half the application in the same
 * commit. Both audit reports listed C2 before C3. That order opens the hole it is
 * trying to close.
 */
import { describe, it, expect } from "vitest";
import { permissionForAdminProcedure, ADMIN_ROLES, hasAdminPermission } from "../shared/adminPermissions";

/** Every top-level key in server/routers.ts appRouter, verbatim. */
const ROUTERS = `activity adStudio adminDashboard adminSecurity analytics autoLabor booking
callTracking callback campaigns chat closedLoop content contentAdmin contentStudio controlCenter
conversion costEstimator coupons customerEvents customerNotifications customers dispatch emergency
estimates export featureFlags financing followUps gallery garage gatewayTire gbp inspection
instagram instagramAdmin instagramStudio intelligence invoices jobAssignments kpi lead localGrowth
loyalty memberships messengerBot metaAdsArchitect nickActions nourOsBridge nourOsQuote payments
portal pricing qa referrals reminders revenueAttribution revenueOps reviewReplies reviewRequests
reviews segments seoTools serviceMatcher serviceReviews shareCards shopStatus shopdriver sms smsBot
smsConversations smsOrchestrator smsPerformance snap socialPipeline specials statenourMetrics system
technicians trafficFunnel vapi voiceAgent weeklyReport winback workOrders`.split(/\s+/).filter(Boolean);

describe("every admin mutation is explicitly permissioned", () => {
  it("NO router resolves a mutation to admin.view", () => {
    const failOpen = ROUTERS.filter(
      (r) => permissionForAdminProcedure(`${r}.anyMutation`, "mutation") === "admin.view",
    );
    expect(failOpen, `these routers fail OPEN on mutations: ${failOpen.join(", ")}`).toEqual([]);
  });

  it.each([
    ["nickActions.runMigrations", "settings.manage"],
    ["adminDashboard.dbCleanupPrune", "settings.manage"],
    ["adStudio.post", "marketing.manage"],
    ["adminSecurity.rotateSecret", "security.manage"],
    ["vapi.transferCall", "callbacks.manage"],
    ["sms.sendBlast", "marketing.manage"],
    ["gatewayTire.placeOrder", "workorders.manage"],
    ["financing.approve", "money.manage"],
  ])("%s resolves to %s", (path, expected) => {
    expect(permissionForAdminProcedure(path, "mutation")).toBe(expected);
  });

  it("an UNKNOWN future router fails closed on mutations, not open", () => {
    // The whole point: a router nobody has classified yet must inconvenience the
    // owner, not be quietly available to all five roles.
    const p = permissionForAdminProcedure("somethingInventedNextYear.deleteEverything", "mutation");
    expect(p).not.toBe("admin.view");
    expect(p).toBe("security.manage");
  });

  it("...and only the owner holds that fallback permission", () => {
    const allowed = ADMIN_ROLES.filter((r) => hasAdminPermission(r, "security.manage"));
    expect(allowed).toEqual(["owner"]);
  });
});

describe("queries stay permissive on purpose", () => {
  it("an unknown QUERY still resolves to admin.view", () => {
    // Making reads fail closed would break the admin for every non-owner the
    // moment RBAC is enabled, for no safety gain. A read costs a viewer seeing a
    // number; a write can delete leads or spend money.
    expect(permissionForAdminProcedure("somethingInventedNextYear.list", "query")).toBe("admin.view");
  });

  it("every role can hold admin.view, which is why it is unsafe for writes", () => {
    for (const r of ADMIN_ROLES) expect(hasAdminPermission(r, "admin.view")).toBe(true);
  });
});

describe("the mappings that already existed still hold", () => {
  it.each([
    ["customers.update", "customers.manage"],
    ["lead.assign", "leads.manage"],
    ["booking.confirm", "bookings.manage"],
    ["workOrders.close", "workorders.manage"],
    ["invoices.void", "money.manage"],
    ["contentAdmin.publishReel", "marketing.manage"],
    ["settings.update", "settings.manage"],
  ])("%s still resolves to %s", (path, expected) => {
    expect(permissionForAdminProcedure(path, "mutation")).toBe(expected);
  });
});
