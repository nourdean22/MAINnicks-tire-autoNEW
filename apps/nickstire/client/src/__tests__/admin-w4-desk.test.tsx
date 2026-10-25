/**
 * Admin UI v1 Wave 4, the Desk pages (apps/nickstire/docs/design/admin-ui-v1/PLAN.md sections 3, 6 and 9):
 * find a customer from the bar, trust every profile tab, and never read a failed member lookup as
 * "not a member". (The work-order and dispatch cases left with those screens on 2026-10-25; Today's
 * Open work order is pinned in admin-w0-honesty.test.tsx.)
 *
 * Same tRPC proxy as admin-w0-honesty.test.tsx: every query returns { data: undefined } unless the test
 * sets an override for its dotted path. A paused query (offline PWA) is modelled the way TanStack Query v5
 * reports it: data undefined, isError false, isLoading false, fetchStatus "paused". The Rule from W5: a
 * paused read is unknown, never empty or zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean; fetchStatus: string; isPaused: boolean };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  calls: [] as Array<[string, unknown]>,
  opts: new Map<string, any>(),
  mutations: new Map<string, (opts: any) => unknown>(),
  confirm: vi.fn(async () => true),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  user: { role: "admin" } as { role: string } | null,
  Null: () => null,
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => (input: unknown, opts?: unknown) => {
    h.calls.push([path, input]);
    h.opts.set(path, opts);
    return {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: () => {},
      isFetching: false,
      fetchStatus: "idle",
      isPaused: false,
      ...h.queries.get(path),
    };
  };
  const mutation = (path: string) => (opts: any) =>
    h.mutations.get(path)?.(opts) ?? { mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false, reset: () => {} };
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation(path);
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  const root = new Proxy({}, {
    get(_t, key) {
      if (key === "useUtils" || key === "useContext") return () => node("utils");
      return node(String(key));
    },
  });
  return { trpc: root };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: h.toastSuccess, error: h.toastError, info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm, default: h.Null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));

import MembershipsSection from "@/pages/admin/MembershipsSection";
import CustomerProfile from "@/pages/admin/customers/CustomerProfile";
import { CustomersList } from "@/pages/admin/customers/CustomersList";
import { CustomersBrief } from "@/pages/admin/customers/CustomersBrief";

const FAILED: Partial<Q> = { data: undefined, isError: true, error: new Error("read failed") };
const PAUSED: Partial<Q> = { data: undefined, isError: false, isLoading: false, fetchStatus: "paused", isPaused: true };
const ok = (data: unknown): Partial<Q> => ({ data, isError: false, fetchStatus: "idle" });
const CUSTOMER = { id: 1, name: "Pat Example", phone: "2165550100", totalVisits: 1, totalSpent: 0 };
const EMPTY_HISTORY = { invoices: [], declinedEstimates: [], openWorkOrders: [] };
/** Exact class token, no responsive prefix: "lg:min-h-12" or "min-h-120" must not satisfy "min-h-12". */
const tok = (el: Element, token: string) =>
  new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(el.getAttribute("class") ?? "");

