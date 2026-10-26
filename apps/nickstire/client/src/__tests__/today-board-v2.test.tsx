/**
 * Today board v2 (job 2026-10-25-admin-tabs-today, lane nickstire-client).
 *
 * The board lists what is the shop's move NOW. A contacted lead is waiting on the customer, so it
 * leaves the board into a visible count; Pipeline follow-ups join the board (five at most, then a
 * line that opens Sales Pipeline); work orders, the months-old lift panel, the integration panel and
 * the receipts feed leave the page. Mounted with the same tRPC proxy admin-w2-today-board.test.tsx
 * uses (every query returns { data: undefined } unless a test sets its dotted path). ExceptionFeed
 * renders for real here so the "no procedure names on the page" check reads what the owner reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean; dataUpdatedAt: number };
const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  mutations: new Map<string, (opts: any) => unknown>(),
  confirm: vi.fn(async () => true),
  Null: () => null,
  Marker: (id: string) => () => <div data-testid={id} />,
}));
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined, isLoading: false, isError: false, error: null, refetch: () => {}, isFetching: false,
    ...h.queries.get(path),
  });
  const mutation = (path: string) => (opts: any) =>
    h.mutations.get(path)?.(opts) ?? { mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false, reset: () => {} };
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation(path);
        if (key === "invalidate") return async () => {};
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() { return undefined; },
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
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm, default: h.Null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));
vi.mock("@/pages/admin/SalesCard", () => ({ default: h.Marker("sales-card") }));
vi.mock("@/pages/admin/PromisesPanel", () => ({ default: h.Marker("promises") }));
vi.mock("@/pages/admin/today/ArrivalLoadStrip", () => ({ default: h.Marker("arrival") }));
import OverviewSection from "@/pages/admin/OverviewSection";
import { KpiTile } from "@/pages/admin/shared/cards";

const ok = (data: unknown): Partial<Q> => ({ data, isError: false });
const FAILED: Partial<Q> = { data: undefined, isError: true, error: new Error("read failed") };
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const slice = { available: true, error: null };

/** Placeholder people only: 555 numbers, no real names. */
const LEADS = [
  { id: 1, name: "Lead Urgent", phone: "(216) 555-0101", status: "new", urgencyScore: 5, source: "popup", createdAt: iso(30) },
  { id: 2, name: "Lead Contacted", phone: "(216) 555-0102", status: "contacted", urgencyScore: 5, source: "popup", createdAt: iso(60) },
  { id: 3, name: "Lead Calm", phone: "(216) 555-0103", status: "new", urgencyScore: 2, source: "chat", createdAt: iso(90) },
  { id: 4, name: "Lead Duplicate", phone: "(216) 555-0104", status: "new", urgencyScore: 5, source: "callback", callbackId: 77, createdAt: iso(10) },
];
const BUNDLE = (extra: Record<string, unknown> = {}) => ({
  stats: { tires: { new: 0 }, memberships: { warning: 0 } },
  slices: { stats: slice, bookings: slice, leads: slice, callbacks: slice, health: slice },
  bookings: [{ id: 11, name: "Booking Person", phone: "(216) 555-0111", status: "new", service: "Tire swap", preferredDate: "2026-10-30", createdAt: iso(20) }],
  leads: LEADS,
  callbacks: [{ id: 21, name: "Callback Person", phone: "(216) 555-0121", status: "pending", createdAt: iso(40) }],
  owedTexts: [{ conversationId: 31, phone: "(216) 555-0131", customerName: "Texting Person", preview: "Do you have 225/65R17?", waitingMinutes: 45, overdue: true }],
  callbackServed: {},
  unavailableSlices: [] as string[],
  ...extra,
});
const opp = (n: number, attempts: number) => ({
  id: `opp-${n}`,
  sourceType: n % 2 ? "missed_call" : "unapproved_estimate",
  recommendedAction: `Call back ${n}`,
  reason: `Reason ${n}`,
  customerPhone: `(216) 555-02${String(n).padStart(2, "0")}`,
  state: attempts ? "attempted" : "new",
  attempts,
  consentOk: true,
  receipts: [],
  createdAt: iso(n * 5),
  updatedAt: iso(0),
  ageDays: 0,
  dataQuality: "verified",
  expectedRevenueCents: null,
  evidence: n === 1 ? { summaryExcerpt: "asked about brakes" } : null,
});
/** 7 open: 2 nobody has tried, 5 attempted. */
const SEVEN = [opp(1, 0), opp(2, 0), opp(3, 1), opp(4, 1), opp(5, 2), opp(6, 1), opp(7, 1)];
const FRESH = { readable: true, connected: true, lastSuccessfulAt: iso(35), failuresSinceLastSuccess: 0, lastAttemptOutcome: "success", source: "alg_probe_log", generatedAt: iso(0) };

