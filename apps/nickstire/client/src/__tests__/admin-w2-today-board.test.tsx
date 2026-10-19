/**
 * Admin UI v1 Wave 2: Today becomes a board (apps/nickstire/docs/design/admin-ui-v1/PLAN.md section 3, W2).
 *
 * The priority queue is the page's first object, as finite ruled rows acted on in place; a one-line
 * verdict sits above it; four numbers sit in one strip below it; Billed and Arrival load follow; every
 * monitoring panel lives under one collapsed "Checks" rail. Each test mounts the real OverviewSection
 * with "@/lib/trpc" replaced by the same proxy admin-w0-honesty.test.tsx uses (every query returns
 * { data: undefined } unless a test sets its dotted path), so the queue actions run through the real
 * performPrimary / performSecondary with mocked mutations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean; dataUpdatedAt: number };
const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  mutations: new Map<string, (opts: any) => unknown>(),
  confirm: vi.fn(async () => true),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  Null: () => null,
  Marker: (id: string) => () => <div data-testid={id} />,
  onInvalidate: null as null | ((path: string) => void),
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
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation(path);
        if (key === "invalidate") return async () => { h.onInvalidate?.(path); };
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
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));
vi.mock("@/pages/admin/SalesCard", () => ({ default: h.Marker("sales-card") }));
vi.mock("@/pages/admin/PromisesPanel", () => ({ default: h.Marker("promises") }));
vi.mock("@/pages/admin/ClosedLoopLiftPanel", () => ({ default: h.Marker("closed-loop") }));
vi.mock("@/pages/admin/today/ArrivalLoadStrip", () => ({ default: h.Marker("arrival") }));
vi.mock("@/pages/admin/today/ExceptionFeed", () => ({ default: h.Marker("exceptions") }));
import OverviewSection from "@/pages/admin/OverviewSection";
import { getQueueActionDefinition } from "@/pages/admin/today/queueActions";

const CHECKS_KEY = "nicks-admin-today-checks";
/** The repo's motion ceiling: a row that is still mounted past this is a stuck row, not a fade. */
const MOTION_BUDGET_MS = 200;

const ok = (data: unknown): Partial<Q> => ({ data, isError: false });
const FAILED: Partial<Q> = { data: undefined, isError: true, error: new Error("read failed") };
const now = () => new Date().toISOString();
const booking = (id: number, name: string) => ({ id, name, phone: `(216) 555-01${String(id).padStart(2, "0")}`, status: "new", service: "Tire swap", preferredDate: "2026-10-16", createdAt: now() });
const BUNDLE = (bookings: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  stats: null, bookings, leads: [], callbacks: [], owedTexts: [], callbackServed: {}, unavailableSlices: [] as string[], ...extra,
});
const FRESH = { readable: true, connected: true, lastSuccessfulAt: now(), failuresSinceLastSuccess: 0, lastAttemptOutcome: "success", source: "alg_probe_log", generatedAt: now() };

/** The queue rows on screen (each row is an <article> inside the board). */
const rows = () => within(screen.getByRole("region", { name: "Priority action queue" })).queryAllByRole("article");
const needsAction = () => screen.getByText("Needs action").parentElement as HTMLElement;
const rail = () => screen.getByText("Checks", { selector: "summary *" }).closest("details") as HTMLDetailsElement;
/** The rail summary's status text (the part after the "Checks" label). */
const checksStatus = () => (rail().querySelector("summary")!.textContent ?? "").replace(/^Checks/, "");

/**
 * Every source the rail counts answers, and every answer is zero or healthy: the bundle's slices are
 * available, the stats counts are 0, publishing and proposals report 0, the gateway is up and the
 * integration is fresh. Promises are left to the test. Without this fixture allMeasured is false for
 * an unrelated reason (no feed signal is "counted"), and a "never says nothing open" check is vacuous.
 */
function measureEverything() {
  const slice = { available: true, error: null };
  h.queries.set(
    "adminDashboard.overviewMediumBundle",
    ok(BUNDLE([], { slices: { stats: slice, bookings: slice, leads: slice, callbacks: slice, health: slice }, stats: { tires: { new: 0 }, memberships: { warning: 0 } } })),
  );
  h.queries.set("contentAdmin.operationsSignal", ok({ unknown: false, total: 0, videoProviderBlocked: 0 }));
  h.queries.set("proposals.counts", ok({ readable: true, count: 0 }));
  h.queries.set("sms.gatewayHealth", ok({ configured: true, readable: true, online: true }));
  h.queries.set("adminSecurity.integrationFreshness", ok(FRESH));
}

