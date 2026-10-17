/**
 * Admin UI v1 W6 prep: Keep / Less marks on Today's queue rows (apps/nickstire/docs/design/admin-ui-v1/PLAN.md,
 * W6 row). W6 (one ranked stream) waits for two weeks of these verdicts, so each row gets two plain
 * words in its overflow, a verdict is recorded through adminSecurity.recordAction, and the Checks rail
 * says how many are stored. A verdict is not an action on the job: the row stays where it is.
 *
 * The harness is the one admin-w2-today-board.test.tsx uses: the real OverviewSection mounted with
 * "@/lib/trpc" replaced by a proxy (every query returns { data: undefined } unless a test sets its dotted
 * path), so the verdict goes through the real handler with a mocked mutation. The summary read is
 * CONTRACT queueFeedbackSummary v1 from the server lane; here it is a mocked query.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
  invalidated: [] as string[],
  /** The options each useQuery path was last called with, so a test can see `enabled`. */
  opts: new Map<string, { enabled?: boolean } | undefined>(),
}));
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => (_input?: unknown, opts?: { enabled?: boolean }) => {
    h.opts.set(path, opts);
    return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isFetching: false,
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
        if (key === "invalidate") return async () => { h.invalidated.push(path); };
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
vi.mock("@/pages/admin/InspectionCapturePanel", () => ({ default: h.Marker("inspection") }));
vi.mock("@/pages/admin/ClosedLoopLiftPanel", () => ({ default: h.Marker("closed-loop") }));
vi.mock("@/pages/admin/today/ArrivalLoadStrip", () => ({ default: h.Marker("arrival") }));
vi.mock("@/pages/admin/today/ExceptionFeed", () => ({ default: h.Marker("exceptions") }));
import OverviewSection from "@/pages/admin/OverviewSection";

const SUMMARY_PATH = "adminSecurity.queueFeedbackSummary";
/** The owner holds security.manage; the front desk does not (queueFeedbackSummary is owner-only). */
const asOwner = () => h.queries.set("adminSecurity.status", ok({ adminRole: "owner", permissions: ["security.manage", "reports.view"] }));
const asFrontDesk = () => h.queries.set("adminSecurity.status", ok({ adminRole: "front_desk", permissions: ["bookings.manage"] }));
const ok = (data: unknown): Partial<Q> => ({ data, isError: false });
const now = () => new Date().toISOString();
const booking = (id: number, name: string) => ({ id, name, phone: `(216) 555-01${String(id).padStart(2, "0")}`, status: "new", service: "Tire swap", preferredDate: "2026-10-16", createdAt: now() });
const workOrder = (id: number, name: string) => ({ id, status: "approved", customerName: name, createdAt: now() });
const BUNDLE = (bookings: unknown[] = []) => ({
  stats: null, bookings, leads: [], callbacks: [], owedTexts: [], callbackServed: {}, unavailableSlices: [] as string[],
});
const FRESH = { readable: true, connected: true, lastSuccessfulAt: now(), failuresSinceLastSuccess: 0, lastAttemptOutcome: "success", source: "alg_probe_log", generatedAt: now() };

const rowFor = (name: string) => screen.getByText(name).closest("article") as HTMLElement;
const more = (row: HTMLElement, name: string) => fireEvent.click(within(row).getByRole("button", { name: `More actions for ${name}` }));
const detailLine = (row: HTMLElement) => row.querySelector("p")!.textContent ?? "";
const hasToken = (el: Element, token: string) => el.className.split(/\s+/).includes(token);
const rail = () => screen.getByText("Checks", { selector: "summary *" }).closest("details") as HTMLDetailsElement;
const checksStatus = () => (rail().querySelector("summary")!.textContent ?? "").replace(/^Checks/, "");
const needsAction = () => screen.getByText("Needs action").parentElement as HTMLElement;
const feedbackLine = () => screen.getByText(/^Keep\/Less:/);

/** Every source the rail counts answers with zero or healthy, so the open count is a stable 0. */
function measureEverything() {
  const slice = { available: true, error: null };
  h.queries.set("adminDashboard.overviewMediumBundle", ok({ ...BUNDLE(), slices: { stats: slice, bookings: slice, leads: slice, callbacks: slice, health: slice }, stats: { tires: { new: 0 }, memberships: { warning: 0 } } }));
  h.queries.set("contentAdmin.operationsSignal", ok({ unknown: false, total: 0, videoProviderBlocked: 0 }));
  h.queries.set("proposals.counts", ok({ readable: true, count: 0 }));
  h.queries.set("sms.gatewayHealth", ok({ configured: true, readable: true, online: true }));
  h.queries.set("adminSecurity.integrationFreshness", ok(FRESH));
  h.queries.set("promises.listOpen", ok([]));
}

type RecordInput = { action: string; entityType?: string; entityId?: number; changes?: Record<string, unknown> };
let recorded: RecordInput[] = [];
function recordWith(impl: (input: RecordInput) => Promise<{ reference: string }>) {
  h.mutations.set("adminSecurity.recordAction", () => ({
    mutateAsync: async (input: RecordInput) => { recorded.push(input); return impl(input); },
    isPending: false,
  }));
}

beforeEach(() => {
  h.queries.clear();
  h.mutations.clear();
  h.invalidated = [];
  h.opts.clear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  recorded = [];
  h.queries.set("workOrders.list", ok([]));
  recordWith(async () => ({ reference: "ACT-1" }));
  try { window.localStorage.clear(); } catch { /* storage blocked: the rail must still render */ }
});
afterEach(() => {
  h.queries.clear();
  h.mutations.clear();
  vi.restoreAllMocks();
});

describe("Keep and Less sit in every row's overflow", () => {
  it("a booking row offers Keep and Less beside its secondary action, each a 48 px target", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    const row = rowFor("Rosa Delgado");
    expect(within(row).queryByRole("button", { name: "Keep" })).toBeNull();
    more(row, "Rosa Delgado");
    for (const name of ["Keep", "Less", "Cancel booking"]) {
      const button = within(row).getByRole("button", { name });
      expect(hasToken(button, "min-h-12"), `${name} is a 48 px target`).toBe(true);
    }
  });

  it("a work order row has no secondary action, and still offers Keep and Less", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("workOrders.list", ok([workOrder(7, "Dana Whitfield")]));
    render(<OverviewSection />);
    const row = rowFor("Dana Whitfield");
    more(row, "Dana Whitfield");
    expect(hasToken(within(row).getByRole("button", { name: "Keep" }), "min-h-12")).toBe(true);
    expect(hasToken(within(row).getByRole("button", { name: "Less" }), "min-h-12")).toBe(true);
  });
});

