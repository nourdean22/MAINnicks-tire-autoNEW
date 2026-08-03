/**
 * adminRegistryTruth.test.ts · 2026-08-03
 *
 * The admin registry is now the SINGLE source of truth for sidebar shape,
 * grouping, ordering and role access. These tests exist because every one of
 * those facts previously lived in two places, and in every case the copies had
 * already drifted:
 *
 *  1. `shared/nav.tsx` built ONE group with `label: ""` and threw the
 *     registry's `group` field away. Because nothing rendered `group`, nothing
 *     contradicted it, and it rotted: `intelligence` under "Outreach",
 *     `customers` under "Revenue", `voiceReceptionist` under "Money", and
 *     "Revenue"/"Money" as two names for one concept.
 *  2. That file's header described "9 clean operational sections" and listed
 *     them. The registry carried 14 visible + 2 hidden.
 *  3. `Admin.tsx` held a ROLE_SECTIONS map whose `owner` and `manager` values
 *     were byte-identical 16-element arrays, maintained by hand.
 *  4. `constants.tsx` carried a comment saying `intelligence` was retired,
 *     three lines above the line that defines its title, while it was live in
 *     the sidebar.
 *  5. `.admin-sidebar-group-label` was fully styled in index.css and never
 *     rendered, because the data was flat.
 *
 * The unifying failure is not "duplication". It is that metadata nothing reads
 * cannot be wrong out loud, so it drifts until someone trusts it.
 */
import { describe, expect, it } from "vitest";

import {
  ADMIN_NAV_GROUPS,
  ADMIN_REGISTRY,
  getSidebarGroups,
  resolveSection,
  sectionsForRole,
} from "../pages/admin/registry";
import { SECTION_TITLES } from "../pages/admin/shared/constants";
import { ADMIN_ROLES, type AdminRole } from "@shared/adminPermissions";

/**
 * The role map EXACTLY as it stood in Admin.tsx before it was derived.
 *
 * This is a behaviour pin, not a spec: the refactor must not have quietly
 * granted or revoked anyone's access. Changing a role is legitimate — but it
 * has to be a deliberate edit here, not a silent by-product.
 */
const LEGACY_ROLE_SECTIONS: Record<AdminRole, readonly string[]> = {
  owner: ["overview", "intelligence", "customers", "leads", "tireOrders", "growth", "instagram", "campaigns", "memberships", "voiceReceptionist", "opsHub", "settings", "revenue", "callTrackingView", "trafficFunnel", "content"],
  manager: ["overview", "intelligence", "customers", "leads", "tireOrders", "growth", "instagram", "campaigns", "memberships", "voiceReceptionist", "opsHub", "settings", "revenue", "callTrackingView", "trafficFunnel", "content"],
  front_desk: ["overview", "customers", "leads", "tireOrders", "voiceReceptionist", "callTrackingView"],
  tech: ["overview", "customers", "tireOrders"],
  accountant: ["overview", "revenue", "memberships", "opsHub", "trafficFunnel"],
  viewer: ["overview", "intelligence", "opsHub"],
};

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("role access survived the move into the registry", () => {
  it.each(ADMIN_ROLES)("%s reaches exactly the sections it reached before", (role) => {
    expect(sorted(sectionsForRole(role))).toEqual(sorted(LEGACY_ROLE_SECTIONS[role]));
  });

  it("owner and manager still reach every section — they were duplicate arrays", () => {
    expect(sorted(sectionsForRole("owner"))).toEqual(sorted(sectionsForRole("manager")));
    expect(sectionsForRole("owner")).toHaveLength(ADMIN_REGISTRY.length);
  });

  it("every section names at least one role — an unreachable section cannot run", () => {
    for (const s of ADMIN_REGISTRY) {
      expect(s.allowedRoles.length, `${s.id} has no allowedRoles`).toBeGreaterThan(0);
    }
  });
});

