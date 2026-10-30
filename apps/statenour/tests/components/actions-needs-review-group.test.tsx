/**
 * /system/actions renders approved-then-unfinished approvals in their own
 * "Needs review" group (audit 2026-10-10, controller ruling). The group sits
 * above the tabs so it is visible on load (the approvals tab is not the
 * default), names the tool, when, and the error, and offers a two-tap
 * in-DOM Dismiss. A failed read says unknown; a clean read renders nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
// The decisions maxim has its own tests (maxim-line, decision-maxim-pages); this page test reads the page's own controls.
vi.mock("@/components/wisdom/maxim-line", () => ({ DecisionMaxim: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/system/actions", useRouter: () => ({ replace: () => {}, push: () => {} }) }));

const stub = vi.hoisted(() => ({ review: {} as Record<string, unknown> }));

vi.mock("@/lib/trpc/client", () => {
  const q = (data: unknown) => () => ({ data, isError: false, isPending: false, isFetching: false, refetch: () => {} });
  const m = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      system: {
        autonomousActions: { useQuery: q(undefined) },
        getCurrentUser: { useQuery: q({ role: "owner" }) },
        approveApprovalRequest: { useMutation: m },
        rejectApprovalRequest: { useMutation: m },
        getApprovalsNeedingReview: { useQuery: () => stub.review },
        dismissApprovalReview: { useMutation: m },
      },
      systemAutomation: {
        getPendingApprovals: {
          useQuery: q([{ id: "p1", toolId: "pending.tool", status: "pending_approval", riskClass: "low", payload: {} }]),
        },
        approvals: { useQuery: q(undefined) },
        approvalWindows: { useQuery: q(undefined) },
        decideApproval: { useMutation: m },
      },
    },
  };
});
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));

import ActionsPage from "@/app/(mastery)/system/actions/page";

const render = () => renderToStaticMarkup(<ActionsPage />);
const group = (html: string) => {
  const at = html.indexOf('aria-labelledby="needs-review-heading"');
  if (at < 0) return "";
  return html.slice(at, html.indexOf("</section>", at));
};

beforeEach(() => {
  stub.review = {
    data: [
      { id: "r1", toolId: "shop.sendSms", status: "needs_review", resultPayload: { error: "Execution did not finish within 5 minutes" }, updatedAt: new Date() },
      { id: "f1", toolId: "calendar.create", status: "failed", resultPayload: { error: "403 forbidden" }, updatedAt: new Date() },
    ],
    isError: false,
  };
});

describe("/system/actions · Needs review group", () => {
  it("lists needs_review and failed rows with tool, status word and error", () => {
    const g = group(render());
    expect(g).toContain("Needs review");
    expect(g).toContain("shop.sendSms");
    expect(g).toContain("may have run");
    expect(g).toContain("Execution did not finish within 5 minutes");
    expect(g).toContain("calendar.create");
    expect(g).toContain("403 forbidden");
  });

  it("each row has an in-DOM Dismiss button, unarmed on load", () => {
    const g = group(render());
    expect(g.split(">Dismiss<").length - 1).toBe(2);
    expect(g).not.toContain("Confirm dismiss");
  });

  it("does not mix in pending approvals", () => {
    expect(group(render())).not.toContain("pending.tool");
  });

  it("a failed read says unknown, never nothing", () => {
    stub.review = { data: undefined, isError: true };
    expect(group(render())).toContain("unknown · read failed");
  });

  it("POSITIVE CONTROL: a clean read renders no group", () => {
    stub.review = { data: [], isError: false };
    expect(group(render())).toBe("");
  });
});
