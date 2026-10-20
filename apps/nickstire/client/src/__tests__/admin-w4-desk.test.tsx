/**
 * Admin UI v1 Wave 4, the Desk pages (apps/nickstire/docs/design/admin-ui-v1/PLAN.md sections 3, 6 and 9):
 * find a customer from the bar, trust every profile tab, read work orders and dispatch as rows, open one
 * work order by link, and never read a failed member lookup as "not a member".
 *
 * Same tRPC proxy as admin-w0-honesty.test.tsx: every query returns { data: undefined } unless the test
 * sets an override for its dotted path. A paused query (offline PWA) is modelled the way TanStack Query v5
 * reports it: data undefined, isError false, isLoading false, fetchStatus "paused". The Rule from W5: a
 * paused read is unknown, never empty or zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
vi.mock("@/pages/admin/money/TireRegistrationPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/money/NhtsaVehiclePanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/SalesCard", () => ({ default: h.Null }));
vi.mock("@/pages/admin/PromisesPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/ClosedLoopLiftPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/today/ArrivalLoadStrip", () => ({ default: h.Null }));
vi.mock("@/pages/admin/today/ExceptionFeed", () => ({ default: h.Null }));

import MembershipsSection from "@/pages/admin/MembershipsSection";
import CustomerProfile from "@/pages/admin/customers/CustomerProfile";
import { CustomersList } from "@/pages/admin/customers/CustomersList";
import { CustomersBrief } from "@/pages/admin/customers/CustomersBrief";
import WorkOrdersSection from "@/pages/admin/money/WorkOrdersSection";
import DispatchSection from "@/pages/admin/money/DispatchSection";
import OverviewSection from "@/pages/admin/OverviewSection";

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

/* ------------------------------- Work orders ------------------------------ */

const WOS = [
  { id: 7, orderNumber: "WO-0007", status: "in_progress", priority: "normal", vehicleYear: "2015", vehicleMake: "Honda", vehicleModel: "Civic", customerName: "Pat Example", promisedAt: new Date(Date.now() + 2 * 3600000).toISOString(), createdAt: new Date().toISOString() },
  { id: 8, orderNumber: "WO-0008", status: "approved", priority: "high", vehicleMake: "Ford", vehicleModel: "F-150", customerName: "Sam Driver", createdAt: new Date().toISOString() },
];

