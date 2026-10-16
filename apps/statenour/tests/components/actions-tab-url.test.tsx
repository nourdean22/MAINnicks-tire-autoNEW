// @vitest-environment jsdom
/**
 * UI v3 W1b: /system/actions reads its tab from the URL. `?tab=approvals` opens the approvals
 * panel on load (Home's "Review approvals" used to land on the log and cost a hunt); a tab button
 * writes `?tab=` back with window.history.replaceState (Next syncs useSearchParams from it, no
 * RSC refetch, no scroll); the approval-windows box sits below the queue list; a failed approvals
 * read says so instead of rendering "no pending" (empty-vs-error). Rendered with react-dom/client
 * in jsdom so the writer is clicked, not regex-pinned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  search: "" as string,
  approvals: { data: [] as unknown[] | undefined, isError: false, refetch: vi.fn() },
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
        autonomousActions: { useQuery: q(undefined) },
        getCurrentUser: { useQuery: q({ role: "owner" }) },
        approveApprovalRequest: { useMutation: m },
        rejectApprovalRequest: { useMutation: m },
        getApprovalsNeedingReview: { useQuery: q([]) },
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
const tabButton = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

describe("/system/actions tab from the URL", () => {
  it("?tab=approvals renders the approvals panel on load", () => {
    const el = render("tab=approvals");
    expect(el.textContent).toContain(APPROVALS_HEADING);
    expect(el.textContent).toContain("no pending tool approvals");
  });

  it("no ?tab renders the log (the default did not move)", () => {
    expect(render("").textContent).not.toContain(APPROVALS_HEADING);
  });

  it("an unknown ?tab falls back to the log", () => {
    expect(render("tab=nonsense").textContent).not.toContain(APPROVALS_HEADING);
  });

  it("the approval-windows box sits below the queue LIST (plan row 3)", () => {
    h.approvals.data = [pending("a1"), pending("a2")];
    const html = render("tab=approvals").innerHTML;
    const lastCard = html.lastIndexOf("pending.tool.a2");
    const windows = html.indexOf("approval windows");
    expect(lastCard).toBeGreaterThan(-1);
    expect(windows).toBeGreaterThan(lastCard);
  });
});

describe("/system/actions tab writer", () => {
  it("clicking Pending Approvals writes ?tab=approvals with history.replaceState (no RSC refetch, no scroll)", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    const el = render("");
    click(tabButton(el, "Pending Approvals"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(null, "", "/system/actions?tab=approvals");
    expect(window.location.search).toBe("?tab=approvals");
  });

  it("clicking Autonomous Log writes ?tab=logs and keeps other params", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    const el = render("tab=approvals&rule=x");
    click(tabButton(el, "Autonomous Log"));
    expect(spy).toHaveBeenCalledWith(null, "", "/system/actions?tab=logs&rule=x");
  });
});

describe("/system/actions approvals read failure (empty-vs-error)", () => {
  it("a failed read says unknown, offers Retry, and never says 'no pending'", () => {
    h.approvals = { data: undefined, isError: true, refetch: vi.fn() };
    const el = render("tab=approvals");
    expect(el.textContent).toContain(READ_FAILED);
    expect(el.textContent).not.toContain("no pending tool approvals");
    const retry = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Retry")!;
    expect(retry).toBeTruthy();
    click(retry);
    expect(h.approvals.refetch).toHaveBeenCalledTimes(1);
  });

  it("the tab badge shows a dash on a failed first read, and the last count when a refetch fails", () => {
    h.approvals = { data: undefined, isError: true, refetch: vi.fn() };
    let badge = tabButton(render("tab=approvals"), "Pending Approvals").querySelector("span")!;
    expect(badge.textContent).toBe("-");
    act(() => root.unmount());
    root = createRoot(container);
    h.approvals = { data: [pending("a1"), pending("a2"), pending("a3")], isError: true, refetch: vi.fn() };
    badge = tabButton(render("tab=approvals"), "Pending Approvals").querySelector("span")!;
    expect(badge.textContent).toBe("3");
  });

  it("control: a clean empty read still says 'no pending' and shows no badge", () => {
    const el = render("tab=approvals");
    expect(el.textContent).toContain("no pending tool approvals");
    expect(el.textContent).not.toContain(READ_FAILED);
    expect(tabButton(el, "Pending Approvals").querySelector("span")).toBeNull();
  });
});
