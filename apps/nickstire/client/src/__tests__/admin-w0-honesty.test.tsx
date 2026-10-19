/**
 * Admin UI v1 Wave 0: a failed read must never paint as 0, "none", "No calls yet today" or "All clear",
 * and a live publish must not be one tap (apps/nickstire/docs/design/admin-ui-v1/PLAN.md section 9).
 *
 * Each block mounts the real section with "@/lib/trpc" replaced by a proxy: every query returns
 * { data: undefined, isError: false } unless the test sets an override for its dotted path, so a
 * section that gains a call never dies on a missing key (the drift admin-leads-panels-outage.test.tsx
 * warns about). Heavy child panels that are not under test are stubbed to null.
 *
 * Procedures read 2026-10-16: every query here THROWS on a query error, so isError is the real signal.
 * Several also return an all-zero or empty sentinel when the DB handle is null (customers.list/stats/
 * history/timeline, winback.campaignStats, callTracking.list); adminDashboard.stats returns
 * `_degraded: true` with zeros. The sentinel cases are reported as a server-lane need; only
 * `_degraded` is readable on the client and is covered below.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  mutations: new Map<string, (opts: any) => unknown>(),
  confirm: vi.fn(async () => true),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  user: { role: "admin" } as { role: string } | null,
  Null: () => null,
  // Stands in for the confirm host so a test can see whether a page mounts one.
  ConfirmHost: () => <div data-testid="confirm-host" />,
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isFetching: false,
    ...h.queries.get(path),
  });
  const mutation = (path: string) => (opts: any) =>
    h.mutations.get(path)?.(opts) ?? { mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false, reset: () => {} };
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery") return query(path);
        if (key === "useInfiniteQuery") return query(path);
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
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm, default: h.ConfirmHost }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));

// Child panels that are not under test.

vi.mock("@/pages/admin/SalesCard", () => ({ default: h.Null }));
vi.mock("@/pages/admin/PromisesPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/InspectionCapturePanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/ClosedLoopLiftPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/today/ArrivalLoadStrip", () => ({ default: h.Null }));
vi.mock("@/pages/admin/today/ExceptionFeed", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Today", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/StudioV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/QueueV2", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Inbox", () => ({ Inbox: h.Null }));
vi.mock("@/pages/admin/instagram/Learn", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Settings", () => ({ default: h.Null }));
vi.mock("@/pages/admin/DraftBoardPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/PatternLab", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Strategy", () => ({ default: h.Null }));
vi.mock("@/components/admin/AutonomyCommandCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/ActionCenter", () => ({ default: h.Null }));
vi.mock("@/pages/admin/instagram/Pipeline", () => ({ Pipeline: h.Null }));

import OverviewSection from "@/pages/admin/OverviewSection";
import { CustomersList } from "@/pages/admin/customers/CustomersList";
import { CustomersBrief } from "@/pages/admin/customers/CustomersBrief";
import CustomerProfile from "@/pages/admin/customers/CustomerProfile";
import { InstagramAdmin } from "@/pages/admin/instagram/InstagramAdmin";
import VoiceReceptionistSection from "@/pages/admin/VoiceReceptionistSection";
import CallTrackingSection from "@/pages/admin/CallTrackingSection";
import WinBackSection from "@/pages/admin/outreach/WinBackSection";
import DegradedDataBanner from "@/components/admin/DegradedDataBanner";
import AdminSectionBoundary from "@/components/admin/AdminSectionBoundary";
import { getQueueActionDefinition } from "@/pages/admin/today/queueActions";

const FAILED: Partial<Q> = { data: undefined, isError: true, error: new Error("read failed") };
const ok = (data: unknown): Partial<Q> => ({ data, isError: false });
const EMPTY_BUNDLE = { stats: null, bookings: [], leads: [], callbacks: [], owedTexts: [], callbackServed: {}, unavailableSlices: [] as string[] };

/** SummaryCard: label div sits directly inside the card. */
const summaryCard = (label: string) => screen.getByText(label).parentElement as HTMLElement;
/** StatCard: label span sits in a header row inside the card, next to the .stat-value value. */
const statCard = (label: string) => {
  const card = screen
    .getAllByText(label)
    .map((el) => el.parentElement?.parentElement)
    .find((el) => el?.querySelector(".stat-value"));
  if (!card) throw new Error(`no StatCard labelled ${label}`);
  return card as HTMLElement;
};
/** The value cell of a StatCard (label text excluded, so "VIP (3+)" does not look numeric). */
const statValue = (label: string) => statCard(label).querySelector(".stat-value")!.textContent ?? "";

