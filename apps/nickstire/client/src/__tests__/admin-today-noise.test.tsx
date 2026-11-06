/**
 * 2026-11-06 · Nour: "correct all these stupid ass reminders". Today stops showing:
 * (1) two callback rows for the same phone (one row; Complete callback closes both);
 * (2) "Promise overdue · callback promised by Front Counter" rows, the receptionist's
 *     retired callback promises (an operator's own promise still shows).
 * Harness: the same "@/lib/trpc" proxy as admin-w2-today-board.test.tsx.
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
const BUNDLE = (extra: Record<string, unknown> = {}) => ({
  stats: null, bookings: [], leads: [], callbacks: [], owedTexts: [], callbackServed: {}, unavailableSlices: [] as string[], ...extra,
});
const rows = () => within(screen.getByRole("region", { name: "Priority action queue" })).queryAllByRole("article");
const cb = (id: number, phone: string, name = "Missed call (name unknown)") => ({ id, name, phone, status: "new", createdAt: now() });
const opp = (id: string, over: Record<string, unknown>) => ({
  id, recommendedAction: "Keep the promise", reason: "r", customerName: null, customerPhone: "2165550199", expectedRevenueCents: null,
  sourceType: "promise_overdue", dataQuality: "verified", state: "new", attempts: 0, consentOk: true, receipts: [],
  createdAt: now(), updatedAt: now(), ageDays: 0, evidence: null as Record<string, unknown> | null, ...over,
});

beforeEach(() => {
  h.queries.clear();
  h.mutations.clear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.queries.set("opportunityQueue.list", ok({ items: [], queryable: true }));
  h.queries.set("adminSecurity.status", ok({ adminRole: "owner", permissions: [] }));
  h.mutations.set("adminSecurity.recordAction", () => ({ mutateAsync: async () => ({ reference: "ACT-1" }), isPending: false }));
});
afterEach(() => {
  h.queries.clear();
  h.mutations.clear();
  vi.restoreAllMocks();
});

describe("one row per phone for callbacks", () => {
  it("two callbacks for the same number are one row; a different number keeps its own (positive control)", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE({ callbacks: [cb(1, "(216) 555-0101"), cb(2, "216-555-0101", "Caller"), cb(3, "(216) 555-0102")] })));
    render(<OverviewSection />);
    expect(rows()).toHaveLength(2);
  });

  it("Complete callback closes every request from that number", async () => {
    const done: number[] = [];
    h.mutations.set("callback.updateStatus", () => ({ mutateAsync: async (v: { id: number }) => { done.push(v.id); return {}; }, isPending: false }));
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE({ callbacks: [cb(1, "(216) 555-0101"), cb(2, "2165550101")] })));
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Complete callback" }));
    });
    await waitFor(() => expect(done.sort()).toEqual([1, 2]));
  });
});

describe("the evaluator's missed-call cards are not on Today (Nour 2026-11-06: \"off\")", () => {
  it("hides a missed_call card and keeps another follow-up (positive control); the card stays in Sales Pipeline", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("opportunityQueue.list", ok({ queryable: true, items: [
      opp("m", { sourceType: "missed_call", reason: "The receptionist's evaluation says this is unresolved (asked if a tire size is in stock); a human call-back beats any text." }),
      opp("e", { sourceType: "unapproved_estimate", reason: "Estimate waiting on the customer." }),
    ] }));
    render(<OverviewSection />);
    expect(screen.queryByText(/a human call-back beats any text/)).toBeNull();
    expect(screen.getByText(/Estimate waiting on the customer/)).toBeTruthy();
  });
});

describe("the receptionist's retired callback promises are not on Today", () => {
  it("hides a Front Counter callback promise and keeps an operator's own promise", () => {
    h.queries.set("adminDashboard.overviewMediumBundle", ok(BUNDLE()));
    h.queries.set("opportunityQueue.list", ok({ queryable: true, items: [
      opp("a", { reason: "callback promised by Front Counter, due 2026-11-05 23:00 — 14h overdue.", evidence: { promiseType: "callback", owner: "Front Counter" } }),
      opp("b", { reason: "quote promised by Nour, due 2026-11-05 23:00 — 14h overdue.", evidence: { promiseType: "quote", owner: "Nour" } }),
    ] }));
    render(<OverviewSection />);
    expect(screen.queryByText(/promised by Front Counter/)).toBeNull();
    expect(screen.getByText(/promised by Nour/)).toBeTruthy();
  });
});
