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
 * The resolver is LIVE: _core/trpc.ts applies authorization unconditionally
 * (MFA and roles are independent controls). An earlier version of this header
 * called the fallback "currently DORMANT" — stale since the RBAC enablement,
 * and corrected because a test that claims to guard a decorative map invites
 * someone to weaken the map.
 */
import { describe, it, expect } from "vitest";
import { permissionForAdminProcedure, ADMIN_ROLES, hasAdminPermission } from "../shared/adminPermissions";

/** Every top-level key in server/routers.ts appRouter, verbatim. */
const ROUTERS = `activity adStudio adminDashboard adminSecurity analytics autoLabor booking
callTracking callback campaigns chat closedLoop content contentAdmin contentStudio controlCenter
conversion costEstimator coupons customerEvents customerNotifications customers dispatch emergency
estimates export featureFlags financing followUps gallery garage gatewayTire gbp inspection
instagram instagramAdmin instagramStudio intelligence invoices jobAssignments kpi lead localGrowth
loyalty memberships messengerBot metaAdsArchitect nickActions nourOsBridge payments
portal pricing qa referrals reminders revenueAttribution revenueOps reviewReplies reviewRequests
reviews segments seoTools serviceMatcher serviceReviews shareCards shopStatus shopdriver sms
smsConversations smsOrchestrator smsPerformance snap socialPipeline specials statenourMetrics system
technicians trafficFunnel vapi voiceAgent winback workOrders`.split(/\s+/).filter(Boolean);

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

describe("sensitive READS do not ride the permissive query default (Wave 2)", () => {
  it.each([
    // Bulk export is exfiltration-shaped: up to 10,000 customers' name/phone/
    // email as CSV. It was a .query, so it resolved to admin.view — every
    // role, including viewer, could pull the whole customer database.
    ["export.leads", "settings.manage"],
    ["export.bookings", "settings.manage"],
    ["export.callbacks", "settings.manage"],
    ["export.calls", "settings.manage"],
    // Camera config + stream URLs are physical security, not dashboard reads.
    ["nickActions.cameras", "settings.manage"],
  ] as const)("%s (query) requires %s", (path, expected) => {
    expect(permissionForAdminProcedure(path, "query")).toBe(expected);
  });

  it("reports-family routers split by type — a viewer can read charts, not write", () => {
    expect(permissionForAdminProcedure("closedLoop.overview", "query")).toBe("reports.view");
    expect(permissionForAdminProcedure("closedLoop.recordDecision", "mutation")).toBe("settings.manage");
    expect(permissionForAdminProcedure("intelligence.masterReport", "query")).toBe("reports.view");
    expect(permissionForAdminProcedure("intelligence.rebuild", "mutation")).toBe("settings.manage");
  });

  it("recordAction is the ONE deliberate mutation→admin.view exception: every role must be able to write its own audit entry", () => {
    // Owner-only audit writes made a front_desk booking-confirm SUCCEED and
    // then error on the receipt — a red banner over a write that worked.
    expect(permissionForAdminProcedure("adminSecurity.recordAction", "mutation")).toBe("admin.view");
    // The rest of adminSecurity stays owner-only, including READING the log.
    expect(permissionForAdminProcedure("adminSecurity.listActions", "query")).toBe("security.manage");
    expect(permissionForAdminProcedure("adminSecurity.rotateSecret", "mutation")).toBe("security.manage");
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

describe("approval queue (0111): drafting sits one tier below deciding", () => {
  it.each([
    // The two Phase-7 surfaces carrying the FLAG CALLBACK button (Sales
    // Pipeline, voice call drawer) are front_desk-reachable, and front_desk
    // does not hold settings.manage — create must therefore resolve to a
    // permission front_desk actually has, or the button always throws.
    ["proposals.create", "callbacks.manage"],
    ["proposals.approve", "settings.manage"],
    ["proposals.reject", "settings.manage"],
    ["proposals.retry", "settings.manage"],
    ["proposals.submitForReview", "settings.manage"],
  ] as const)("%s resolves to %s", (path, expected) => {
    expect(permissionForAdminProcedure(path, "mutation")).toBe(expected);
  });

  it("front_desk can draft but can never decide", () => {
    expect(hasAdminPermission("front_desk", permissionForAdminProcedure("proposals.create", "mutation"))).toBe(true);
    expect(hasAdminPermission("front_desk", permissionForAdminProcedure("proposals.approve", "mutation"))).toBe(false);
  });

  it("viewer and accountant cannot even draft", () => {
    for (const role of ["viewer", "accountant"] as const) {
      expect(hasAdminPermission(role, permissionForAdminProcedure("proposals.create", "mutation")), role).toBe(false);
    }
  });

  it("queue reads stay admin.view so every role's shell can render the badge", () => {
    expect(permissionForAdminProcedure("proposals.counts", "query")).toBe("admin.view");
    expect(permissionForAdminProcedure("proposals.list", "query")).toBe("admin.view");
  });
});
