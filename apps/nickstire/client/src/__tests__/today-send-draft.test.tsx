/**
 * Fast replies (job 2026-11-07-fast-replies, client half). Nour 2026-11-07: "Answer texts in a minute,
 * not 66 hours". The draft for a waiting text exists within seconds; Today's row only opened the thread,
 * and the thread drafted again. Now a waiting-text row whose newest text has a stored draft
 * (bundle.owedTexts[i].draftId / draftText, server/services/smsResponseJobs.ts) shows that draft and
 * sends it in one tap through smsOrchestrator.actionHumanReview({ id: draftId, action: "send" }), the
 * same claim-first mutation the review queue's APPROVE & SEND uses. A row with no draft is unchanged.
 *
 * Harness: the "@/lib/trpc" proxy of admin-w2-today-board.test.tsx, plus `getData` on utils so the
 * board can read the refetched bundle after the send. The draft TEXT is a fixture value, never copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean; dataUpdatedAt: number };
const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  mutations: new Map<string, (opts: any) => unknown>(),
  /** Every mutation input, by dotted path. */
  inputs: [] as Array<{ path: string; input: unknown }>,
  confirm: vi.fn(async () => true),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  Null: () => null,
  Marker: (id: string) => () => <div data-testid={id} />,
  onInvalidate: null as null | ((path: string) => void),
}));
vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined, isLoading: false, isError: false, error: null, refetch: () => {}, isFetching: false, ...h.queries.get(path),
  });
  const mutation = (path: string) => (opts: any) =>
    h.mutations.get(path)?.(opts) ?? {
      mutate: () => {},
      mutateAsync: async (input: unknown) => { h.inputs.push({ path, input }); return {}; },
      isPending: false, isSuccess: false, reset: () => {},
    };
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation(path);
        if (key === "invalidate") return async () => { h.onInvalidate?.(path); };
        // utils.<proc>.getData(): the cached data, which is what the query mock serves.
        if (key === "getData") return () => h.queries.get(path.replace(/^utils\./, ""))?.data;
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
  toast: Object.assign(vi.fn(), { success: h.toastSuccess, error: h.toastError, info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm, promptDialog: vi.fn(async () => null), default: h.Null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));
vi.mock("@/pages/admin/SalesCard", () => ({ default: h.Marker("sales-card") }));
vi.mock("@/pages/admin/PromisesPanel", () => ({ default: h.Marker("promises") }));
vi.mock("@/pages/admin/today/ArrivalLoadStrip", () => ({ default: h.Marker("arrival") }));
vi.mock("@/pages/admin/today/ExceptionFeed", () => ({ default: h.Marker("exceptions") }));
import OverviewSection from "@/pages/admin/OverviewSection";

const BUNDLE_PATH = "adminDashboard.overviewMediumBundle";
const SEND_PATH = "smsOrchestrator.actionHumanReview";
const ok = (data: unknown): Partial<Q> => ({ data, isError: false });
const DRAFT = "fixture draft body 0001";
/** Placeholder people only: 555 numbers, no real names. */
const text = (conversationId: number, over: Record<string, unknown> = {}) => ({
  conversationId, phone: `(216) 555-01${conversationId}`, customerName: `Texter ${conversationId}`, preview: `question ${conversationId}`,
  waitingMinutes: 12, overdue: false, texts: 1, draftId: null as number | null, draftText: null as string | null, ...over,
});
const BUNDLE = (owedTexts: unknown[]) => ({ stats: null, bookings: [], leads: [], callbacks: [], owedTexts, callbackServed: {}, unavailableSlices: [] as string[] });
const rows = () => within(screen.getByRole("region", { name: "Priority action queue" })).queryAllByRole("article");
const rowOf = (name: string) => rows().find((r) => within(r).queryByText(name)) as HTMLElement;
const sends = () => h.inputs.filter((i) => i.path === SEND_PATH).map((i) => i.input);

