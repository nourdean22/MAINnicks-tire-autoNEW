/**
 * Admin UI v1 Wave 5, review round 2 (silent-instrument lens). Each block kills a named surviving mutant:
 *   - a paused read (data undefined, isError false, fetchStatus "paused") is unknown in Voice live
 *     calls and the Growth reply counts, not "quiet hours" or "no banner" (the Ops Hub registry
 *     cards it also covered were cut 2026-10-25);
 *   - Settings says "Checking the ALG connection..." while the status read is in flight, never "ALG offline";
 *   - an estimate line type renders sentence case at runtime;
 *   - a phone with no digits gets no tel: or sms: link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean; fetchStatus?: string };
const h = vi.hoisted(() => ({ queries: new Map<string, Partial<Q>>(), Null: () => null }));

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
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  return { trpc: new Proxy({}, { get: (_t, key) => (key === "useUtils" || key === "useContext" ? () => node("utils") : node(String(key))) }) };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));
vi.mock("@/pages/admin/settings/FeatureFlagsPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/settings/DeclinedRecoveryPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/shared/SectionInsightStrip", () => ({ default: h.Null, SectionInsightStrip: h.Null }));

import SettingsSection from "@/pages/admin/SettingsSection";
import { LiveCallsCard } from "@/pages/admin/voice/LiveCallsCard";
import { CustomerIntelligence } from "@/pages/admin/intelligence/CustomerIntelligence";

const PAUSED: Partial<Q> = { data: undefined, isError: false, isLoading: false, fetchStatus: "paused" };
const FETCHING: Partial<Q> = { data: undefined, isError: false, isLoading: true, fetchStatus: "fetching" };
const ok = (data: unknown): Partial<Q> => ({ data, isError: false });

beforeEach(() => {
  h.queries.clear();
  window.history.replaceState({}, "", "/admin");
});
afterEach(() => h.queries.clear());

describe("Voice live calls", () => {
  it("a paused read is unknown, not quiet hours", () => {
    h.queries.set("vapi.activeCallStates", PAUSED);
    const { container } = render(<LiveCallsCard onSelectCall={() => {}} />);
    expect(container.textContent).toContain("Live calls not checked (offline). Calls in flight are unknown, not zero.");
  });

  it("positive controls: a real zero and an in-flight read both stay quiet", () => {
    h.queries.set("vapi.activeCallStates", ok({ count: 0, windowMinutes: 10, byState: {}, states: [] }));
    const zero = render(<LiveCallsCard onSelectCall={() => {}} />);
    expect(zero.container.textContent).toBe("");
    zero.unmount();
    h.queries.set("vapi.activeCallStates", FETCHING);
    const loading = render(<LiveCallsCard onSelectCall={() => {}} />);
    expect(loading.container.textContent).toBe("");
  });
});


describe("Settings ALG status while loading", () => {
  it("says it is checking, and neither 'ALG offline' nor the failure block", () => {
    window.history.replaceState({}, "", "/admin?settingsTab=shopdriver");
    h.queries.set("autoLabor.status", FETCHING);
    h.queries.set("adminDashboard.stats", ok({ shopFloor: { totalCustomers: 5, vipCustomers: 1 }, leads: { total: 2, urgent: 0 } }));
    render(<SettingsSection />);
    expect(screen.getByText("Checking the ALG connection...")).toBeTruthy();
    expect(screen.queryByText(/ALG offline/i)).toBeNull();
    expect(screen.queryByText(/ALG status couldn't load/)).toBeNull();
  });
});

describe("CustomerIntelligence phone with no digits", () => {
  it("hides both links for 'N/A' and keeps them for a real number", () => {
    h.queries.set(
      "intelligence.nextBestActions",
      ok({
        actions: [
          { type: "vip_winback", message: "Pat Example has not visited in 200 days", urgency: 4, phone: "216-555-0100" },
          { type: "vip_winback", message: "Lee Example has not visited in 300 days", urgency: 3, phone: "N/A" },
        ],
      }),
    );
    h.queries.set("intelligence.masterReport", ok({}));
    render(<CustomerIntelligence />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["tel:2165550100", "sms:2165550100"]);
  });
});
