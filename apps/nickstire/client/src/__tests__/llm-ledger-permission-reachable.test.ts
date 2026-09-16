/**
 * A panel must not mount for a role that cannot call it.
 *
 * The LLM-usage panel mounts unconditionally on Intelligence HQ's default tab.
 * The first draft put its procedure on the `system.` prefix, which
 * shared/adminPermissions.ts maps to `settings.manage` — and registry.tsx
 * grants the `intelligence` section to `viewer`, who does not hold it. So a
 * viewer's only possible outcome was a request that could only fail, rendered
 * as a "Ledger unreadable" card that blamed the database for a permission
 * decision. adminPermissions.ts already carries the same lesson for
 * `proposals.create`: "a button the gate refuses is the exact class the
 * palette role-scoping exists to prevent."
 *
 * This derives both sides rather than restating them: the roles come from
 * `sectionsForRole()` (the registry is the single source of truth for section
 * access) and the permission from `permissionForAdminProcedure()`. Change
 * either one incompatibly and this goes red.
 */
import { describe, expect, it } from "vitest";

import { ADMIN_ROLES, hasAdminPermission, permissionForAdminProcedure } from "@shared/adminPermissions";
import { sectionsForRole } from "@/pages/admin/registry";

const PROCEDURE = "system.llmLedger";

describe("system.llmLedger is callable by every role that can reach the panel", () => {
  const permission = permissionForAdminProcedure(PROCEDURE, "query");

  const rolesOnIntelligence = ADMIN_ROLES.filter((role) =>
    (sectionsForRole(role) as readonly string[]).includes("intelligence"),
  );

  it("the registry really does grant the section to more than the owner tier", () => {
    // Guard against a vacuous pass: if this list were empty the loop below
    // would assert nothing at all.
    expect(rolesOnIntelligence.length).toBeGreaterThan(1);
  });

  it.each(rolesOnIntelligence)("%s can call it", (role) => {
    expect(
      hasAdminPermission(role, permission),
      `${role} can open Intelligence HQ but lacks "${permission}", so the panel would render a failure card for a permission decision`,
    ).toBe(true);
  });

  it("resolves to a read permission, not an operator-grade one", () => {
    // Documents the deliberate choice: the projection is counts, token sums,
    // latency and lane/provider names, and excludes the `error` column, so no
    // provider error text or prompt fragment leaves the server.
    expect(permission).toBe("reports.view");
  });

  it("stays a query-only path — nothing here should widen a mutation", () => {
    expect(permissionForAdminProcedure(PROCEDURE, "mutation")).toBe("reports.view");
  });
});