const board = () => screen.getByRole("region", { name: "Priority action queue" });
const rows = () => within(board()).queryAllByRole("article");
const strip = () => screen.getByRole("region", { name: "Today summary" });
const tile = (label: string) => within(strip()).getByText(label).parentElement as HTMLElement;

function standardDay() {
  h.queries.set("adminSecurity.status", ok({ adminRole: "owner", permissions: [] }));
  h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
  h.queries.set("opportunityQueue.list", ok({ items: SEVEN, queryable: true }));
  h.queries.set("contentAdmin.operationsSignal", ok({ unknown: false, total: 2, videoProviderBlocked: 0 }));
  h.queries.set("proposals.counts", ok({ readable: true, count: 3 }));
  h.queries.set("sms.gatewayHealth", ok({ configured: true, readable: true, online: true }));
  h.queries.set("adminSecurity.integrationFreshness", ok(FRESH));
  h.queries.set("promises.listOpen", ok([]));
}

const navigations: Array<{ section: string; href: string }> = [];
const onNavigate = (e: Event) => navigations.push({ section: (e as CustomEvent<{ section: string }>).detail.section, href: window.location.href });

beforeEach(() => {
  h.queries.clear();
  h.mutations.clear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.mutations.set("adminSecurity.recordAction", () => ({ mutateAsync: async () => ({ reference: "ACT-1" }), isPending: false }));
  navigations.length = 0;
  window.addEventListener("admin:navigate-section", onNavigate);
});
afterEach(() => {
  window.removeEventListener("admin:navigate-section", onNavigate);
  window.history.replaceState({}, "", "/");
  h.queries.clear();
  h.mutations.clear();
  vi.restoreAllMocks();
});

describe("queue membership: the board holds the shop's move, not the customer's", () => {
  it("a contacted lead is off the board and counted as waiting on the customer; a new urgent lead stays", () => {
    standardDay();
    render(<OverviewSection />);
    const text = rows().map((r) => r.textContent ?? "");
    expect(text.some((t) => t.includes("Lead Urgent"))).toBe(true);
    expect(text.some((t) => t.includes("Lead Calm"))).toBe(true);
    expect(text.some((t) => t.includes("Lead Contacted"))).toBe(false);
    expect(text.some((t) => t.includes("Lead Duplicate"))).toBe(false);
    expect(within(board()).getByRole("button", { name: "Waiting on customer · 1 contacted lead" })).toBeTruthy();
    expect(within(tile("Waiting on customer")).getByText("1")).toBeTruthy();
  });

  it("the waiting line opens Sales Pipeline on the Leads list", () => {
    standardDay();
    render(<OverviewSection />);
    fireEvent.click(within(board()).getByRole("button", { name: /^Waiting on customer/ }));
    expect(navigations).toHaveLength(1);
    expect(navigations[0].section).toBe("leads");
    expect(new URL(navigations[0].href).search).toBe("?tab=leads&leadsTab=leads");
  });

  it("marking a lead contacted takes it off the board at once", async () => {
    const leadUpdate = vi.fn(async () => ({}));
    h.mutations.set("lead.update", () => ({ mutateAsync: leadUpdate, isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE({ leads: [LEADS[0]], bookings: [], callbacks: [], owedTexts: [] })));
    h.queries.set("opportunityQueue.list", ok({ items: [], queryable: true }));
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark contacted" }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(leadUpdate).toHaveBeenCalledWith({ id: 1, status: "contacted", contacted: 1 });
    expect(screen.queryByText("Lead Urgent")).toBeNull();
  });

  it("the waiting line says unknown when the leads slice failed, and is absent at zero", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE({ unavailableSlices: ["leads"] })));
    h.queries.set("opportunityQueue.list", ok({ items: [], queryable: true }));
    const first = render(<OverviewSection />);
    expect(within(board()).getByRole("button", { name: "Waiting on customer · unknown" })).toBeTruthy();
    expect(within(tile("Waiting on customer")).getByText("Unable to determine")).toBeTruthy();
    first.unmount();
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE({ leads: [LEADS[0]] })));
    render(<OverviewSection />);
    expect(within(board()).queryByRole("button", { name: /^Waiting on customer/ })).toBeNull();
  });

  it("work orders are not read and not listed", () => {
    standardDay();
    h.queries.set("workOrders.list", ok([{ id: 7, status: "in_progress", customerName: "Work Person", createdAt: iso(5) }]));
    render(<OverviewSection />);
    expect(screen.queryByText("Work Person")).toBeNull();
    expect(within(board()).queryByRole("button", { name: "Work orders" })).toBeNull();
    const src = readFileSync(join(process.cwd(), "client/src/pages/admin/OverviewSection.tsx"), "utf8");
    expect(src).not.toMatch(/workOrders\.list/);
  });
});