describe("Work orders as rows", () => {
  it("rows are grouped under the kanban stages with vehicle, customer, status words and the next status as the verb", () => {
    const mutate = vi.fn();
    h.mutations.set("workOrders.advanceStatus", () => ({ mutate, isPending: false }));
    h.queries.set("workOrders.list", ok(WOS));
    render(<WorkOrdersSection />);
    const rows = screen.getByRole("region", { name: "Work orders by stage" });
    expect(within(rows).getByRole("heading", { name: /In Shop/ })).toBeTruthy();
    expect(within(rows).getByRole("heading", { name: /Queue/ })).toBeTruthy();
    expect(within(rows).getByText("2015 Honda Civic")).toBeTruthy();
    expect(within(rows).getByText(/Pat Example/)).toBeTruthy();
    expect(within(rows).getByText(/In progress/)).toBeTruthy();
    // Round 1: no one-tap status change. "Move to" opens an in-DOM choice; nothing moves on the first tap.
    fireEvent.click(within(rows).getByRole("button", { name: "Move WO-0007 to" }));
    expect(mutate).not.toHaveBeenCalled();
    const choice = within(rows).getByRole("group", { name: "Move WO-0007 to" });
    const options = within(choice).getAllByRole("button").map((b) => b.textContent);
    expect(options).toEqual(["QC review", "Ready for pickup", "On hold", "Cancelled", "Cancel"]);
    for (const b of within(choice).getAllByRole("button")) expect(tok(b, "min-h-12"), "min-h-12").toBe(true);
    fireEvent.click(within(choice).getByRole("button", { name: "Cancel" }));
    expect(within(rows).queryByRole("group", { name: "Move WO-0007 to" })).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(within(rows).getByRole("button", { name: "Move WO-0007 to" }));
    fireEvent.click(within(within(rows).getByRole("group", { name: "Move WO-0007 to" })).getByRole("button", { name: "QC review" }));
    expect(mutate).toHaveBeenCalledWith({ id: "7", status: "qc_review" });
  });

  it("a paused list is unknown, never No jobs in this stage", () => {
    h.queries.set("workOrders.list", PAUSED);
    render(<WorkOrdersSection />);
    expect(screen.queryByText("No jobs in this stage")).toBeNull();
    expect(screen.getByText(/Work orders not checked/)).toBeTruthy();
  });

  it("?wo=<id> opens that work order and drops the param", async () => {
    window.history.replaceState({}, "", "/admin?section=money&moneyTab=workOrders&wo=7");
    h.queries.set("workOrders.list", ok(WOS));
    h.queries.set("workOrders.getById", ok({ ...WOS[0], items: [], transitions: [] }));
    render(<WorkOrdersSection />);
    expect(await screen.findByRole("dialog", { name: "Work order WO-0007" })).toBeTruthy();
    expect(h.calls).toContainEqual(["workOrders.getById", { id: "7" }]);
    expect(new URL(window.location.href).searchParams.get("wo")).toBeNull();
  });

  it("Today's Open work order carries the row id for a role that may open Money", async () => {
    h.queries.set("adminSecurity.status", ok({ adminRole: "owner", permissions: [] }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok({ stats: null, bookings: [], leads: [], callbacks: [], owedTexts: [], callbackServed: {}, unavailableSlices: [] }));
    h.queries.set("workOrders.list", ok([{ id: 7, status: "in_progress", customerName: "Pat Example", customerId: 42, createdAt: new Date().toISOString() }]));
    h.mutations.set("adminSecurity.recordAction", () => ({ mutateAsync: async () => ({ reference: "ACT-1" }), isPending: false }));
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open work order" }));
    });
    expect(new URL(window.location.href).searchParams.get("wo")).toBe("7");
  });
});

/* -------------------------------- Dispatch -------------------------------- */

