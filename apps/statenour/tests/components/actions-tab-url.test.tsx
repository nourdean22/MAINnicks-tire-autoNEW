/**
 * UI v3 W1b: /system/actions reads its tab from the URL. `?tab=approvals` opens the approvals
 * panel on load (Home's "Review approvals" used to land on the log and cost a hunt); the tab
 * buttons write `?tab=` back with router.replace and no scroll jump; the approval-windows box sits
 * below the queue, not above it. Rendered with renderToStaticMarkup like the sibling actions tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ search: "" as string, replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/system/actions",
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
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
        getPendingApprovals: { useQuery: q([]) },
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

const render = (search: string) => {
  nav.search = search;
  return renderToStaticMarkup(<ActionsPage />);
};
const APPROVALS_HEADING = "pending action queue";

afterEach(() => {
  nav.search = "";
  nav.replace.mockClear();
});

describe("/system/actions tab from the URL", () => {
  it("?tab=approvals renders the approvals panel on load", () => {
    const html = render("tab=approvals");
    expect(html).toContain(APPROVALS_HEADING);
    expect(html).toContain("no pending tool approvals");
  });

  it("no ?tab renders the log (the default did not move)", () => {
    const html = render("");
    expect(html).not.toContain(APPROVALS_HEADING);
  });

  it("an unknown ?tab falls back to the log", () => {
    expect(render("tab=nonsense")).not.toContain(APPROVALS_HEADING);
  });

  it("the approval-windows box sits below the queue (plan row 3)", () => {
    const html = render("tab=approvals");
    const queue = html.indexOf("no pending tool approvals");
    const windows = html.indexOf("approval windows");
    expect(queue).toBeGreaterThan(-1);
    expect(windows).toBeGreaterThan(queue);
  });
});

describe("/system/actions tab writer (source pin: a static render cannot click)", () => {
  const src = readFileSync(join(process.cwd(), "app/(mastery)/system/actions/page.tsx"), "utf8");

  it("writes ?tab= back with router.replace and no scroll jump", () => {
    expect(src).toMatch(/router\.replace\([^;]*\{\s*scroll:\s*false\s*\}\s*\)/);
    expect(src).not.toMatch(/router\.push\(/);
    expect(src).not.toMatch(/useState<"logs" \| "approvals">/);
  });

  it("wraps the search-params reader in a Suspense boundary (Next 16 app router)", () => {
    expect(src).toContain("useSearchParams()");
    expect(src).toMatch(/<Suspense fallback=\{null\}>\s*<ActionsPageInner \/>/);
  });
});
