export const ADMIN_ROLES = ["owner", "manager", "front_desk", "tech", "accountant", "viewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "admin.view",
  "customers.manage",
  "leads.manage",
  "bookings.manage",
  "callbacks.manage",
  "workorders.manage",
  "money.view",
  "money.manage",
  "marketing.manage",
  "reports.view",
  "settings.manage",
  "security.manage",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  owner: ADMIN_PERMISSIONS,
  manager: ["admin.view", "customers.manage", "leads.manage", "bookings.manage", "callbacks.manage", "workorders.manage", "money.view", "money.manage", "marketing.manage", "reports.view", "settings.manage"],
  front_desk: ["admin.view", "customers.manage", "leads.manage", "bookings.manage", "callbacks.manage", "workorders.manage"],
  tech: ["admin.view", "workorders.manage"],
  accountant: ["admin.view", "money.view", "reports.view"],
  viewer: ["admin.view", "reports.view"],
};

export function hasAdminPermission(role: AdminRole | null | undefined, permission: AdminPermission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForAdminRole(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}

/**
 * Central authorization map for legacy routers that already use adminProcedure.
 * This makes RBAC apply to direct API calls as well as navigation visibility.
 */
export function permissionForAdminProcedure(path: string, type: "query" | "mutation" | "subscription"): AdminPermission {
  const normalized = path.toLowerCase();

  // ── Exact-path overrides (checked before every prefix rule) ──────────────
  //
  // adminSecurity.recordAction is the AUDIT-LOG WRITE fired after ordinary
  // operator actions (Overview's confirm/cancel calls it on success). Rolled
  // into adminsecurity.* → security.manage (owner-only), the sequence for any
  // non-owner was: booking confirm SUCCEEDS → receipt write throws FORBIDDEN
  // → mutateAsync rejects → the operator sees a red error for a write that
  // worked, and re-taps an already-confirmed booking. An audit log only the
  // owner may write defeats its own purpose: every role must be able to
  // record its own actions. READING/managing the log stays security.manage —
  // this is the one deliberate mutation→admin.view exception, pinned in
  // adminPermissionCoverage.test.ts.
  if (normalized === "adminsecurity.recordaction") return "admin.view";

  // Physical-security reads are not dashboard reads: cameras returns camera
  // config + stream URLs and cameraFeed returns a live stream URL for one
  // camera — the operational-router QUERY default below handed both to every
  // role including viewer. A FAMILY set, not a single path: the first fix
  // covered `cameras` alone and left its sibling `cameraFeed` wide open.
  if (normalized === "nickactions.cameras" || normalized === "nickactions.camerafeed") {
    return "settings.manage";
  }

  // Bulk export is exfiltration-shaped even though it is a read: export.leads
  // returns up to 10,000 customers' name/phone/email/problem as CSV, and the
  // query default gave it to every role. The comment further down already
  // named "bulk export" part of the dangerous operational surface — the
  // query/mutation split silently undermined that for reads.
  if (normalized.startsWith("export.")) return "settings.manage";
  if (normalized.startsWith("customers.") || normalized.startsWith("technicians.") || normalized.startsWith("jobassignments.")) return "customers.manage";
  if (normalized.startsWith("lead.") || normalized.startsWith("segments.")) return "leads.manage";
  if (normalized.startsWith("booking.") || normalized.startsWith("dispatch.")) return "bookings.manage";
  if (normalized.startsWith("callback.") || normalized.startsWith("calltracking.")) return "callbacks.manage";
  if (normalized.startsWith("workorders.") || normalized.startsWith("estimates.")) return "workorders.manage";
  if (normalized.startsWith("invoices.") || normalized.startsWith("payments.") || normalized.startsWith("memberships.") || normalized.startsWith("revenueops.") || normalized.startsWith("revenueattribution.")) {
    return type === "mutation" ? "money.manage" : "money.view";
  }
  if (normalized.startsWith("content") || normalized.startsWith("campaigns.") || normalized.startsWith("winback.") || normalized.startsWith("instagramadmin.") || normalized.startsWith("instagramstudio.") || normalized.startsWith("socialpipeline.") || normalized.startsWith("gbp.") || normalized.startsWith("metaadsarchitect.")) return "marketing.manage";
  // SPLIT BY TYPE: reports.view is held by viewer and accountant — fine for
  // reading a chart, wrong for whatever mutations these routers grow
  // (closedLoop has write procedures). Reads stay reports.view; writes need
  // an operator-grade permission.
  if (normalized.startsWith("analytics.") || normalized.startsWith("weeklyreport.") || normalized.startsWith("intelligence.") || normalized.startsWith("trafficfunnel.") || normalized.startsWith("smsperformance.") || normalized.startsWith("closedloop.")) {
    return type === "mutation" ? "settings.manage" : "reports.view";
  }
  if (normalized.startsWith("settings.") || normalized.startsWith("featureflags.") || normalized.startsWith("shopdriver.") || normalized.startsWith("autolabor.") || normalized.startsWith("system.")) return "settings.manage";
  // Approval queue: any admin role may SEE the queue; deciding (approve /
  // reject / create) executes internal writes and starts operator-grade.
  if (normalized.startsWith("proposals.")) {
    return type === "mutation" ? "settings.manage" : "admin.view";
  }
  if (normalized.startsWith("adminsecurity.")) return "security.manage";

  // ── Routers that were falling through to admin.view ────────────────────────
  //
  // Measured by running THIS function over every key in the app router: 49 of 85
  // resolved to "admin.view", the weakest permission, held by every role
  // including `viewer`. Among them: nickActions (database migrations, customer
  // CSV import, Meta token reconnect that can return the Page token),
  // adminDashboard (dbCleanupPrune — permanently deletes leads, bookings and
  // callbacks), vapi, sms, gatewayTire, coupons, specials and adStudio, whose
  // own router comment claims "every procedure is owner-gated".
  //
  // LIVE since the 2026-07 authorization fix in _core/trpc.ts: authorization
  // now runs unconditionally (MFA and roles are independent controls), so
  // this resolver governs every adminProcedure call. (An earlier version of
  // this comment said "currently DORMANT" — that went stale the day RBAC was
  // enabled, and a stale claim that a permission map is decorative invites
  // someone to weaken it.)

  /**
   * Dangerous operational surface — migrations, data pruning, credential
   * rotation, bulk export.
   *
   * SPLIT BY TYPE, and the split is load-bearing. A first version mapped these
   * prefixes wholesale to settings.manage and broke 32 tests the moment the
   * permission check was actually enabled: adminDashboard.stats is a QUERY — the
   * main dashboard read that every role needs — and it was being asked for the
   * same permission as dbCleanupPrune, which permanently deletes leads.
   *
   * Reads on an operational router are still just reads. Only the writes here
   * can migrate a schema, prune a table, or hand back a Page token.
   */
  if (
    normalized.startsWith("nickactions.") || normalized.startsWith("admindashboard.") ||
    normalized.startsWith("controlcenter.")
  ) return type === "mutation" ? "settings.manage" : "admin.view";

  // Anything that can reach a customer: texts, calls, reviews, reminders, offers.
  if (
    normalized.startsWith("sms") || normalized.startsWith("reviewrequests.") ||
    normalized.startsWith("reviewreplies.") || normalized.startsWith("reviews.") ||
    normalized.startsWith("servicereviews.") || normalized.startsWith("reminders.") ||
    normalized.startsWith("followups.") || normalized.startsWith("customernotifications.") ||
    normalized.startsWith("messengerbot.") || normalized.startsWith("coupons.") ||
    normalized.startsWith("specials.") || normalized.startsWith("adstudio.") ||
    normalized.startsWith("sharecards.") || normalized.startsWith("gallery.") ||
    normalized.startsWith("seotools.") || normalized.startsWith("localgrowth.") ||
    normalized.startsWith("snap.") || normalized.startsWith("instagram.")
  ) return "marketing.manage";

  // Phone: the shop's real front door (1,945 call logs vs 2 web leads).
  if (normalized.startsWith("vapi.") || normalized.startsWith("voiceagent.")) return "callbacks.manage";

  // Shop floor and the work itself.
  if (
    normalized.startsWith("gatewaytire.") || normalized.startsWith("inspection.") ||
    normalized.startsWith("servicematcher.") || normalized.startsWith("qa.") ||
    normalized.startsWith("shopstatus.")
  ) return "workorders.manage";

  // Money in and money out.
  if (
    normalized.startsWith("financing.") || normalized.startsWith("loyalty.") ||
    normalized.startsWith("referrals.") || normalized.startsWith("portal.") ||
    normalized.startsWith("nourosquote.") || normalized.startsWith("pricing.")
  ) return type === "mutation" ? "money.manage" : "money.view";

  // Customer records.
  if (normalized.startsWith("customerevents.") || normalized.startsWith("garage.")) return "customers.manage";

  // Read-oriented analytics surfaces.
  if (
    normalized.startsWith("activity.") || normalized.startsWith("kpi.") ||
    normalized.startsWith("conversion.") || normalized.startsWith("costestimator.") ||
    normalized.startsWith("statenourmetrics.") || normalized.startsWith("nourosbridge.") ||
    normalized.startsWith("chat.") || normalized.startsWith("emergency.")
  ) return type === "mutation" ? "settings.manage" : "reports.view";

  /**
   * FAIL CLOSED ON MUTATIONS.
   *
   * A read that slips through costs a viewer seeing a number. A WRITE that slips
   * through can delete leads, text customers, spend money, or rotate a
   * credential. Those are not the same risk and must not share a default.
   *
   * `security.manage` is the narrowest permission in the system — owner only —
   * so an unmapped mutation becomes owner-only rather than everyone-allowed. It
   * fails LOUDLY the first time someone who is not the owner calls it, which is
   * the correct direction: a new router that nobody classified should inconvenience
   * exactly one person until it is classified, rather than silently be available
   * to all five roles.
   *
   * Queries keep the permissive default deliberately. Making reads fail closed
   * would break the admin for every non-owner the moment RBAC is enabled, for no
   * safety gain.
   */
  return type === "mutation" ? "security.manage" : "admin.view";
}