function setDesktop(desktop: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: desktop && query.includes("min-width: 1024px"),
      media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
}
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  h.queries.clear();
  h.mutations.clear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.onInvalidate = null;
  h.queries.set("workOrders.list", ok([]));
  h.mutations.set("adminSecurity.recordAction", () => ({ mutateAsync: async () => ({ reference: "ACT-1" }), isPending: false }));
  try { window.localStorage.clear(); } catch { /* storage blocked: the rail must still render */ }
  setDesktop(false);
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: realMatchMedia });
  h.queries.clear();
  h.mutations.clear();
  vi.restoreAllMocks();
});

const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("Today reads top to bottom as verdict, board, strip, Billed, Arrival, Checks", () => {
  it("the queue is the first object after the one-line verdict, and the monitoring panels sit in the rail", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    const verdict = screen.getByText(/^Now: /);
    const board = screen.getByRole("region", { name: "Priority action queue" });
    const strip = screen.getByRole("region", { name: "Today summary" });
    const sales = screen.getByTestId("sales-card");
    const arrival = screen.getByTestId("arrival");
    const checks = rail();
    expect(before(verdict, board)).toBe(true);
    expect(before(board, strip)).toBe(true);
    expect(before(strip, sales)).toBe(true);
    expect(before(sales, arrival)).toBe(true);
    expect(before(arrival, checks)).toBe(true);
    for (const id of ["promises", "closed-loop", "exceptions"]) {
      expect(screen.getByTestId(id).closest("details"), id).toBe(checks);
    }
    expect(screen.getByRole("heading", { name: "Integration freshness" }).closest("details")).toBe(checks);
  });

  it("the gateway and calls line moves into the rail; only the Now line stays on top", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("sms.gatewayHealth", ok({ configured: true, readable: true, online: false }));
    h.queries.set("vapi.recentCalls", ok({ calls: [] }));
    render(<OverviewSection />);
    expect(screen.getByText(/F25e SMS gateway OFFLINE/).closest("details")).toBe(rail());
    expect(screen.getByText(/^Now: /).closest("details")).toBeNull();
  });
});