beforeEach(() => {
  h.queries.clear();
  h.calls.length = 0;
  h.opts.clear();
  h.mutations.clear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.user = { role: "admin" };
  window.history.replaceState({}, "", "/admin");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------ Nonstop Nick ------------------------------ */

describe("Nonstop Nick counter lookup", () => {
  function lookUp(phone = "2165550100") {
    fireEvent.change(screen.getByRole("textbox", { name: "Member phone number" }), { target: { value: phone } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
  }

  it("a failed lookup says it was not checked, offers Retry, and never says not a member", () => {
    const refetch = vi.fn();
    h.queries.set("memberships.lookupByPhone", { ...FAILED, refetch });
    render(<MembershipsSection />);
    lookUp();
    expect(screen.getByText("Lookup failed. Not checked: this does not mean they are not a member.")).toBeTruthy();
    expect(screen.queryByText(/No member found/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("a paused (offline) lookup says offline, not checked, and never Lookup failed or not a member", () => {
    h.queries.set("memberships.lookupByPhone", PAUSED);
    render(<MembershipsSection />);
    lookUp();
    expect(screen.getByText("Offline, not checked: this does not mean they are not a member.")).toBeTruthy();
    expect(screen.queryByText(/Lookup failed/)).toBeNull();
    expect(screen.queryByText(/No member found/)).toBeNull();
  });

  it("positive control: a successful found:false still says no member, and nothing shows before a search", () => {
    h.queries.set("memberships.lookupByPhone", ok({ found: false }));
    render(<MembershipsSection />);
    expect(screen.queryByText(/No member found/)).toBeNull();
    lookUp();
    expect(screen.getByText("No member found for that number.")).toBeTruthy();
    expect(screen.queryByText(/Lookup failed/)).toBeNull();
  });

  it("the phone field is a 48 px, 16 px text control", () => {
    render(<MembershipsSection />);
    const field = screen.getByRole("textbox", { name: "Member phone number" });
    expect(tok(field, "min-h-12"), "min-h-12").toBe(true);
    expect(tok(field, "text-base"), "text-base").toBe(true);
  });
});

/* ---------------------------- Customer profile ---------------------------- */

describe("Customer profile tabs", () => {
  it("a paused history read shows ? on every tab and never a none-found line", () => {
    h.queries.set("customers.getById", ok(CUSTOMER));
    h.queries.set("customers.timeline", ok([]));
    h.queries.set("customers.history", PAUSED);
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    for (const chip of [/Service History/, /Declined Work/, /Active Backlog/]) {
      const text = screen.getByRole("button", { name: chip }).textContent ?? "";
      expect(text, String(chip)).not.toMatch(/\d/);
      expect(text, String(chip)).toContain("?");
    }
    expect(screen.queryByText("No service history invoices found.")).toBeNull();
    expect(screen.getByText(/Service history not checked/)).toBeTruthy();
  });

  it("a paused timeline read never says no interactions", () => {
    h.queries.set("customers.getById", ok(CUSTOMER));
    h.queries.set("customers.timeline", PAUSED);
    h.queries.set("customers.history", ok(EMPTY_HISTORY));
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    expect(screen.queryByText("No interactions recorded yet.")).toBeNull();
    expect(screen.getByText(/Interactions not checked/)).toBeTruthy();
  });

  it("the tabs are one horizontally scrolling strip of 48 px targets", () => {
    h.queries.set("customers.getById", ok(CUSTOMER));
    h.queries.set("customers.timeline", ok([]));
    h.queries.set("customers.history", ok(EMPTY_HISTORY));
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    const tabs = [/Service History/, /Declined Work/, /Active Backlog/].map((n) => screen.getByRole("button", { name: n }));
    const strip = tabs[0].parentElement as HTMLElement;
    for (const t of tabs) {
      expect(t.parentElement).toBe(strip);
      expect(tok(t, "min-h-12"), "min-h-12").toBe(true);
    }
    expect(tok(strip, "overflow-x-auto"), "overflow-x-auto").toBe(true);
  });
});

/* ----------------------------- Customers list ----------------------------- */

describe("Customers list lookup", () => {
  const LISTED = {
    id: 5, firstName: "Pat", lastName: "Example", phone: "2165550100", email: null, totalVisits: 2, totalSpent: 45000,
    lastVisitDate: new Date(Date.now() - 3 * 86400000).toISOString(), daysSinceLastVisit: 3, isVip: false, churnRisk: "low",
    declinedCount: 0, backlogCount: 0, customerType: "retail", notes: null,
  };

  it("the search field comes first, is type=search with 16 px text and 48 px height, and is not autofocused", () => {
    h.queries.set("customers.list", ok({ customers: [], total: 0, page: 1, pageSize: 25 }));
    h.queries.set("customers.stats", ok({ total: 4, withVisits: 3, vipCount: 1, totalRevenue: 120000, recent: 1, lapsed: 1, withEmail: 2, commercial: 0 }));
    render(<CustomersList onOpenCustomer={() => {}} />);
    const input = screen.getByRole("searchbox", { name: /search customers/i }) as HTMLInputElement;
    expect(input.type).toBe("search");
    expect(tok(input, "min-h-12"), "min-h-12").toBe(true);
    expect(tok(input, "text-base"), "text-base").toBe(true);
    expect(document.activeElement).not.toBe(input);
    const firstTile = screen.getAllByText("Total Customers")[0];
    expect(input.compareDocumentPosition(firstTile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("each result row has one Open verb that opens the profile", () => {
    const onOpen = vi.fn();
    h.queries.set("customers.list", ok({ customers: [LISTED], total: 1, page: 1, pageSize: 25 }));
    render(<CustomersList onOpenCustomer={onOpen} />);
    const rows = screen.getByRole("list", { name: "Customers" });
    expect(within(rows).getByText("Pat Example")).toBeTruthy();
    fireEvent.click(within(rows).getByRole("button", { name: "Open Pat Example" }));
    expect(onOpen).toHaveBeenCalledWith(5);
  });

  it("a paused list says not checked, never No customers found; paused stats show no number", () => {
    h.queries.set("customers.list", PAUSED);
    h.queries.set("customers.stats", PAUSED);
    render(<CustomersList onOpenCustomer={() => {}} />);
    expect(screen.queryByText("No customers found")).toBeNull();
    expect(screen.getByText(/Customer list not checked/)).toBeTruthy();
    const tile = screen.getAllByText("Total Customers")[0].parentElement?.parentElement as HTMLElement;
    expect(tile.querySelector(".stat-value")?.textContent ?? "").not.toMatch(/\d/);
  });
});

/* ------------------------------ Round 1 review ----------------------------- */

describe("W4 round 1", () => {
  it("no phone on file: profile history and timeline say so, offer no Retry, and never run the read", () => {
    const refetchHistory = vi.fn();
    const refetchTimeline = vi.fn();
    h.queries.set("customers.getById", ok({ ...CUSTOMER, phone: null }));
    h.queries.set("customers.timeline", { data: undefined, refetch: refetchTimeline });
    h.queries.set("customers.history", { data: undefined, refetch: refetchHistory });
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    expect(screen.getByText("No phone on file, history can't be looked up")).toBeTruthy();
    expect(screen.getByText("No phone on file, interactions can't be looked up")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /try again|retry/i })).toBeNull();
    expect(h.opts.get("customers.history")?.enabled).toBe(false);
    expect(h.opts.get("customers.timeline")?.enabled).toBe(false);
    expect(refetchHistory).not.toHaveBeenCalled();
    expect(refetchTimeline).not.toHaveBeenCalled();
  });

  const LAPSED = {
    id: 5, firstName: "Pat", lastName: "Example", phone: "2165550100", email: null, totalVisits: 2, totalSpent: 45000,
    lastVisitDate: new Date(Date.now() - 120 * 86400000).toISOString(), daysSinceLastVisit: 120, isVip: false, churnRisk: "medium",
    declinedCount: 0, backlogCount: 0, customerType: "retail", notes: null,
  };

  it("a customer row keeps Call, Text and Win back reachable behind a 48 px overflow", () => {
    h.queries.set("customers.list", ok({ customers: [LAPSED], total: 1, page: 1, pageSize: 25 }));
    render(<CustomersList onOpenCustomer={() => {}} />);
    const rows = screen.getByRole("list", { name: "Customers" });
    const more = within(rows).getByRole("button", { name: "More actions for Pat Example" });
    expect(tok(more, "min-h-12"), "min-h-12").toBe(true);
    expect(within(rows).queryByRole("link", { name: "Call Pat Example" })).toBeNull();
    fireEvent.click(more);
    const call = within(rows).getByRole("link", { name: "Call Pat Example" });
    expect(call.getAttribute("href")).toBe("tel:2165550100");
    expect(tok(call, "min-h-12"), "min-h-12").toBe(true);
    expect(within(rows).getByRole("link", { name: "Text Pat" })).toBeTruthy();
    expect(within(rows).getByRole("button", { name: "Win back Pat" })).toBeTruthy();
  });

  it("below lg one 48 px select sorts the list with the table's options", () => {
    h.queries.set("customers.list", ok({ customers: [LAPSED], total: 1, page: 1, pageSize: 25 }));
    render(<CustomersList onOpenCustomer={() => {}} />);
    const sort = screen.getByRole("combobox", { name: "Sort customers" }) as HTMLSelectElement;
    expect(tok(sort, "min-h-12"), "min-h-12").toBe(true);
    expect(Array.from(sort.options).map((o) => o.value)).toEqual(["totalSpent", "visits", "lastVisit", "firstVisit", "declined", "backlog", "name", "created"]);
    fireEvent.change(sort, { target: { value: "visits" } });
    const last = h.calls.filter(([p]) => p === "customers.list").pop()?.[1] as { sortBy?: string };
    expect(last?.sortBy).toBe("visits");
  });

  it("CustomersBrief says not checked on a paused stats read; stale tiles keep their numbers when a refetch pauses", () => {
    h.queries.set("customers.stats", PAUSED);
    const { container, unmount } = render(<CustomersBrief onLapsedAction={() => {}} />);
    expect(container.textContent).toMatch(/Customer stats not checked \(offline\)/);
    unmount();
    h.queries.set("customers.stats", { ...PAUSED, data: { total: 4, withVisits: 3, vipCount: 1, totalRevenue: 120000, recent: 1, lapsed: 1, withEmail: 2, commercial: 0 } });
    h.queries.set("customers.list", ok({ customers: [], total: 0, page: 1, pageSize: 25 }));
    render(<CustomersList onOpenCustomer={() => {}} />);
    const tile = screen.getAllByText("Total Customers")[0].parentElement?.parentElement as HTMLElement;
    expect(tile.querySelector(".stat-value")?.textContent ?? "").toMatch(/\d/);
  });

});

/* ------------------------------ Round 2 review ----------------------------- */

describe("W4 round 2", () => {
  const LAPSED2 = {
    id: 5, firstName: "Pat", lastName: "Example", phone: "2165550100", email: null, totalVisits: 2, totalSpent: 45000,
    lastVisitDate: new Date(Date.now() - 120 * 86400000).toISOString(), daysSinceLastVisit: 120, isVip: false, churnRisk: "medium",
    declinedCount: 0, backlogCount: 0, customerType: "retail", notes: null,
  };
  const RECENT = { ...LAPSED2, id: 6, firstName: "Rae", lastName: "Recent", lastVisitDate: new Date(Date.now() - 3 * 86400000).toISOString(), daysSinceLastVisit: 3, churnRisk: "low" };
  const NOPHONE = { ...LAPSED2, id: 9, firstName: "Nia", lastName: "Nophone", phone: null };

  function lookUp(phone = "2165550100") {
    fireEvent.change(screen.getByRole("textbox", { name: "Member phone number" }), { target: { value: phone } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
  }

  it("Nonstop Nick: Look up button and the plate input are 48 px with 16 px text", () => {
    h.queries.set("memberships.lookupByPhone", ok({ found: true, members: [{ id: 3, name: "Pat Member", phone: "2165550100", isActive: true, status: "active", repairDiscountPct: 0, vehiclePlate: null, vehicleDesc: null }] }));
    render(<MembershipsSection />);
    expect(tok(screen.getByRole("button", { name: /look up/i }), "min-h-12")).toBe(true);
    lookUp();
    fireEvent.click(screen.getByRole("button", { name: /Bind the covered vehicle/ }));
    const plate = screen.getByRole("textbox", { name: "License plate" });
    expect(tok(plate, "min-h-12")).toBe(true);
    expect(tok(plate, "text-base")).toBe(true);
  });

  it("Nonstop Nick: a failed re-lookup hides the stale member card", () => {
    h.queries.set("memberships.lookupByPhone", { ...FAILED, data: { found: true, members: [{ id: 3, name: "Pat Member", phone: "2165550100", isActive: true, status: "active", repairDiscountPct: 0, vehiclePlate: "ABC123", vehicleDesc: null }] } });
    render(<MembershipsSection />);
    lookUp();
    expect(screen.queryByText("Pat Member")).toBeNull();
    expect(screen.getByText(/Lookup failed/)).toBeTruthy();
  });

  it("a paused history read says not checked on the Declined and Backlog tabs too", () => {
    h.queries.set("customers.getById", ok(CUSTOMER));
    h.queries.set("customers.timeline", ok([]));
    h.queries.set("customers.history", PAUSED);
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Declined Work/ }));
    expect(screen.queryByText("No declined estimates found.")).toBeNull();
    expect(screen.getByText(/Service history not checked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Active Backlog/ }));
    expect(screen.queryByText("No active work orders found.")).toBeNull();
    expect(screen.getByText(/Service history not checked/)).toBeTruthy();
  });

  it("no phone on file: the tab chips show ?, never 0", () => {
    h.queries.set("customers.getById", ok({ ...CUSTOMER, phone: null }));
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    for (const chip of [/Service History/, /Declined Work/, /Active Backlog/]) {
      const text = screen.getByRole("button", { name: chip }).textContent ?? "";
      expect(text, String(chip)).not.toMatch(/\d/);
      expect(text, String(chip)).toContain("?");
    }
  });



  it("customer overflow: Text and the Win back wrapper are 48 px; no Win back when not lapsed; no More without a phone", () => {
    h.queries.set("customers.list", ok({ customers: [LAPSED2, RECENT, NOPHONE], total: 3, page: 1, pageSize: 25 }));
    render(<CustomersList onOpenCustomer={() => {}} />);
    const rows = screen.getByRole("list", { name: "Customers" });
    fireEvent.click(within(rows).getByRole("button", { name: "More actions for Pat Example" }));
    expect(tok(within(rows).getByRole("link", { name: "Text Pat" }), "min-h-12")).toBe(true);
    const winBackWrap = within(rows).getByRole("button", { name: "Win back Pat" }).parentElement as HTMLElement;
    expect(tok(winBackWrap, "[&>button]:min-h-12")).toBe(true);
    fireEvent.click(within(rows).getByRole("button", { name: "More actions for Rae Recent" }));
    expect(within(rows).getByRole("link", { name: "Text Rae" })).toBeTruthy();
    expect(within(rows).queryByRole("button", { name: "Win back Rae" })).toBeNull();
    expect(within(rows).queryByRole("button", { name: "More actions for Nia Nophone" })).toBeNull();
  });
});