describe("Pipeline follow-ups on the board", () => {
  it("shows five of seven, untouched first, with a line that opens Sales Pipeline", () => {
    standardDay();
    render(<OverviewSection />);
    const follow = rows().filter((r) => /Missed call|Unapproved estimate/.test(r.textContent ?? ""));
    expect(follow).toHaveLength(5);
    // Untouched rows come first inside the type, newest first: opp-1 then opp-2.
    expect(follow[0].textContent).toContain("Reason 1");
    expect(follow[0].textContent).toContain("asked about brakes");
    expect(follow[1].textContent).toContain("Reason 2");
    expect(within(board()).getByRole("button", { name: "5 of 7 follow-ups open · Open Sales Pipeline" })).toBeTruthy();
    // 1 booking + 2 new leads + 1 callback + 1 text + 5 follow-ups, and more follow-ups exist.
    expect(within(tile("Needs action")).getByText("10+")).toBeTruthy();
  });

  it("a follow-up row's one verb is Open, and it opens Today's follow-ups without writing anything", () => {
    standardDay();
    const transition = vi.fn();
    h.mutations.set("opportunityQueue.transition", () => ({ mutate: transition, mutateAsync: transition, isPending: false }));
    render(<OverviewSection />);
    const first = rows().find((r) => r.textContent?.includes("Reason 1")) as HTMLElement;
    expect(within(first).queryByRole("button", { name: /More actions/ })).toBeNull();
    fireEvent.click(within(first).getByRole("button", { name: "Open in Sales Pipeline" }));
    expect(navigations.at(-1)?.section).toBe("leads");
    expect(new URL(navigations.at(-1)!.href).search).toBe("?tab=leads&leadsTab=followups");
    expect(transition).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("a failed follow-ups read makes Needs action unknown and never says all clear", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE({ bookings: [], leads: [], callbacks: [], owedTexts: [] })));
    for (const failed of [FAILED, ok({ items: [], queryable: false })]) {
      h.queries.set("opportunityQueue.list", failed);
      const view = render(<OverviewSection />);
      expect(within(tile("Needs action")).getByText("Unable to determine")).toBeTruthy();
      expect(tile("Needs action").textContent).not.toMatch(/\d/);
      expect(screen.queryByText(/Done for today/)).toBeNull();
      expect(screen.queryByText("All clear")).toBeNull();
      expect(within(board()).getByText("follow-ups unknown · a read failed")).toBeTruthy();
      view.unmount();
    }
    // The control: the same empty day with a readable follow-ups read reaches the end state.
    h.queries.set("opportunityQueue.list", ok({ items: [], queryable: true }));
    render(<OverviewSection />);
    expect(screen.getByText("Done for today. Nothing needs you.")).toBeTruthy();
  });

  it("the read input and the card size are the Pipeline's own (text pin against OpportunitiesSection.tsx)", async () => {
    const { LIST_INPUT, FOLLOW_UPS_ON_BOARD } = await import("@/pages/admin/today/followUpsRead");
    const src = readFileSync(join(process.cwd(), "client/src/pages/admin/OpportunitiesSection.tsx"), "utf8");
    const states = src.match(/const RELEVANT_STATES = \[([^\]]+)\] as const;/);
    expect(states, "RELEVANT_STATES literal found").not.toBeNull();
    expect([...states![1].matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual(LIST_INPUT.states);
    expect(Number(src.match(/const TOP = (\d+);/)?.[1])).toBe(FOLLOW_UPS_ON_BOARD);
    expect(Number(src.match(/const LIMIT = (\d+);/)?.[1])).toBe(LIST_INPUT.limit);
    expect(LIST_INPUT.order).toBe("worklist");
  });
});