describe("the board", () => {
  it("shows at most 12 rows, then one Show N more row that reveals the rest", () => {
    const many = Array.from({ length: 15 }, (_, i) => booking(i + 1, `Customer ${i + 1}`));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE(many)));
    render(<OverviewSection />);
    expect(rows()).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(rows()).toHaveLength(15);
  });

  it("a readable empty queue ends the day in one line with the time it was checked", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", { ...ok(BUNDLE()), dataUpdatedAt: new Date("2026-10-16T14:05:00").getTime() });
    render(<OverviewSection />);
    const end = screen.getByText("Done for today. Nothing needs you.");
    expect(end.closest("[role=status]")?.textContent).toMatch(/Checked 2:05/);
    expect(screen.queryByText(/UNKNOWN, not clear/)).toBeNull();
  });

  it("the end state waits for the work-order read too: bundle answered, work orders pending, no all-clear", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("workOrders.list", { data: undefined, isLoading: true, isError: false });
    render(<OverviewSection />);
    expect(screen.queryByText(/Done for today/)).toBeNull();
    expect(screen.queryByText("All clear")).toBeNull();
    expect(screen.getByText("Loading the queue")).toBeTruthy();
  });

  it("a paused work-order read (no data, not loading, not failed) is not an all-clear either", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("workOrders.list", { data: undefined, isLoading: false, isError: false });
    render(<OverviewSection />);
    expect(screen.queryByText(/Done for today/)).toBeNull();
    expect(screen.getByText("Loading the queue")).toBeTruthy();
  });

  it("a live work order outside the old five statuses is on the board and blocks the all-clear", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    // The real lifecycle (server workOrderService) has these live statuses; the old set only knew five.
    for (const status of ["approved", "parts_ordered", "ready_for_pickup", "on_hold"]) {
      h.queries.set("workOrders.list", ok([{ id: 7, status, customerName: "Dana Whitfield", createdAt: now() }]));
      const { unmount } = render(<OverviewSection />);
      expect(rows().some((r) => r.textContent?.includes("Dana Whitfield")), status).toBe(true);
      expect(screen.queryByText(/Done for today/), status).toBeNull();
      expect(within(screen.getByText("Active work orders").parentElement as HTMLElement).getByText("1"), status).toBeTruthy();
      unmount();
    }
    // The control: a finished order is not on the board, so the all-clear is still reachable.
    h.queries.set("workOrders.list", ok([{ id: 8, status: "picked_up", customerName: "Dana Whitfield", createdAt: now() }]));
    render(<OverviewSection />);
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Done for today. Nothing needs you.")).toBeTruthy();
  });

  it("an urgent item past position 12 is sorted into the first 12 rows", () => {
    const calm = Array.from({ length: 12 }, (_, i) => booking(i + 1, `Customer ${i + 1}`));
    const urgent = { ...booking(13, "Urgent Driver"), urgency: "emergency" };
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([...calm, urgent])));
    render(<OverviewSection />);
    expect(rows()).toHaveLength(12);
    expect(rows().some((r) => r.textContent?.includes("Urgent Driver"))).toBe(true);
  });

  it("phones get a short verb of at most 10 characters; the full verb stays the accessible name", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([], { callbacks: [{ id: 5, name: "Linda Nowak", phone: "(216) 555-0105", status: "new", createdAt: now() }] })));
    render(<OverviewSection />);
    const verb = screen.getByRole("button", { name: "Complete callback" });
    const phone = verb.querySelector(".lg\\:hidden");
    expect(phone?.textContent?.length ?? 99).toBeLessThanOrEqual(10);
    expect(verb.querySelector(".hidden.lg\\:inline")?.textContent).toBe("Complete callback");
  });

  it("every queue action type has a short phone verb of at most 10 characters", () => {
    // The types come from the source, so a case added to queueActions.ts is covered automatically.
    const src = readFileSync(join(process.cwd(), "client/src/pages/admin/today/queueActions.ts"), "utf8");
    const types = [...src.matchAll(/^\s*case "(\w+)":/gm)].map((m) => m[1]);
    // The scrape must still find the five known types, or the loop below would pass over nothing.
    expect(types).toEqual(expect.arrayContaining(["booking", "callback", "lead", "text", "workOrder"]));
    for (const type of types) {
      const { shortLabel } = getQueueActionDefinition(type as Parameters<typeof getQueueActionDefinition>[0]);
      expect(shortLabel.trim().length, `${type} has a short verb`).toBeGreaterThan(0);
      expect(shortLabel.length, `${type} short verb "${shortLabel}"`).toBeLessThanOrEqual(10);
    }
  });

  it("an unreadable queue keeps the W0 unknown state and never says Done for today", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", FAILED);
    render(<OverviewSection />);
    expect(screen.getByText("Queue unreadable: this is UNKNOWN, not clear")).toBeTruthy();
    expect(screen.queryByText(/Done for today/)).toBeNull();
  });

  it("a failed work-order read alone also blocks the end state", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("workOrders.list", FAILED);
    render(<OverviewSection />);
    expect(screen.queryByText(/Done for today/)).toBeNull();
    expect(screen.getByText("Queue unreadable: this is UNKNOWN, not clear")).toBeTruthy();
  });

  it("every control in a row is a 48 px target", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    const controls = [...within(rows()[0]).queryAllByRole("button"), ...within(rows()[0]).queryAllByRole("link")];
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const c of controls) expect(c.className, c.textContent ?? "").toMatch(/(^|\s)min-h-12(\s|$)/);
  });
});