describe("grouping is real, and every section is placed", () => {
  it("every section declares a known group", () => {
    for (const s of ADMIN_REGISTRY) {
      expect(ADMIN_NAV_GROUPS, `${s.id} group "${s.group}"`).toContain(s.group);
    }
  });

  it("no section still carries a retired group name", () => {
    // The rotted set. If one of these reappears, the registry regressed to
    // metadata that the sidebar cannot render.
    const retired = ["Operations", "Outreach", "Revenue", "Money", "Sales"];
    for (const s of ADMIN_REGISTRY) {
      expect(retired, `${s.id}`).not.toContain(s.group as string);
    }
  });

  it("groups render in declared order with no empty headings", () => {
    const groups = getSidebarGroups("owner");
    expect(groups.length).toBeGreaterThan(1); // the whole point: not one flat list
    for (const g of groups) {
      expect(g.label).not.toBe("");
      expect(g.items.length).toBeGreaterThan(0);
    }
    const order = groups.map((g) => g.label);
    expect(order).toEqual([...ADMIN_NAV_GROUPS].filter((g) => order.includes(g)));
  });

  it("priorities are unique within a group, so ordering is not accidental", () => {
    for (const group of ADMIN_NAV_GROUPS) {
      const ps = ADMIN_REGISTRY.filter((s) => s.group === group).map((s) => s.priority);
      expect(new Set(ps).size, `duplicate priority in ${group}`).toBe(ps.length);
    }
  });

  it("sidebar items come back sorted by priority", () => {
    for (const g of getSidebarGroups("owner")) {
      const priorities = g.items.map((i) => ADMIN_REGISTRY.find((s) => s.id === i.id)!.priority);
      expect(priorities, `${g.label} out of order`).toEqual([...priorities].sort((a, b) => a - b));
    }
  });
});

describe("no section can become unreachable", () => {
  it("every sidebar-visible section is in the owner sidebar", () => {
    const shown = getSidebarGroups("owner").flatMap((g) => g.items.map((i) => i.id));
    const expected = ADMIN_REGISTRY.filter((s) => s.showInSidebar).map((s) => s.id);
    expect(sorted(shown)).toEqual(sorted(expected));
  });

  it("a hidden section still has an alias, or it has no door at all", () => {
    // showInSidebar:false is only acceptable when SOMETHING can still reach it.
    // Money and Content were once hidden with no visible door on an iPhone PWA
    // where Cmd+K does not exist; that is the regression this guards.
    for (const s of ADMIN_REGISTRY.filter((x) => !x.showInSidebar)) {
      expect(s.aliases?.length ?? 0, `${s.id} is hidden with no alias`).toBeGreaterThan(0);
    }
  });

  it("every registry id resolves to itself", () => {
    for (const s of ADMIN_REGISTRY) expect(resolveSection(s.id)).toBe(s.id);
  });

  it("every alias resolves to its own section — no cross-section collisions", () => {
    for (const s of ADMIN_REGISTRY) {
      for (const alias of s.aliases ?? []) {
        expect(resolveSection(alias), `alias "${alias}" on ${s.id}`).toBe(s.id);
      }
    }
  });
});

describe("SECTION_TITLES parity — the labels must not drift again", () => {
  it("titles and registry labels agree exactly", () => {
    for (const s of ADMIN_REGISTRY) {
      expect(SECTION_TITLES[s.id], `title for ${s.id}`).toBe(s.label);
    }
  });

  it("neither side carries a section the other lacks", () => {
    expect(sorted(Object.keys(SECTION_TITLES))).toEqual(sorted(ADMIN_REGISTRY.map((s) => s.id)));
  });

  it("intelligence is present and live — a comment once claimed it was retired", () => {
    expect(SECTION_TITLES.intelligence).toBe("Intelligence HQ");
    expect(ADMIN_REGISTRY.find((s) => s.id === "intelligence")?.showInSidebar).toBe(true);
  });
});
