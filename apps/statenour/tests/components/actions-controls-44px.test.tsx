// @vitest-environment jsdom
/**
 * /system/actions tap targets (lens B review P2, 2026-10-25): on a phone the Refresh button (px-4 py-2
 * text-xs, about 32 px), the window chips, the approval chips and "Clear rule filter" (px-3 py-1
 * text-xs, about 24 px) sat under the 44 px house floor (tests/e2e/target-size.spec.ts measures 44 px on
 * both axes; /system/actions is not one of its pages and its History fold is closed by default).
 *
 * jsdom does not lay out Tailwind, so, as in tests/components/journal-system-44px-controls.test.tsx, the
 * floor is read from the class of the measured element: min-h-11 (44 px) or larger on every control, and
 * a width floor on the chips ("24h" measured 43 px wide with px-3 alone). The page is rendered with
 * seeded data because the chips and the leaderboard only mount with a feed, and "Clear rule filter" only
 * exists after a rule row is clicked.
 *
 * Positive control: a planted px-3 py-1 control fails the same check, and the sweep must locate all nine
 * controls (a scanner that matched nothing would pass on a deleted chip).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=logs"),
  usePathname: () => "/system/actions",
}));
vi.mock("@/lib/trpc/client", () => {
  const q = (data: unknown) => () => ({ data, isError: false, isPending: false, isFetching: false, refetch: () => {} });
  const m = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      system: {
        autonomousActions: { useQuery: q({
          totalInWindow: 3,
          generatedAt: "2026-10-25T12:00:00Z",
          rules: [{ ruleName: "rule.alpha", total: 3, success: 3, failed: 0, skipped: 0, successRate: 100, lastFiredAt: "2026-10-25T11:00:00Z" }],
          recent: [],
          approvalBreakdown: { auto: 1, pending: 1, approved: 1, rejected: 0, processing: 0, needs_review: 0, other: 0 },
        }) },
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
  StandardPage: ({ actions, children }: { actions?: ReactNode; children?: ReactNode }) => (
    <main>
      <div data-page-actions>{actions}</div>
      {children}
    </main>
  ),
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));

import ActionsPage from "@/app/(mastery)/system/actions/page";

/** Height floor: min-h-11 / min-h-[44px] / h-11 or taller. A later, smaller min-h would win, so it is read last. */
const HEIGHT_PX = (cls: string): number => {
  let px = 0;
  for (const m of cls.matchAll(/(?:^|\s)(?:min-h|h)-(\d+|\[(\d+)px\])(?=\s|$)/g)) {
    px = m[2] ? Number(m[2]) : Number(m[1]) * 4;
  }
  return px;
};
const WIDTH_PX = (cls: string): number => {
  let px = 0;
  for (const m of cls.matchAll(/(?:^|\s)(?:min-w|w)-(\d+|\[(\d+)px\])(?=\s|$)/g)) {
    px = m[2] ? Number(m[2]) : Number(m[1]) * 4;
  }
  return px;
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ActionsPage />);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
const byText = (re: RegExp) => buttons().filter((b) => re.test((b.textContent ?? "").trim()));

/** The four controls the review named, located by what they say. */
function subjects(): { label: string; el: HTMLButtonElement; wide: boolean }[] {
  const out: { label: string; el: HTMLButtonElement; wide: boolean }[] = [];
  for (const el of byText(/^Refresh$/)) out.push({ label: "Refresh", el, wide: false });
  for (const el of byText(/^(24h|7d|30d)$/)) out.push({ label: `window ${el.textContent}`, el, wide: true });
  for (const el of byText(/^(auto|pending|approved|rejected) ·/)) out.push({ label: `approval ${el.textContent}`, el, wide: true });
  for (const el of byText(/^Clear rule filter/)) out.push({ label: "Clear rule filter", el, wide: false });
  return out;
}

describe("/system/actions controls reach the 44 px floor", () => {
  it("renders Refresh, three window chips and four approval chips", () => {
    expect(subjects().length).toBe(8);
  });

  it("Clear rule filter exists once a rule row is selected, and the sweep sees all nine", () => {
    const row = byText(/rule\.alpha/)[0];
    expect(row, "the seeded rule row rendered").toBeTruthy();
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(subjects().length).toBe(9);
    expect(subjects().map((s) => s.label)).toContain("Clear rule filter");
  });

  it("every one is at least 44 px tall; the chips are at least 44 px wide", () => {
    const row = byText(/rule\.alpha/)[0];
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const found = subjects();
    expect(found.length, "the subject rendered no controls").toBe(9);
    // Collect every violation so a red run names all of them, not the first.
    const under: string[] = [];
    for (const { label, el, wide } of found) {
      const cls = el.getAttribute("class") ?? "";
      if (HEIGHT_PX(cls) < 44) under.push(`${label}: under 44 px tall`);
      if (wide && WIDTH_PX(cls) < 44) under.push(`${label}: under 44 px wide`);
    }
    expect(under).toEqual([]);
  });

  it("positive control: a planted px-3 py-1 control fails the same check", () => {
    const planted = "rounded-full px-3 py-1 text-xs transition";
    expect(HEIGHT_PX(planted)).toBe(0);
    expect(HEIGHT_PX("min-h-[32px] rounded-control")).toBe(32);
    expect(HEIGHT_PX("min-h-11 rounded-full")).toBe(44);
    expect(HEIGHT_PX("min-h-11 min-h-[32px]")).toBe(32);
    expect(WIDTH_PX("min-h-11 min-w-11")).toBe(44);
  });
});