describe("act in place", () => {
  it("a confirmed booking leaves the board and the Needs action number drops with it", async () => {
    const update = vi.fn(async () => ({}));
    const receipts: Array<{ action: string; entityId: number }> = [];
    h.mutations.set("booking.updateStatus", () => ({ mutateAsync: update, isPending: false }));
    h.mutations.set("adminSecurity.recordAction", () => ({
      mutateAsync: async (input: { action: string; entityId: number }) => { receipts.push(input); return { reference: "ACT-7" }; },
      isPending: false,
    }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado"), booking(2, "Paul Szabo")])));
    render(<OverviewSection />);
    expect(within(needsAction()).getByText("2")).toBeTruthy();
    const row = screen.getByText("Rosa Delgado").closest("article") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Confirm booking" }));
    });
    expect(update).toHaveBeenCalledWith({ id: 1, status: "confirmed" });
    expect(row.className).toMatch(/(^|\s)transition-opacity(\s|$)/);
    expect(row.className).toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(receipts).toEqual([expect.objectContaining({ action: "admin.booking_confirmed", entityId: 1 })]);
    // A fading row takes no second tap: a double tap must not open a second confirm.
    expect((within(row).getByRole("button", { name: "Confirm booking" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.queryByText("Rosa Delgado")).toBeNull());
    expect(within(needsAction()).getByText("1")).toBeTruthy();
    expect(screen.getByText("Paul Szabo")).toBeTruthy();
    expect(screen.getByText("Done: Rosa Delgado").getAttribute("aria-live") ?? screen.getByText("Done: Rosa Delgado").closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("the row stays mounted for the whole fade, then leaves within the motion budget", async () => {
    // Fake timers, and the row's mounted state read from the document rather than from a held node:
    // a detached node keeps its opacity-0 class forever, so a class check alone cannot see an early unmount.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.mutations.set("booking.updateStatus", () => ({ mutateAsync: async () => ({}), isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    const row = screen.getByText("Rosa Delgado").closest("article") as HTMLElement;
    const fadeMs = Number(/(?:^|\s)duration-(\d+)(?:\s|$)/.exec(row.className)?.[1]);
    expect(fadeMs, "the row carries a duration-N transition class").toBeGreaterThan(0);
    expect(fadeMs).toBeLessThanOrEqual(MOTION_BUDGET_MS);
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Confirm booking" }));
    });
    expect(row.className).toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(row.isConnected, "faded, not yet removed").toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(fadeMs - 1);
    });
    expect(row.isConnected, "still mounted one millisecond before the transition ends").toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS - (fadeMs - 1));
    });
    expect(row.isConnected, "gone once the motion budget has passed").toBe(false);
  });

  it("when the refetch drops the item before the action resolves, the row is gone through the data path", async () => {
    h.mutations.set("callback.updateStatus", () => ({ mutateAsync: async () => ({}), isPending: false }));
    const cb = { id: 5, name: "Linda Nowak", phone: "(216) 555-0105", status: "new", reason: "Price on an alignment", createdAt: now() };
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([], { callbacks: [cb] })));
    h.onInvalidate = (path) => {
      if (path.endsWith("overviewMediumBundle")) h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([], { callbacks: [] })));
    };
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Complete callback" }));
    });
    await waitFor(() => expect(screen.queryByText("Linda Nowak")).toBeNull());
    expect(screen.getByText("Done for today. Nothing needs you.")).toBeTruthy();
  });

  it("a done row whose id leaves the data and returns unchanged is shown again", async () => {
    h.mutations.set("booking.updateStatus", () => ({ mutateAsync: async () => ({}), isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    const view = render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    });
    await waitFor(() => expect(screen.queryByText("Rosa Delgado")).toBeNull());
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([])));
    view.rerender(<OverviewSection />);
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    view.rerender(<OverviewSection />);
    await waitFor(() => expect(screen.getByText("Rosa Delgado")).toBeTruthy());
  });

  it("a text closed with No reply needed comes back when the customer texts again", async () => {
    h.mutations.set("smsConversations.markNoReplyNeeded", () => ({ mutateAsync: async () => ({ closed: true }), isPending: false }));
    const text = (waitingMinutes: number) => ({ conversationId: 31, phone: "(216) 555-0131", customerName: "DeShawn Carter", preview: "Is my car ready?", waitingMinutes, overdue: false });
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([], { owedTexts: [text(42)] })));
    const view = render(<OverviewSection />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for DeShawn Carter" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "No reply needed" }));
    });
    await waitFor(() => expect(screen.queryByText("DeShawn Carter")).toBeNull());
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([], { owedTexts: [text(2)] })));
    view.rerender(<OverviewSection />);
    await waitFor(() => expect(screen.getByText("DeShawn Carter")).toBeTruthy());
  });

  it("the secondary action waits behind the row's overflow, and a cancelled booking leaves the board", async () => {
    const update = vi.fn(async () => ({}));
    h.mutations.set("booking.updateStatus", () => ({ mutateAsync: update, isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    expect(screen.queryByRole("button", { name: "Cancel booking" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Rosa Delgado" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    });
    expect(update).toHaveBeenCalledWith({ id: 1, status: "cancelled" });
    await waitFor(() => expect(screen.queryByText("Rosa Delgado")).toBeNull());
    expect(screen.getByText("Done for today. Nothing needs you.")).toBeTruthy();
  });

  it("a failed action keeps the row and says why", async () => {
    h.mutations.set("booking.updateStatus", () => ({ mutateAsync: async () => { throw new Error("Booking update failed"); }, isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(h.toastError).toHaveBeenCalledWith("Booking update failed");
    expect(screen.getByText("Rosa Delgado")).toBeTruthy();
    expect(within(needsAction()).getByText("1")).toBeTruthy();
  });

  it("a cancelled confirm changes nothing", async () => {
    h.confirm.mockResolvedValue(false);
    const update = vi.fn(async () => ({}));
    h.mutations.set("booking.updateStatus", () => ({ mutateAsync: update, isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText("Rosa Delgado")).toBeTruthy();
  });

  it("a lead marked contacted stays on the board: contacted is still an active lead", async () => {
    const leadUpdate = vi.fn(async () => ({}));
    h.mutations.set("lead.update", () => ({ mutateAsync: leadUpdate, isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([], { leads: [{ id: 9, name: "Aisha Brooks", status: "new", phone: "(216) 555-0109", createdAt: now() }] })));
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark contacted" }));
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(leadUpdate).toHaveBeenCalledWith({ id: 9, status: "contacted", contacted: 1 });
    expect(screen.getByText("Aisha Brooks")).toBeTruthy();
  });
});

describe("the summary strip", () => {
  it("holds four numbers in one row with no card borders, and keeps the unknown shape", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", FAILED);
    render(<OverviewSection />);
    const strip = screen.getByRole("region", { name: "Today summary" });
    expect(strip.className).toMatch(/(^|\s)grid-cols-4(\s|$)/);
    expect(strip.className).not.toMatch(/(^|\s)lg:grid-cols|(^|\s)grid-cols-2(\s|$)/);
    expect(strip.children).toHaveLength(4);
    for (const cell of Array.from(strip.children)) expect(cell.className).not.toMatch(/(^|\s)border(\s|-)/);
    expect(within(needsAction()).getByText("Unable to determine")).toBeTruthy();
    expect(needsAction().textContent).not.toMatch(/\d/);
  });
});

describe("the Checks rail", () => {
  it("is collapsed on a phone and open on a desktop", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    const { unmount } = render(<OverviewSection />);
    expect(rail().open).toBe(false);
    unmount();
    setDesktop(true);
    render(<OverviewSection />);
    expect(rail().open).toBe(true);
  });

  it("does not store the mount-time default, only an operator toggle", () => {
    setDesktop(true);
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    render(<OverviewSection />);
    fireEvent(rail(), new Event("toggle"));
    expect(window.localStorage.getItem(CHECKS_KEY)).toBeNull();
  });

  it("an overdue promise is an open check, and a failed promise read says promises unknown, never nothing open", () => {
    measureEverything();
    h.queries.set("promises.listOpen", ok([]));
    const first = render(<OverviewSection />);
    // The control: this fixture measures every source, so "nothing open" is reachable. The failed read
    // below is then the only thing standing between this line and the wrong one.
    expect(checksStatus()).toBe("nothing open in promises, exceptions, freshness, gateway");
    first.unmount();
    const overdue = { id: 1, customerName: "Pat", promise: "Call back", dueAt: new Date(Date.now() - 3 * 3_600_000).toISOString() };
    const later = { id: 2, customerName: "Sam", promise: "Quote", dueAt: new Date(Date.now() + 3_600_000).toISOString() };
    h.queries.set("promises.listOpen", ok([overdue, later]));
    const second = render(<OverviewSection />);
    expect(checksStatus()).toBe("1 open: 1 overdue promise");
    second.unmount();
    h.queries.set("promises.listOpen", FAILED);
    render(<OverviewSection />);
    expect(checksStatus()).toBe("not all measured · promises unknown");
  });

  it("an exception signal is an open check: one proposals count of 3 adds one exception", () => {
    measureEverything();
    h.queries.set("promises.listOpen", ok([]));
    h.queries.set("proposals.counts", ok({ readable: true, count: 3 }));
    render(<OverviewSection />);
    expect(checksStatus()).toBe("1 open: 1 exception");
  });

  it("never says nothing open while the gateway has not answered; it says so once the gateway is up", () => {
    measureEverything();
    h.queries.set("promises.listOpen", ok([]));
    // First read still in flight: no data, not an error. Everything else is measured and clear.
    h.queries.set("sms.gatewayHealth", { data: undefined, isLoading: true, isError: false });
    const first = render(<OverviewSection />);
    expect(checksStatus()).not.toMatch(/nothing open/);
    expect(checksStatus()).toBe("not all measured");
    first.unmount();
    // The control: the same fixture with the gateway answering reaches the all-clear line.
    h.queries.set("sms.gatewayHealth", ok({ configured: true, readable: true, online: true }));
    render(<OverviewSection />);
    expect(checksStatus()).toBe("nothing open in promises, exceptions, freshness, gateway");
  });

  it("a full page of 50 overdue promises is a lower bound: 50+, while 49 stays exact", () => {
    measureEverything();
    const overdue = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: i + 1, customerName: `P${i}`, promise: "Call back", dueAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString() }));
    h.queries.set("promises.listOpen", ok(overdue(49)));
    const exact = render(<OverviewSection />);
    expect(checksStatus()).toBe("49 open: 49 overdue promises");
    exact.unmount();
    // A full page that still holds a not-yet-due row is exact: the read is ordered most overdue first.
    const later = { id: 99, customerName: "Sam", promise: "Quote", dueAt: new Date(Date.now() + 3_600_000).toISOString() };
    h.queries.set("promises.listOpen", ok([...overdue(49), later]));
    const notAllDue = render(<OverviewSection />);
    expect(checksStatus()).toBe("49 open: 49 overdue promises");
    notAllDue.unmount();
    h.queries.set("promises.listOpen", ok(overdue(50)));
    render(<OverviewSection />);
    expect(checksStatus()).toBe("50+ open: 50+ overdue promises");
  });

  it("remembers the operator's choice across mounts", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    const { unmount } = render(<OverviewSection />);
    const details = rail();
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(window.localStorage.getItem(CHECKS_KEY)).toBe("open");
    unmount();
    render(<OverviewSection />);
    expect(rail().open).toBe(true);
  });

  it("an operator close on a desktop is stored as closed and the rail stays closed after a remount", () => {
    setDesktop(true);
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    const first = render(<OverviewSection />);
    const details = rail();
    expect(details.open, "a desktop opens by default").toBe(true);
    details.open = false;
    fireEvent(details, new Event("toggle"));
    expect(window.localStorage.getItem(CHECKS_KEY)).toBe("closed");
    first.unmount();
    render(<OverviewSection />);
    expect(rail().open).toBe(false);
  });

  it("a saved choice wins over the viewport default, on a phone and on a desktop", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    for (const desktop of [false, true]) {
      for (const saved of ["open", "closed"] as const) {
        window.localStorage.setItem(CHECKS_KEY, saved);
        setDesktop(desktop);
        const { unmount } = render(<OverviewSection />);
        expect(rail().open, `saved ${saved} on a ${desktop ? "desktop" : "phone"}`).toBe(saved === "open");
        unmount();
      }
    }
  });

  it("its summary counts open items: an offline gateway and a stale integration each add one", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("sms.gatewayHealth", ok({ configured: true, readable: true, online: true }));
    h.queries.set("adminSecurity.integrationFreshness", ok(FRESH));
    const { unmount } = render(<OverviewSection />);
    const base = Number(/(\d+) open/.exec(rail().querySelector("summary")!.textContent ?? "")?.[1] ?? 0);
    unmount();
    h.queries.set("sms.gatewayHealth", ok({ configured: true, readable: true, online: false }));
    h.queries.set("adminSecurity.integrationFreshness", FAILED);
    render(<OverviewSection />);
    expect(rail().querySelector("summary")!.textContent).toMatch(new RegExp(`${base + 2} open`));
  });

  it("the summary is a 48 px row with a visible focus ring", () => {
    const src = readFileSync(join(process.cwd(), "client/src/pages/admin/today/ChecksRail.tsx"), "utf8");
    const summary = /<summary\b[^>]*className="([^"]*)"/.exec(src)?.[1] ?? "";
    expect(summary).toMatch(/(^|\s)min-h-12(\s|$)/);
    expect(summary).toMatch(/focus-visible:(outline|ring)/);
  });
});
