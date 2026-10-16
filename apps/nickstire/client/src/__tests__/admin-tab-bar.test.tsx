/**
 * Admin UI v1 Wave 1: the phone bottom bar (apps/nickstire/docs/design/admin-ui-v1/PLAN.md section 3, W1).
 *
 * The bar navigates and never acts (HIG tab bars): Today, Lot, Approvals, Customers, then Search, each
 * slot only when the role may open that section, topped up from the Daily group in priority order so a
 * restricted role is not left with a half-empty bar. Search opens the same command palette the old
 * floating button opened, through the palette's own window event, so there is still one palette.
 *
 * Slot sets are derived from the registry (getSidebarGroups / sectionsForRole) where a role's Daily list
 * decides them, and spelled out for owner, where the decided design is the contract.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/trpc", () => {
  const query = () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: () => {}, isFetching: false });
  const mutation = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, reset: () => {} });
  const node = (): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useInfiniteQuery") return query;
        if (key === "useMutation") return mutation;
        return node();
      },
    });
  return { trpc: new Proxy({}, { get: (_t, key) => (key === "useUtils" ? () => node() : node()) }) };
});

import { AdminTabBar } from "@/components/admin/AdminTabBar";
import { CommandSearch, openCommandSearch } from "@/components/admin/CommandSearch";
import { getSidebarGroups, sectionsForRole } from "@/pages/admin/registry";
import type { AdminSignal } from "@shared/adminSignal";
import type { AdminRole } from "@shared/adminPermissions";

const noop = () => {};
const renderBar = (role: AdminRole, extra: Partial<React.ComponentProps<typeof AdminTabBar>> = {}) =>
  render(<AdminTabBar role={role} active="overview" signals={[]} onNavigate={noop} onSearch={noop} {...extra} />);
const bar = () => screen.getByRole("navigation", { name: "Primary sections" });
const slotNames = () => within(bar()).getAllByRole("button").map((b) => b.getAttribute("data-slot"));

const signal = (section: string, reading: AdminSignal["reading"]): AdminSignal => ({
  id: `t-${section}`,
  section,
  label: "held items",
  reading,
  severity: "warning",
  source: "test.fixture",
  updatedAt: null,
} as AdminSignal);

afterEach(() => vi.restoreAllMocks());

describe("AdminTabBar slots", () => {
  it("owner gets Today, Lot, Approvals, Customers and Search, in that order", () => {
    renderBar("owner");
    expect(slotNames()).toEqual(["overview", "lot", "approvals", "customers", "search"]);
    expect(within(bar()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Today", "Lot", "Approvals", "Customers", "Search"]);
  });

  it.each(["front_desk", "tech", "accountant", "viewer"] as const)(
    "%s sees only sections it may open, topped up from Daily to four, then Search",
    (role) => {
      renderBar(role);
      const allowed = sectionsForRole(role);
      const names = slotNames();
      expect(names[names.length - 1]).toBe("search");
      const sections = names.slice(0, -1) as string[];
      for (const s of sections) expect(allowed, `${role} offered ${s}`).toContain(s);
      const daily = getSidebarGroups(role).find((g) => g.label === "Daily")?.items.map((i) => i.id) ?? [];
      expect(sections.length).toBe(Math.min(4, daily.length));
      // Never a slot for a section the role lacks (Approvals and Lot are owner/manager only).
      if (!allowed.includes("approvals")) expect(sections).not.toContain("approvals");
      if (!allowed.includes("revenue")) expect(sections).not.toContain("revenue");
    },
  );

  it("front_desk fills its two missing slots from Daily in priority order", () => {
    renderBar("front_desk");
    const daily = getSidebarGroups("front_desk").find((g) => g.label === "Daily")!.items.map((i) => i.id);
    const fills = daily.filter((id) => !["overview", "lot", "approvals", "customers"].includes(id)).slice(0, 2);
    expect(slotNames()).toEqual(["overview", "customers", ...fills, "search"]);
  });
});

describe("AdminTabBar behaviour", () => {
  it("marks only the active slot with aria-current=page", () => {
    renderBar("owner", { active: "lot" });
    const current = within(bar()).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");
    expect(current.map((b) => b.getAttribute("data-slot"))).toEqual(["lot"]);
  });

  it("a section slot navigates and Search calls onSearch, never navigation", () => {
    const onNavigate = vi.fn();
    const onSearch = vi.fn();
    renderBar("owner", { onNavigate, onSearch });
    fireEvent.click(within(bar()).getByText("Customers"));
    expect(onNavigate).toHaveBeenCalledWith("customers");
    fireEvent.click(within(bar()).getByText("Search"));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("every slot is at least 44 px tall and the bar reserves the safe area", () => {
    renderBar("owner");
    for (const b of within(bar()).getAllByRole("button")) expect(b.className).toMatch(/(^|\s)min-h-11(\s|$)/);
    expect(bar().className).toMatch(/(^|\s)lg:hidden(\s|$)/);
    // jsdom drops env() from inline styles and computes no CSS, so the Tailwind tokens are the receipt.
    expect(bar().className).toMatch(/(^|\s)h-\[calc\(56px\+env\(safe-area-inset-bottom,0px\)\)\](\s|$)/);
    expect(bar().className).toMatch(/(^|\s)pb-\[env\(safe-area-inset-bottom,0px\)\](\s|$)/);
  });

  it("badges carry the three states: a count, ? for unknown, nothing when not measured", () => {
    renderBar("owner", {
      signals: [
        signal("approvals", { state: "counted", count: 3 }),
        signal("lot", { state: "unknown", reason: "lot read failed" }),
        signal("customers", { state: "not_measured", reason: "nothing measures this" }),
      ],
    });
    const slot = (id: string) => within(bar()).getAllByRole("button").find((b) => b.getAttribute("data-slot") === id)!;
    expect(within(slot("approvals")).getByText("3")).toBeTruthy();
    expect(within(slot("lot")).getByLabelText("outstanding work unknown").textContent).toBe("?");
    expect(slot("customers").querySelector("[data-badge]")).toBeNull();
  });

  it("the Approvals count is the one gold mark (owner priority); other counts stay neutral red", () => {
    renderBar("owner", {
      signals: [signal("approvals", { state: "counted", count: 2 }), signal("customers", { state: "counted", count: 5 })],
    });
    const badge = (id: string) => within(bar()).getAllByRole("button").find((b) => b.getAttribute("data-slot") === id)!.querySelector("[data-badge]")!;
    expect(badge("approvals").className).toContain("var(--owner-priority)");
    expect(badge("customers").className).not.toContain("var(--owner-priority)");
  });
});

describe("Search reaches the one command palette", () => {
  it("openCommandSearch() opens the palette that CommandSearch renders", () => {
    render(<CommandSearch allowedSections={sectionsForRole("owner")} onNavigate={noop} onSelectCustomer={noop} />);
    expect(screen.queryByRole("dialog", { name: "Command search" })).toBeNull();
    act(() => openCommandSearch());
    expect(screen.getByRole("dialog", { name: "Command search" })).toBeTruthy();
  });

  it("the floating Quick actions button is gone (the bar's Search replaces it)", () => {
    render(<CommandSearch allowedSections={sectionsForRole("owner")} onNavigate={noop} onSelectCustomer={noop} />);
    expect(screen.queryByLabelText("Quick actions")).toBeNull();
  });
});
