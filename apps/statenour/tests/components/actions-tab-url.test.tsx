// @vitest-environment jsdom
/**
 * /system/actions, wave E1 (2026-10-24): approve or reject is the page. The pending queue (with its
 * deferred automation and approval windows) is on top, "Needs review" above it; the success rings, rule
 * leaderboard and recent feed sit in ONE closed "History" fold. `?tab=logs` opens the fold on load;
 * Home's `?tab=approvals` links, a missing value and garbage leave it closed. A failed approvals read
 * says so instead of rendering "no pending", and a closed History says when its own read failed
 * (empty-vs-error). Rendered with react-dom/client in jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  search: "" as string,
  approvals: { data: [] as unknown[] | undefined, isError: false, refetch: vi.fn() },
  actions: { data: undefined as unknown, isError: false },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(h.search),
  usePathname: () => "/system/actions",
}));
vi.mock("@/lib/trpc/client", () => {
  const q = (data: unknown) => () => ({ data, isError: false, isPending: false, isFetching: false, refetch: () => {} });
  const m = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      system: {
        autonomousActions: {
          useQuery: () => ({ data: h.actions.data, isError: h.actions.isError, isPending: false, isFetching: false, refetch: () => {} }),
        },
        getCurrentUser: { useQuery: q({ role: "owner" }) },
        approveApprovalRequest: { useMutation: m },
        rejectApprovalRequest: { useMutation: m },
        getApprovalsNeedingReview: { useQuery: q([{ id: "r1", toolId: "review.tool.r1", status: "needs_review", resultPayload: { error: "stuck" }, updatedAt: new Date() }]) },
        dismissApprovalReview: { useMutation: m },
      },
      systemAutomation: {
        getPendingApprovals: {
          useQuery: () => ({ data: h.approvals.data, isError: h.approvals.isError, isPending: false, isFetching: false, refetch: h.approvals.refetch }),
        },
        approvals: { useQuery: q(undefined) },
        approvalWindows: { useQuery: q({ source: "default", defaultDays: 7, windows: [] }) },
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

const APPROVALS_HEADING = "pending action queue";
const READ_FAILED = "Approvals could not be read. State unknown, not empty.";
const pending = (id: string) => ({ id, toolId: `pending.tool.${id}`, status: "pending_approval", riskClass: "low", payload: {} });
const feedWith = () => ({
  totalInWindow: 1,
  generatedAt: "2026-10-24T12:00:00Z",
  rules: [{ ruleName: "rule.alpha", total: 1, success: 1, failed: 0, successRate: 1, lastFiredAt: "2026-10-24T11:00:00Z" }],
  recent: [],
  approvalBreakdown: { auto: 1, pending: 0, approved: 0, rejected: 0, processing: 0, needs_review: 0, other: 0 },
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  h.search = "";
  h.approvals = { data: [], isError: false, refetch: vi.fn() };
  h.actions = { data: undefined, isError: false };
  vi.restoreAllMocks();
});

const render = (search: string) => {
  h.search = search;
  act(() => {
    root.render(<ActionsPage />);
  });
  return container;
};
const click = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const history = (el: HTMLElement) => el.querySelector<HTMLDetailsElement>('details[aria-label="History"]')!;

describe("/system/actions is queue first", () => {
  it("renders the pending queue by default, with no tab buttons", () => {
    const el = render("");
    expect(el.textContent).toContain(APPROVALS_HEADING);
    expect(el.textContent).toContain("no pending tool approvals");
    const labels = [...el.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(labels.some((t) => t.includes("Autonomous Log"))).toBe(false);
    expect(labels.some((t) => t.includes("Pending Approvals"))).toBe(false);
  });

  it("Needs review is above the queue and the queue is above History", () => {
    h.actions.data = feedWith();
    const html = render("").innerHTML;
    const review = html.indexOf("review.tool.r1");
    const queue = html.indexOf(APPROVALS_HEADING);
    const fold = html.indexOf('aria-label="History"');
    expect(review).toBeGreaterThan(-1);
    expect(queue).toBeGreaterThan(review);
    expect(fold).toBeGreaterThan(queue);
  });

  it("the success ring, rule leaderboard and recent feed live inside ONE closed History fold", () => {
    h.actions.data = feedWith();
    const el = render("");
    expect(el.querySelectorAll('details[aria-label="History"]').length).toBe(1);
    const fold = history(el);
    expect(fold.open).toBe(false);
    expect(fold.textContent).toContain("rule leaderboard");
    expect(fold.textContent).toContain("recent · last 100");
    expect(fold.textContent).toContain("rule.alpha");
  });

  it("?tab=logs opens History on load; approvals links and garbage leave it closed", () => {
    expect(history(render("tab=logs")).open).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    expect(history(render("tab=approvals")).open).toBe(false);
    act(() => root.unmount());
    root = createRoot(container);
    expect(history(render("tab=nonsense")).open).toBe(false);
  });

  it("the approval-windows box sits below the queue LIST (plan row 3)", () => {
    h.approvals.data = [pending("a1"), pending("a2")];
    const html = render("").innerHTML;
    const lastCard = html.lastIndexOf("pending.tool.a2");
    const windows = html.indexOf("approval windows");
    expect(lastCard).toBeGreaterThan(-1);
    expect(windows).toBeGreaterThan(lastCard);
  });
});

describe("/system/actions failed reads (empty-vs-error)", () => {
  it("a failed approvals read says unknown, offers Retry, and never says 'no pending'", () => {
    h.approvals = { data: undefined, isError: true, refetch: vi.fn() };
    const el = render("");
    expect(el.textContent).toContain(READ_FAILED);
    expect(el.textContent).not.toContain("no pending tool approvals");
    const retry = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Retry")!;
    expect(retry).toBeTruthy();
    click(retry);
    expect(h.approvals.refetch).toHaveBeenCalledTimes(1);
  });

  it("the queue badge shows a dash on a failed first read, and the last count when a refetch fails", () => {
    h.approvals = { data: undefined, isError: true, refetch: vi.fn() };
    let badge = render("").querySelector("h2 span")!;
    expect(badge.textContent).toBe("-");
    act(() => root.unmount());
    root = createRoot(container);
    h.approvals = { data: [pending("a1"), pending("a2"), pending("a3")], isError: true, refetch: vi.fn() };
    badge = render("").querySelector("h2 span")!;
    expect(badge.textContent).toBe("3");
  });

  it("control: a clean empty read says 'no pending' and shows no badge", () => {
    const el = render("");
    expect(el.textContent).toContain("no pending tool approvals");
    expect(el.textContent).not.toContain(READ_FAILED);
    const queueHeading = [...el.querySelectorAll("h2")].find((x) => x.textContent?.includes(APPROVALS_HEADING))!;
    expect(queueHeading.querySelector("span")).toBeNull();
  });

  it("a closed History says when its own read failed", () => {
    h.actions = { data: undefined, isError: true };
    expect(history(render("")).querySelector("summary")!.textContent).toContain("log unreadable");
  });

  it("control: a healthy log makes no such claim", () => {
    h.actions.data = feedWith();
    expect(history(render("")).querySelector("summary")!.textContent).not.toContain("unreadable");
  });
});
