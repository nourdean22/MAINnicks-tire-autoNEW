/**
 * admin-prune-redirects.test.tsx · 2026-10-19 (job 2026-10-19-admin-prune, W1)
 *
 * Seven sections were folded into others as tabs. The crew opens this admin from
 * home-screen iPhone PWAs, so every old ?tab= value (id AND alias) has to keep
 * landing on the right section AND the right inner tab, through all four ways a
 * slug arrives: the first URL, browser back/forward (popstate), the
 * admin:navigate-section event and a server-supplied link. Before this wave the
 * compound redirects worked on the first load only: popstate and the event
 * called resolveSection, which knows nothing about inner tabs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import * as registry from "../pages/admin/registry";
import * as innerTabs from "../pages/admin/innerTabs";
import { actionVisibleToRole, visibleSectionShortcuts } from "../components/admin/CommandSearch";
import { permissionForAdminProcedure } from "@shared/adminPermissions";

const { useAdminNavigation, sectionsForRole, ADMIN_REGISTRY, getSidebarGroups } = registry;

// [slug, section, innerKey, innerValue]
const REDIRECTS: Array<[string, string, string | null, string | null]> = [
  ["opportunities", "leads", "leadsTab", "opportunities"],
  ["decisioninbox", "leads", "leadsTab", "opportunities"],
  ["decisions", "leads", "leadsTab", "opportunities"],
  ["openwork", "leads", "leadsTab", "opportunities"],
  ["callTrackingView", "voiceReceptionist", "voiceTab", "calls"],
  ["callbacks", "voiceReceptionist", "voiceTab", "calls"],
  ["calls", "voiceReceptionist", "voiceTab", "calls"],
  ["calltracking", "voiceReceptionist", "voiceTab", "calls"],
  ["call-tracking", "voiceReceptionist", "voiceTab", "calls"],
  ["market", "opsHub", "reportsTab", "search"],
  ["gsc", "opsHub", "reportsTab", "search"],
  ["search-console", "opsHub", "reportsTab", "search"],
  ["searchconsole", "opsHub", "reportsTab", "search"],
  ["radar", "opsHub", "reportsTab", "search"],
  ["master-report", "opsHub", "reportsTab", "search"],
  ["trafficFunnel", "opsHub", "reportsTab", "traffic"],
  ["funnel", "opsHub", "reportsTab", "traffic"],
  ["traffic", "opsHub", "reportsTab", "traffic"],
  ["traffic-revenue", "opsHub", "reportsTab", "traffic"],
  ["growth", "content", "contentTab", "local"],
  ["gbp", "content", "contentTab", "local"],
  ["local", "content", "contentTab", "local"],
  ["localseo", "content", "contentTab", "local"],
  ["social", "content", "contentTab", "local"],
  ["memberships", "customers", "customersTab", "members"],
  ["membership", "customers", "customersTab", "members"],
  ["member", "customers", "customersTab", "members"],
  ["nonstop", "customers", "customersTab", "members"],
  ["subscription", "customers", "customersTab", "members"],
  ["intelligence", "customers", "customersTab", "calls"],
  ["intell", "customers", "customersTab", "calls"],
  ["intelligencehq", "customers", "customersTab", "calls"],
  // A pre-existing compound redirect: it must now survive back/forward and the event too.
  ["declined", "revenue", "moneyTab", "declined"],
  ["snapdashboard", "revenue", "moneyTab", "financing"],
  // useSettingsStatus linked ?tab=outreach for months; it resolved nowhere.
  ["outreach", "campaigns", null, null],
];

const params = () => new URLSearchParams(window.location.search);

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe.each(REDIRECTS)("?tab=%s", (slug, section, innerKey, innerValue) => {
  const expectLanded = (got: { section: string; unresolvedSlug: string | null }) => {
    expect(got.section).toBe(section);
    expect(got.unresolvedSlug).toBeNull();
    expect(params().get("tab")).toBe(section);
    if (innerKey) expect(params().get(innerKey)).toBe(innerValue);
  };

  it("lands on first load", () => {
    window.history.replaceState(null, "", `/admin?tab=${slug}`);
    const { result } = renderHook(() => useAdminNavigation());
    expectLanded(result.current);
  });

  it("lands on browser back/forward", () => {
    window.history.replaceState(null, "", "/admin");
    const { result } = renderHook(() => useAdminNavigation());
    act(() => {
      window.history.pushState(null, "", `/admin?tab=${slug}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expectLanded(result.current);
  });

  it("lands from the admin:navigate-section event", () => {
    window.history.replaceState(null, "", "/admin");
    const { result } = renderHook(() => useAdminNavigation());
    act(() => {
      window.dispatchEvent(new CustomEvent("admin:navigate-section", { detail: { section: slug } }));
    });
    expectLanded(result.current);
  });
});

describe("a legacy growthTab survives the move into Website & Local", () => {
  it("?tab=growth&growthTab=photos opens the Photo Queue tab", () => {
    window.history.replaceState(null, "", "/admin?tab=growth&growthTab=photos");
    const { result } = renderHook(() => useAdminNavigation());
    expect(result.current.section).toBe("content");
    expect(params().get("contentTab")).toBe("photos");
  });

  it("a cut growthTab (reviews) falls back to the default, never a blank tab", () => {
    window.history.replaceState(null, "", "/admin?tab=growth&growthTab=reviews");
    renderHook(() => useAdminNavigation());
    expect(innerTabs.resolveInnerTab("content", params().get("contentTab"), "owner")).toBe("manager");
  });
});

describe("retired inner-tab values fall back to the section default", () => {
  it.each([
    ["customers", "loyalty", "customers"],
    ["customers", "coupons", "customers"],
    ["content", "ideas", "manager"],
    ["content", "evals", "manager"],
    ["content", "reviews", "manager"],
    ["opsHub", "messages", "search"],
    ["opsHub", "actions", "search"],
    ["opsHub", "reports", "search"],
    ["voiceReceptionist", "nonsense", "performance"],
    ["leads", "nonsense", "pipeline"],
  ])("%s %s -> %s", (section, raw, expected) => {
    expect(innerTabs.resolveInnerTab(section as innerTabs.InnerTabSection, raw, "owner")).toBe(expected);
  });
});

describe("role gating survives the merge", () => {
  it("an accountant sent to Search or Traffic gets no tab (the section says so), not a page of FORBIDDEN", () => {
    expect(innerTabs.resolveInnerTab("opsHub", "search", "accountant")).toBeNull();
    expect(innerTabs.resolveInnerTab("opsHub", "traffic", "viewer")).toBeNull();
    expect(innerTabs.resolveInnerTab("opsHub", "search", "owner")).toBe("search");
    expect(innerTabs.innerTabsForRole("opsHub", "accountant")).not.toContain("search");
  });

  it("an accountant reaches Customers for the Members tab only, never the customer list", () => {
    expect(sectionsForRole("accountant")).toContain("customers");
    expect(innerTabs.innerTabsForRole("customers", "accountant")).toEqual(["members"]);
    expect(innerTabs.resolveInnerTab("customers", "customers", "accountant")).toBe("members");
    expect(innerTabs.resolveInnerTab("customers", null, "accountant")).toBe("members");
  });

  it("the call list is owner/manager only", () => {
    expect(innerTabs.innerTabsForRole("customers", "front_desk")).toEqual(["customers"]);
    expect(innerTabs.innerTabsForRole("customers", "owner")).toEqual(["customers", "members", "calls"]);
  });

  it("an unknown role sees no restricted tab", () => {
    expect(innerTabs.innerTabsForRole("opsHub", null)).toEqual([]);
    expect(innerTabs.innerTabsForRole("customers", null)).toEqual([]);
  });

  // The absorbed sections' role sets, as they stood before the merge.
  it.each([
    ["opportunities", "leads", ["owner", "manager", "front_desk"]],
    ["callTrackingView", "voiceReceptionist", ["owner", "manager", "front_desk"]],
    ["growth", "content", ["owner", "manager"]],
  ])("%s's roles equal its new home %s's roles", (_old, home, roles) => {
    const entry = ADMIN_REGISTRY.find((s) => s.id === home)!;
    expect([...entry.allowedRoles].sort()).toEqual([...roles].sort());
  });
});

describe("the sidebar after the prune", () => {
  it("owner sees exactly the agreed sections, in order", () => {
    const shape = getSidebarGroups("owner").map((g) => [g.label, g.items.map((i) => i.label)]);
    expect(shape).toEqual([
      ["Daily", ["Today", "Lot", "Approvals", "Customers", "Sales Pipeline", "Money", "Tires"]],
      // "Shop media" is main's owner-only review gate (#3177), not part of the prune.
      ["Reach", ["Website & Local", "Instagram", "Shop media", "Outreach"]],
      ["Automation", ["Voice Receptionist"]],
      ["Truth", ["Reports"]],
      ["System", ["Settings / Safety"]],
    ]);
  });
});

// ── Review round 1 (2026-10-19) ──────────────────────────────────────────────
describe("review round 1: redirects", () => {
  it("a leftover ?id= never beats a redirect: Today with id=55, then the Nonstop Nick event, lands on Members with no id", () => {
    window.history.replaceState(null, "", "/admin?tab=overview&id=55&profileTab=backlog");
    const { result } = renderHook(() => useAdminNavigation());
    act(() => {
      window.dispatchEvent(new CustomEvent("admin:navigate-section", { detail: { section: "memberships" } }));
    });
    expect(result.current.section).toBe("customers");
    expect(params().get("customersTab")).toBe("members");
    expect(params().get("id")).toBeNull();
    expect(params().get("profileTab")).toBeNull();
  });

  it("control: a plain customers link keeps its id (the drawer deep link)", () => {
    window.history.replaceState(null, "", "/admin?tab=customers&id=55");
    renderHook(() => useAdminNavigation());
    expect(params().get("id")).toBe("55");
  });

  it("?tab=growth&growthTab=instagram goes to the Instagram section, as it did before the merge", () => {
    window.history.replaceState(null, "", "/admin?tab=growth&growthTab=instagram");
    const { result } = renderHook(() => useAdminNavigation());
    expect(result.current.section).toBe("instagram");
    expect(params().get("contentTab")).toBeNull();
  });

  it("the legacy leadsTab=followups still opens the Opportunities tab", () => {
    expect(innerTabs.resolveInnerTab("leads", "followups", "owner")).toBe("opportunities");
    expect(innerTabs.resolveInnerTab("leads", "opportunities", "owner")).toBe("opportunities");
  });

  it("a section the role cannot reach says so (role reason) instead of a silent Today", () => {
    window.history.replaceState(null, "", "/admin?tab=intelligence");
    const { result } = renderHook(() => useAdminNavigation());
    act(() => result.current.denySection("overview"));
    expect(result.current.section).toBe("overview");
    expect(result.current.unresolvedSlug).toBe("intelligence");
    expect(result.current.unresolvedReason).toBe("role");
  });
});

describe("review round 1: the palette", () => {
  const OWNER = sectionsForRole("owner");
  const ACCOUNTANT = sectionsForRole("accountant");

  it("an action that opens an inner tab is hidden from a role that cannot see that tab", () => {
    const search = { section: "opsHub" as const, inner: { section: "opsHub" as const, tab: "search" } };
    expect(actionVisibleToRole(search, OWNER, "owner")).toBe(true);
    expect(actionVisibleToRole(search, ACCOUNTANT, "accountant")).toBe(false);
  });

  it("accountant gets no customer-list doors: no Customer Database shortcut, no lapsed/VIP actions", () => {
    const list = { section: "customers" as const, inner: { section: "customers" as const, tab: "customers" } };
    expect(actionVisibleToRole(list, ACCOUNTANT, "accountant")).toBe(false);
    expect(visibleSectionShortcuts(ACCOUNTANT, "accountant").map((s) => s.id)).not.toContain("customers");
    expect(visibleSectionShortcuts(OWNER, "owner").map((s) => s.id)).toContain("customers");
  });
});

// ── PR 3182 review (Codex) ───────────────────────────────────────────────────
describe("PR 3182 review", () => {
  it("the tire markup save needs settings.manage (owner/manager), not workorders.manage", () => {
    expect(permissionForAdminProcedure("gatewayTire.updateMarkup", "mutation")).toBe("settings.manage");
    // control: the rest of gatewayTire.* is unchanged
    expect(permissionForAdminProcedure("gatewayTire.placeOrder", "mutation")).toBe("workorders.manage");
  });

  it("the growthTab=instagram forward consumes growthTab, so a later growth link opens Local", () => {
    window.history.replaceState(null, "", "/admin?tab=growth&growthTab=instagram");
    const { result } = renderHook(() => useAdminNavigation());
    expect(result.current.section).toBe("instagram");
    expect(params().get("growthTab")).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent("admin:navigate-section", { detail: { section: "growth" } }));
    });
    expect(result.current.section).toBe("content");
    expect(params().get("contentTab")).toBe("local");
  });

  it("a refused legacy ?section= link names its slug in the role notice", () => {
    window.history.replaceState(null, "", "/admin?section=settings");
    const { result } = renderHook(() => useAdminNavigation());
    act(() => result.current.denySection("overview"));
    expect(result.current.unresolvedSlug).toBe("settings");
    expect(result.current.unresolvedReason).toBe("role");
  });
});