describe("Dispatch", () => {
  it("a paused ready queue is not checked, never No jobs waiting", () => {
    h.queries.set("workOrders.list", PAUSED);
    render(<DispatchSection />);
    expect(screen.queryByText("No jobs waiting for a bay")).toBeNull();
    expect(screen.getByText(/Ready queue not checked/)).toBeTruthy();
  });


  it("ready-queue rows show vehicle, customer and one Assign verb", () => {
    h.queries.set("workOrders.list", ok([{ ...WOS[1], status: "ready_for_bay" }]));
    render(<DispatchSection />);
    const rows = screen.getByRole("list", { name: "Ready for a bay" });
    expect(within(rows).getByText("Ford F-150")).toBeTruthy();
    expect(within(rows).getByText(/Sam Driver/)).toBeTruthy();
    fireEvent.click(within(rows).getByRole("button", { name: "Assign Sam Driver" }));
    expect(screen.getByText("Assign Work Order")).toBeTruthy();
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

  it("work-order rows say blocked, emergency and overdue in words, with the order number", () => {
    const now = Date.now();
    h.queries.set("workOrders.list", ok([
      { id: 11, orderNumber: "WO-0011", status: "in_progress", priority: "normal", blockerType: "waiting_parts", customerName: "Ann Blocked", createdAt: new Date().toISOString() },
      { id: 12, orderNumber: "WO-0012", status: "approved", priority: "emergency", customerName: "Bo Urgent", createdAt: new Date().toISOString() },
      { id: 13, orderNumber: "WO-0013", status: "assigned", priority: "normal", customerName: "Cy Late", promisedAt: new Date(now - 3600000).toISOString(), createdAt: new Date().toISOString() },
    ]));
    render(<WorkOrdersSection />);
    const rows = screen.getByRole("region", { name: "Work orders by stage" });
    expect(within(rows).getByText(/WO-0011/).textContent).toMatch(/Blocked: parts/);
    expect(within(rows).getByText(/WO-0012/).textContent).toMatch(/Emergency/);
    expect(within(rows).getByText(/WO-0013/).textContent).toMatch(/Overdue/);
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

  it("Dispatch: Assign scrolls the assignment panel into view, and the row keeps the order number", () => {
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
    try {
      h.queries.set("workOrders.list", ok([{ ...WOS[1], status: "ready_for_bay" }]));
      render(<DispatchSection />);
      const rows = screen.getByRole("list", { name: "Ready for a bay" });
      expect(within(rows).getByText(/WO-0008/)).toBeTruthy();
      fireEvent.click(within(rows).getByRole("button", { name: "Assign Sam Driver" }));
      expect(scroll).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
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

  it("Move to runs the option tapped, not the first one; the approved list is pinned", () => {
    const mutate = vi.fn();
    h.mutations.set("workOrders.advanceStatus", () => ({ mutate, isPending: false }));
    h.queries.set("workOrders.list", ok(WOS));
    render(<WorkOrdersSection />);
    const rows = screen.getByRole("region", { name: "Work orders by stage" });
    fireEvent.click(within(rows).getByRole("button", { name: "Move WO-0008 to" }));
    const choice = within(rows).getByRole("group", { name: "Move WO-0008 to" });
    expect(within(choice).getAllByRole("button").map((b) => b.textContent)).toEqual(["Parts needed", "Ready for bay", "On hold", "Cancelled", "Cancel"]);
    fireEvent.click(within(choice).getByRole("button", { name: "On hold" }));
    expect(mutate).toHaveBeenLastCalledWith({ id: "8", status: "on_hold" });
    fireEvent.click(within(rows).getByRole("button", { name: "Move WO-0007 to" }));
    fireEvent.click(within(within(rows).getByRole("group", { name: "Move WO-0007 to" })).getByRole("button", { name: "Cancelled" }));
    expect(mutate).toHaveBeenLastCalledWith({ id: "7", status: "cancelled" });
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("work-order controls are 48 px: Move to, its options, the row's open button, and the search field is 16 px", () => {
    h.queries.set("workOrders.list", ok(WOS));
    render(<WorkOrdersSection />);
    const rows = screen.getByRole("region", { name: "Work orders by stage" });
    const move = within(rows).getByRole("button", { name: "Move WO-0007 to" });
    expect(tok(move, "min-h-12")).toBe(true);
    fireEvent.click(move);
    for (const b of within(within(rows).getByRole("group", { name: "Move WO-0007 to" })).getAllByRole("button")) expect(tok(b, "min-h-12"), b.textContent ?? "").toBe(true);
    expect(tok(within(rows).getByRole("button", { name: "Open WO-0007" }), "min-h-12")).toBe(true);
    const search = screen.getByRole("searchbox", { name: "Search work orders" });
    expect(tok(search, "min-h-12")).toBe(true);
    expect(tok(search, "text-base")).toBe(true);
  });

  it("Today with a stale moneyTab drops it and sets wo, and that URL opens WO-0007 in Money", async () => {
    window.history.replaceState({}, "", "/admin?tab=overview&moneyTab=unpaid");
    h.queries.set("adminSecurity.status", ok({ adminRole: "owner", permissions: [] }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok({ stats: null, bookings: [], leads: [], callbacks: [], owedTexts: [], callbackServed: {}, unavailableSlices: [] }));
    h.queries.set("workOrders.list", ok([{ id: 7, status: "in_progress", customerName: "Pat Example", customerId: 42, createdAt: new Date().toISOString() }]));
    h.mutations.set("adminSecurity.recordAction", () => ({ mutateAsync: async () => ({ reference: "ACT-1" }), isPending: false }));
    const { unmount } = render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open work order" }));
    });
    const url = new URL(window.location.href);
    expect(url.searchParams.get("moneyTab")).toBeNull();
    expect(url.searchParams.get("wo")).toBe("7");
    unmount();
    h.queries.set("workOrders.list", ok(WOS));
    h.queries.set("workOrders.getById", ok({ ...WOS[0], items: [], transitions: [] }));
    render(<WorkOrdersSection />);
    expect(await screen.findByRole("dialog", { name: "Work order WO-0007" })).toBeTruthy();
  });

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
