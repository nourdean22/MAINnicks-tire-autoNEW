/**
 * admin-prune-honesty-kept.test.tsx · 2026-10-19 (admin prune W1, review round 1)
 *
 * Two live honesty guards lived in describe blocks of admin-w5-honesty.test.tsx that
 * the prune dropped with Growth and Intelligence HQ. The panels are still live:
 * Social Pipeline Health inside Website & Local > Local Growth, and ContentManager's
 * generation log. Copied verbatim from 174e3306f, rendered through their new homes.
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

import { LocalGrowthTab } from "@/pages/admin/GrowthSection";
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


describe("Website & Local > Local Growth: Social Pipeline Health", () => {
  const PIPELINE = {
    readiness: { igLivePosting: false, reelPipeline: true, reelPublish: false, reelAutopost: false, gbpPosting: false, smsPathOpen: false },
    envGates: [{ key: "IG_LIVE_POSTING", armed: false }],
    dbFlags: [{ key: "FEATURE_X", armed: true }],
  };

  it("a failed Social Pipeline Health read keeps the panel, says unknown, and Retry refetches", () => {
    window.history.replaceState({}, "", "/admin?growthTab=local");
    const refetch = vi.fn();
    h.queries.set("socialPipeline.status", { ...FAILED, refetch });
    render(<LocalGrowthTab />);
    const msg = screen.getByText("Social pipeline status couldn't load. The kill-switch states are unknown, not off.");
    expect(screen.getByText("Social Pipeline Health")).toBeTruthy();
    fireEvent.click(within(msg.parentElement as HTMLElement).getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByText("IG Live Posting")).toBeNull();
  });

  it("positive control: a good read still lists the kill switches", () => {
    window.history.replaceState({}, "", "/admin?growthTab=local");
    h.queries.set("socialPipeline.status", ok(PIPELINE));
    render(<LocalGrowthTab />);
    expect(screen.getByText("IG Live Posting")).toBeTruthy();
    expect(screen.queryByText(/kill-switch states are unknown/)).toBeNull();
  });
});

describe("Website & Local > Content Manager: generation log", () => {
  it("ContentManager: a failed generation log is unknown in the tile and the log tab", () => {
    h.queries.set("contentAdmin.allArticles", ok([]));
    h.queries.set("contentAdmin.allNotifications", ok([]));
    h.queries.set("contentAdmin.generationLog", FAILED);
    render(<ContentManager />);
    const tile = screen.getByText("AI Generations").parentElement?.parentElement as HTMLElement;
    expect(tile.querySelector(".stat-value")?.textContent).not.toMatch(/\d/);
    expect(within(tile).getByText("Unable to determine")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Generation Log/ }));
    expect(screen.queryByText(/NO GENERATION HISTORY/i)).toBeNull();
    expect(screen.getByText("Generation log couldn't load. Unknown, not empty.")).toBeTruthy();
  });

  it("ContentManager positive control: a real empty log still reads zero and no history", () => {
    h.queries.set("contentAdmin.allArticles", ok([]));
    h.queries.set("contentAdmin.allNotifications", ok([]));
    h.queries.set("contentAdmin.generationLog", ok([]));
    render(<ContentManager />);
    const tile = screen.getByText("AI Generations").parentElement?.parentElement as HTMLElement;
    expect(tile.querySelector(".stat-value")?.textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: /Generation Log/ }));
    expect(screen.getByText(/No generation history/i)).toBeTruthy();
  });
});
