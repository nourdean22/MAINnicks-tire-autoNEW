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