beforeEach(() => {
  h.queries.clear();
  h.mutations.clear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.user = { role: "admin" };
  window.history.replaceState({}, "", "/admin");
});

// StatCard counts numbers up from 0 when they scroll into view; jsdom never intersects, so a positive
// control asks for reduced motion, which useCountUp honours by rendering the final value at once.
const realMatchMedia = window.matchMedia;
function reduceMotion() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: realMatchMedia });
  h.queries.clear();
  h.mutations.clear();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("Today (OverviewSection)", () => {
  it("a failed overview bundle never says All clear, and the two cards say unknown", () => {
    const refetch = vi.fn();
    h.queries.set("adminDashboard.overviewMediumBundle", { ...FAILED, refetch });
    render(<OverviewSection />);
    // The banner's Retry is wired to the bundle's own refetch (the consumer end of onRetry).
    fireEvent.click(within(screen.getByText("Dashboard data is unavailable").closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByText("All clear")).toBeNull();
    expect(screen.queryByText(/all clear/i)).toBeNull();
    for (const label of ["Needs action", "Bookings today", "Urgent leads"]) {
      const card = summaryCard(label);
      expect(within(card).getByText("Unable to determine"), label).toBeTruthy();
      expect(card.textContent, label).not.toMatch(/\d/);
    }
    expect(screen.getByText("Now: queue unknown · a source read failed")).toBeTruthy();
  });

  it("an unavailable slice makes only its own card unknown", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok({ ...EMPTY_BUNDLE, unavailableSlices: ["bookings"] }));
    const { unmount } = render(<OverviewSection />);
    expect(within(summaryCard("Bookings today")).getByText("Unable to determine")).toBeTruthy();
    expect(within(summaryCard("Urgent leads")).getByText("0")).toBeTruthy();
    expect(screen.getByText(/Now: queue unknown/)).toBeTruthy();
    unmount();
    h.queries.set("adminDashboard.overviewMediumBundle", ok({ ...EMPTY_BUNDLE, unavailableSlices: ["leads"] }));
    render(<OverviewSection />);
    expect(within(summaryCard("Urgent leads")).getByText("Unable to determine")).toBeTruthy();
  });

  it("positive control: a clean empty read still says All clear in the card and the brief", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(EMPTY_BUNDLE));
    h.queries.set("workOrders.list", ok([]));
    render(<OverviewSection />);
    expect(within(summaryCard("Needs action")).getByText("All clear")).toBeTruthy();
    expect(within(summaryCard("Bookings today")).getByText("0")).toBeTruthy();
    expect(screen.getByText(/Now: all clear/)).toBeTruthy();
  });

  function workOrderScenario(role: string, customerId?: number) {
    h.queries.set("adminSecurity.status", ok({ adminRole: role, permissions: [] }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(EMPTY_BUNDLE));
    h.queries.set("workOrders.list", ok([{ id: 7, status: "in_progress", customerName: "Pat Example", customerId, createdAt: new Date().toISOString() }]));
    const receipts: Array<{ action: string; changes: Record<string, unknown> }> = [];
    h.mutations.set("adminSecurity.recordAction", () => ({
      mutateAsync: async (input: { action: string; changes: Record<string, unknown> }) => {
        receipts.push(input);
        return { reference: "ACT-1" };
      },
      isPending: false,
    }));
    const sections: string[] = [];
    const listener = (e: Event) => sections.push((e as CustomEvent<{ section: string }>).detail.section);
    window.addEventListener("admin:navigate-section", listener);
    return { receipts, sections, done: () => window.removeEventListener("admin:navigate-section", listener) };
  }

  it("front desk opens the customer's Active Backlog instead of Money, and the receipt names it", async () => {
    const s = workOrderScenario("front_desk", 42);
    try {
      render(<OverviewSection />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Open work order" }));
      });
      expect(s.sections).toEqual(["customers"]);
      const url = new URL(window.location.href);
      expect(url.searchParams.get("id")).toBe("42");
      expect(url.searchParams.get("profileTab")).toBe("backlog");
      expect(s.receipts).toEqual([expect.objectContaining({ action: "admin.work_order_opened", changes: expect.objectContaining({ target: "customers" }) })]);
    } finally {
      s.done();
    }
  });

  it("front desk with no customer on the work order: no navigation, a toast, and no opened receipt", async () => {
    const s = workOrderScenario("front_desk");
    try {
      render(<OverviewSection />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Open work order" }));
      });
      expect(s.sections).toEqual([]);
      expect(h.toastError).toHaveBeenCalledWith("Work orders are in Money, which your role cannot open");
      expect(s.receipts).toEqual([]);
    } finally {
      s.done();
    }
  });

  it("Open work order goes to Money's work orders tab for an owner, and shows one button", async () => {
    window.history.replaceState({}, "", "/admin?tab=overview&moneyTab=declined");
    const s = workOrderScenario("owner", 42);
    const { sections, receipts } = s;
    try {
      render(<OverviewSection />);
      const buttons = screen.getAllByRole("button", { name: "Open work order" });
      expect(buttons).toHaveLength(1);
      await act(async () => {
        fireEvent.click(buttons[0]);
      });
      expect(sections).toEqual(["revenue"]);
      expect(new URL(window.location.href).searchParams.get("moneyTab")).toBeNull();
      expect(receipts).toEqual([expect.objectContaining({ action: "admin.work_order_opened", changes: expect.objectContaining({ target: "revenue" }) })]);
      const wo = getQueueActionDefinition("workOrder");
      expect(wo.primaryConfirmMessage("Pat")).toBe("Open Pat's work order in Money.");
      expect(wo.secondaryConfirmMessage("Pat")).toBe("Open Pat's work order in Money.");
    } finally {
      s.done();
    }
  });
});

