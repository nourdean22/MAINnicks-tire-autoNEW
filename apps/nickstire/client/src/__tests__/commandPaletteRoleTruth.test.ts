/**
 * commandPaletteRoleTruth.test.ts · 2026-08-04
 *
 * The command palette (⌘K on desktop, the floating Zap sheet on the phone)
 * must derive its offering from the registry's role data. Admin.tsx has
 * always gated `onNavigate` with `allowedSections`, but the palette listed
 * every section and every navigating quick action regardless of role — so a
 * front_desk user was offered sections whose selection silently did nothing.
 * A menu that offers what the gate refuses is the interactive cousin of the
 * ROS-083 false all-clear: the control looks live and the tap goes nowhere.
 *
 * These pins compare the palette against `sectionsForRole` — the registry
 * function Admin.tsx itself uses — never against a hand-kept list, so a
 * deliberate role change moves both sides together and only a break in the
 * derivation turns them red.
 */
import { describe, expect, it } from "vitest";

import {
  actionVisibleToRole,
  visibleSectionShortcuts,
} from "../components/admin/CommandSearch";
import { ADMIN_REGISTRY, sectionsForRole } from "../pages/admin/registry";
import { ADMIN_ROLES } from "@shared/adminPermissions";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("section shortcuts are role-scoped", () => {
  it.each(ADMIN_ROLES)(
    "%s is offered exactly the sections it can open",
    (role) => {
      const allowed = sectionsForRole(role);
      const offered = visibleSectionShortcuts(allowed).map((s) => s.id);
      expect(sorted(offered)).toEqual(sorted(allowed));
    },
  );

  it("owner still browses the full registry — no over-filtering", () => {
    expect(visibleSectionShortcuts(sectionsForRole("owner"))).toHaveLength(
      ADMIN_REGISTRY.length,
    );
  });

  it("a restricted role is not offered a door the gate would refuse", () => {
    // Derived, not hardcoded: any section the owner has and front_desk lacks.
    const frontDesk = sectionsForRole("front_desk");
    const ownerOnly = sectionsForRole("owner").filter(
      (s) => !frontDesk.includes(s),
    );
    // The restricted-role model itself is pinned in adminRegistryTruth; this
    // guards against it degenerating into "everyone sees everything".
    expect(ownerOnly.length).toBeGreaterThan(0);
    const offered = visibleSectionShortcuts(frontDesk).map((s) => s.id);
    for (const s of ownerOnly) {
      expect(offered, `front_desk offered "${s}"`).not.toContain(s);
    }
  });
});

describe("quick actions are role-scoped by their navigation target", () => {
  it("an action with no section is a drilldown/mutation and stays visible", () => {
    for (const role of ADMIN_ROLES) {
      expect(actionVisibleToRole({}, sectionsForRole(role))).toBe(true);
    }
  });

  it.each(ADMIN_ROLES)(
    "%s sees a navigating action iff it can reach the target",
    (role) => {
      const allowed = sectionsForRole(role);
      for (const target of ADMIN_REGISTRY.map((s) => s.id)) {
        expect(actionVisibleToRole({ section: target }, allowed)).toBe(
          allowed.includes(target),
        );
      }
    },
  );
});
