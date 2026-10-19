/**
 * Admin UI v1 Wave 5, item 1: the Reach, Machine and System sections stop painting a failed read as
 * 0, "none", an empty-state sentence, nothing at all, or a spinner that never ends
 * (apps/nickstire/docs/design/admin-ui-v1/PLAN.md sections 3 and 9).
 *
 * Same harness as admin-w0-honesty.test.tsx: "@/lib/trpc" is a proxy whose queries return
 * { data: undefined, isError: false } unless a test sets an override for the dotted path, so a
 * section that gains a call never dies on a missing key. Every block has a positive control that
 * proves the honest branch did not swallow the real empty or real data case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  Null: () => null,
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
  const mutation = () => () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false, reset: () => {} });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation();
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
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));

// Child panels that are not under test.
vi.mock("@/pages/admin/settings/FeatureFlagsPanel", () => ({ default: h.Null }));
vi.mock("@/pages/admin/shared/SectionInsightStrip", () => ({ default: h.Null, SectionInsightStrip: h.Null }));
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

import SettingsSection from "@/pages/admin/SettingsSection";
import DeclinedRecoveryPanel from "@/pages/admin/settings/DeclinedRecoveryPanel";
import TrafficFunnelSection from "@/pages/admin/TrafficFunnelSection";
import { ContentManager } from "@/pages/admin/content/ContentManager";
import OpsHubSection from "@/pages/admin/OpsHubSection";
import { LiveCallsCard } from "@/pages/admin/voice/LiveCallsCard";
import { InstagramAdmin } from "@/pages/admin/instagram/InstagramAdmin";

const FAILED: Partial<Q> = { data: undefined, isError: true, error: new Error("read failed") };
const ok = (data: unknown): Partial<Q> => ({ data, isError: false });

beforeEach(() => {
  h.queries.clear();
  window.history.replaceState({}, "", "/admin");
});
afterEach(() => {
  h.queries.clear();
  vi.restoreAllMocks();
});


describe("Settings (ShopDriver tab)", () => {
  beforeEach(() => window.history.replaceState({}, "", "/admin?settingsTab=shopdriver"));

  it("a failed ALG status read is unknown: no offline banner, no 'No credentials configured', no zero counts", () => {
    const refetch = vi.fn();
    h.queries.set("autoLabor.status", { ...FAILED, refetch });
    h.queries.set("adminDashboard.stats", ok({ shopFloor: { totalCustomers: 5, vipCustomers: 1 }, leads: { total: 2, urgent: 0 } }));
    render(<SettingsSection />);
    expect(screen.queryByText(/No credentials configured/)).toBeNull();
    expect(screen.queryByText(/ALG OFFLINE/i)).toBeNull();
    expect(screen.queryByText(/ALG offline/i)).toBeNull();
    expect(screen.queryByText(/0 categories/)).toBeNull();
    expect(screen.queryByText(/0 lookups total/)).toBeNull();
    const msg = screen.getByText("ALG status couldn't load. The connection and lookup counts are unknown, not zero.");
    fireEvent.click(within(msg.parentElement as HTMLElement).getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("failed dashboard stats show unknown tiles, not '0 VIP' or '0 urgent'", () => {
    h.queries.set("autoLabor.status", ok({ connected: true, accountId: "A1", fallbackCategories: 3, fallbackJobs: 9, totalLookups: 4 }));
    h.queries.set("adminDashboard.stats", FAILED);
    render(<SettingsSection />);
    expect(screen.queryByText(/0 VIP/)).toBeNull();
    expect(screen.queryByText(/0 urgent/)).toBeNull();
    expect(screen.getAllByText("Unable to determine").length).toBeGreaterThanOrEqual(2);
  });

  it("positive control: a real offline status still reads offline with its own error", () => {
    h.queries.set("autoLabor.status", ok({ connected: false, error: "login rejected", fallbackCategories: 3, fallbackJobs: 9, totalLookups: 4 }));
    h.queries.set("adminDashboard.stats", ok({ shopFloor: { totalCustomers: 5, vipCustomers: 1 }, leads: { total: 2, urgent: 0 } }));
    render(<SettingsSection />);
    expect(screen.getByText(/login rejected/)).toBeTruthy();
    expect(screen.getByText(/3 categories/)).toBeTruthy();
    expect(screen.getByText(/1 VIP/)).toBeTruthy();
    expect(screen.queryByText(/ALG status couldn't load/)).toBeNull();
  });
});

describe("Declined-work recovery panel", () => {
  it("a failed read keeps a visible, retryable unknown instead of returning null", () => {
    const refetch = vi.fn();
    h.queries.set("shopdriver.declinedRecoveryStatus", { ...FAILED, refetch });
    const { container } = render(<DeclinedRecoveryPanel />);
    expect(container.textContent).toContain("Declined-work recovery status couldn't load. Whether it is live is unknown, not off.");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("positive control: good data renders the tiles", () => {
    h.queries.set("shopdriver.declinedRecoveryStatus", ok({ featureEnabled: true, eligible: 4, recoverableDollars: 900, next7dSends: 1, next30dSends: 2, message: "ok" }));
    const { container } = render(<DeclinedRecoveryPanel />);
    expect(screen.getByText("Recoverable")).toBeTruthy();
    expect(container.textContent).not.toMatch(/couldn't load/);
  });
});

describe("Traffic to Revenue panels", () => {
  /** The panels are private to the section, so mount the whole section with a good overview read. */
  function renderFunnel() {
    h.queries.set("trafficFunnel.overview", ok({
      stages: [], alerts: [], topQueries: [], topPages: [],
      branded: { branded: 0, brandedPct: 0, nonBranded: 0 },
      generatedAt: new Date().toISOString(),
    }));
    return render(<TrafficFunnelSection />);
  }

  it("failed top-booking-pages is unknown, not 'No bookings with page attribution'", () => {
    const refetch = vi.fn();
    h.queries.set("trafficFunnel.topBookingPages", { ...FAILED, refetch });
    renderFunnel();
    expect(screen.queryByText(/No bookings with page attribution/)).toBeNull();
    const msg = screen.getByText("Booking pages couldn't load. Attribution is unknown, not empty.");
    fireEvent.click(within(msg.parentElement as HTMLElement).getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("positive control: a real zero-attribution read still explains the gap", () => {
    h.queries.set("trafficFunnel.topBookingPages", ok({ pages: [], withAttribution: 0, totalBookings: 7 }));
    renderFunnel();
    expect(screen.getByText(/No bookings with page attribution/)).toBeTruthy();
  });

});


describe("Ops Hub live checks", () => {
  it("a failed payments.health read says the live check is unknown on both annotated cards", () => {
    h.queries.set("payments.health", FAILED);
    render(<OpsHubSection />);
    expect(screen.getAllByText("Live check couldn't load. This deploy's state is unknown.")).toHaveLength(2);
  });

  it("positive control: a good read keeps the live lines and no unknown line", () => {
    h.queries.set("payments.health", ok({ stripe: { fullyConfigured: true, halfConfigured: false }, sheetsConfigured: true }));
    render(<OpsHubSection />);
    expect(screen.getByText("Live check: Stripe fully configured in this deploy.")).toBeTruthy();
    expect(screen.queryByText(/Live check couldn't load/)).toBeNull();
  });
});

describe("Voice live calls", () => {
  it("a failed read shows a retryable unknown instead of vanishing", () => {
    const refetch = vi.fn();
    h.queries.set("vapi.activeCallStates", { ...FAILED, refetch });
    const { container } = render(<LiveCallsCard onSelectCall={() => {}} />);
    expect(container.textContent).toContain("Live calls couldn't load. Calls in flight are unknown, not zero.");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("positive control: a real zero in flight still hides the card on quiet hours", () => {
    h.queries.set("vapi.activeCallStates", ok({ count: 0, windowMinutes: 10, byState: {}, states: [] }));
    const { container } = render(<LiveCallsCard onSelectCall={() => {}} />);
    expect(container.textContent).toBe("");
  });
});

describe("Instagram header chip", () => {
  it("a failed pipeline-health read shows 'Meta unknown' instead of no chip", () => {
    h.queries.set("instagramAdmin.getPipelineHealth", FAILED);
    render(<InstagramAdmin />);
    expect(screen.getByText("Meta unknown")).toBeTruthy();
  });

  it("positive control: a live Meta read still says Meta live", () => {
    h.queries.set("instagramAdmin.getPipelineHealth", ok({ meta: { connected: true, live: true } }));
    render(<InstagramAdmin />);
    expect(screen.getByText("Meta live")).toBeTruthy();
    expect(screen.queryByText("Meta unknown")).toBeNull();
  });
});
