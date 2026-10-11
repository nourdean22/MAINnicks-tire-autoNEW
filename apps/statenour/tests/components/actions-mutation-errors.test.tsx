/**
 * /system/actions mutation feedback and approval-breakdown chips.
 *
 * P-S5b: approve and reject had no onError, so a refused decision (the server's CONFLICT when the request changed,
 * was decided elsewhere, or expired) failed silently: the button re-enabled and nothing said why.
 * R3-01 hand-off B: the feed now counts processing, needs_review and an `other` bucket, but the page rendered chips
 * for the four original keys only, so those rows were counted in "N in window" and shown nowhere.
 *
 * The tRPC mock records each mutation's options so the handlers can be driven directly (node, no DOM).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

type MutationOpts = { onSuccess?: () => void; onError?: (err: unknown) => void };
const h = vi.hoisted(() => ({
  opts: {} as Record<string, MutationOpts | undefined>,
  refetch: vi.fn(),
  feed: undefined as unknown,
  feedError: false,
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("@/lib/trpc/client", () => {
  const q = (data: () => unknown, isError: () => boolean = () => false) => () => ({
    data: data(),
    isError: isError(),
    isPending: false,
    isFetching: false,
    refetch: h.refetch,
  });
  const m = (name: string) => (opts?: MutationOpts) => {
    h.opts[name] = opts;
    return { mutate: () => {}, isPending: false, isError: false };
  };
  return {
    trpc: {
      system: {
        autonomousActions: { useQuery: q(() => h.feed, () => h.feedError) },
        getCurrentUser: { useQuery: q(() => ({ role: "owner" })) },
        approveApprovalRequest: { useMutation: m("approve") },
        rejectApprovalRequest: { useMutation: m("reject") },
        getApprovalsNeedingReview: { useQuery: q(() => []) },
        dismissApprovalReview: { useMutation: m("dismiss") },
      },
      systemAutomation: {
        getPendingApprovals: { useQuery: q(() => []) },
        approvals: { useQuery: q(() => undefined) },
        approvalWindows: { useQuery: q(() => undefined) },
        decideApproval: { useMutation: m("decide") },
      },
    },
  };
});
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ description, children }: { description?: ReactNode; children?: ReactNode }) => (
    <main>
      <p data-description="">{description}</p>
      {children}
    </main>
  ),
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));

import ActionsPage from "@/app/(mastery)/system/actions/page";

const render = () => renderToStaticMarkup(<ActionsPage />);
const feed = (approvalBreakdown: Record<string, number>, totalInWindow: number) => ({
  recent: [],
  rules: [],
  approvalBreakdown,
  totalInWindow,
  generatedAt: "2026-10-11T10:00:00.000Z",
});

beforeEach(() => {
  h.opts = {};
  h.refetch.mockReset();
  h.toastError.mockReset();
  h.feed = undefined;
  h.feedError = false;
});

describe("approve / reject surface their failures (P-S5b)", () => {
  // "decide" is the deferred-automation Approve/Reject on the same page: same silent-failure shape.
  for (const name of ["approve", "reject", "decide"] as const) {
    it(`${name}: a server error is toasted with the server's message`, () => {
      render();
      const onError = h.opts[name]?.onError;
      expect(onError, `${name} has an onError`).toBeTypeOf("function");
      onError?.({ message: "guardian unreachable", data: { code: "INTERNAL_SERVER_ERROR" } });
      expect(h.toastError).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(h.toastError.mock.calls[0])).toContain("guardian unreachable");
    });

    it(`${name}: a CONFLICT says it changed elsewhere and refreshes the queue`, () => {
      render();
      h.opts[name]?.onError?.({ message: "This approval is approved now; reload and check it again", data: { code: "CONFLICT" } });
      expect(h.toastError).toHaveBeenCalledTimes(1);
      expect(h.toastError.mock.calls[0][0]).toBe("Changed since it was read. Refreshing.");
      expect(JSON.stringify(h.toastError.mock.calls[0][1])).toContain("approved now");
      expect(h.refetch).toHaveBeenCalled();
    });
  }
});

describe("approval breakdown chips cover every bucket the feed counts (R3-01 hand-off B)", () => {
  it("renders processing, needs review and other when the feed counts them", () => {
    h.feed = feed({ auto: 5, pending: 0, approved: 1, rejected: 0, processing: 1, needs_review: 2, other: 3 }, 12);
    const html = render();
    expect(html).toContain("needs review");
    expect(html).toContain("processing");
    expect(html).toContain("other");
    expect(html).toMatch(/needs review[^<]*<[^>]*>2</);
  });

  it("control: a feed with the new buckets at zero adds no extra chips", () => {
    h.feed = feed({ auto: 5, pending: 0, approved: 1, rejected: 0, processing: 0, needs_review: 0, other: 0 }, 6);
    const html = render();
    expect(html).not.toContain("needs review");
    expect(html).toContain("auto");
  });

  it("a failed feed read shows unknown on the chips, not a confident 0", () => {
    h.feedError = true;
    const html = render();
    expect(html).toContain("unknown");
    expect(html).not.toMatch(/auto [^<]{1,2}<span[^>]*>0</);
    expect(html).toMatch(/auto [^<]{1,2}\?</); // the chip says it does not know
  });
});
