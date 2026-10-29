// @vitest-environment jsdom
/**
 * /system/actions live-decisions total (2026-10-29 sync audit, finding 2; Codex P2 on #3354): the header
 * counts live requests plus live autonomous actions, the number Home and the app badge show. With either
 * read unanswered the total is unknown, never the other queue's count.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ autoFailed: false }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=logs"),
  usePathname: () => "/system/actions",
}));
vi.mock("@/lib/trpc/client", () => {
  const refetch = () => {};
  const ok = (data: unknown) => () => ({ data, isError: false, isPending: false, isLoading: false, isFetching: false, fetchStatus: "idle", refetch });
  const failed = () => ({ data: undefined, isError: true, isPending: false, isLoading: false, isFetching: false, fetchStatus: "idle", refetch });
  const m = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      system: {
        autonomousActions: {
          useQuery: ok({
            totalInWindow: 3,
            generatedAt: "2026-10-25T12:00:00Z",
            rules: [],
            recent: [],
            approvalBreakdown: { auto: 0, pending: 0, approved: 0, rejected: 0, processing: 0, needs_review: 0, other: 0 },
          }),
        },
        getCurrentUser: { useQuery: ok({ role: "owner" }) },
        approveApprovalRequest: { useMutation: m },
        rejectApprovalRequest: { useMutation: m },
        getApprovalsNeedingReview: { useQuery: ok([]) },
        dismissApprovalReview: { useMutation: m },
      },
      systemAutomation: {
        // Two live requests and one expired one.
        getPendingApprovals: { useQuery: ok([{ id: "a", expired: false }, { id: "b", expired: false }, { id: "c", expired: true }]) },
        approvals: {
          useQuery: () =>
            h.autoFailed ? failed() : ok({ summary: { live: 1, expired: 0 }, rows: [{ id: "x", expired: false }] })(),
        },
        approvalWindows: { useQuery: ok({ source: "default", defaultDays: 7, windows: [] }) },
        decideApproval: { useMutation: m },
      },
    },
  };
});
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ description, children }: { description?: ReactNode; children?: ReactNode }) => (
    <main>
      <p data-page-description>{description}</p>
      {children}
    </main>
  ),
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));

import ActionsPage from "@/app/(mastery)/system/actions/page";

let container: HTMLDivElement;
let root: Root;
function description(autoFailed: boolean) {
  h.autoFailed = autoFailed;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ActionsPage />));
  return container.querySelector("[data-page-description]")!.textContent ?? "";
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("/system/actions live decisions total", () => {
  it("both reads answered: live requests plus live autonomous actions, expired apart", () => {
    expect(description(false)).toContain("3 live, 1 expired");
  });

  it("the autonomous read failed: the total is unknown, not the requests' 2", () => {
    const d = description(true);
    expect(d).toContain("live decisions unknown");
    expect(d).not.toMatch(/\d+ live/);
  });
});