describe("Customers", () => {
  it("a failed list shows an error with Retry, not an empty table; failed stats show unknown, not $0", () => {
    const refetch = vi.fn();
    h.queries.set("customers.list", { ...FAILED, refetch });
    h.queries.set("customers.stats", FAILED);
    render(<CustomersList onOpenCustomer={() => {}} />);
    expect(screen.queryByText("No customers found")).toBeNull();
    expect(screen.getByText(/Customers couldn't load/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
    for (const label of ["Total Customers", "With Visits", "VIP (3+)", "Total Revenue", "Recent", "Lapsed", "With Email", "Commercial"]) {
      expect(statValue(label), label).not.toMatch(/\d/);
      expect(within(statCard(label)).getByText(/Unable to determine/), label).toBeTruthy();
    }
    expect(screen.getByText(/Customer stats couldn't load, state unknown/)).toBeTruthy();
  });

  it("positive control: a successful empty list still says No customers found", async () => {
    reduceMotion();
    h.queries.set("customers.list", ok({ customers: [], total: 0, page: 1, pageSize: 25 }));
    h.queries.set("customers.stats", ok({ total: 4, withVisits: 3, vipCount: 1, totalRevenue: 120000, recent: 1, lapsed: 1, withEmail: 2, commercial: 0 }));
    render(<CustomersList onOpenCustomer={() => {}} />);
    expect(screen.getByText("No customers found")).toBeTruthy();
    expect(statCard("Total Revenue").textContent).toContain("$");
    await waitFor(() => expect(statValue("Total Customers")).toBe("4"), { timeout: 3000 });
    expect(screen.queryByText(/Unable to determine/)).toBeNull();
  });

  it("CustomersBrief says state unknown on a failed read instead of vanishing", () => {
    h.queries.set("customers.stats", FAILED);
    const { container } = render(<CustomersBrief onLapsedAction={() => {}} />);
    expect(container.textContent).toMatch(/Customer stats couldn't load, state unknown/);
  });

  it("CustomerProfile: a failed timeline read errors only the timeline", () => {
    h.queries.set("customers.getById", ok({ id: 1, name: "Pat Example", phone: "2165550100", totalVisits: 1, totalSpent: 0 }));
    h.queries.set("customers.timeline", FAILED);
    h.queries.set("customers.history", ok({ invoices: [], declinedEstimates: [], openWorkOrders: [] }));
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    expect(screen.queryByText("No interactions recorded yet.")).toBeNull();
    expect(screen.getByText(/Interactions couldn't load/)).toBeTruthy();
    expect(screen.getByText("No service history invoices found.")).toBeTruthy();
    expect(screen.queryByText(/Service history couldn't load/)).toBeNull();
    expect(screen.getByRole("button", { name: /Service History/ }).textContent).toMatch(/0/);
  });

  it("CustomerProfile: a failed history read errors every history tab and its chips, not the timeline", () => {
    h.queries.set("customers.getById", ok({ id: 1, name: "Pat Example", phone: "2165550100", totalVisits: 1, totalSpent: 0 }));
    h.queries.set("customers.timeline", ok([]));
    h.queries.set("customers.history", FAILED);
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    expect(screen.getByText("No interactions recorded yet.")).toBeTruthy();
    expect(screen.queryByText(/Interactions couldn't load/)).toBeNull();
    for (const chip of [/Service History/, /Declined Work/, /Active Backlog/]) {
      const text = screen.getByRole("button", { name: chip }).textContent ?? "";
      expect(text, String(chip)).not.toMatch(/\d/);
      expect(text, String(chip)).toContain("?");
    }
    expect(screen.queryByText("No service history invoices found.")).toBeNull();
    expect(screen.getByText(/Service history couldn't load/)).toBeTruthy();
    for (const tab of [/Declined/i, /Backlog/i]) {
      fireEvent.click(screen.getAllByRole("button", { name: tab })[0]);
      expect(screen.queryByText("No declined estimates found.")).toBeNull();
      expect(screen.queryByText("No active work orders found.")).toBeNull();
      expect(screen.getByText(/Service history couldn't load/)).toBeTruthy();
    }
  });

  it("CustomerProfile opens the tab named by ?profileTab once, then drops the param", () => {
    window.history.replaceState({}, "", "/admin?tab=customers&id=1&profileTab=backlog");
    h.queries.set("customers.getById", ok({ id: 1, name: "Pat Example", phone: "2165550100", totalVisits: 1, totalSpent: 0 }));
    h.queries.set("customers.timeline", ok([]));
    h.queries.set("customers.history", ok({ invoices: [], declinedEstimates: [], openWorkOrders: [] }));
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    expect(screen.getByText("No active work orders found.")).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get("profileTab")).toBeNull();
  });

  it("positive control: CustomerProfile still says none found on a clean empty read", () => {
    h.queries.set("customers.getById", ok({ id: 1, name: "Pat Example", phone: "2165550100", totalVisits: 1, totalSpent: 0 }));
    h.queries.set("customers.timeline", ok([]));
    h.queries.set("customers.history", ok({ invoices: [], declinedEstimates: [], openWorkOrders: [] }));
    render(<CustomerProfile customerId={1} onClose={() => {}} />);
    expect(screen.getByText("No interactions recorded yet.")).toBeTruthy();
    expect(screen.getByText("No service history invoices found.")).toBeTruthy();
  });
});

describe("Instagram held-reel badge", () => {
  it("a failed attention read shows the unknown badge, never a hidden badge", () => {
    h.queries.set("contentAdmin.reelJobsNeedingAttention", FAILED);
    render(<InstagramAdmin />);
    const badge = screen.getByTitle("Held reels unknown: read failed");
    expect(badge.textContent).toBe("?");
  });

  it("positive control: a clean zero shows no badge, a count shows the count", () => {
    h.queries.set("contentAdmin.reelJobsNeedingAttention", ok({ count: 0 }));
    const { unmount } = render(<InstagramAdmin />);
    expect(screen.queryByTitle("Held reels unknown: read failed")).toBeNull();
    expect(screen.queryByLabelText(/reel job\(s\) need attention/)).toBeNull();
    unmount();
    h.queries.set("contentAdmin.reelJobsNeedingAttention", ok({ count: 3 }));
    render(<InstagramAdmin />);
    expect(screen.getByLabelText("3 reel job(s) need attention")).toBeTruthy();
  });
});

describe("Voice today calls", () => {
  it("a failed read says unknown with Retry, not 'No calls yet today'", () => {
    const refetch = vi.fn();
    h.queries.set("vapi.todayCalls", { ...FAILED, refetch });
    render(<VoiceReceptionistSection />);
    expect(screen.queryByText("No calls yet today")).toBeNull();
    // The default range is the last 7 days; the message names the range on screen.
    expect(screen.getByText("Calls for last 7 days couldn't load, state unknown, not empty")).toBeTruthy();
    expect(screen.queryByText(/Today's calls couldn't load/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("Today's calls couldn't load, state unknown, not empty")).toBeTruthy();
  });

  it("positive control: a clean empty read still says No calls yet today", () => {
    h.queries.set("vapi.todayCalls", ok([]));
    render(<VoiceReceptionistSection />);
    expect(screen.getByText("No calls yet today")).toBeTruthy();
  });
});

describe("Call Tracking tiles", () => {
  it("failed stats and calls render unknown tiles and one error line, not 0/0/0", () => {
    h.queries.set("adminDashboard.stats", FAILED);
    h.queries.set("callTracking.list", FAILED);
    h.queries.set("callback.list", ok([]));
    render(<CallTrackingSection />);
    for (const label of ["Total Calls", "This Week", "Callbacks Total"]) {
      expect(statCard(label).textContent, label).not.toMatch(/\d/);
    }
    expect(screen.getAllByText("Call stats couldn't load. The counts above are unknown, not zero.")).toHaveLength(1);
    expect(screen.getAllByText("Call events couldn't load. Top Source and the charts below are unknown, not empty.")).toHaveLength(1);
  });

  it("calls failed, stats fine: Top Source unknown, one amber block, and no empty-state lines", () => {
    h.queries.set("adminDashboard.stats", ok({ callTracking: { totalCalls: 12, thisWeek: 4 }, callbacks: { total: 9, completed: 5 } }));
    h.queries.set("callTracking.list", FAILED);
    h.queries.set("callback.list", ok([]));
    render(<CallTrackingSection />);
    expect(within(statCard("Top Source")).getByText("Unable to determine")).toBeTruthy();
    // The stats tiles above are valid here, so the line must not call them unknown.
    expect(screen.queryByText("Call stats couldn't load. The counts above are unknown, not zero.")).toBeNull();
    expect(screen.getAllByText("Call events couldn't load. Top Source and the charts below are unknown, not empty.")).toHaveLength(1);
    for (const empty of ["No call data for peak hours", "No call data yet", "No call events yet."]) {
      expect(screen.queryByText(empty), empty).toBeNull();
    }
  });

  it("a degraded stats sentinel (zeros with _degraded) is also unknown", () => {
    h.queries.set("adminDashboard.stats", ok({ _degraded: true, callTracking: { totalCalls: 0, thisWeek: 0 }, callbacks: { total: 0, completed: 0 } }));
    h.queries.set("callTracking.list", ok([]));
    h.queries.set("callback.list", ok([]));
    render(<CallTrackingSection />);
    expect(statCard("Total Calls").textContent).not.toMatch(/\d/);
    expect(screen.getByText("Call stats couldn't load. The counts above are unknown, not zero.")).toBeTruthy();
    expect(screen.queryByText("Call events couldn't load. Top Source and the charts below are unknown, not empty.")).toBeNull();
  });

  it("positive control: real stats render their numbers", async () => {
    reduceMotion();
    h.queries.set("adminDashboard.stats", ok({ callTracking: { totalCalls: 12, thisWeek: 4 }, callbacks: { total: 9, completed: 5 } }));
    h.queries.set("callTracking.list", ok([]));
    h.queries.set("callback.list", ok([]));
    render(<CallTrackingSection />);
    expect(statCard("Total Calls").textContent).not.toMatch(/Unable to determine/);
    await waitFor(() => expect(statValue("Total Calls")).toBe("12"), { timeout: 3000 });
    expect(screen.getByText("No call events yet.")).toBeTruthy();
    expect(screen.queryByText(/Call stats couldn't load/)).toBeNull();
  });
});

describe("Win-back tiles", () => {
  it("failed campaign stats render unknown tiles plus one error line", () => {
    h.queries.set("winback.campaignStats", FAILED);
    h.queries.set("winback.campaigns", ok([]));
    render(<WinBackSection />);
    for (const label of ["Total Campaigns", "Active", "Messages Sent", "Holdout", "Failed", "Pending"]) {
      expect(statValue(label), label).not.toMatch(/\d/);
    }
    expect(screen.getAllByText(/Campaign stats couldn't load/)).toHaveLength(1);
  });

  it("positive control: real stats render their numbers", async () => {
    reduceMotion();
    h.queries.set("winback.campaignStats", ok({ totalCampaigns: 2, activeCampaigns: 1, totalSent: 30, totalHeldOut: 3, totalFailed: 1, totalPending: 4 }));
    h.queries.set("winback.campaigns", ok([]));
    render(<WinBackSection />);
    await waitFor(() => expect(statValue("Messages Sent")).toBe("30"), { timeout: 3000 });
    expect(screen.queryByText(/Campaign stats couldn.t load/)).toBeNull();
  });
});


describe("failure copy", () => {
  it("DegradedDataBanner speaks plain words, names no internals, and retries when it can", () => {
    const onRetry = vi.fn();
    const { container } = render(<DegradedDataBanner unavailable onRetry={onRetry} />);
    expect(container.textContent).toContain("Some of these numbers couldn't be loaded. The counts below may be incomplete; treat them as unknown, not zero.");
    expect(container.textContent).not.toMatch(/getDashboardStats|Telegram|Sentry|Railway/);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("DegradedDataBanner shows no Retry without a refetch", () => {
    render(<DegradedDataBanner stats={{ _degraded: true }} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.getByText(/treat them as unknown, not zero/)).toBeTruthy();
  });

  it("AdminSectionBoundary names the section by its title, not its registry id", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("boom");
    };
    render(<AdminSectionBoundary sectionName="tireOrders"><Boom /></AdminSectionBoundary>);
    expect(screen.getByRole("heading", { name: "The Tires section failed." })).toBeTruthy();
  });
});