describe("the summary strip", () => {
  it("holds three numbers: Needs action, Waiting on customer, Decisions waiting", () => {
    standardDay();
    render(<OverviewSection />);
    expect(strip().className).toMatch(/(^|\s)grid-cols-3(\s|$)/);
    expect(strip().children).toHaveLength(3);
    for (const gone of ["Bookings today", "Urgent leads", "Active work orders"]) expect(within(strip()).queryByText(gone)).toBeNull();
    const decisions = tile("Decisions waiting");
    expect(within(decisions).getByText("5")).toBeTruthy();
    expect(within(decisions).getByText("Approvals and Instagram")).toBeTruthy();
    fireEvent.click(within(strip()).getByRole("button", { name: /Decisions waiting/ }));
    expect(navigations.at(-1)?.section).toBe("approvals");
  });

  it("Decisions waiting is unknown when either read failed, never a partial number", () => {
    standardDay();
    h.queries.set("proposals.counts", FAILED);
    const first = render(<OverviewSection />);
    expect(within(tile("Decisions waiting")).getByText("Unable to determine")).toBeTruthy();
    expect(tile("Decisions waiting").textContent).not.toMatch(/\d/);
    first.unmount();
    standardDay();
    h.queries.set("contentAdmin.operationsSignal", ok({ unknown: true, total: 0 }));
    render(<OverviewSection />);
    expect(within(tile("Decisions waiting")).getByText("Unable to determine")).toBeTruthy();
  });
});

describe("what left the page", () => {
  it("no procedure name is printed anywhere on Today", () => {
    standardDay();
    const { container } = render(<OverviewSection />);
    // The control: the feed rendered the held-publishing row, so the check below read a real source line.
    expect(screen.getByText("publishing items held")).toBeTruthy();
    expect(screen.getByText("via Instagram queue")).toBeTruthy();
    expect(container.innerHTML).not.toContain("contentAdmin.");
    expect(container.innerHTML).not.toContain("proposals.counts");
  });

  it("the months-old lift panel is gone", () => {
    standardDay();
    h.queries.set("closedLoop.summary", FAILED);
    render(<OverviewSection />);
    expect(screen.queryByText(/Automation lift/i)).toBeNull();
  });

  it("the integration panel is gone; the mirror reading is one line in words with no table name", () => {
    standardDay();
    const { container } = render(<OverviewSection />);
    expect(screen.queryByRole("heading", { name: "Integration freshness" })).toBeNull();
    expect(container.innerHTML).not.toContain("alg_probe_log");
    expect(screen.getByText(/^ShopDriver mirror · fresh · as of /)).toBeTruthy();
  });

  it("the receipts feed is gone even for a role that may read history; the toast stays the receipt", () => {
    standardDay();
    h.queries.set("adminSecurity.status", ok({ adminRole: "owner", permissions: ["reports.view"] }));
    h.queries.set("adminSecurity.recentActions", ok([{ id: 1, action: "admin.lead_contacted", actor: "owner", entityId: 2, changes: { reference: "ACT-9" }, createdAt: iso(5) }]));
    const { container } = render(<OverviewSection />);
    expect(screen.queryByText("Recent action receipts")).toBeNull();
    expect(container.innerHTML).not.toContain("admin.lead_contacted");
  });

  it("a stale mirror says since when, and an unreadable one says so", () => {
    standardDay();
    h.queries.set("adminSecurity.integrationFreshness", ok({ ...FRESH, lastSuccessfulAt: iso(3 * 24 * 60) }));
    const first = render(<OverviewSection />);
    expect(screen.getByText(/^ShopDriver mirror · stale since /)).toBeTruthy();
    first.unmount();
    h.queries.set("adminSecurity.integrationFreshness", FAILED);
    const second = render(<OverviewSection />);
    expect(screen.getByText("ShopDriver mirror · unreadable")).toBeTruthy();
    second.unmount();
    // Unknown with a recorded last success is unknown, not unreadable: the read itself worked.
    h.queries.set("adminSecurity.integrationFreshness", ok({ ...FRESH, lastSuccessfulAt: "not a timestamp" }));
    render(<OverviewSection />);
    expect(screen.getByText(/^ShopDriver mirror · unknown · last sync /)).toBeTruthy();
    expect(screen.queryByText("ShopDriver mirror · unreadable")).toBeNull();
  });
});

