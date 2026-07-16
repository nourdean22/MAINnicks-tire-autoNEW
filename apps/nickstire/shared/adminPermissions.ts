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
  if (normalized.startsWith("customers.") || normalized.startsWith("technicians.") || normalized.startsWith("jobassignments.")) return "customers.manage";
  if (normalized.startsWith("lead.") || normalized.startsWith("segments.")) return "leads.manage";
  if (normalized.startsWith("booking.") || normalized.startsWith("dispatch.")) return "bookings.manage";
  if (normalized.startsWith("callback.") || normalized.startsWith("calltracking.")) return "callbacks.manage";
  if (normalized.startsWith("workorders.") || normalized.startsWith("estimates.")) return "workorders.manage";
  if (normalized.startsWith("invoices.") || normalized.startsWith("payments.") || normalized.startsWith("memberships.") || normalized.startsWith("revenueops.") || normalized.startsWith("revenueattribution.")) {
    return type === "mutation" ? "money.manage" : "money.view";
  }
  if (normalized.startsWith("content") || normalized.startsWith("campaigns.") || normalized.startsWith("winback.") || normalized.startsWith("instagramadmin.") || normalized.startsWith("instagramstudio.") || normalized.startsWith("socialpipeline.") || normalized.startsWith("gbp.") || normalized.startsWith("metaadsarchitect.")) return "marketing.manage";
  if (normalized.startsWith("analytics.") || normalized.startsWith("weeklyreport.") || normalized.startsWith("intelligence.") || normalized.startsWith("trafficfunnel.") || normalized.startsWith("smsperformance.") || normalized.startsWith("closedloop.")) return "reports.view";
  if (normalized.startsWith("settings.") || normalized.startsWith("featureflags.") || normalized.startsWith("shopdriver.") || normalized.startsWith("autolabor.") || normalized.startsWith("system.")) return "settings.manage";
  if (normalized.startsWith("adminsecurity.setrole")) return "security.manage";
  return "admin.view";
}
