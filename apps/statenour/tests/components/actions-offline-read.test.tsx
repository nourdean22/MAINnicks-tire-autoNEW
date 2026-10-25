// @vitest-environment jsdom
/**
 * /system/actions offline (lens B review P3 row 4, 2026-10-25): a PWA with no connection leaves a tRPC
 * query PAUSED (no data, no error, still isPending), and the page read isPending as "in flight": the
 * header said "loading...", the approvals list "loading approvals…", the deferred queue and approval
 * windows "loading…" for as long as the connection was down. A paused read is offline, not loading
 * (lib/query-state.ts readState; the same fix PR 3287 made in observability-status-panel.tsx).
 *
 * Control: the same page with a query that really is loading still says loading, and with data it draws
 * the data, so the offline branch did not swallow either.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ mode: "offline" as "offline" | "loading" | "ready" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=logs"),
  usePathname: () => "/system/actions",
}));
vi.mock("@/lib/trpc/client", () => {
  const refetch = () => {};
  // One shape per mode, as react-query v5 reports them: paused = pending with fetchStatus "paused".
  const q = (ready: unknown) => () =>
    h.mode === "ready"
      ? { data: ready, isError: false, isPending: false, isLoading: false, isFetching: false, fetchStatus: "idle", refetch }
      : h.mode === "offline"
        ? { data: undefined, isError: false, isPending: true, isLoading: false, isFetching: false, fetchStatus: "paused", refetch }
        : { data: undefined, isError: false, isPending: true, isLoading: true, isFetching: true, fetchStatus: "fetching", refetch };
  const m = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      system: {
        autonomousActions: {
          useQuery: q({
            totalInWindow: 3,
            generatedAt: "2026-10-25T12:00:00Z",
            rules: [],
            recent: [],
            approvalBreakdown: { auto: 0, pending: 0, approved: 0, rejected: 0, processing: 0, needs_review: 0, other: 0 },
          }),
        },
        getCurrentUser: { useQuery: q({ role: "owner" }) },
        approveApprovalRequest: { useMutation: m },
        rejectApprovalRequest: { useMutation: m },
        getApprovalsNeedingReview: { useQuery: q([]) },
        dismissApprovalReview: { useMutation: m },
      },
      systemAutomation: {
        getPendingApprovals: { useQuery: q([]) },
        approvals: { useQuery: q({ summary: { live: 0, expired: 0 }, rows: [] }) },
        approvalWindows: { useQuery: q({ source: "default", defaultDays: 7, windows: [] }) },
        decideApproval: { useMutation: m },
      },
    },
  };
});
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ description, actions, children }: { description?: ReactNode; actions?: ReactNode; children?: ReactNode }) => (
    <main>
      <p data-page-description>{description}</p>
      <div>{actions}</div>
      {children}
    </main>
  ),
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));

import ActionsPage from "@/app/(mastery)/system/actions/page";

let container: HTMLDivElement;
let root: Root;
function mount(mode: "offline" | "loading" | "ready") {
  h.mode = mode;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ActionsPage />);
  });
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const text = () => (container.textContent ?? "").replace(/\s+/g, " ");

describe("/system/actions offline", () => {
  it("a paused read renders the offline note and never a loading verdict", () => {
    mount("offline");
    expect(container.querySelector("[data-page-description]")!.textContent).toContain("Offline. The action feed shows when the connection returns.");
    expect(container.querySelectorAll('[data-read-state="offline"]').length).toBeGreaterThanOrEqual(3);
    expect(text()).toContain("Offline. The approvals queue shows when the connection returns.");
    expect(text()).not.toMatch(/loading/i);
    expect(text()).not.toContain("Refreshing");
    // a pause is not an empty queue either
    expect(text()).not.toContain("no pending tool approvals");
    expect(text()).not.toContain("no autonomous actions in this window");
  });

  it("control: a read that really is in flight still says loading", () => {
    mount("loading");
    expect(container.querySelector("[data-page-description]")!.textContent).toBe("loading...");
    expect(text()).toContain("loading approvals…");
    expect(container.querySelector('[data-read-state="offline"]')).toBeNull();
  });

  it("control: a completed read draws its data, not an offline note", () => {
    mount("ready");
    expect(container.querySelector("[data-page-description]")!.textContent).toContain("3 in window");
    expect(text()).toContain("no pending tool approvals");
    expect(container.querySelector('[data-read-state="offline"]')).toBeNull();
    expect(text()).not.toMatch(/loading/i);
  });
});