describe("manager rulings (2026-10-26)", () => {
  const empty = () => BUNDLE({ bookings: [], leads: [], callbacks: [], owedTexts: [] });
  const as = (row: ReturnType<typeof opp>, sourceType: string) => ({ ...row, sourceType });

  it("follow-ups the board already lists as callbacks or owed texts are not listed or counted twice", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(empty()));
    h.queries.set("opportunityQueue.list", ok({ items: [as(opp(1, 0), "callback"), as(opp(2, 0), "human_pending_sms"), as(opp(3, 0), "missed_call")], queryable: true }));
    const first = render(<OverviewSection />);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Missed call");
    expect(within(tile("Needs action")).getByText("1")).toBeTruthy();
    first.unmount();
    // Past five, the open count leaves them out too: 6 missed calls and 2 callbacks are 6 open.
    const many = [...Array.from({ length: 6 }, (_, i) => as(opp(i + 1, 0), "missed_call")), as(opp(7, 0), "callback"), as(opp(8, 0), "callback")];
    h.queries.set("opportunityQueue.list", ok({ items: many, queryable: true }));
    render(<OverviewSection />);
    expect(within(board()).getByRole("button", { name: "5 of 6 follow-ups open · Open Sales Pipeline" })).toBeTruthy();
  });

  it("no source on Today has the shape of a procedure name after via or Source:", () => {
    standardDay();
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE({ stats: { tires: { new: 2 }, memberships: { warning: 1 } } })));
    const { container } = render(<OverviewSection />);
    // The control: the tire and membership rows rendered, so their source lines were read.
    expect(screen.getByText("new tire orders")).toBeTruthy();
    const text = [container.textContent ?? "", ...Array.from(container.querySelectorAll("[title]"), (el) => el.getAttribute("title") ?? "")].join("\n");
    expect(text).toContain("via Dashboard counts");
    // "<word>.<word>" after via or Source: is the shape of a tRPC procedure name.
    expect(text.match(/(?:via|Source:)\s+[A-Za-z_]+\.[A-Za-z_]+/g)).toBeNull();
  });

  it("the verdict and the Needs action tile carry the same at-least plus", () => {
    standardDay();
    const first = render(<OverviewSection />);
    expect(within(tile("Needs action")).getByText("10+")).toBeTruthy();
    expect(screen.getByText(/^Now: /).textContent).toContain("10+ in queue");
    first.unmount();
    // The control: no follow-ups past five, no plus in either place.
    h.queries.set("opportunityQueue.list", ok({ items: SEVEN.slice(0, 2), queryable: true }));
    render(<OverviewSection />);
    expect(within(tile("Needs action")).getByText("7")).toBeTruthy();
    expect(screen.getByText(/^Now: /).textContent).toContain("7 in queue");
    expect(screen.getByText(/^Now: /).textContent).not.toContain("+");
  });
});

describe("KpiTile separator (Settings > Status)", () => {
  it("a label with no delta prints one middle dot; a label with a delta keeps the delta shape", () => {
    const alone = render(<KpiTile label="Customers" value={2377} deltaLabel="169 VIP" />);
    expect(alone.container.textContent).toBe("Customers2,377·169 VIP");
    alone.unmount();
    const both = render(<KpiTile label="Customers" value={2377} delta="+5%" deltaLabel="vs last week" trend="up" />);
    expect(both.container.textContent).toBe("Customers2,377↑+5%· vs last week");
  });
});