beforeEach(() => {
  h.queries.clear();
  h.mutations.clear();
  h.inputs.length = 0;
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.onInvalidate = null;
  h.queries.set("opportunityQueue.list", ok({ items: [], queryable: true }));
  h.queries.set("adminSecurity.status", ok({ adminRole: "owner", permissions: [] }));
  h.mutations.set("adminSecurity.recordAction", () => ({ mutateAsync: async () => ({ reference: "ACT-1" }), isPending: false }));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a waiting text with a stored draft", () => {
  it("shows the draft and a Send draft button; a text with no draft shows neither (the draftId guard)", () => {
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31, { draftId: 901, draftText: DRAFT }), text(32)])));
    render(<OverviewSection />);
    const withDraft = rowOf("Texter 31");
    expect(within(withDraft).getByText(DRAFT)).toBeTruthy();
    expect(within(withDraft).getByRole("button", { name: "Send draft" })).toBeTruthy();
    const noDraft = rowOf("Texter 32");
    expect(within(noDraft).queryByRole("button", { name: "Send draft" })).toBeNull();
    expect(within(noDraft).queryByText(/Suggested reply/)).toBeNull();
  });

  it("a row with no draft keeps exactly today's Open thread action", () => {
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(32)])));
    render(<OverviewSection />);
    const row = rowOf("Texter 32");
    expect(within(row).getByRole("button", { name: "Open thread" })).toBeTruthy();
    expect(within(row).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).not.toContain("Send draft");
  });

  it("the draft row still offers Open thread, so the counter can write their own reply", () => {
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31, { draftId: 901, draftText: DRAFT })])));
    render(<OverviewSection />);
    expect(within(rowOf("Texter 31")).getByRole("button", { name: "Open thread" })).toBeTruthy();
  });

  it("the draft reads at 16 px, clamps to 3 lines, and opens in full on tap", () => {
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31, { draftId: 901, draftText: DRAFT })])));
    render(<OverviewSection />);
    const toggle = within(rowOf("Texter 31")).getByText(DRAFT).closest("button") as HTMLButtonElement;
    expect(toggle.className).toMatch(/text-\[16px\]/);
    expect(toggle.className).toMatch(/line-clamp-3/);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.className).not.toMatch(/line-clamp-3/);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("Send draft is a 48 x 48 minimum tap target", () => {
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31, { draftId: 901, draftText: DRAFT })])));
    render(<OverviewSection />);
    const button = within(rowOf("Texter 31")).getByRole("button", { name: "Send draft" });
    expect(button.className).toMatch(/\bmin-h-12\b/);
    expect(button.className).toMatch(/\bmin-w-12\b/);
  });
});

describe("one tap sends the stored draft", () => {
  it("calls actionHumanReview with exactly { id: draftId, action: 'send' }, no dialog, and refreshes the board", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const promptSpy = vi.spyOn(window, "prompt");
    const invalidated: string[] = [];
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31, { draftId: 901, draftText: DRAFT })])));
    h.onInvalidate = (path) => {
      invalidated.push(path);
      if (path === `utils.${BUNDLE_PATH}`) h.queries.set(BUNDLE_PATH, ok(BUNDLE([])));
    };
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(within(rowOf("Texter 31")).getByRole("button", { name: "Send draft" }));
    });
    expect(sends()).toEqual([{ id: 901, action: "send" }]);
    expect(h.inputs.some((i) => i.path === "smsConversations.send")).toBe(false);
    expect(invalidated).toContain(`utils.${BUNDLE_PATH}`);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("the row leaves the board once the refreshed bundle no longer lists the customer", async () => {
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31, { draftId: 901, draftText: DRAFT })])));
    h.onInvalidate = (path) => { if (path === `utils.${BUNDLE_PATH}`) h.queries.set(BUNDLE_PATH, ok(BUNDLE([]))); };
    const { rerender } = render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(within(rowOf("Texter 31")).getByRole("button", { name: "Send draft" }));
    });
    rerender(<OverviewSection />);
    await waitFor(() => expect(rows()).toHaveLength(0));
  });

  it("a send the server accepted but that left the customer waiting is said out loud, and the row stays", async () => {
    const waiting = BUNDLE([text(31, { draftId: 901, draftText: DRAFT })]);
    h.queries.set(BUNDLE_PATH, ok(waiting));
    // The refetch still lists the customer (the gateway refused, or the obligation did not close).
    h.onInvalidate = (path) => { if (path === `utils.${BUNDLE_PATH}`) h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31)]))); };
    const { rerender } = render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(within(rowOf("Texter 31")).getByRole("button", { name: "Send draft" }));
    });
    rerender(<OverviewSection />);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/still shows as waiting/));
    expect(rowOf("Texter 31")).toBeTruthy();
  });

  it("a refused send (CONFLICT) shows the server's own message on the row, and the row stays", async () => {
    const message = "This draft was just actioned elsewhere — refresh the queue.";
    h.mutations.set(SEND_PATH, () => ({ mutateAsync: async () => { throw new Error(message); }, isPending: false }));
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31, { draftId: 901, draftText: DRAFT })])));
    render(<OverviewSection />);
    await act(async () => {
      fireEvent.click(within(rowOf("Texter 31")).getByRole("button", { name: "Send draft" }));
    });
    const row = rowOf("Texter 31");
    expect(within(row).getByRole("alert").textContent).toBe(message);
    expect(within(row).getByRole("button", { name: "Send draft" })).toBeTruthy();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("while the send runs the button says Sending and cannot be tapped again", () => {
    h.mutations.set(SEND_PATH, () => ({ mutateAsync: async () => ({}), isPending: true, variables: { id: 901, action: "send" } }));
    h.queries.set(BUNDLE_PATH, ok(BUNDLE([text(31, { draftId: 901, draftText: DRAFT }), text(33, { draftId: 903, draftText: "fixture draft body 0003" })])));
    render(<OverviewSection />);
    const busy = within(rowOf("Texter 31")).getByRole("button", { name: "Sending" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    // The other row's button keeps its label; every board action waits while a write runs.
    const other = within(rowOf("Texter 33")).getByRole("button", { name: "Send draft" }) as HTMLButtonElement;
    expect(other.disabled).toBe(true);
  });
});