describe("tapping a verdict", () => {
  it("Less records the exact payload, asks nothing, keeps the row, closes the overflow and says so quietly", async () => {
    const update = vi.fn(async () => ({}));
    h.mutations.set("booking.updateStatus", () => ({ mutateAsync: update, isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado"), booking(2, "Paul Szabo")])));
    render(<OverviewSection />);
    const row = rowFor("Rosa Delgado");
    more(row, "Rosa Delgado");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Less" })); });

    expect(recorded).toEqual([
      { action: "admin.queue_feedback", entityType: "booking", entityId: 1, changes: { verdict: "less", itemType: "booking", source: "today" } },
    ]);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith("Marked Less");
    expect(row.isConnected).toBe(true);
    expect(rowFor("Paul Szabo")).toBeTruthy();
    expect(hasToken(row, "opacity-0"), "a verdict does not fade the row").toBe(false);
    expect(within(row).queryByRole("button", { name: "Less" })).toBeNull();
    expect(within(row).getByRole("button", { name: "More actions for Rosa Delgado" }).getAttribute("aria-expanded")).toBe("false");
    expect(detailLine(row)).toMatch(/^Less · booking/);
    expect(detailLine(rowFor("Paul Szabo"))).not.toMatch(/^(Less|Kept) · /);
    expect(within(needsAction()).getByText("2")).toBeTruthy();
    expect(h.invalidated).toContain(`utils.${SUMMARY_PATH}`);
  });

  it("Keep records its own verdict, and marking again replaces the word on the row and records again", async () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    const row = rowFor("Rosa Delgado");
    more(row, "Rosa Delgado");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Keep" })); });
    expect(recorded[0]).toEqual({ action: "admin.queue_feedback", entityType: "booking", entityId: 1, changes: { verdict: "keep", itemType: "booking", source: "today" } });
    expect(h.toastSuccess).toHaveBeenCalledWith("Marked Keep");
    expect(detailLine(row)).toMatch(/^Kept · booking/);

    more(row, "Rosa Delgado");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Less" })); });
    expect(recorded.map((r) => r.changes?.verdict)).toEqual(["keep", "less"]);
    expect(detailLine(row)).toMatch(/^Less · booking/);
    expect(detailLine(row)).not.toMatch(/Kept/);
  });

  it("the front desk can still mark a verdict (recordAction is open to every admin role)", async () => {
    asFrontDesk();
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    const row = rowFor("Rosa Delgado");
    more(row, "Rosa Delgado");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Keep" })); });
    expect(recorded).toHaveLength(1);
    expect(detailLine(row)).toMatch(/^Kept · booking/);
  });

  it("a work order row records its own type and entity", async () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("workOrders.list", ok([workOrder(7, "Dana Whitfield")]));
    render(<OverviewSection />);
    const row = rowFor("Dana Whitfield");
    more(row, "Dana Whitfield");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Keep" })); });
    expect(recorded).toEqual([
      { action: "admin.queue_feedback", entityType: "workOrder", entityId: 7, changes: { verdict: "keep", itemType: "workOrder", source: "today" } },
    ]);
  });

  it("a failed write records no word on the row, toasts the failure, and keeps the row", async () => {
    recordWith(async () => { throw new Error("Receipt write failed"); });
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE([booking(1, "Rosa Delgado")])));
    render(<OverviewSection />);
    const row = rowFor("Rosa Delgado");
    more(row, "Rosa Delgado");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Less" })); });
    expect(h.toastError).toHaveBeenCalledWith("Receipt write failed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(row.isConnected).toBe(true);
    expect(detailLine(row)).not.toMatch(/^(Less|Kept) · /);
    expect(h.invalidated).not.toContain(`utils.${SUMMARY_PATH}`);
  });
});

describe("the Checks rail counts the stored verdicts", () => {
  beforeEach(asOwner);

  it("a readable total says how many are marked since which day", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set(SUMMARY_PATH, ok({ readable: true, total: 12, since: "2026-10-03T14:00:00.000Z", byType: [{ itemType: "booking", keep: 5, less: 7 }] }));
    render(<OverviewSection />);
    expect(feedbackLine().textContent).toBe("Keep/Less: 12 marked since Oct 3");
    expect(feedbackLine().closest("details")).toBe(rail());
  });

  it("a real zero says none yet", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set(SUMMARY_PATH, ok({ readable: true, total: 0, since: null, byType: [] }));
    render(<OverviewSection />);
    expect(feedbackLine().textContent).toBe("Keep/Less: none yet");
  });

  it("an unreadable store, a failed read and a read that has not answered all say not measured, never 0", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    const cases: Array<[string, Partial<Q>]> = [
      ["readable false", ok({ readable: false, reason: "table missing" })],
      ["isError", { data: undefined, isError: true, error: new Error("read failed") }],
      ["a refetch that failed after an earlier answer (stale data kept)", { data: { readable: true, total: 12, since: "2026-10-03T14:00:00.000Z", byType: [] }, isError: true }],
      ["paused", { data: undefined, isLoading: false, isError: false }],
      ["loading", { data: undefined, isLoading: true, isError: false }],
    ];
    for (const [label, query] of cases) {
      h.queries.set(SUMMARY_PATH, query);
      const view = render(<OverviewSection />);
      expect(feedbackLine().textContent, label).toBe("Keep/Less: not measured");
      view.unmount();
    }
  });

  it("the front desk gets no line and no read: the summary is owner-only, and the query is not enabled", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set(SUMMARY_PATH, ok({ readable: true, total: 12, since: "2026-10-03T14:00:00.000Z", byType: [] }));
    asFrontDesk();
    const desk = render(<OverviewSection />);
    expect(screen.queryByText(/Keep\/Less:/)).toBeNull();
    expect(h.opts.get(SUMMARY_PATH)?.enabled).toBe(false);
    desk.unmount();
    // Permissions not loaded yet is not a grant either.
    h.queries.set("adminSecurity.status", { data: undefined });
    const unknown = render(<OverviewSection />);
    expect(screen.queryByText(/Keep\/Less:/)).toBeNull();
    expect(h.opts.get(SUMMARY_PATH)?.enabled).toBe(false);
    unknown.unmount();
    // The control: the owner, same fixture, sees the line and the read is enabled.
    asOwner();
    render(<OverviewSection />);
    expect(feedbackLine().textContent).toBe("Keep/Less: 12 marked since Oct 3");
    expect(h.opts.get(SUMMARY_PATH)?.enabled).toBe(true);
  });

  it("is not an open check: the open count and the status line do not move with it", async () => {
    measureEverything();
    const unread = render(<OverviewSection />);
    const baseline = checksStatus();
    expect(baseline, "the fixture reaches the all-clear line, so a leak into the count would show").toBe("nothing open in promises, exceptions, freshness, gateway");
    unread.unmount();

    h.queries.set(SUMMARY_PATH, ok({ readable: true, total: 40, since: "2026-10-03T14:00:00.000Z", byType: [] }));
    const withVerdicts = render(<OverviewSection />);
    expect(checksStatus()).toBe(baseline);
    withVerdicts.unmount();

    h.queries.set("adminDashboard.overviewMediumBundle", ok({ ...BUNDLE([booking(1, "Rosa Delgado")]), slices: {}, stats: { tires: { new: 0 }, memberships: { warning: 0 } } }));
    render(<OverviewSection />);
    const before = checksStatus();
    const row = rowFor("Rosa Delgado");
    more(row, "Rosa Delgado");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Less" })); });
    expect(checksStatus()).toBe(before);
  });
});
